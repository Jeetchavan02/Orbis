import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applySceneAction, SceneSchema } from "./index.js";

const bedroom = SceneSchema.parse(JSON.parse(readFileSync(resolve(process.cwd(), "fixtures/bedroom-scene.json"), "utf8")));
const plan = { url: "/api/assets/plan-abc12345.jpg", name: "Plan", roomId: "room-main", x: 0, z: 0, width: 5, aspect: 0.8, rotationDegrees: 0, opacity: 0.6, visible: true };

describe("floor-plan underlay", () => {
  it("old scenes without an underlay still load", () => {
    expect(bedroom.underlay).toBeNull();
  });

  it("is added, changed and removed through scene.update with exact inverses", () => {
    const added = applySceneAction(bedroom, { type: "scene.update", patch: { underlay: plan } });
    expect(added.scene.underlay).toEqual(plan);
    expect(added.scene.settingsVersion).toBe(bedroom.settingsVersion + 1);
    const moved = applySceneAction(added.scene, { type: "scene.update", patch: { underlay: { ...plan, x: 1.2, opacity: 0.3 } } });
    expect(moved.scene.underlay).toMatchObject({ x: 1.2, opacity: 0.3 });
    expect(applySceneAction(moved.scene, moved.inverse).scene.underlay).toEqual(plan); // undo the move
    const removed = applySceneAction(moved.scene, { type: "scene.update", patch: { underlay: null } });
    expect(removed.scene.underlay).toBeNull();
    expect(applySceneAction(removed.scene, removed.inverse).scene.underlay).toMatchObject({ x: 1.2 }); // undo the removal
    expect(applySceneAction(added.scene, added.inverse).scene.underlay).toBeNull();
  });

  it("survives a save/load round trip", () => {
    const saved = JSON.parse(JSON.stringify(applySceneAction(bedroom, { type: "scene.update", patch: { underlay: plan } }).scene));
    expect(SceneSchema.parse(saved).underlay).toEqual(plan);
  });
});

import { createCylinderMesh, extrudeFace, faceTriangles, meshBounds, triangleNormal } from "./index.js";

describe("floor annotations", () => {
  it("lines and labels are added and undone through scene.update", () => {
    const line = { id: "ann-1", kind: "line" as const, x: 0, z: 0, x2: 1.5, z2: 0, color: "#6a3de8" };
    const label = { id: "ann-2", kind: "text" as const, x: 1, z: 1, text: "Reading nook", color: "#6a3de8" };
    expect(bedroom.annotations).toEqual([]);
    const one = applySceneAction(bedroom, { type: "scene.update", patch: { annotations: [line] } });
    const two = applySceneAction(one.scene, { type: "scene.update", patch: { annotations: [line, label] } });
    expect(two.scene.annotations).toHaveLength(2);
    expect(applySceneAction(two.scene, two.inverse).scene.annotations).toEqual([line]);
    expect(SceneSchema.parse(JSON.parse(JSON.stringify(two.scene))).annotations[1]).toMatchObject({ text: "Reading nook" });
  });
});

describe("cylinder primitive", () => {
  it("has the requested size and an upward top cap that can be extruded", () => {
    const mesh = createCylinderMesh({ width: 0.6, depth: 0.6, height: 0.5 });
    const bounds = meshBounds(mesh);
    expect(bounds.max[1] - bounds.min[1]).toBeCloseTo(0.5);
    expect(bounds.max[0] - bounds.min[0]).toBeCloseTo(0.6, 2);
    const topTriangle = mesh.indices.length / 3 - 48; // first triangle of the top cap
    expect(triangleNormal(mesh, topTriangle)[1]).toBeGreaterThan(0.99);
    const cap = faceTriangles(mesh, topTriangle);
    expect(cap).toHaveLength(24);
    const taller = meshBounds(extrudeFace(mesh, cap, 0.2));
    expect(taller.max[1]).toBeCloseTo(0.7);
  });
});
