import type { Dimensions3D, FurnitureCategory, LightFixture, ObjectConstraints } from "@reality-builder/shared";

/** Rendering family: each one is a parametric 3D model in FurnitureModel.tsx. */
export type Family =
  | "sofa" | "sectional" | "armchair" | "recliner" | "chair" | "office-chair" | "stool" | "bench"
  | "bed" | "bunk-bed" | "crib" | "nightstand" | "dresser" | "cabinet" | "wardrobe" | "bookshelf" | "wall-shelf" | "tv-unit"
  | "table" | "round-table" | "coffee-table" | "side-table" | "desk"
  | "floor-lamp" | "table-lamp" | "desk-lamp" | "pendant" | "ceiling-light"
  | "rug" | "plant" | "vase" | "mirror" | "artwork" | "tv" | "monitor"
  | "kitchen-counter" | "kitchen-island" | "fridge" | "stove" | "sink-cabinet"
  | "toilet" | "vanity" | "bathtub" | "shower" | "lounger" | "parasol" | "toy-box" | "box"
  | "door" | "window";

export type GroupId =
  | "sofas" | "chairs" | "beds" | "tables" | "storage" | "shelves" | "lighting" | "rugs" | "plants"
  | "decor" | "media" | "kitchen" | "bathroom" | "outdoor" | "kids" | "openings" | "basic";

export type RoomType = "bedroom" | "living" | "dining" | "kitchen" | "bathroom" | "office" | "study" | "kids" | "outdoor";

export type ModelParams = Record<string, string | number | boolean | undefined>;

export type CatalogItem = {
  id: string;
  name: string;
  category: FurnitureCategory;
  group: GroupId;
  family: Family;
  dimensions: Dimensions3D;
  /** Primary material colour (fabric/body); editable per object in the inspector. */
  color: string;
  params: ModelParams;
  rooms: RoomType[];
  /** Height above the floor when placed (wall/ceiling-mounted items). */
  elevation?: number;
  light?: LightFixture;
  constraints?: ObjectConstraints;
  /** Doors and windows become room openings instead of furniture. */
  opening?: { kind: "door" | "window"; width: number; height: number; sillHeight: number };
};

export const CATEGORY_LABELS: Record<FurnitureCategory, string> = {
  beds: "Beds", seating: "Seating", tables: "Tables & desks", storage: "Storage", lighting: "Lighting", decor: "Decor", other: "Other",
};

export const ROOM_TYPES: { id: RoomType; label: string }[] = [
  { id: "bedroom", label: "Bedroom" }, { id: "living", label: "Living room" }, { id: "dining", label: "Dining room" },
  { id: "kitchen", label: "Kitchen" }, { id: "bathroom", label: "Bathroom" }, { id: "office", label: "Home office" },
  { id: "study", label: "Study room" }, { id: "kids", label: "Kids' room" }, { id: "outdoor", label: "Outdoor / patio" },
];

/** Library groups with their icon (lucide name) and consistent accent colour. */
export const GROUPS: Record<GroupId, { label: string; icon: string; color: string }> = {
  sofas: { label: "Sofas", icon: "Sofa", color: "#d9822b" },
  chairs: { label: "Chairs", icon: "Armchair", color: "#d9822b" },
  beds: { label: "Beds", icon: "BedDouble", color: "#6b7fd7" },
  tables: { label: "Tables & desks", icon: "Table2", color: "#a0714f" },
  storage: { label: "Storage", icon: "Archive", color: "#7a8a99" },
  shelves: { label: "Shelves", icon: "Library", color: "#7a8a99" },
  lighting: { label: "Lighting", icon: "Lamp", color: "#d6a21e" },
  rugs: { label: "Rugs", icon: "Grid2X2", color: "#b2667a" },
  plants: { label: "Plants", icon: "Sprout", color: "#3f9a5b" },
  decor: { label: "Decor", icon: "Frame", color: "#9a6ab5" },
  media: { label: "TV & media", icon: "Tv", color: "#4a90a8" },
  kitchen: { label: "Kitchen", icon: "Refrigerator", color: "#3d8c8c" },
  bathroom: { label: "Bathroom", icon: "Bath", color: "#3b8fd1" },
  outdoor: { label: "Outdoor", icon: "Umbrella", color: "#5c9e3d" },
  kids: { label: "Kids", icon: "Baby", color: "#e0679a" },
  openings: { label: "Doors & windows", icon: "DoorOpen", color: "#8c7b6b" },
  basic: { label: "Basic shapes", icon: "Box", color: "#8a94a6" },
};

type Swatch = { name: string; color: string };
const FABRIC: Swatch[] = [
  { name: "Oatmeal", color: "#cdbfa8" }, { name: "Charcoal", color: "#4a4d50" }, { name: "Sage", color: "#8fa38b" },
  { name: "Navy", color: "#3a4a66" }, { name: "Terracotta", color: "#b8694a" },
];
const LEATHER: Swatch[] = [{ name: "Cognac leather", color: "#8a4b2a" }, { name: "Black leather", color: "#2b2522" }];
const VELVET: Swatch[] = [{ name: "Emerald velvet", color: "#2f6b55" }, { name: "Mustard velvet", color: "#c99a2e" }, { name: "Blush velvet", color: "#d6a6a0" }];
const WOOD: Swatch[] = [
  { name: "Oak", color: "#c49a6c" }, { name: "Walnut", color: "#6e4a33" }, { name: "White", color: "#eeeae3" },
  { name: "Black", color: "#2c2a28" }, { name: "Ash", color: "#d8c3a0" },
];
const METAL: Swatch[] = [{ name: "Brass", color: "#b08d57" }, { name: "Matte black", color: "#2a2a2a" }, { name: "Chrome", color: "#c9ccd0" }];
const RUG_COLORS: Swatch[] = [{ name: "Ivory", color: "#e3dccd" }, { name: "Slate", color: "#6f7780" }, { name: "Rust", color: "#a65a3c" }];

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const items: CatalogItem[] = [];
function add(entry: Omit<CatalogItem, "id"> & { id?: string }) {
  items.push({ ...entry, id: entry.id ?? slug(`${entry.family}-${entry.name}`) });
}
type Size = { label: string; w: number; d: number; h: number };

// ---------- Seating ----------
const SOFA_STYLES = [
  { key: "modern", label: "Modern", params: { arm: "box", leg: "block", back: 0.42, cushions: true } },
  { key: "classic", label: "Classic rolled-arm", params: { arm: "rolled", leg: "taper", back: 0.45, cushions: true } },
  { key: "midcentury", label: "Mid-century", params: { arm: "slim", leg: "taper", back: 0.38, cushions: true, buttons: true } },
  { key: "chesterfield", label: "Chesterfield", params: { arm: "rolled", leg: "block", back: 0.36, cushions: false, tufted: true } },
  { key: "minimal", label: "Minimalist", params: { arm: "slim", leg: "metal", back: 0.32, cushions: false } },
  { key: "lounge", label: "Low lounge", params: { arm: "none", leg: "none", back: 0.3, cushions: true } },
];
for (const style of SOFA_STYLES) {
  for (const seats of [2, 3]) {
    const swatches = style.key === "chesterfield" ? [...LEATHER, VELVET[0]!, VELVET[1]!] : FABRIC.slice(0, 4);
    for (const swatch of swatches) {
      add({
        name: `${style.label} ${seats === 2 ? "two" : "three"}-seater — ${swatch.name}`, category: "seating", group: "sofas", family: "sofa",
        dimensions: { width: seats === 2 ? 1.6 : 2.2, depth: style.key === "lounge" ? 1.0 : 0.92, height: style.key === "lounge" ? 0.72 : 0.84 },
        color: swatch.color, params: { ...style.params, seats }, rooms: ["living", "study"],
      });
    }
  }
}
for (const swatch of [...FABRIC.slice(0, 3), ...VELVET]) {
  add({ name: `Loveseat — ${swatch.name}`, category: "seating", group: "sofas", family: "sofa", dimensions: { width: 1.3, depth: 0.85, height: 0.82 }, color: swatch.color, params: { arm: "rolled", leg: "taper", back: 0.42, cushions: true, seats: 2 }, rooms: ["living", "bedroom", "study"] });
}
for (const [label, params] of [["Modular", { arm: "box", leg: "block" }], ["Contemporary", { arm: "slim", leg: "metal" }], ["Deep-seat", { arm: "box", leg: "none" }]] as const) {
  for (const side of ["left", "right"]) {
    for (const swatch of FABRIC.slice(0, 4)) {
      add({ name: `${label} L-shaped sectional, ${side} chaise — ${swatch.name}`, category: "seating", group: "sofas", family: "sectional", dimensions: { width: 2.8, depth: 1.7, height: 0.84 }, color: swatch.color, params: { ...params, side, back: 0.4 }, rooms: ["living"] });
    }
  }
}
const ARMCHAIRS = [
  { label: "Club armchair", params: { arm: "box", leg: "block", back: 0.42, cushions: true, seats: 1 }, dims: { width: 0.9, depth: 0.85, height: 0.8 } },
  { label: "Wingback chair", params: { arm: "rolled", leg: "taper", back: 0.6, cushions: true, seats: 1, wings: true }, dims: { width: 0.85, depth: 0.85, height: 1.1 } },
  { label: "Slipper chair", params: { arm: "none", leg: "taper", back: 0.45, cushions: false, seats: 1 }, dims: { width: 0.65, depth: 0.75, height: 0.82 } },
  { label: "Mid-century lounge chair", params: { arm: "slim", leg: "taper", back: 0.4, cushions: true, seats: 1, buttons: true }, dims: { width: 0.8, depth: 0.82, height: 0.82 } },
  { label: "Barrel chair", params: { arm: "barrel", leg: "none", back: 0.35, cushions: true, seats: 1 }, dims: { width: 0.8, depth: 0.78, height: 0.75 } },
];
for (const chair of ARMCHAIRS) {
  for (const swatch of [...FABRIC, ...VELVET.slice(0, 1)]) {
    add({ name: `${chair.label} — ${swatch.name}`, category: "seating", group: "chairs", family: "armchair", dimensions: chair.dims, color: swatch.color, params: chair.params, rooms: ["living", "bedroom", "study", "office"] });
  }
}
for (const [label, w] of [["Recliner", 0.9], ["Wide recliner", 1.05]] as const) {
  for (const swatch of [...LEATHER, FABRIC[1]!, FABRIC[0]!]) {
    add({ name: `${label} — ${swatch.name}`, category: "seating", group: "chairs", family: "recliner", dimensions: { width: w, depth: 0.95, height: 1.02 }, color: swatch.color, params: {}, rooms: ["living", "study"] });
  }
}
const CHAIRS = [
  { label: "Panel dining chair", params: { back: "panel", leg: "taper" } },
  { label: "Slat-back dining chair", params: { back: "slats", leg: "taper" } },
  { label: "Windsor chair", params: { back: "spindles", leg: "taper" } },
  { label: "Scandi chair", params: { back: "curve", leg: "taper" } },
  { label: "Metal café chair", params: { back: "slats", leg: "metal" } },
  { label: "Upholstered dining chair", params: { back: "upholstered", leg: "taper" } },
];
for (const chair of CHAIRS) {
  for (const swatch of WOOD.slice(0, 4)) {
    add({ name: `${chair.label} — ${swatch.name}`, category: "seating", group: "chairs", family: "chair", dimensions: { width: 0.46, depth: 0.52, height: 0.88 }, color: swatch.color, params: { ...chair.params, seatColor: chair.params.back === "upholstered" ? "#bfb3a0" : swatch.color }, rooms: chair.label.startsWith("Metal") ? ["dining", "kitchen", "outdoor"] : ["dining", "kitchen"], constraints: { frontClearance: 0 } });
  }
}
for (const [label, params] of [["Task chair", { back: "mesh", arms: false }], ["Ergonomic office chair", { back: "mesh", arms: true, headrest: true }], ["Executive chair", { back: "padded", arms: true, headrest: true }]] as const) {
  for (const swatch of [{ name: "Black", color: "#2b2d30" }, { name: "Grey", color: "#7c8188" }, { name: "Blue", color: "#3d5a80" }]) {
    add({ name: `${label} — ${swatch.name}`, category: "seating", group: "chairs", family: "office-chair", dimensions: { width: 0.62, depth: 0.62, height: label === "Task chair" ? 0.95 : 1.15 }, color: swatch.color, params, rooms: ["office", "study", "kids"], constraints: { frontClearance: 0 } });
  }
}
for (const [label, params, h] of [["Round bar stool", { seat: "round", base: "legs" }, 0.75], ["Square counter stool", { seat: "square", base: "legs" }, 0.65], ["Pedestal stool", { seat: "round", base: "pedestal" }, 0.7]] as const) {
  for (const swatch of [WOOD[0]!, WOOD[3]!, METAL[0]!]) {
    add({ name: `${label} — ${swatch.name}`, category: "seating", group: "chairs", family: "stool", dimensions: { width: 0.4, depth: 0.4, height: h }, color: swatch.color, params, rooms: ["kitchen", "dining"], constraints: { frontClearance: 0 } });
  }
}
for (const [label, params, w] of [["Dining bench", { back: false, legs: "taper" }, 1.4], ["Entry bench", { back: false, legs: "panel" }, 1.0], ["Garden bench", { back: true, legs: "panel" }, 1.5]] as const) {
  for (const swatch of WOOD.slice(0, 3)) {
    add({ name: `${label} — ${swatch.name}`, category: "seating", group: label === "Garden bench" ? "outdoor" : "chairs", family: "bench", dimensions: { width: w, depth: 0.4, height: params.back ? 0.85 : 0.46 }, color: swatch.color, params, rooms: label === "Garden bench" ? ["outdoor"] : ["dining", "bedroom", "living"], constraints: { frontClearance: 0 } });
  }
}

// ---------- Beds ----------
const BED_SIZES: Size[] = [
  { label: "Single", w: 0.95, d: 2.0, h: 0.95 }, { label: "Double", w: 1.4, d: 2.05, h: 1.0 },
  { label: "Queen", w: 1.6, d: 2.1, h: 1.05 }, { label: "King", w: 1.9, d: 2.15, h: 1.1 },
];
const HEADBOARDS = [{ key: "panel", label: "Panel" }, { key: "tufted", label: "Tufted" }, { key: "slat", label: "Slatted" }, { key: "low", label: "Low platform" }];
for (const size of BED_SIZES) {
  for (const head of HEADBOARDS) {
    for (const swatch of [WOOD[0]!, WOOD[1]!, { name: "Grey upholstered", color: "#8a8d91" }]) {
      add({ name: `${size.label} bed, ${head.label.toLowerCase()} — ${swatch.name}`, category: "beds", group: "beds", family: "bed", dimensions: { width: size.w, depth: size.d, height: head.key === "low" ? 0.7 : size.h }, color: "#d4d9df", params: { headboard: head.key, frame: swatch.color }, rooms: size.label === "Single" ? ["bedroom", "kids"] : ["bedroom"] });
    }
  }
}
for (const swatch of WOOD.slice(0, 3)) {
  add({ name: `Bunk bed — ${swatch.name}`, category: "beds", group: "kids", family: "bunk-bed", dimensions: { width: 1.0, depth: 2.05, height: 1.65 }, color: "#c9d3dc", params: { frame: swatch.color }, rooms: ["kids"] });
  add({ name: `Baby crib — ${swatch.name}`, category: "beds", group: "kids", family: "crib", dimensions: { width: 0.7, depth: 1.25, height: 0.95 }, color: swatch.color, params: {}, rooms: ["kids", "bedroom"] });
}

// ---------- Storage ----------
const CASE_STYLES = [{ key: "legs", label: "Mid-century" }, { key: "plinth", label: "Modern" }, { key: "classic", label: "Classic" }, { key: "float", label: "Handle-less" }];
for (const style of CASE_STYLES) {
  for (const swatch of WOOD.slice(0, 3)) {
    add({ name: `${style.label} nightstand — ${swatch.name}`, category: "storage", group: "storage", family: "nightstand", dimensions: { width: 0.5, depth: 0.4, height: 0.55 }, color: swatch.color, params: { base: style.key, drawers: 2 }, rooms: ["bedroom", "kids"], constraints: { frontClearance: 0.4 } });
    add({ name: `${style.label} dresser — ${swatch.name}`, category: "storage", group: "storage", family: "dresser", dimensions: { width: 1.2, depth: 0.48, height: 0.85 }, color: swatch.color, params: { base: style.key, drawers: 3, columns: 2 }, rooms: ["bedroom"] });
    add({ name: `${style.label} cabinet — ${swatch.name}`, category: "storage", group: "storage", family: "cabinet", dimensions: { width: 0.9, depth: 0.45, height: 1.0 }, color: swatch.color, params: { base: style.key, doors: 2 }, rooms: ["living", "dining", "office", "study"] });
  }
}
for (const [label, params, w] of [["Two-door wardrobe", { doors: 2, mirror: false }, 1.0], ["Three-door wardrobe", { doors: 3, mirror: false }, 1.5], ["Mirrored wardrobe", { doors: 2, mirror: true }, 1.2], ["Sliding wardrobe", { doors: 2, sliding: true }, 1.8]] as const) {
  for (const swatch of [WOOD[0]!, WOOD[2]!, WOOD[1]!]) {
    add({ name: `${label} — ${swatch.name}`, category: "storage", group: "storage", family: "wardrobe", dimensions: { width: w, depth: 0.6, height: 2.1 }, color: swatch.color, params, rooms: ["bedroom", "kids"] });
  }
}
for (const [label, params, dims] of [["Tall bookcase", { shelves: 5, books: true }, { width: 0.8, depth: 0.3, height: 1.9 }], ["Wide bookcase", { shelves: 4, books: true, dividers: 2 }, { width: 1.5, depth: 0.35, height: 1.6 }], ["Low bookcase", { shelves: 2, books: true }, { width: 1.0, depth: 0.3, height: 0.8 }], ["Open display shelf", { shelves: 4, books: false, open: true }, { width: 0.9, depth: 0.35, height: 1.8 }]] as const) {
  for (const swatch of WOOD.slice(0, 3)) {
    add({ name: `${label} — ${swatch.name}`, category: "storage", group: "shelves", family: "bookshelf", dimensions: dims, color: swatch.color, params, rooms: ["living", "study", "office", "kids"], constraints: { frontClearance: 0.5 } });
  }
}
for (const [label, w] of [["Floating shelf", 0.8], ["Long floating shelf", 1.2], ["Double wall shelf", 0.9]] as const) {
  for (const swatch of WOOD.slice(0, 3)) {
    add({ name: `${label} — ${swatch.name}`, category: "storage", group: "shelves", family: "wall-shelf", elevation: 1.4, dimensions: { width: w, depth: 0.22, height: label.startsWith("Double") ? 0.45 : 0.15 }, color: swatch.color, params: { double: label.startsWith("Double") }, rooms: ["living", "bedroom", "office", "study", "kitchen", "kids"], constraints: { frontClearance: 0 } });
  }
}
for (const [label, params, w] of [["Low TV unit", { compartments: 3, legs: true }, 1.8], ["Floating TV console", { compartments: 2, legs: false }, 1.6], ["Media cabinet", { compartments: 2, doors: true, legs: true }, 1.4], ["Wide TV bench", { compartments: 4, legs: false }, 2.2]] as const) {
  for (const swatch of [WOOD[1]!, WOOD[0]!, WOOD[3]!]) {
    add({ name: `${label} — ${swatch.name}`, category: "storage", group: "media", family: "tv-unit", dimensions: { width: w, depth: 0.42, height: 0.5 }, color: swatch.color, params, rooms: ["living", "bedroom"], constraints: { frontClearance: 0.4 } });
  }
}

// ---------- Tables ----------
const TABLE_SIZES: Size[] = [{ label: "4-seat", w: 1.2, d: 0.8, h: 0.75 }, { label: "6-seat", w: 1.8, d: 0.9, h: 0.75 }, { label: "8-seat", w: 2.3, d: 1.0, h: 0.75 }];
for (const legs of [{ key: "taper", label: "Tapered-leg" }, { key: "trestle", label: "Trestle" }, { key: "hairpin", label: "Industrial" }, { key: "panel", label: "Waterfall" }]) {
  for (const size of TABLE_SIZES) {
    for (const swatch of [WOOD[0]!, WOOD[1]!, WOOD[2]!]) {
      add({ name: `${legs.label} dining table ${size.label} — ${swatch.name}`, category: "tables", group: "tables", family: "table", dimensions: { width: size.w, depth: size.d, height: size.h }, color: swatch.color, params: { legs: legs.key }, rooms: ["dining", "kitchen"] });
    }
  }
}
for (const base of [{ key: "pedestal", label: "Pedestal" }, { key: "legs", label: "Four-leg" }]) {
  for (const diameter of [0.9, 1.2]) {
    for (const swatch of [WOOD[0]!, WOOD[2]!, WOOD[3]!]) {
      add({ name: `${base.label} round table Ø${diameter} m — ${swatch.name}`, category: "tables", group: "tables", family: "round-table", dimensions: { width: diameter, depth: diameter, height: 0.75 }, color: swatch.color, params: { base: base.key }, rooms: ["dining", "kitchen", "outdoor"] });
    }
  }
}
for (const [label, params, dims] of [["Rectangular coffee table", { shape: "rect", shelf: true }, { width: 1.1, depth: 0.6, height: 0.42 }], ["Round coffee table", { shape: "round", shelf: false }, { width: 0.85, depth: 0.85, height: 0.4 }], ["Glass coffee table", { shape: "rect", glass: true }, { width: 1.2, depth: 0.65, height: 0.4 }], ["Nesting coffee tables", { shape: "nest" }, { width: 0.9, depth: 0.55, height: 0.45 }]] as const) {
  for (const swatch of [WOOD[0]!, WOOD[1]!, WOOD[3]!]) {
    add({ name: `${label} — ${swatch.name}`, category: "tables", group: "tables", family: "coffee-table", dimensions: dims, color: swatch.color, params, rooms: ["living"], constraints: { frontClearance: 0 } });
  }
}
for (const [label, shape] of [["Round side table", "round"], ["Square side table", "square"], ["C-shaped side table", "c"]] as const) {
  for (const swatch of [WOOD[0]!, WOOD[3]!, METAL[0]!]) {
    add({ name: `${label} — ${swatch.name}`, category: "tables", group: "tables", family: "side-table", dimensions: { width: 0.45, depth: 0.45, height: 0.55 }, color: swatch.color, params: { shape }, rooms: ["living", "bedroom"], constraints: { frontClearance: 0 } });
  }
}
for (const [label, params, dims] of [["Writing desk", { pedestal: false, legs: "taper" }, { width: 1.2, depth: 0.6, height: 0.75 }], ["Pedestal desk", { pedestal: true, legs: "panel" }, { width: 1.4, depth: 0.7, height: 0.75 }], ["Standing desk", { pedestal: false, legs: "frame" }, { width: 1.5, depth: 0.75, height: 1.0 }], ["Corner desk", { pedestal: true, legs: "panel", corner: true }, { width: 1.5, depth: 1.2, height: 0.75 }]] as const) {
  for (const swatch of [WOOD[0]!, WOOD[2]!, WOOD[1]!]) {
    add({ name: `${label} — ${swatch.name}`, category: "tables", group: "tables", family: "desk", dimensions: dims, color: swatch.color, params, rooms: ["office", "study", "bedroom", "kids"] });
  }
}

// ---------- Lighting ----------
const warm = (intensity: number, height: number, kind: "point" | "spot" = "point"): LightFixture => ({ kind, on: true, intensity, color: "#ffd2a0", height });
for (const [label, shade] of [["Drum floor lamp", "drum"], ["Cone floor lamp", "cone"], ["Globe floor lamp", "globe"], ["Arc floor lamp", "arc"]] as const) {
  for (const swatch of [{ name: "Linen", color: "#e9dfc9" }, { name: "Black", color: "#2f2f2f" }, { name: "Brass", color: "#c9a96a" }]) {
    add({ name: `${label} — ${swatch.name}`, category: "lighting", group: "lighting", family: "floor-lamp", dimensions: { width: shade === "arc" ? 1.0 : 0.4, depth: 0.4, height: shade === "arc" ? 1.9 : 1.6 }, color: swatch.color, params: { shade }, rooms: ["living", "bedroom", "study", "office"], light: warm(9, 1.45), constraints: { frontClearance: 0 } });
  }
}
for (const [label, base] of [["Ceramic table lamp", "sphere"], ["Column table lamp", "column"], ["Tripod table lamp", "tripod"]] as const) {
  for (const swatch of [{ name: "White", color: "#f1ede6" }, { name: "Sage", color: "#9fb39a" }, { name: "Terracotta", color: "#c07a58" }]) {
    add({ name: `${label} — ${swatch.name}`, category: "lighting", group: "lighting", family: "table-lamp", dimensions: { width: 0.32, depth: 0.32, height: 0.55 }, color: swatch.color, params: { base }, rooms: ["bedroom", "living", "study", "office"], light: warm(5, 0.45), constraints: { frontClearance: 0 } });
  }
}
for (const [label, swatch] of [["Arm desk lamp", METAL[1]!], ["Arm desk lamp", METAL[0]!], ["Arm desk lamp", { name: "White", color: "#eeeeee" }], ["Mushroom desk lamp", { name: "Amber", color: "#d08a3a" }], ["Mushroom desk lamp", { name: "White", color: "#f2f0ea" }], ["Mushroom desk lamp", METAL[2]!]] as const) {
  add({ name: `${label} — ${swatch.name}`, category: "lighting", group: "lighting", family: "desk-lamp", dimensions: { width: 0.22, depth: 0.22, height: 0.45 }, color: swatch.color, params: { style: label.startsWith("Mushroom") ? "mushroom" : "arm" }, rooms: ["office", "study", "bedroom", "kids"], light: warm(6, 0.4, "spot"), constraints: { frontClearance: 0 } });
}
for (const [label, shade] of [["Dome pendant", "dome"], ["Globe pendant", "globe"], ["Cylinder pendant", "cylinder"]] as const) {
  for (const swatch of [METAL[1]!, METAL[0]!, { name: "White", color: "#f1efe9" }]) {
    add({ name: `${label} — ${swatch.name}`, category: "lighting", group: "lighting", family: "pendant", elevation: 1.85, dimensions: { width: 0.4, depth: 0.4, height: 0.8 }, color: swatch.color, params: { shade }, rooms: ["dining", "kitchen", "living", "bedroom"], light: warm(14, 0.1), constraints: { frontClearance: 0 } });
  }
}
for (const [label, w] of [["Flush ceiling light", 0.45], ["Large ceiling light", 0.6]] as const) {
  for (const swatch of [{ name: "White", color: "#f4f1ea" }, METAL[0]!, METAL[1]!]) {
    add({ name: `${label} — ${swatch.name}`, category: "lighting", group: "lighting", family: "ceiling-light", elevation: 2.5, dimensions: { width: w, depth: w, height: 0.1 }, color: swatch.color, params: {}, rooms: ["bedroom", "living", "dining", "kitchen", "bathroom", "office", "study", "kids"], light: warm(16, 0), constraints: { frontClearance: 0 } });
  }
}

// ---------- Rugs ----------
for (const size of [{ label: "1.6 × 2.3 m", w: 1.6, d: 2.3 }, { label: "2.0 × 3.0 m", w: 2.0, d: 3.0 }, { label: "1.2 × 1.8 m", w: 1.2, d: 1.8 }]) {
  for (const pattern of ["border", "stripes", "plain"]) {
    for (const swatch of RUG_COLORS) {
      add({ name: `${pattern[0]!.toUpperCase() + pattern.slice(1)} rug ${size.label} — ${swatch.name}`, category: "decor", group: "rugs", family: "rug", dimensions: { width: size.w, depth: size.d, height: 0.015 }, color: swatch.color, params: { pattern, shape: "rect" }, rooms: ["living", "bedroom", "dining", "study", "office", "kids"], constraints: { floorCovering: true } });
    }
  }
}
for (const diameter of [1.5, 2.0]) {
  for (const swatch of RUG_COLORS) {
    add({ name: `Round rug Ø${diameter} m — ${swatch.name}`, category: "decor", group: "rugs", family: "rug", dimensions: { width: diameter, depth: diameter, height: 0.015 }, color: swatch.color, params: { pattern: "border", shape: "round" }, rooms: ["living", "bedroom", "kids", "dining"], constraints: { floorCovering: true } });
  }
}
for (const swatch of RUG_COLORS) {
  add({ name: `Runner rug 0.8 × 2.5 m — ${swatch.name}`, category: "decor", group: "rugs", family: "rug", dimensions: { width: 0.8, depth: 2.5, height: 0.012 }, color: swatch.color, params: { pattern: "stripes", shape: "rect" }, rooms: ["kitchen", "bedroom", "living"], constraints: { floorCovering: true } });
}

// ---------- Plants & decor ----------
const FOLIAGE = [{ key: "bush", label: "Leafy bush" }, { key: "fiddle", label: "Fiddle-leaf fig" }, { key: "snake", label: "Snake plant" }, { key: "palm", label: "Areca palm" }, { key: "succulent", label: "Succulent" }];
const POTS = [{ key: "ceramic", label: "ceramic pot", color: "#e7e1d6" }, { key: "terracotta", label: "terracotta pot", color: "#b86b4b" }, { key: "basket", label: "woven basket", color: "#b89a6a" }];
for (const foliage of FOLIAGE) {
  for (const pot of POTS) {
    for (const size of foliage.key === "succulent" ? [{ label: "Small", s: 0.25 }, { label: "Medium", s: 0.35 }] : [{ label: "Medium", s: 0.8 }, { label: "Large", s: 1.4 }]) {
      add({ name: `${size.label} ${foliage.label} in ${pot.label}`, category: "decor", group: "plants", family: "plant", dimensions: { width: Math.max(0.25, size.s * 0.45), depth: Math.max(0.25, size.s * 0.45), height: size.s }, color: "#5f8f5a", params: { foliage: foliage.key, pot: pot.key, potColor: pot.color }, rooms: ["living", "bedroom", "office", "study", "dining", "kitchen", "bathroom", "outdoor"], constraints: { frontClearance: 0 } });
    }
  }
}
for (const [label, shape] of [["Tall vase", "tall"], ["Round vase", "round"], ["Bottle vase", "bottle"]] as const) {
  for (const swatch of [{ name: "White", color: "#f0ede6" }, { name: "Blue glaze", color: "#3f6c8f" }, { name: "Terracotta", color: "#b86b4b" }]) {
    add({ name: `${label} — ${swatch.name}`, category: "decor", group: "decor", family: "vase", dimensions: { width: 0.25, depth: 0.25, height: shape === "round" ? 0.3 : 0.5 }, color: swatch.color, params: { shape }, rooms: ["living", "dining", "bedroom"], constraints: { frontClearance: 0 } });
  }
}
for (const [label, params, dims, elevation] of [["Floor mirror", { frame: "thin" }, { width: 0.6, depth: 0.05, height: 1.7 }, 0], ["Round wall mirror", { round: true }, { width: 0.7, depth: 0.04, height: 0.7 }, 1.3], ["Arched wall mirror", { arch: true }, { width: 0.6, depth: 0.04, height: 0.9 }, 1.2]] as const) {
  for (const swatch of [METAL[0]!, METAL[1]!]) {
    add({ name: `${label} — ${swatch.name}`, category: "decor", group: "decor", family: "mirror", elevation, dimensions: dims, color: swatch.color, params, rooms: ["bedroom", "bathroom", "living"], constraints: { frontClearance: 0 } });
  }
}
const ART = [{ label: "Abstract canvas", colors: ["#d98c5f", "#3f6c8f", "#e8d8b0"] }, { label: "Landscape print", colors: ["#7fa3c2", "#7f9e6b", "#e6d6b8"] }, { label: "Botanical print", colors: ["#4f7f55", "#e9e2cf", "#2f4f3a"] }, { label: "Line art", colors: ["#f2efe8", "#2a2a2a", "#c9b79a"] }];
for (const art of ART) {
  for (const [size, w, h] of [["Small", 0.5, 0.6], ["Medium", 0.8, 0.6], ["Large", 1.2, 0.8]] as const) {
    add({ name: `${art.label}, ${size.toLowerCase()}`, category: "decor", group: "decor", family: "artwork", elevation: 1.3, dimensions: { width: w, depth: 0.04, height: h }, color: art.colors[0]!, params: { a: art.colors[1]!, b: art.colors[2]! }, rooms: ["living", "bedroom", "dining", "office", "study", "kids"], constraints: { frontClearance: 0 } });
  }
}
for (const [label, w] of [["43\" TV", 0.97], ["55\" TV", 1.23], ["65\" TV", 1.45]] as const) {
  add({ name: label, category: "other", group: "media", family: "tv", dimensions: { width: w, depth: 0.22, height: w * 0.6 + 0.08 }, color: "#1d1f22", params: {}, rooms: ["living", "bedroom"], constraints: { frontClearance: 0 } });
}
for (const [label, w] of [["24\" monitor", 0.55], ["Ultrawide monitor", 0.82]] as const) {
  add({ name: label, category: "other", group: "media", family: "monitor", dimensions: { width: w, depth: 0.2, height: 0.48 }, color: "#1d1f22", params: {}, rooms: ["office", "study"], constraints: { frontClearance: 0 } });
}

// ---------- Kitchen ----------
const KITCHEN_FINISH: Swatch[] = [{ name: "White", color: "#eeeae3" }, { name: "Sage", color: "#9aab95" }, { name: "Navy", color: "#334766" }];
for (const length of [1.2, 1.8, 2.4]) {
  for (const swatch of KITCHEN_FINISH) {
    add({ name: `Base cabinets ${length} m — ${swatch.name}`, category: "storage", group: "kitchen", family: "kitchen-counter", dimensions: { width: length, depth: 0.6, height: 0.9 }, color: swatch.color, params: { top: "#d9d4cb" }, rooms: ["kitchen"], constraints: { frontClearance: 1.0 } });
  }
}
for (const [label, w] of [["Kitchen island", 1.8], ["Large kitchen island", 2.4]] as const) {
  for (const swatch of KITCHEN_FINISH) {
    add({ name: `${label} — ${swatch.name}`, category: "storage", group: "kitchen", family: "kitchen-island", dimensions: { width: w, depth: 0.95, height: 0.92 }, color: swatch.color, params: { top: "#e6e2da" }, rooms: ["kitchen"], constraints: { frontClearance: 0.9 } });
  }
}
for (const [label, w, h] of [["Fridge", 0.7, 1.85], ["French-door fridge", 0.9, 1.8]] as const) {
  for (const swatch of [{ name: "Stainless", color: "#c7cacd" }, { name: "White", color: "#f1f1ef" }, { name: "Black", color: "#2c2d2f" }]) {
    add({ name: `${label} — ${swatch.name}`, category: "storage", group: "kitchen", family: "fridge", dimensions: { width: w, depth: 0.7, height: h }, color: swatch.color, params: { french: label.startsWith("French") }, rooms: ["kitchen"], constraints: { frontClearance: 0.9 } });
  }
}
for (const [label, w] of [["Range cooker", 0.6], ["Wide range cooker", 0.9]] as const) {
  for (const swatch of [{ name: "Stainless", color: "#c7cacd" }, { name: "Black", color: "#2c2d2f" }]) {
    add({ name: `${label} — ${swatch.name}`, category: "other", group: "kitchen", family: "stove", dimensions: { width: w, depth: 0.62, height: 0.9 }, color: swatch.color, params: {}, rooms: ["kitchen"], constraints: { frontClearance: 0.9 } });
  }
}
for (const [label, w] of [["Sink cabinet", 0.8], ["Double sink cabinet", 1.2]] as const) {
  for (const swatch of KITCHEN_FINISH) {
    add({ name: `${label} — ${swatch.name}`, category: "storage", group: "kitchen", family: "sink-cabinet", dimensions: { width: w, depth: 0.6, height: 0.9 }, color: swatch.color, params: { double: label.startsWith("Double"), top: "#d9d4cb" }, rooms: ["kitchen"], constraints: { frontClearance: 1.0 } });
  }
}

// ---------- Bathroom ----------
for (const [label, wall] of [["Toilet", false], ["Wall-hung toilet", true]] as const) {
  for (const swatch of [{ name: "White", color: "#f4f4f2" }, { name: "Matte black", color: "#2e2e2e" }]) {
    add({ name: `${label} — ${swatch.name}`, category: "other", group: "bathroom", family: "toilet", dimensions: { width: 0.4, depth: 0.68, height: 0.8 }, color: swatch.color, params: { wall }, rooms: ["bathroom"], constraints: { frontClearance: 0.6 } });
  }
}
for (const w of [0.6, 0.9, 1.2]) {
  for (const swatch of [WOOD[0]!, { name: "White", color: "#eeeae3" }, { name: "Charcoal", color: "#4a4d50" }]) {
    add({ name: `Vanity ${w} m — ${swatch.name}`, category: "storage", group: "bathroom", family: "vanity", dimensions: { width: w, depth: 0.48, height: 0.85 }, color: swatch.color, params: { basins: w >= 1.2 ? 2 : 1 }, rooms: ["bathroom"], constraints: { frontClearance: 0.7 } });
  }
}
for (const [label, w] of [["Bathtub", 1.7], ["Large bathtub", 1.8]] as const) {
  for (const freestanding of [false, true]) {
    add({ name: `${freestanding ? "Freestanding" : "Built-in"} ${label.toLowerCase()}`, category: "other", group: "bathroom", family: "bathtub", dimensions: { width: w, depth: 0.78, height: 0.58 }, color: "#f6f6f4", params: { freestanding }, rooms: ["bathroom"], constraints: { frontClearance: 0.6 } });
  }
}
for (const size of [0.9, 1.2]) {
  add({ name: `Walk-in shower ${size} m`, category: "other", group: "bathroom", family: "shower", dimensions: { width: size, depth: 0.9, height: 2.0 }, color: "#e9eef1", params: {}, rooms: ["bathroom"], constraints: { frontClearance: 0.6 } });
}

// ---------- Outdoor & kids ----------
for (const swatch of [WOOD[0]!, WOOD[1]!, { name: "White", color: "#eeeeee" }]) {
  add({ name: `Sun lounger — ${swatch.name}`, category: "seating", group: "outdoor", family: "lounger", dimensions: { width: 0.7, depth: 1.95, height: 0.8 }, color: swatch.color, params: { cushion: "#e8e1d2" }, rooms: ["outdoor"], constraints: { frontClearance: 0 } });
  add({ name: `Outdoor armchair — ${swatch.name}`, category: "seating", group: "outdoor", family: "armchair", dimensions: { width: 0.75, depth: 0.75, height: 0.8 }, color: "#e8e1d2", params: { arm: "slim", leg: "taper", back: 0.4, cushions: true, seats: 1, frame: swatch.color }, rooms: ["outdoor"] });
}
for (const swatch of [{ name: "Natural", color: "#e8dcc4" }, { name: "Terracotta", color: "#c06a4a" }, { name: "Navy", color: "#30476a" }]) {
  add({ name: `Garden parasol — ${swatch.name}`, category: "other", group: "outdoor", family: "parasol", dimensions: { width: 2.4, depth: 2.4, height: 2.4 }, color: swatch.color, params: {}, rooms: ["outdoor"], constraints: { frontClearance: 0 } });
}
for (const swatch of [{ name: "Red", color: "#d2574e" }, { name: "Mint", color: "#7fc8b1" }, { name: "Yellow", color: "#e9c34b" }]) {
  add({ name: `Toy chest — ${swatch.name}`, category: "storage", group: "kids", family: "toy-box", dimensions: { width: 0.8, depth: 0.45, height: 0.5 }, color: swatch.color, params: {}, rooms: ["kids"], constraints: { frontClearance: 0.4 } });
  add({ name: `Kids table — ${swatch.name}`, category: "tables", group: "kids", family: "table", dimensions: { width: 0.9, depth: 0.6, height: 0.5 }, color: swatch.color, params: { legs: "taper" }, rooms: ["kids"] });
  add({ name: `Kids chair — ${swatch.name}`, category: "seating", group: "kids", family: "chair", dimensions: { width: 0.34, depth: 0.36, height: 0.58 }, color: swatch.color, params: { back: "panel", leg: "taper", seatColor: swatch.color }, rooms: ["kids"], constraints: { frontClearance: 0 } });
}

// ---------- Doors & windows (become room openings) ----------
for (const [label, w] of [["Single door", 0.85], ["Wide door", 1.0], ["Double door", 1.5]] as const) {
  add({ name: label, category: "other", group: "openings", family: "door", dimensions: { width: w, depth: 0.1, height: 2.05 }, color: "#d9cbb6", params: {}, rooms: ["bedroom", "living", "dining", "kitchen", "bathroom", "office", "study", "kids", "outdoor"], opening: { kind: "door", width: w, height: 2.05, sillHeight: 0 } });
}
for (const [label, w, h, sill] of [["Window", 1.2, 1.3, 0.9], ["Wide window", 1.8, 1.4, 0.85], ["Tall window", 0.9, 2.0, 0.3]] as const) {
  add({ name: label, category: "other", group: "openings", family: "window", dimensions: { width: w, depth: 0.1, height: h }, color: "#cfe6f3", params: {}, rooms: ["bedroom", "living", "dining", "kitchen", "bathroom", "office", "study", "kids"], opening: { kind: "window", width: w, height: h, sillHeight: sill } });
}

// ---------- Original ids (kept stable for existing scenes, demos and AI) ----------
const legacy: CatalogItem[] = [
  { id: "bed-queen", name: "Queen bed", category: "beds", group: "beds", family: "bed", dimensions: { width: 1.6, depth: 2.1, height: 1.0 }, color: "#d4d9df", params: { headboard: "panel", frame: "#8f735b" }, rooms: ["bedroom"] },
  { id: "bed-single", name: "Single bed", category: "beds", group: "beds", family: "bed", dimensions: { width: 0.95, depth: 2.0, height: 0.9 }, color: "#d4d9df", params: { headboard: "slat", frame: "#c49a6c" }, rooms: ["bedroom", "kids"] },
  { id: "armchair", name: "Armchair", category: "seating", group: "chairs", family: "armchair", dimensions: { width: 0.85, depth: 0.8, height: 0.85 }, color: "#7d8f7f", params: ARMCHAIRS[0]!.params, rooms: ["living", "bedroom"] },
  { id: "sofa", name: "Sofa", category: "seating", group: "sofas", family: "sofa", dimensions: { width: 2.1, depth: 0.9, height: 0.82 }, color: "#b7a18a", params: { ...SOFA_STYLES[0]!.params, seats: 3 }, rooms: ["living"] },
  { id: "desk-chair", name: "Desk chair", category: "seating", group: "chairs", family: "office-chair", dimensions: { width: 0.5, depth: 0.5, height: 0.9 }, color: "#5f6f68", params: { back: "mesh", arms: false }, rooms: ["office", "study"], constraints: { frontClearance: 0 } },
  { id: "desk", name: "Desk", category: "tables", group: "tables", family: "desk", dimensions: { width: 1.2, depth: 0.6, height: 0.75 }, color: "#a07c60", params: { pedestal: true, legs: "taper" }, rooms: ["office", "study", "bedroom"] },
  { id: "dining-table", name: "Dining table", category: "tables", group: "tables", family: "table", dimensions: { width: 1.6, depth: 0.9, height: 0.75 }, color: "#8f6a4d", params: { legs: "taper" }, rooms: ["dining"] },
  { id: "dining-chair", name: "Dining chair", category: "seating", group: "chairs", family: "chair", dimensions: { width: 0.45, depth: 0.5, height: 0.9 }, color: "#6b5b4f", params: { back: "slats", leg: "taper", seatColor: "#6b5b4f" }, rooms: ["dining"], constraints: { frontClearance: 0 } },
  { id: "coffee-table", name: "Coffee table", category: "tables", group: "tables", family: "coffee-table", dimensions: { width: 1.1, depth: 0.6, height: 0.4 }, color: "#8a6248", params: { shape: "rect", shelf: true }, rooms: ["living"] },
  { id: "nightstand", name: "Nightstand", category: "storage", group: "storage", family: "nightstand", dimensions: { width: 0.5, depth: 0.4, height: 0.55 }, color: "#9b7a5f", params: { base: "legs", drawers: 2 }, rooms: ["bedroom"], constraints: { frontClearance: 0.4 } },
  { id: "wardrobe", name: "Wardrobe", category: "storage", group: "storage", family: "wardrobe", dimensions: { width: 1.2, depth: 0.6, height: 2.1 }, color: "#b9c1b9", params: { doors: 2 }, rooms: ["bedroom"] },
  { id: "dresser", name: "Dresser", category: "storage", group: "storage", family: "dresser", dimensions: { width: 1.0, depth: 0.45, height: 0.8 }, color: "#9b7a5f", params: { base: "legs", drawers: 3, columns: 1 }, rooms: ["bedroom"] },
  { id: "kitchen-counter", name: "Kitchen counter", category: "storage", group: "kitchen", family: "kitchen-counter", dimensions: { width: 2.4, depth: 0.6, height: 0.9 }, color: "#e8e4dc", params: { top: "#d9d4cb" }, rooms: ["kitchen"], constraints: { frontClearance: 1.0 } },
  { id: "fridge", name: "Refrigerator", category: "storage", group: "kitchen", family: "fridge", dimensions: { width: 0.7, depth: 0.7, height: 1.85 }, color: "#d9dcdf", params: {}, rooms: ["kitchen"], constraints: { frontClearance: 0.9 } },
  { id: "tv-unit", name: "TV unit", category: "storage", group: "media", family: "tv-unit", dimensions: { width: 1.8, depth: 0.4, height: 0.5 }, color: "#5d5148", params: { compartments: 3, legs: true }, rooms: ["living"], constraints: { frontClearance: 0.4 } },
  { id: "bookshelf", name: "Bookshelf", category: "storage", group: "shelves", family: "bookshelf", dimensions: { width: 0.8, depth: 0.3, height: 1.8 }, color: "#8a6a52", params: { shelves: 5, books: true }, rooms: ["living", "study", "office"], constraints: { frontClearance: 0.5 } },
  { id: "floor-lamp", name: "Floor lamp", category: "lighting", group: "lighting", family: "floor-lamp", dimensions: { width: 0.35, depth: 0.35, height: 1.6 }, color: "#d8c79a", params: { shade: "drum" }, rooms: ["living", "bedroom"], light: { kind: "point", on: true, intensity: 8, color: "#ffcf91", height: 1.5 } },
  { id: "desk-lamp", name: "Desk lamp", category: "lighting", group: "lighting", family: "desk-lamp", dimensions: { width: 0.18, depth: 0.18, height: 0.42 }, color: "#2f3532", params: { style: "arm" }, rooms: ["office", "study"], light: { kind: "spot", on: true, intensity: 6, color: "#ffd9a8", height: 0.4 } },
  { id: "ceiling-light", name: "Ceiling light", category: "lighting", group: "lighting", family: "ceiling-light", elevation: 2.5, dimensions: { width: 0.5, depth: 0.5, height: 0.1 }, color: "#f4f1ea", params: {}, rooms: ["bedroom", "living"], light: { kind: "point", on: true, intensity: 14, color: "#fff1dc", height: 0 } },
  { id: "rug", name: "Rug", category: "decor", group: "rugs", family: "rug", dimensions: { width: 2.0, depth: 1.4, height: 0.015 }, color: "#d9d1c3", params: { pattern: "border", shape: "rect" }, rooms: ["living", "bedroom"], constraints: { floorCovering: true } },
  { id: "plant", name: "Plant", category: "decor", group: "plants", family: "plant", dimensions: { width: 0.45, depth: 0.45, height: 1.2 }, color: "#6f9a74", params: { foliage: "fiddle", pot: "ceramic", potColor: "#e7e1d6" }, rooms: ["living", "bedroom"] },
  { id: "box", name: "Editable box", category: "other", group: "basic", family: "box", dimensions: { width: 0.6, depth: 0.6, height: 0.6 }, color: "#a9b3c2", params: {}, rooms: [] },
];

export const catalog: CatalogItem[] = [...legacy, ...items.filter((item) => !legacy.some((entry) => entry.id === item.id))];

const byId = new Map(catalog.map((entry) => [entry.id, entry]));
export function catalogById(id: string | undefined) {
  return id ? byId.get(id) : undefined;
}
