import RBush from "rbush";
import SunCalc from "suncalc";
import type { FurnitureObject, Room, Scene } from "@reality-builder/shared";
import { DEG_TO_RAD, footprint, polygonAabb, roomToWorld, rotateYaw, worldToRoom } from "./geometry.js";

export type SunPosition = { altitudeDeg: number; bearingDeg: number; daylight: boolean };

export type SunStudy = {
  /** "instant": lit (1/0) per cell at `date`; "daily": hours of direct sun per cell for that day. */
  mode: "instant" | "daily";
  sun: SunPosition;
  columns: number;
  rows: number;
  cellSize: number;
  values: number[];
  /** Share of floor cells receiving direct sun (instant) or the mean hours per cell (daily). */
  summary: number;
  objects: { id: string; name: string; value: number }[];
  samples: number;
  durationMs: number;
  assumptions: string[];
};

type Box = { minX: number; minY: number; maxX: number; maxY: number; item: FurnitureObject };

const MAX_CELLS = 6000;
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** Sun position from SunCalc, as a compass bearing (0 = north, 90 = east) and altitude. */
export function sunPosition(date: Date, latitude: number, longitude: number): SunPosition {
  const position = SunCalc.getPosition(date, latitude, longitude);
  // SunCalc azimuth is measured from south, positive toward west.
  const bearingDeg = ((((position.azimuth * 180) / Math.PI + 180) % 360) + 360) % 360;
  const altitudeDeg = (position.altitude * 180) / Math.PI;
  return { altitudeDeg, bearingDeg, daylight: altitudeDeg > 0 };
}

/** Unit direction toward the sun in room-local coordinates (x, y, z), honoring the room's north offset. */
function sunDirection(sun: SunPosition, northOffsetDegrees: number): [number, number, number] {
  const relative = (sun.bearingDeg - northOffsetDegrees) * DEG_TO_RAD;
  const altitude = sun.altitudeDeg * DEG_TO_RAD;
  return [Math.sin(relative) * Math.cos(altitude), Math.sin(altitude), -Math.cos(relative) * Math.cos(altitude)];
}

/** Ray vs. oriented furniture box (slab test in the object's frame). Returns hit distance or Infinity. */
function rayBox(origin: [number, number, number], direction: [number, number, number], item: FurnitureObject) {
  const [ox, oz] = rotateYaw([origin[0] - item.position.x, origin[2] - item.position.z], -item.yawDegrees);
  const [dx, dz] = rotateYaw([direction[0], direction[2]], -item.yawDegrees);
  const min = [-item.dimensions.width / 2, item.position.y, -item.dimensions.depth / 2];
  const max = [item.dimensions.width / 2, item.position.y + item.dimensions.height, item.dimensions.depth / 2];
  const o = [ox, origin[1], oz];
  const d = [dx, direction[1], dz];
  let tMin = 0;
  let tMax = Infinity;
  for (let axis = 0; axis < 3; axis += 1) {
    if (Math.abs(d[axis]!) < 1e-12) {
      if (o[axis]! < min[axis]! || o[axis]! > max[axis]!) return Infinity;
      continue;
    }
    let t1 = (min[axis]! - o[axis]!) / d[axis]!;
    let t2 = (max[axis]! - o[axis]!) / d[axis]!;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return Infinity;
  }
  return tMin > 1e-6 ? tMin : Infinity;
}

/**
 * Is the room-local point lit by direct sun? The ray must leave the room through a window opening
 * (walls and ceiling block it) and must not hit any furniture first. World-space furniture is tested via RBush.
 */
function isLit(room: Room, local: [number, number, number], direction: [number, number, number], tree: RBush<Box>, ignoreId?: string) {
  const halfW = room.dimensions.width / 2;
  const halfD = room.dimensions.depth / 2;
  const [x, y, z] = local;
  const [dx, dy, dz] = direction;
  if (dy <= 0) return false;
  const candidates: [number, string][] = [];
  if (dx > 0) candidates.push([(halfW - x) / dx, "east"]);
  if (dx < 0) candidates.push([(-halfW - x) / dx, "west"]);
  if (dz > 0) candidates.push([(halfD - z) / dz, "south"]);
  if (dz < 0) candidates.push([(-halfD - z) / dz, "north"]);
  candidates.sort((a, b) => a[0] - b[0]);
  const [tWall, wall] = candidates[0] ?? [Infinity, ""];
  const hitY = y + dy * tWall;
  if (hitY >= room.dimensions.height) return false; // ceiling
  const along = wall === "north" || wall === "south" ? x + dx * tWall : z + dz * tWall;
  const window = room.openings.find((opening) =>
    opening.kind === "window" && opening.wall === wall &&
    Math.abs(along - opening.offset) <= opening.width / 2 &&
    hitY >= opening.sillHeight && hitY <= opening.sillHeight + opening.height);
  if (!window) return false;

  // Furniture occlusion between the point and the window, in world space.
  const startWorld = roomToWorld(room, [x, z]);
  const endWorld = roomToWorld(room, [x + dx * tWall, z + dz * tWall]);
  const [wdx, wdz] = rotateYaw([dx, dz], room.yawDegrees);
  const hits = tree.search({
    minX: Math.min(startWorld[0], endWorld[0]), maxX: Math.max(startWorld[0], endWorld[0]),
    minY: Math.min(startWorld[1], endWorld[1]), maxY: Math.max(startWorld[1], endWorld[1]),
  });
  const origin: [number, number, number] = [startWorld[0], room.position.y + y, startWorld[1]];
  return !hits.some((box) => box.item.id !== ignoreId && rayBox(origin, [wdx, dy, wdz], box.item) < tWall);
}

/**
 * Approximate direct-sunlight study: SunCalc sun position + ray casting through window openings with
 * furniture as occluders. Ignores diffuse/bounced light, exterior obstructions, glass transmittance and terrain.
 */
export function sunStudy(scene: Scene, date: Date, mode: "instant" | "daily" = "instant", roomId?: string): SunStudy {
  const started = now();
  const room = scene.rooms.find((entry) => entry.id === roomId) ?? scene.rooms[0];
  const { latitude, longitude, northOffsetDegrees } = scene.environment;
  const sun = sunPosition(date, latitude, longitude);
  const assumptions = [
    `Site ${latitude.toFixed(3)}°, ${longitude.toFixed(3)}°; room north offset ${northOffsetDegrees}°.`,
    "Direct sun only — no diffuse sky light, reflections, or exterior buildings/trees.",
    "Windows are fully transparent openings; furniture is treated as solid boxes.",
  ];
  if (!room) return { mode, sun, columns: 0, rows: 0, cellSize: 0, values: [], summary: 0, objects: [], samples: 0, durationMs: 0, assumptions };

  const area = room.dimensions.width * room.dimensions.depth;
  const cellSize = Math.max(0.1, Math.sqrt(area / MAX_CELLS));
  const columns = Math.max(1, Math.floor(room.dimensions.width / cellSize));
  const rows = Math.max(1, Math.floor(room.dimensions.depth / cellSize));
  const tree = new RBush<Box>();
  // Floor coverings (rugs, drawn-back curtains) never block sun rays.
  const occluders = scene.furniture.filter((item) => item.roomId === room.id && item.dimensions.height > 0.03 && !item.constraints?.floorCovering);
  tree.load(occluders.map((item) => {
    const box = polygonAabb(footprint(item));
    return { minX: box.minX, minY: box.minZ, maxX: box.maxX, maxY: box.maxZ, item };
  }));

  // Times to sample: one instant, or every 30 minutes across the day (local solar day via SunCalc times).
  const times: Date[] = [];
  if (mode === "instant") times.push(date);
  else {
    const day = SunCalc.getTimes(date, latitude, longitude);
    if (!Number.isNaN(day.sunrise.getTime())) {
      for (let t = day.sunrise.getTime(); t <= day.sunset.getTime(); t += 30 * 60_000) times.push(new Date(t));
    }
  }
  const step = mode === "daily" ? 0.5 : 1;
  const directions = times.map((time) => sunPosition(time, latitude, longitude)).filter((position) => position.daylight).map((position) => sunDirection(position, northOffsetDegrees));

  const values = new Array<number>(columns * rows).fill(0);
  let samples = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = -room.dimensions.width / 2 + (column + 0.5) * cellSize;
      const z = -room.dimensions.depth / 2 + (row + 0.5) * cellSize;
      for (const direction of directions) {
        samples += 1;
        if (isLit(room, [x, 0.02, z], direction, tree)) values[row * columns + column]! += step;
      }
    }
  }

  // Per object: share of a 5×5 grid on its top surface receiving sun (instant) or mean hours (daily).
  const objects = occluders.filter((item) => ["beds", "tables", "seating"].includes(item.category)).map((item) => {
    let total = 0;
    let count = 0;
    for (let i = 0; i < 5; i += 1) {
      for (let j = 0; j < 5; j += 1) {
        const [ox, oz] = rotateYaw([(i / 4 - 0.5) * item.dimensions.width * 0.9, (j / 4 - 0.5) * item.dimensions.depth * 0.9], item.yawDegrees);
        const [lx, lz] = worldToRoom(room, [item.position.x + ox, item.position.z + oz]);
        const local: [number, number, number] = [lx, item.position.y - room.position.y + item.dimensions.height + 0.01, lz];
        for (const direction of directions) {
          samples += 1;
          if (isLit(room, local, direction, tree, item.id)) total += step;
        }
        count += 1;
      }
    }
    return { id: item.id, name: item.name, value: Math.round((total / count) * 100) / 100 };
  });

  // Instant: share of lit cells (values are 0/1). Daily: mean hours of direct sun per cell.
  const summary = values.reduce((sum, value) => sum + value, 0) / values.length;
  return { mode, sun, columns, rows, cellSize, values, summary, objects, samples, durationMs: now() - started, assumptions };
}

