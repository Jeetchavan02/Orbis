import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applySceneAction, SceneActionError, SceneSchema, type Scene, type SceneAction } from "./index.js";

const fixture = SceneSchema.parse(
  JSON.parse(readFileSync(resolve(process.cwd(), "fixtures/studio-scene.json"), "utf8")),
);

/** Compares scenes ignoring version counters, which always move forward. */
function strip(scene: Scene) {
  return JSON.parse(JSON.stringify(scene, (key, value) => (key === "version" ? undefined : value)));
}

function roundTrip(action: SceneAction) {
  const applied = applySceneAction(fixture, action);
  const restored = applySceneAction(applied.scene, applied.inverse).scene;
  expect(strip(restored)).toEqual(strip(fixture));
  return applied;
}

describe("scene action pipeline", () => {
  it("moves an object, bumps its version, and inverts exactly", () => {
    const { scene } = roundTrip({ type: "furniture.update", furnitureId: "furniture-sofa", patch: { position: { x: 1.5 } } });
    const sofa = scene.furniture.find((item) => item.id === "furniture-sofa")!;
    expect(sofa.position).toEqual({ x: 1.5, y: 0, z: -1.45 });
    expect(sofa.version).toBe(2);
  });

  it("inverts rotate, resize, rename, and color changes", () => {
    roundTrip({
      type: "furniture.update",
      furnitureId: "furniture-chair",
      patch: { yawDegrees: 90, dimensions: { width: 1.1 }, name: "Armchair", color: "#112233" },
    });
  });

  it("inverts create and delete", () => {
    const sofa = fixture.furniture[0]!;
    roundTrip({ type: "furniture.create", furniture: { ...sofa, id: "copy", position: { x: 2, y: 0, z: 2 } } });
    roundTrip({ type: "furniture.delete", furnitureId: "furniture-table" });
  });

  it("inverts room resizes", () => {
    roundTrip({ type: "room.update", roomId: "room-living", patch: { dimensions: { width: 9 } } });
  });

  it("undoes a batch in reverse order as one step", () => {
    roundTrip({
      type: "batch",
      label: "Apply recovery",
      actions: [
        { type: "furniture.update", furnitureId: "furniture-sofa", patch: { position: { x: 1 } } },
        { type: "furniture.update", furnitureId: "furniture-sofa", patch: { position: { z: 0 } } },
        { type: "furniture.delete", furnitureId: "furniture-rug" },
      ],
    });
  });

  it("does not mutate the input scene", () => {
    const before = JSON.stringify(fixture);
    applySceneAction(fixture, { type: "furniture.delete", furnitureId: "furniture-sofa" });
    expect(JSON.stringify(fixture)).toBe(before);
  });

  it("rejects missing entities, duplicate ids, and malformed actions", () => {
    expect(() => applySceneAction(fixture, { type: "furniture.delete", furnitureId: "nope" })).toThrow(SceneActionError);
    expect(() => applySceneAction(fixture, { type: "furniture.create", furniture: fixture.furniture[0]! })).toThrow(/already exists/);
    expect(() => applySceneAction(fixture, {
      type: "furniture.update",
      furnitureId: "furniture-sofa",
      patch: { dimensions: { width: -1 } },
    })).toThrow(SceneActionError);
  });
});
