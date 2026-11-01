// Matches every library item to a real IKEA India product (name, price, link, photo) and writes
// web/src/data/real-products.json. Data comes from IKEA's public site search (robots.txt allows it);
// requests are cached per query and sent one per second. Re-run to refresh prices:
//   npx tsx scripts/products/fetch-ikea.mts
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { catalog, type CatalogItem } from "../../web/src/data/catalog";

const OUT = resolve(import.meta.dirname, "../../web/src/data/real-products.json");
const SEARCH = "https://sik.search.blue.cdtapps.com/in/en/search-result-page?size=40&types=PRODUCT&q=";

/** IKEA search phrase per library item; null = IKEA India doesn't sell this kind of thing. */
function queryFor(item: CatalogItem): string | null {
  const n = item.name.toLowerCase();
  const seats = /three|3/.test(n) ? "3-seat sofa" : "2-seat sofa";
  switch (item.family) {
    case "sofa": return n.startsWith("loveseat") ? "2-seat sofa" : seats;
    case "sectional": return "corner sofa chaise longue";
    case "armchair": return n.includes("outdoor") ? "outdoor armchair" : n.includes("wingback") ? "wing chair" : n.includes("barrel") || n.includes("slipper") ? "armchair" : n.includes("lounge") ? "lounge chair" : "armchair";
    case "recliner": return "recliner armchair";
    case "chair": return n.includes("kids") ? "children's chair" : n.includes("metal") ? "chair metal" : n.includes("upholstered") ? "upholstered chair" : "chair";
    case "office-chair": return n.includes("executive") ? "office chair" : n.includes("ergonomic") ? "ergonomic office chair" : "desk chair";
    case "stool": return "bar stool";
    case "bench": return n.includes("garden") ? "outdoor bench" : n.includes("entry") ? "bench with shoe storage" : "bench";
    case "bed": {
      const size = n.startsWith("single") ? "90x200" : n.startsWith("double") ? "140x200" : n.startsWith("queen") ? "160x200" : "180x200";
      return (n.includes("tufted") ? "upholstered bed frame " : "bed frame ") + size;
    }
    case "bunk-bed": return "bunk bed frame";
    case "crib": return "cot";
    case "nightstand": return "bedside table";
    case "dresser": return "chest of drawers";
    case "cabinet": return "cabinet with doors";
    case "wardrobe": return n.includes("sliding") ? "wardrobe with sliding doors" : n.includes("mirror") ? "wardrobe with mirror door" : "wardrobe";
    case "bookshelf": return n.includes("low") ? "low bookcase" : n.includes("display") ? "shelving unit" : "bookcase";
    case "wall-shelf": return "wall shelf";
    case "tv-unit": return n.includes("floating") ? "wall mounted tv bench" : n.includes("media cabinet") ? "tv storage combination" : "tv bench";
    case "table": return n.includes("kids") ? "children's table" : n.includes("8-seat") ? "extendable dining table" : "dining table";
    case "round-table": return "round dining table";
    case "coffee-table": return n.includes("nesting") ? "nest of tables" : n.includes("glass") ? "glass coffee table" : n.includes("round") ? "round coffee table" : "coffee table";
    case "side-table": return "side table";
    case "desk": return n.includes("standing") ? "sit/stand desk" : n.includes("corner") ? "corner desk" : "desk";
    case "floor-lamp": return n === "floor lamp" ? "floor lamp" : n.includes("arc") ? "arc floor lamp" : "floor lamp";
    case "table-lamp": return "table lamp";
    case "desk-lamp": return "work lamp";
    case "pendant": return "pendant lamp";
    case "ceiling-light": return "ceiling lamp";
    case "rug": {
      const size = n.match(/(\d\.\d) × (\d\.\d)/);
      return n.includes("round") ? "round rug" : n.includes("runner") ? "runner rug" : "rug " + (size ? `${Math.round(+size[1]! * 100)}x${Math.round(+size[2]! * 100)}` : "");
    }
    case "plant": return n.includes("succulent") ? "artificial potted plant succulent" : "artificial potted plant";
    case "vase": return "vase";
    case "mirror": return n.includes("floor") ? "standing mirror" : n.includes("round") ? "round mirror" : "mirror";
    case "artwork": return n.includes("canvas") ? "picture" : n.includes("botanical") ? "poster plants" : n.includes("landscape") ? "poster landscape" : "poster";
    case "curtains": return "curtains";
    case "kitchen-counter": return "kitchen base cabinet";
    case "kitchen-island": return "kitchen island";
    case "sink-cabinet": return "sink cabinet";
    case "vanity": return "wash-stand";
    case "lounger": return "sun lounger";
    case "parasol": return "parasol";
    case "toy-box": return "toy storage";
    default: return null; // TV, monitor, fridge, stove, toilet, bathtub, shower: not sold by IKEA India
  }
}

const COLOURS: Record<string, string> = {
  white: "#f4f4f2", "off-white": "#ece6da", black: "#222222", "black-brown": "#3a2e28", grey: "#8c8c8c", "dark grey": "#555555", "light grey": "#c4c4c4",
  beige: "#d8c9ad", "light beige": "#e6dcc8", brown: "#7a5536", "dark brown": "#4b3324", oak: "#c49a6c", "white stained oak": "#d9c7ab", walnut: "#6e4b33",
  birch: "#d6b98c", pine: "#d9b27c", bamboo: "#c9a46a", rattan: "#b88a55", green: "#6f8a5d", "dark green": "#3e5a3e", "light green": "#a8bf8f",
  blue: "#4a6a94", "dark blue": "#2b3d5c", "light blue": "#a7bfd6", red: "#a83a32", pink: "#d9a3a8", yellow: "#d9b440", orange: "#d47d3a",
  anthracite: "#3d3f42", "golden-brown": "#a8783f", turquoise: "#3f9c9a", natural: "#d9c39c",
};
const hex = (value: string) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
const distance = (a: string, b: string) => Math.hypot(...hex(a).map((v, i) => v - hex(b)[i]!));
function colourOf(text: string): string | undefined {
  const t = text.toLowerCase().replace(/-/g, " ");
  return Object.keys(COLOURS).sort((a, b) => b.length - a.length).find((name) => t.includes(name.replace(/-/g, " ")));
}

type Candidate = { name: string; type: string; price: number; url: string; image: string; measure: string; colour?: string; rating?: number };
const cache = new Map<string, Candidate[]>();
async function search(query: string): Promise<Candidate[]> {
  if (cache.has(query)) return cache.get(query)!;
  await new Promise((done) => setTimeout(done, 1000));
  const response = await fetch(SEARCH + encodeURIComponent(query), { headers: { "user-agent": "OrbisCatalogSync/1.0 (product matching for an interior design app)" } });
  if (!response.ok) throw new Error(`${query}: HTTP ${response.status}`);
  const data = await response.json() as { searchResultPage: { products: { main: { items: { product: Record<string, any> }[] } } } };
  const found: Candidate[] = [];
  for (const { product } of data.searchResultPage.products.main.items ?? []) {
    for (const p of [product, ...(product.gprDescription?.variants ?? [])]) {
      const price = p.salesPrice?.numeral;
      if (!price || !p.pipUrl || !p.onlineSellable && p.onlineSellable !== undefined && false) continue;
      found.push({ name: p.name, type: p.typeName, price, url: p.pipUrl, image: p.mainImageUrl ?? p.imageUrl, measure: p.itemMeasureReferenceText ?? "", colour: colourOf(p.pipUrl.split("/p/")[1] ?? "") ?? colourOf(p.mainImageAlt ?? ""), rating: p.ratingValue });
    }
  }
  const unique = [...new Map(found.map((c) => [c.url, c])).values()];
  cache.set(query, unique);
  return unique;
}

/** The IKEA product type a match must have (checked against "typeName"), per library family. */
function typeRule(item: CatalogItem): RegExp {
  const n = item.name.toLowerCase();
  const rules: Partial<Record<CatalogItem["family"], RegExp>> = {
    sofa: /^[23]-seat sofa$/i, sectional: /(corner sofa|sofa with chaise|chaise longue)/i, armchair: n.includes("outdoor") ? /armchair, outdoor|chair, outdoor|armchair/i : n.includes("wingback") ? /^wing chair/i : /^(armchair|easy chair|lounge chair)$/i,
    recliner: /recliner|^armchair$/i, chair: n.includes("kids") ? /children's chair|junior chair/i : /^chair$/i, "office-chair": /office chair|swivel chair/i,
    stool: /^bar stool/i, bench: n.includes("garden") ? /^bench, outdoor|^bench$/i : n.includes("entry") ? /bench with (shoe )?storage|shoe bench/i : /^bench/i,
    bed: n.startsWith("single") ? /^(bed frame|upholstered bed frame|day-bed)/i : /^(bed frame|upholstered bed frame)/i, "bunk-bed": /^bunk bed frame/i, crib: /^cot\b/i,
    nightstand: /^bedside table/i, dresser: /^chest of \d drawers/i, cabinet: /^cabinet/i, wardrobe: /^wardrobe/i,
    bookshelf: n.includes("low") ? /^(bookcase|shelving unit)/i : n.includes("display") ? /^shelving unit/i : /^bookcase/i, "wall-shelf": /^wall shelf$/i,
    "tv-unit": /^tv (bench|storage|unit)/i, table: n.includes("kids") ? /children's table/i : /^(table|extendable table|dining table)$/i,
    "round-table": /^(table|extendable table)$/i, "coffee-table": n.includes("nesting") ? /^nest of tables/i : /^coffee table$/i, "side-table": /^side table$/i,
    desk: n.includes("standing") ? /sit\/stand/i : n.includes("corner") ? /corner (desk|workstation)|^desk/i : /^desk$/i,
    "floor-lamp": /^floor (lamp|uplighter)/i, "table-lamp": /^table lamp$/i, "desk-lamp": /work lamp|desk lamp/i, pendant: /^pendant lamp$/i, "ceiling-light": /^ceiling (lamp|spotlight)/i,
    rug: /^rug/i, plant: /^artificial potted plant$/i, vase: /^vase$/i, mirror: /^mirror$/i, artwork: n.includes("canvas") ? /^picture$/i : /^(picture|poster|frame)$/i,
    curtains: /^curtains, 1 pair$/i, "kitchen-counter": /^base cabinet/i, "kitchen-island": /kitchen island|island/i, "sink-cabinet": /sink/i, vanity: /^wash-stand/i,
    lounger: /sun lounger/i, parasol: /^parasol/i, "toy-box": /^(storage bench|chest|toy|storage combination|storage with)/i,
  };
  return rules[item.family] ?? /./;
}

/** Lower is better: colour closeness, width/length closeness when IKEA states a size, and rejects off-type items. */
function score(item: CatalogItem, c: Candidate, query: string) {
  const type = c.type.toLowerCase();
  const key = query.split(" ").filter((w) => w.length > 3 && !/^\d/.test(w)).at(-1) ?? "";
  if (!typeRule(item).test(c.type.trim())) return Infinity;
  let s = type.includes(key.replace(/s$/, "")) ? 0 : 40;
  if (/cover|cushion|mattress|leg|frame for|insert|accessor|tray|bulb|shade$/.test(type)) s += 400;
  if (c.colour) s += distance(item.color, COLOURS[c.colour]!) * 0.6; else s += 60;
  const cm = c.measure.match(/(\d+)\s*x\s*(\d+)/) ?? c.measure.match(/(\d+)\s*cm/);
  if (cm) {
    const a = +cm[1]! / 100, b = cm[2] ? +cm[2] / 100 : a;
    const round = /round|Ø/.test(item.name) && item.family !== "rug" ? true : /round/i.test(item.name);
    if (round && Math.abs(a - b) > 0.05 && cm[2]) s += 200;
    const [ta, tb] = [item.dimensions.width, item.dimensions.depth].sort((x, y) => y - x);
    s += Math.abs(Math.log(Math.max(a, b) / ta!)) * 150 + (cm[2] && /bed|rug|table|desk/.test(item.family) ? Math.abs(Math.log(Math.min(a, b) / tb!)) * 100 : 0);
  }
  return s;
}

// Output: a product table plus, per library item, up to 5 ranked IKEA matches (the app picks by current colour).
const products: Record<string, object> = {};
const items: Record<string, string[]> = {};
const checkedAt = new Date().toISOString().slice(0, 10);
let matched = 0;
for (const item of catalog) {
  if (item.opening || item.group === "basic") continue;
  const query = queryFor(item);
  if (!query) continue;
  const candidates = await search(query);
  const ranked = candidates.map((c) => ({ c, s: score(item, c, query) })).filter((r) => Number.isFinite(r.s) && r.s < 380).sort((a, b) => a.s - b.s);
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const { c } of ranked) {
    const key = c.url.replace(/\/$/, "").split("-").at(-1)!;
    const family = c.name + c.type;
    if (seen.has(family + c.colour)) continue;
    seen.add(family + c.colour);
    products[key] = { name: `${c.name} ${c.type}`.trim(), price: c.price, url: c.url, image: c.image, measure: c.measure || undefined, colour: c.colour, hex: c.colour ? COLOURS[c.colour] : undefined, rating: c.rating, checkedAt };
    keys.push(key);
    if (keys.length === 5) break;
  }
  if (!keys.length) { console.warn("no match:", item.name, "←", query); continue; }
  items[item.id] = keys;
  matched += 1;
}
writeFileSync(OUT, JSON.stringify({ checkedAt, products, items }) + "\n");
console.log(`Matched ${matched} items, ${Object.keys(products).length} products, ${cache.size} searches → ${OUT}`);
