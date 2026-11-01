import { z } from "zod";
import type { Scene } from "./schemas.js";

/**
 * Shopping layer. A furniture object may carry a `product` reference. Only references with `sample: false`
 * (a real listing the user linked) are purchasable and enter the cart; sample references are illustrative
 * prices for planning and are never presented as real listings.
 */
export const RETAILERS = {
  amazon: { name: "Amazon.in", hosts: ["amazon.in", "amzn.in", "amzn.to"], search: "https://www.amazon.in/s?k=" },
  flipkart: { name: "Flipkart", hosts: ["flipkart.com", "fkrt.it"], search: "https://www.flipkart.com/search?q=" },
  pepperfry: { name: "Pepperfry", hosts: ["pepperfry.com"], search: "https://www.pepperfry.com/site_product/search?q=" },
  urbanladder: { name: "Urban Ladder", hosts: ["urbanladder.com"], search: "https://www.urbanladder.com/products/search?keywords=" },
  woodenstreet: { name: "Wooden Street", hosts: ["woodenstreet.com"], search: "https://www.woodenstreet.com/search?keyword=" },
  ikea: { name: "IKEA India", hosts: ["ikea.com"], search: "https://www.ikea.com/in/en/search/?q=" },
} as const;
export type RetailerId = keyof typeof RETAILERS | "other" | "sample";

export const ProductAvailabilitySchema = z.enum(["in-stock", "out-of-stock", "unknown"]);

export const ProductRefSchema = z.object({
  productId: z.string().min(1),
  retailerId: z.string().min(1),
  retailerName: z.string().min(1),
  productName: z.string().min(1).max(200),
  brand: z.string().max(80).optional(),
  /** Unit price in `currency`; for sample references this is an illustrative estimate. */
  price: z.number().nonnegative().finite(),
  currency: z.literal("INR").default("INR"),
  productUrl: z.string().url().optional(),
  thumbnailUrl: z.string().url().optional(),
  modelUrl: z.string().url().optional(),
  material: z.string().max(80).optional(),
  availability: ProductAvailabilitySchema.default("unknown"),
  /** ISO date the price was last checked (user-entered for linked products). */
  priceCheckedAt: z.string().optional(),
  /** true = Orbis sample estimate, not a real listing. */
  sample: z.boolean(),
  /** How the 3D object relates to the product: a real model or a box-fitted approximation. */
  representation: z.enum(["exact-model", "scaled-approximation"]).default("scaled-approximation"),
});
export type ProductRef = z.infer<typeof ProductRefSchema>;

/** Which known retailer a product URL belongs to ("other" for any other shop). */
export function retailerForUrl(url: string): { id: RetailerId; name: string } {
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch { return { id: "other", name: "Other shop" }; }
  for (const [id, retailer] of Object.entries(RETAILERS)) {
    if (retailer.hosts.some((entry) => host === entry || host.endsWith("." + entry))) return { id: id as RetailerId, name: retailer.name };
  }
  return { id: "other", name: host.replace(/^www\./, "") || "Other shop" };
}

/** Real retailer search pages for a product name (no listing is implied, just a search). */
export function retailerSearchLinks(query: string) {
  return Object.entries(RETAILERS).map(([id, retailer]) => ({ id: id as RetailerId, name: retailer.name, url: retailer.search + encodeURIComponent(query) }));
}

export type CartLine = { productId: string; product: ProductRef; quantity: number; subtotal: number; objectIds: string[] };
export type CartGroup = { retailerId: string; retailerName: string; lines: CartLine[]; subtotal: number; itemCount: number };
export type RoomCart = { groups: CartGroup[]; subtotal: number; itemCount: number; sampleEstimate: number; sampleCount: number; unpricedCount: number };

/**
 * Builds the cart from the scene: one line per product (quantity = how many objects use it), grouped by
 * retailer. Only real linked products are purchasable; sample-priced objects are totalled separately as an
 * estimate, and objects without any product are counted as unpriced. Amounts are rounded to paise.
 */
export function buildRoomCart(scene: Scene, roomId?: string): RoomCart {
  const lines = new Map<string, CartLine>();
  let sampleEstimate = 0;
  let sampleCount = 0;
  let unpricedCount = 0;
  for (const item of scene.furniture) {
    if (roomId && item.roomId !== roomId) continue;
    const product = item.product;
    if (!product) { unpricedCount += 1; continue; }
    if (product.sample) { sampleEstimate += product.price; sampleCount += 1; continue; }
    const key = product.retailerId + "|" + product.productId;
    const line = lines.get(key) ?? { productId: product.productId, product, quantity: 0, subtotal: 0, objectIds: [] };
    line.quantity += 1;
    line.objectIds.push(item.id);
    line.subtotal = round(line.product.price * line.quantity);
    lines.set(key, line);
  }
  const groups = new Map<string, CartGroup>();
  for (const line of lines.values()) {
    const group = groups.get(line.product.retailerId) ?? { retailerId: line.product.retailerId, retailerName: line.product.retailerName, lines: [], subtotal: 0, itemCount: 0 };
    group.lines.push(line);
    group.subtotal = round(group.subtotal + line.subtotal);
    group.itemCount += line.quantity;
    groups.set(line.product.retailerId, group);
  }
  const sorted = [...groups.values()].sort((a, b) => b.subtotal - a.subtotal);
  return {
    groups: sorted,
    subtotal: round(sorted.reduce((sum, group) => sum + group.subtotal, 0)),
    itemCount: sorted.reduce((sum, group) => sum + group.itemCount, 0),
    sampleEstimate: round(sampleEstimate), sampleCount, unpricedCount,
  };
}

const round = (value: number) => Math.round(value * 100) / 100;

export const formatInr = (value: number) => "₹" + Math.round(value).toLocaleString("en-IN");
