import type { Dimensions3D, FurnitureCategory, LightFixture, ObjectConstraints } from "@reality-builder/shared";

export type CatalogItem = {
  id: string;
  name: string;
  category: FurnitureCategory;
  dimensions: Dimensions3D;
  color: string;
  /** Height above the floor when placed (wall/ceiling-mounted items). */
  elevation?: number;
  light?: LightFixture;
  constraints?: ObjectConstraints;
};

export const CATEGORY_LABELS: Record<FurnitureCategory, string> = {
  beds: "Beds",
  seating: "Seating",
  tables: "Tables & desks",
  storage: "Storage",
  lighting: "Lighting",
  decor: "Decor",
  other: "Other",
};

/** Real-world nominal sizes in meters. */
export const catalog: CatalogItem[] = [
  { id: "bed-queen", name: "Queen bed", category: "beds", dimensions: { width: 1.6, depth: 2.1, height: 1.0 }, color: "#d4d9df" },
  { id: "bed-single", name: "Single bed", category: "beds", dimensions: { width: 0.95, depth: 2.0, height: 0.9 }, color: "#d4d9df" },
  { id: "armchair", name: "Armchair", category: "seating", dimensions: { width: 0.85, depth: 0.8, height: 0.85 }, color: "#7d8f7f" },
  { id: "sofa", name: "Sofa", category: "seating", dimensions: { width: 2.1, depth: 0.9, height: 0.82 }, color: "#b7a18a" },
  { id: "desk-chair", name: "Desk chair", category: "seating", dimensions: { width: 0.5, depth: 0.5, height: 0.9 }, color: "#5f6f68", constraints: { frontClearance: 0 } },
  { id: "desk", name: "Desk", category: "tables", dimensions: { width: 1.2, depth: 0.6, height: 0.75 }, color: "#a07c60" },
  { id: "coffee-table", name: "Coffee table", category: "tables", dimensions: { width: 1.1, depth: 0.6, height: 0.4 }, color: "#8a6248" },
  { id: "nightstand", name: "Nightstand", category: "storage", dimensions: { width: 0.5, depth: 0.4, height: 0.55 }, color: "#9b7a5f", constraints: { frontClearance: 0.4 } },
  { id: "wardrobe", name: "Wardrobe", category: "storage", dimensions: { width: 1.2, depth: 0.6, height: 2.1 }, color: "#b9c1b9" },
  { id: "dresser", name: "Dresser", category: "storage", dimensions: { width: 1.0, depth: 0.45, height: 0.8 }, color: "#9b7a5f" },
  { id: "bookshelf", name: "Bookshelf", category: "storage", dimensions: { width: 0.8, depth: 0.3, height: 1.8 }, color: "#8a6a52", constraints: { frontClearance: 0.5 } },
  { id: "floor-lamp", name: "Floor lamp", category: "lighting", dimensions: { width: 0.35, depth: 0.35, height: 1.6 }, color: "#d8c79a", light: { kind: "point", on: true, intensity: 8, color: "#ffcf91", height: 1.5 } },
  { id: "desk-lamp", name: "Desk lamp", category: "lighting", dimensions: { width: 0.18, depth: 0.18, height: 0.42 }, color: "#2f3532", light: { kind: "spot", on: true, intensity: 6, color: "#ffd9a8", height: 0.4 } },
  { id: "ceiling-light", name: "Ceiling light", category: "lighting", elevation: 2.5, dimensions: { width: 0.5, depth: 0.5, height: 0.1 }, color: "#f4f1ea", light: { kind: "point", on: true, intensity: 14, color: "#fff1dc", height: 0 } },
  { id: "rug", name: "Rug", category: "decor", dimensions: { width: 2.0, depth: 1.4, height: 0.015 }, color: "#d9d1c3", constraints: { floorCovering: true } },
  { id: "plant", name: "Plant", category: "decor", dimensions: { width: 0.45, depth: 0.45, height: 1.2 }, color: "#6f9a74" },
  { id: "box", name: "Editable box", category: "other", dimensions: { width: 0.6, depth: 0.6, height: 0.6 }, color: "#a9b3c2" },
];
