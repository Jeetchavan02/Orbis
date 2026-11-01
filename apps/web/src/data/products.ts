import { retailerSearchLinks, type ProductRef } from "@reality-builder/shared";
import type { CatalogItem } from "./catalog";
import realProducts from "./real-products.json";

/**
 * Real-world counterparts of library items. IKEA India matches (name, price, link, photo) come from
 * scripts/products/fetch-ikea.mts and are dated; re-run it to refresh prices. Amazon.in and Flipkart have no
 * open product API, so they get search links for the same item.
 */
type RealProduct = { name: string; price: number; url: string; image?: string; measure?: string; colour?: string; hex?: string; rating?: number; checkedAt: string };
const DATA = realProducts as { checkedAt: string; products: Record<string, RealProduct>; items: Record<string, string[]> };

function toRef(key: string, real: RealProduct): ProductRef {
  return {
    productId: "ikea:" + key, retailerId: "ikea", retailerName: "IKEA India", productName: real.name, brand: real.name.split(" ")[0]!,
    price: real.price, currency: "INR", productUrl: real.url, ...(real.image ? { thumbnailUrl: real.image } : {}),
    ...(real.colour ? { material: real.colour } : {}), availability: "unknown", priceCheckedAt: real.checkedAt, sample: false, representation: "scaled-approximation",
  };
}

/** All IKEA matches for a library item, best first. */
export function realOptionsFor(entry: CatalogItem | undefined): (ProductRef & { measure?: string; rating?: number; hex?: string })[] {
  if (!entry) return [];
  return (DATA.items[entry.id] ?? []).map((key) => {
    const real = DATA.products[key]!;
    return { ...toRef(key, real), measure: real.measure, rating: real.rating, hex: real.hex };
  });
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const colourGap = (a: string, b: string) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]!));

/** The real product for an item; with `colour` (the object's current colour) the closest-coloured match wins. */
export function realProductFor(entry: CatalogItem | undefined, colour?: string) {
  const options = realOptionsFor(entry);
  if (!colour || !/^#[0-9a-f]{6}$/i.test(colour)) return options[0];
  return options.map((option, rank) => ({ option, cost: (option.hex ? colourGap(option.hex, colour) : 120) + rank * 12 })).sort((a, b) => a.cost - b.cost)[0]?.option;
}

/** Amazon.in and Flipkart searches for the item (base name plus colour, e.g. "wingback chair sage"). */
export function marketplaceLinks(name: string) {
  const query = name.replace(/\s+—\s+/, " ").replace(/[,Ø]/g, " ").replace(/\s+/g, " ").trim();
  return retailerSearchLinks(query).filter((link) => link.id === "amazon" || link.id === "flipkart");
}
