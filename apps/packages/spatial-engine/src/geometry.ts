import type { FurnitureObject, Room } from "@reality-builder/shared";

/** A point on the floor plane: [x, z] in world meters. */
export type Point = [number, number];
/** Convex polygon, counter-clockwise when viewed from +Y looking down... orientation is normalized by `convexHull`. */
export type Polygon = Point[];
export type Aabb = { minX: number; minZ: number; maxX: number; maxZ: number };

export const DEG_TO_RAD = Math.PI / 180;

/** Rotates a local (x, z) offset by yaw around +Y, matching three.js `rotation.y`. */
export function rotateYaw([x, z]: Point, yawDegrees: number): Point {
  const angle = yawDegrees * DEG_TO_RAD;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [x * cos + z * sin, -x * sin + z * cos];
}

export function localToWorld(item: Pick<FurnitureObject, "position" | "yawDegrees">, local: Point): Point {
  const [x, z] = rotateYaw(local, item.yawDegrees);
  return [item.position.x + x, item.position.z + z];
}

export function rectPolygon(item: Pick<FurnitureObject, "position" | "yawDegrees">, minX: number, maxX: number, minZ: number, maxZ: number): Polygon {
  return [
    localToWorld(item, [minX, minZ]),
    localToWorld(item, [maxX, minZ]),
    localToWorld(item, [maxX, maxZ]),
    localToWorld(item, [minX, maxZ]),
  ];
}

/**
 * Floor footprint collider, derived from geometry and transform (never stored).
 * Mesh objects use the convex hull of their projected vertices; primitives use their oriented box.
 */
export function footprint(item: FurnitureObject): Polygon {
  if (item.mesh) {
    const points: Point[] = [];
    const { positions } = item.mesh;
    for (let i = 0; i < positions.length; i += 3) points.push(localToWorld(item, [positions[i]!, positions[i + 2]!]));
    return convexHull(points);
  }
  const { width, depth } = item.dimensions;
  return rectPolygon(item, -width / 2, width / 2, -depth / 2, depth / 2);
}

export function verticalRange(item: FurnitureObject): [number, number] {
  return [item.position.y, item.position.y + item.dimensions.height];
}

export function polygonAabb(polygon: Polygon): Aabb {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of polygon) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, minZ, maxX, maxZ };
}

/** Andrew's monotone chain. */
export function convexHull(points: Point[]): Polygon {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length <= 2) return sorted;
  const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Point[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 1e-12) lower.pop();
    lower.push(point);
  }
  const upper: Point[] = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const point = sorted[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 1e-12) upper.pop();
    upper.push(point);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function projectionRange(polygon: Polygon, axis: Point): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const [x, z] of polygon) {
    const value = x * axis[0] + z * axis[1];
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return [min, max];
}

/**
 * Separating Axis Theorem for convex polygons. Returns the minimum penetration depth
 * (0 or negative-free: `depth <= 0` means separated).
 */
export function satPenetration(a: Polygon, b: Polygon): number {
  let minOverlap = Infinity;
  for (const polygon of [a, b]) {
    for (let i = 0; i < polygon.length; i += 1) {
      const p1 = polygon[i]!;
      const p2 = polygon[(i + 1) % polygon.length]!;
      const edge: Point = [p2[0] - p1[0], p2[1] - p1[1]];
      const length = Math.hypot(edge[0], edge[1]);
      if (length < 1e-12) continue;
      const axis: Point = [-edge[1] / length, edge[0] / length];
      const [minA, maxA] = projectionRange(a, axis);
      const [minB, maxB] = projectionRange(b, axis);
      const overlap = Math.min(maxA, maxB) - Math.max(minA, minB);
      if (overlap <= 0) return overlap;
      if (overlap < minOverlap) minOverlap = overlap;
    }
  }
  return minOverlap;
}

function pointSegmentDistance([px, pz]: Point, [ax, az]: Point, [bx, bz]: Point): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lengthSq));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

export function pointInConvexPolygon(point: Point, polygon: Polygon): boolean {
  let sign = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const cross = (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0]);
    if (Math.abs(cross) < 1e-12) continue;
    const current = Math.sign(cross);
    if (sign === 0) sign = current;
    else if (current !== sign) return false;
  }
  return true;
}

/** Distance from a point to a convex polygon (0 inside). */
export function pointPolygonDistance(point: Point, polygon: Polygon): number {
  if (pointInConvexPolygon(point, polygon)) return 0;
  let best = Infinity;
  for (let i = 0; i < polygon.length; i += 1) {
    best = Math.min(best, pointSegmentDistance(point, polygon[i]!, polygon[(i + 1) % polygon.length]!));
  }
  return best;
}

/** Minimum distance between two convex polygons (0 when they overlap). */
export function polygonDistance(a: Polygon, b: Polygon): number {
  if (satPenetration(a, b) > 0) return 0;
  let best = Infinity;
  for (const point of a) best = Math.min(best, pointPolygonDistance(point, b));
  for (const point of b) best = Math.min(best, pointPolygonDistance(point, a));
  return best;
}

/** Room-local frame: origin at room center, axes aligned with the room walls. */
export function worldToRoom(room: Room, [x, z]: Point): Point {
  return rotateYaw([x - room.position.x, z - room.position.z], -room.yawDegrees);
}

export function roomToWorld(room: Room, local: Point): Point {
  const [x, z] = rotateYaw(local, room.yawDegrees);
  return [room.position.x + x, room.position.z + z];
}

export function roomInteriorPolygon(room: Room): Polygon {
  const w = room.dimensions.width / 2;
  const d = room.dimensions.depth / 2;
  return [roomToWorld(room, [-w, -d]), roomToWorld(room, [w, -d]), roomToWorld(room, [w, d]), roomToWorld(room, [-w, d])];
}
