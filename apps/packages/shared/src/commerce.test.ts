import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applySceneAction, buildRoomCart, retailerForUrl, SceneSchema, type FurnitureObject, type ProductRef, type Scene } from "./index.js";

const product = (id: string, retailerId: string, price: number, sample = false): ProductRef => ({
  productId: id, retailerId, retailerName: retailerId, productName: id, price, currency: "INR", availability: "in-stock", sample, representation: "scaled-approximation",
});
const item = (id: string, roomId: string, p?: ProductRef): FurnitureObject => ({
  id, roomId, name: id, category: "seating", position: { x: 0, y: 0, z: 0 }, yawDegrees: 0, dimensions: { width: 0.5, depth: 0.5, height: 0.5 }, version: 1, ...(p ? { product: p } : {}),
});
const scene = (furniture: FurnitureObject[]) => ({ furniture } as unknown as Scene);

describe("room cart", () => {
  it("groups real products by retailer, counts quantities and keeps samples out", () => {
    const cart = buildRoomCart(scene([
      item("a", "r1", product("chair", "amazon", 2499.5)), item("b", "r1", product("chair", "amazon", 2499.5)),
      item("c", "r1", product("bed", "ikea", 30000)), item("d", "r2", product("lamp", "amazon", 999)),
      item("e", "r1", product("sample:x", "sample", 5000, true)), item("f", "r1"),
    ]));
    expect(cart.groups.map((group) => group.retailerId)).toEqual(["ikea", "amazon"]);
    const amazon = cart.groups.find((group) => group.retailerId === "amazon")!;
    expect(amazon.lines.find((line) => line.productId === "chair")).toMatchObject({ quantity: 2, subtotal: 4999 });
    expect(amazon.subtotal).toBe(5998);
    expect(cart.subtotal).toBe(35998);
    expect(cart.itemCount).toBe(4);
    expect(cart).toMatchObject({ sampleEstimate: 5000, sampleCount: 1, unpricedCount: 1 });
  });
  it("filters by room", () => {
    const cart = buildRoomCart(scene([item("a", "r1", product("chair", "amazon", 100)), item("d", "r2", product("lamp", "amazon", 50))]), "r2");
    expect(cart.subtotal).toBe(50);
  });
  it("recognises retailers from product links", () => {
    expect(retailerForUrl("https://www.amazon.in/dp/B0XYZ").id).toBe("amazon");
    expect(retailerForUrl("https://www.flipkart.com/p/itm123").id).toBe("flipkart");
    expect(retailerForUrl("https://shop.example.com/x")).toEqual({ id: "other", name: "shop.example.com" });
    expect(retailerForUrl("not a url").id).toBe("other");
  });
});

describe("product reference on objects", () => {
  it("is linked, undone and unlinked through furniture.update", () => {
    const base = scene([item("a", "r1", product("sample:x", "sample", 5000, true))]);
    const real = { ...product("chair", "amazon", 2499), productUrl: "https://www.amazon.in/dp/B0XYZ" };
    const linked = applySceneAction(base, { type: "furniture.update", furnitureId: "a", patch: { product: real } });
    expect(linked.scene.furniture[0]!.product).toEqual(real);
    const undone = applySceneAction(linked.scene, linked.inverse);
    expect(undone.scene.furniture[0]!.product?.sample).toBe(true);
    const cleared = applySceneAction(base, { type: "furniture.update", furnitureId: "a", patch: { product: null } });
    expect(cleared.scene.furniture[0]!.product).toBeUndefined();
    expect(applySceneAction(cleared.scene, cleared.inverse).scene.furniture[0]!.product?.productId).toBe("sample:x");
  });
  it("survives scene schema parsing (save / load / collaboration)", () => {
    const fixture = SceneSchema.parse(JSON.parse(readFileSync(resolve(process.cwd(), "fixtures/studio-scene.json"), "utf8")));
    const real = { ...product("chair", "amazon", 2499), productUrl: "https://www.amazon.in/dp/B0XYZ", priceCheckedAt: "2026-11-01" };
    const withProduct = { ...fixture, furniture: fixture.furniture.map((entry, index) => (index === 0 ? { ...entry, product: real } : entry)) };
    const restored = SceneSchema.parse(JSON.parse(JSON.stringify(withProduct)));
    expect(restored.furniture[0]!.product).toEqual(real);
    expect(() => SceneSchema.parse({ ...withProduct, furniture: [{ ...withProduct.furniture[0], product: { ...real, productUrl: "nope" } }] })).toThrow();
  });
});
