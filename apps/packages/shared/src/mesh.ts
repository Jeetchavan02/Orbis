import type { Dimensions3D, MeshData } from "./schemas.js";

export type MeshBounds = {
  min: [number, number, number];
  max: [number, number, number];
};

/** Box mesh with 24 vertices (separate per face) so faces can be extruded independently. */
export function createBoxMesh({ width, depth, height }: Dimensions3D): MeshData {
  const x = width / 2;
  const z = depth / 2;
  const h = height;
  // Each face: 4 corners counter-clockwise when viewed from outside.
  const faces: [number, number, number][][] = [
    [[-x, 0, z], [x, 0, z], [x, h, z], [-x, h, z]], // front +Z
    [[x, 0, -z], [-x, 0, -z], [-x, h, -z], [x, h, -z]], // back −Z
    [[x, 0, z], [x, 0, -z], [x, h, -z], [x, h, z]], // right +X
    [[-x, 0, -z], [-x, 0, z], [-x, h, z], [-x, h, -z]], // left −X
    [[-x, h, z], [x, h, z], [x, h, -z], [-x, h, -z]], // top +Y
    [[-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z]], // bottom −Y
  ];
  const positions: number[] = [];
  const indices: number[] = [];
  faces.forEach((corners, face) => {
    for (const corner of corners) positions.push(...corner);
    const base = face * 4;
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  return { positions, indices, source: "primitive" };
}

export function meshBounds(mesh: Pick<MeshData, "positions">): MeshBounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = mesh.positions[i + axis]!;
      if (value < min[axis]!) min[axis] = value;
      if (value > max[axis]!) max[axis] = value;
    }
  }
  return { min, max };
}

export function boundsDimensions(bounds: MeshBounds): Dimensions3D {
  const size = (axis: number) => Math.max(1e-4, bounds.max[axis]! - bounds.min[axis]!);
  return { width: size(0), height: size(1), depth: size(2) };
}

/** Scales a mesh about its local origin so that its bounds match `next`. */
export function scaleMeshTo(mesh: MeshData, current: Dimensions3D, next: Dimensions3D): MeshData {
  const sx = next.width / current.width;
  const sy = next.height / current.height;
  const sz = next.depth / current.depth;
  const positions = mesh.positions.map((value, index) => {
    const axis = index % 3;
    return value * (axis === 0 ? sx : axis === 1 ? sy : sz);
  });
  return { ...mesh, positions };
}

/**
 * Re-anchors a mesh so its bounds are bottom-centered at the local origin.
 * Returns the local-space offset that was removed; callers move the object by that offset (rotated by yaw)
 * so the geometry stays where it was in the world.
 */
export function normalizeMesh(mesh: MeshData): { mesh: MeshData; offset: [number, number, number]; dimensions: Dimensions3D } {
  const bounds = meshBounds(mesh);
  const offset: [number, number, number] = [
    (bounds.min[0] + bounds.max[0]) / 2,
    bounds.min[1],
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
  const positions = mesh.positions.map((value, index) => value - offset[index % 3]!);
  const normalized = { ...mesh, positions };
  return { mesh: normalized, offset, dimensions: boundsDimensions(meshBounds(normalized)) };
}

type Vec3 = [number, number, number];

function vertex(mesh: MeshData, index: number): Vec3 {
  return [mesh.positions[index * 3]!, mesh.positions[index * 3 + 1]!, mesh.positions[index * 3 + 2]!];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

export function triangleNormal(mesh: MeshData, triangle: number): Vec3 {
  const a = vertex(mesh, mesh.indices[triangle * 3]!);
  const b = vertex(mesh, mesh.indices[triangle * 3 + 1]!);
  const c = vertex(mesh, mesh.indices[triangle * 3 + 2]!);
  return normalize(cross(sub(b, a), sub(c, a)));
}

/**
 * A "face" is the set of triangles that share at least one vertex index with the seed triangle and are coplanar
 * with it (same normal, same plane offset). For box primitives this yields the 2-triangle quads.
 */
export function faceTriangles(mesh: MeshData, seedTriangle: number): number[] {
  const normal = triangleNormal(mesh, seedTriangle);
  const seedVertex = vertex(mesh, mesh.indices[seedTriangle * 3]!);
  const planeOffset = normal[0] * seedVertex[0] + normal[1] * seedVertex[1] + normal[2] * seedVertex[2];
  const triangleCount = mesh.indices.length / 3;
  const result = new Set<number>([seedTriangle]);
  const vertexSet = new Set<number>(mesh.indices.slice(seedTriangle * 3, seedTriangle * 3 + 3));
  let grew = true;
  while (grew) {
    grew = false;
    for (let t = 0; t < triangleCount; t += 1) {
      if (result.has(t)) continue;
      const tri = mesh.indices.slice(t * 3, t * 3 + 3);
      if (!tri.some((index) => vertexSet.has(index))) continue;
      const n = triangleNormal(mesh, t);
      if (n[0] * normal[0] + n[1] * normal[1] + n[2] * normal[2] < 0.999) continue;
      const v = vertex(mesh, tri[0]!);
      if (Math.abs(normal[0] * v[0] + normal[1] * v[1] + normal[2] * v[2] - planeOffset) > 1e-5) continue;
      result.add(t);
      tri.forEach((index) => vertexSet.add(index));
      grew = true;
    }
  }
  return [...result].sort((a, b) => a - b);
}

/**
 * Extrudes a face along its normal by `distance`. The face's vertices are duplicated and moved out,
 * the original face triangles are re-pointed to the moved copies, and side walls are generated along
 * the face's boundary edges with outward winding. Produces genuinely new geometry (new vertices and triangles).
 */
export function extrudeFace(mesh: MeshData, triangles: number[], distance: number): MeshData {
  if (triangles.length === 0) throw new Error("No face selected for extrusion.");
  const normal = triangleNormal(mesh, triangles[0]!);
  const positions = [...mesh.positions];
  const indices = [...mesh.indices];
  const remap = new Map<number, number>();
  const triangleSet = new Set(triangles);

  for (const triangle of triangles) {
    for (let corner = 0; corner < 3; corner += 1) {
      const original = mesh.indices[triangle * 3 + corner]!;
      if (!remap.has(original)) {
        const [x, y, z] = vertex(mesh, original);
        remap.set(original, positions.length / 3);
        positions.push(x + normal[0] * distance, y + normal[1] * distance, z + normal[2] * distance);
      }
    }
  }

  // Boundary edges appear in exactly one face triangle (directed edge a→b without its twin b→a inside the face).
  const directed = new Map<string, [number, number]>();
  for (const triangle of triangleSet) {
    for (let corner = 0; corner < 3; corner += 1) {
      const a = mesh.indices[triangle * 3 + corner]!;
      const b = mesh.indices[triangle * 3 + ((corner + 1) % 3)]!;
      directed.set(a + ">" + b, [a, b]);
    }
  }
  for (const [key, [a, b]] of directed) {
    if (directed.has(b + ">" + a)) continue;
    void key;
    const a2 = remap.get(a)!;
    const b2 = remap.get(b)!;
    // Side quad a, b, b2, a2 — winding follows the face edge so normals face outward.
    if (distance >= 0) indices.push(a, b, b2, a, b2, a2);
    else indices.push(a, b2, b, a, a2, b2);
  }

  for (const triangle of triangles) {
    for (let corner = 0; corner < 3; corner += 1) {
      indices[triangle * 3 + corner] = remap.get(mesh.indices[triangle * 3 + corner]!)!;
    }
  }
  return { ...mesh, positions, indices };
}

/** Moves one or more vertices (by index) by a local-space delta. Coincident duplicates are moved together. */
export function moveVertices(mesh: MeshData, vertexIndices: number[], delta: [number, number, number]): MeshData {
  const targets = new Set<number>();
  const keyOf = (index: number) => vertex(mesh, index).map((value) => value.toFixed(5)).join(",");
  const keys = new Set(vertexIndices.map(keyOf));
  for (let index = 0; index < mesh.positions.length / 3; index += 1) {
    if (keys.has(keyOf(index))) targets.add(index);
  }
  const positions = [...mesh.positions];
  for (const index of targets) {
    positions[index * 3] = positions[index * 3]! + delta[0];
    positions[index * 3 + 1] = positions[index * 3 + 1]! + delta[1];
    positions[index * 3 + 2] = positions[index * 3 + 2]! + delta[2];
  }
  return { ...mesh, positions };
}

/** Distinct vertex positions (coincident duplicates collapsed); returns one representative index per position. */
export function uniqueVertexIndices(mesh: MeshData): number[] {
  const seen = new Map<string, number>();
  for (let index = 0; index < mesh.positions.length / 3; index += 1) {
    const key = vertex(mesh, index).map((value) => value.toFixed(5)).join(",");
    if (!seen.has(key)) seen.set(key, index);
  }
  return [...seen.values()];
}
