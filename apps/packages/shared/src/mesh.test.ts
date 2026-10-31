import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applySceneAction,
  boundsDimensions,
  createBoxMesh,
  extrudeFace,
  faceTriangles,
  meshBounds,
  moveVertices,
  normalizeMesh,
  SceneSchema,
  triangleNormal,
  uniqueVertexIndices,
} from "./index.js";

const box = createBoxMesh({ width: 1, depth: 0.5, height: 0.8 });
const topTriangle = 8; // face order: front, back, right, left, top, bottom — 2 triangles each

describe("mesh editing", () => {
  it("builds a closed box with outward normals and bottom-center origin", () => {
    expect(box.positions.length / 3).toBe(24);
    expect(box.indices.length / 3).toBe(12);
    expect(boundsDimensions(meshBounds(box))).toEqual({ width: 1, height: 0.8, depth: 0.5 });
    expect(triangleNormal(box, 0)).toEqual([0, 0, 1]);
    expect(triangleNormal(box, topTriangle).map((value) => Math.round(value) + 0)).toEqual([0, 1, 0]);
  });

  it("groups coplanar triangles of one face", () => {
    expect(faceTriangles(box, topTriangle)).toEqual([8, 9]);
  });

  it("extrudes a face into real new geometry with outward side walls", () => {
    const extruded = extrudeFace(box, faceTriangles(box, topTriangle), 0.3);
    expect(extruded.positions.length / 3).toBe(28);
    expect(extruded.indices.length / 3).toBe(12 + 8);
    expect(boundsDimensions(meshBounds(extruded)).height).toBeCloseTo(1.1);
    // Every new side triangle faces horizontally outward (no inverted walls).
    for (let triangle = 12; triangle < 20; triangle += 1) {
      const [nx, ny, nz] = triangleNormal(extruded, triangle);
      expect(Math.abs(ny)).toBeLessThan(1e-9);
      const centroid = [0, 1, 2].map((axis) => [0, 1, 2].reduce((sum, corner) => sum + extruded.positions[extruded.indices[triangle * 3 + corner]! * 3 + axis]!, 0) / 3);
      expect(nx * centroid[0]! + nz * centroid[2]!).toBeGreaterThan(0);
    }
  });

  it("moves coincident vertices together so the surface stays closed", () => {
    const corner = box.indices[0]!; // front-bottom-left, shared by three faces
    const moved = moveVertices(box, [corner], [0, 0, 0.2]);
    const original = box.positions.slice(corner * 3, corner * 3 + 3).map((value) => value.toFixed(5)).join();
    let changed = 0;
    for (let i = 0; i < box.positions.length / 3; i += 1) {
      if (box.positions.slice(i * 3, i * 3 + 3).map((value) => value.toFixed(5)).join() === original) {
        expect(moved.positions[i * 3 + 2]).toBeCloseTo(box.positions[i * 3 + 2]! + 0.2);
        changed += 1;
      }
    }
    expect(changed).toBe(3);
    expect(uniqueVertexIndices(box)).toHaveLength(8);
  });

  it("re-anchors edited meshes at the bottom center and reports the offset", () => {
    const lowered = moveVertices(box, uniqueVertexIndices(box).filter((index) => box.positions[index * 3 + 1] === 0), [0, -0.2, 0]);
    const { mesh, offset, dimensions } = normalizeMesh(lowered);
    expect(offset[1]).toBeCloseTo(-0.2);
    expect(meshBounds(mesh).min[1]).toBeCloseTo(0);
    expect(dimensions.height).toBeCloseTo(1.0);
  });
});

describe("mesh actions", () => {
  const scene = SceneSchema.parse(JSON.parse(readFileSync(resolve(process.cwd(), "fixtures/bedroom-scene.json"), "utf8")));

  it("derives dimensions from the mesh and undoes back to the parametric object", () => {
    const withMesh = applySceneAction(scene, { type: "furniture.update", furnitureId: "obj-dresser", patch: { mesh: extrudeFace(createBoxMesh({ width: 1, depth: 0.45, height: 0.8 }), [8, 9], 0.2) } });
    const dresser = withMesh.scene.furniture.find((item) => item.id === "obj-dresser")!;
    expect(dresser.dimensions.height).toBeCloseTo(1.0);
    const undone = applySceneAction(withMesh.scene, withMesh.inverse).scene.furniture.find((item) => item.id === "obj-dresser")!;
    expect(undone.mesh).toBeUndefined();
    expect(undone.dimensions).toEqual({ width: 1, depth: 0.45, height: 0.8 });
  });

  it("scales mesh vertices when a mesh object is resized", () => {
    const withMesh = applySceneAction(scene, { type: "furniture.update", furnitureId: "obj-dresser", patch: { mesh: createBoxMesh({ width: 1, depth: 0.45, height: 0.8 }) } }).scene;
    const resized = applySceneAction(withMesh, { type: "furniture.update", furnitureId: "obj-dresser", patch: { dimensions: { width: 2 } } });
    const dresser = resized.scene.furniture.find((item) => item.id === "obj-dresser")!;
    expect(boundsDimensions(meshBounds(dresser.mesh!)).width).toBeCloseTo(2);
    const back = applySceneAction(resized.scene, resized.inverse).scene.furniture.find((item) => item.id === "obj-dresser")!;
    expect(boundsDimensions(meshBounds(back.mesh!)).width).toBeCloseTo(1);
  });

  it("derives created mesh objects' dimensions from their geometry", () => {
    const created = applySceneAction(scene, {
      type: "furniture.create",
      furniture: { ...scene.furniture[1]!, id: "imported-1", dimensions: { width: 9, depth: 9, height: 9 }, mesh: createBoxMesh({ width: 0.3, depth: 0.2, height: 0.1 }) },
    }).scene.furniture.find((item) => item.id === "imported-1")!;
    expect(created.dimensions).toEqual({ width: 0.3, depth: 0.2, height: 0.1 });
  });
});
