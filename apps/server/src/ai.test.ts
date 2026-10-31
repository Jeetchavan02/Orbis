import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applySceneAction, SceneSchema, type AiCatalogItem } from "@reality-builder/shared";
import { validateScene } from "@reality-builder/spatial-engine";
import { toolCallsToActions } from "./ai.js";

const scene = SceneSchema.parse(JSON.parse(readFileSync(resolve(process.cwd(), "fixtures/bedroom-scene.json"), "utf8")));
const catalog: AiCatalogItem[] = [{ id: "armchair", name: "Armchair", category: "seating", dimensions: { width: 0.85, depth: 0.8, height: 0.85 }, color: "#7d8f7f" }];
const ids = () => {
  let n = 0;
  return () => "ai-" + ++n;
};

describe("AI tool calls → canonical actions", () => {
  it("converts every tool into a schema-valid action that applies and undoes", () => {
    const actions = toolCallsToActions(scene, [
      { tool: "add_object", catalogItemId: "armchair", x: 1.3, z: -0.8, yawDegrees: 180 },
      { tool: "move_object", objectId: "obj-plant", x: 1.9, z: -1.8 },
      { tool: "rotate_object", objectId: "obj-desk-chair", yawDegrees: -90 },
      { tool: "resize_object", objectId: "obj-rug", width: 1.8 },
      { tool: "set_color", objectId: "obj-bed", color: "#aabbcc" },
      { tool: "set_light", objectId: "obj-floor-lamp", on: false },
      { tool: "set_environment", mode: "night" },
      { tool: "delete_object", objectId: "obj-desk-lamp" },
    ], catalog, ids());
    const applied = applySceneAction(scene, { type: "batch", label: "AI", actions });
    expect(applied.scene.furniture.find((item) => item.id === "ai-1")?.name).toBe("Armchair");
    expect(applied.scene.furniture.find((item) => item.id === "obj-desk-chair")?.yawDegrees).toBe(270);
    expect(applied.scene.furniture.find((item) => item.id === "obj-floor-lamp")?.light?.on).toBe(false);
    expect(applied.scene.environment.mode).toBe("night");
    const undone = applySceneAction(applied.scene, applied.inverse).scene;
    expect(undone.furniture.map((item) => item.id)).toEqual(scene.furniture.map((item) => item.id));
    expect(undone.environment.mode).toBe("day");
  });

  it("rejects unknown ids, unknown catalog items, locked objects and non-lights with explanations", () => {
    expect(() => toolCallsToActions(scene, [{ tool: "move_object", objectId: "nope", x: 0, z: 0 }], catalog, ids())).toThrow(/Unknown objectId/);
    expect(() => toolCallsToActions(scene, [{ tool: "add_object", catalogItemId: "piano", x: 0, z: 0, yawDegrees: 0 }], catalog, ids())).toThrow(/Unknown catalogItemId/);
    const locked = applySceneAction(scene, { type: "furniture.update", furnitureId: "obj-bed", patch: { constraints: { locked: true } } }).scene;
    expect(() => toolCallsToActions(locked, [{ tool: "move_object", objectId: "obj-bed", x: 0, z: 0 }], catalog, ids())).toThrow(/locked/);
    expect(() => toolCallsToActions(scene, [{ tool: "set_light", objectId: "obj-bed", on: true }], catalog, ids())).toThrow(/not a light/);
  });
});

describe("semantic placement (engine decides coordinates)", () => {
  const bookshelf: AiCatalogItem = { id: "bookshelf", name: "Bookshelf", category: "storage", dimensions: { width: 0.8, depth: 0.3, height: 1.8 }, color: "#8a6a52", constraints: { frontClearance: 0.5 } };
  const nightstand: AiCatalogItem = { id: "nightstand", name: "Nightstand", category: "storage", dimensions: { width: 0.5, depth: 0.4, height: 0.55 }, color: "#9b7a5f", constraints: { frontClearance: 0.4 } };

  it("puts a new item flush against the requested wall without creating issues", () => {
    const actions = toolCallsToActions(scene, [{ tool: "place_against_wall", catalogItemId: "bookshelf", wall: "east", near: "middle" }], [bookshelf], ids());
    const next = applySceneAction(scene, { type: "batch", label: "AI", actions }).scene;
    const shelf = next.furniture.find((item) => item.catalogItemId === "bookshelf")!;
    expect(shelf.yawDegrees).toBe(270);
    expect(shelf.position.x).toBeCloseTo(2.3 - 0.15, 2);
    expect(validateScene(next).issues).toEqual([]);
  });

  it("places items beside a target and later calls see earlier ones", () => {
    const actions = toolCallsToActions(scene, [
      { tool: "place_near", catalogItemId: "nightstand", targetId: "obj-desk", side: "left" },
      { tool: "place_near", catalogItemId: "nightstand", targetId: "obj-desk", side: "left" },
    ], [nightstand], ids());
    const next = applySceneAction(scene, { type: "batch", label: "AI", actions }).scene;
    expect(validateScene(next).issues.filter((issue) => issue.ruleId === "collision.overlap")).toEqual([]);
  });

  it("explains when nothing fits", () => {
    const huge: AiCatalogItem = { ...bookshelf, id: "huge", dimensions: { width: 4.4, depth: 3, height: 2 } };
    expect(() => toolCallsToActions(scene, [{ tool: "place_against_wall", catalogItemId: "huge", wall: "north", near: "middle" }], [huge], ids())).toThrow(/No valid spot/);
  });
});
