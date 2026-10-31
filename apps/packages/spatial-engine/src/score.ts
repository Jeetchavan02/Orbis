import type { BaseSceneAction, FurnitureObject, Room, Scene, SceneAction, ValidationIssue } from "@reality-builder/shared";
import { footprint, rotateYaw, worldToRoom, type Point } from "./geometry.js";
import { buildWalkGrid, floodFill, localToCell } from "./pathways.js";
import { isWalkingObstacle, openingFrame, validateScene } from "./validate.js";

export type ScoreComponent = { id: string; label: string; score: number; max: number; detail: string };
export type LayoutScore = { total: number; components: ScoreComponent[] };

const WALL_TOLERANCE = 0.15;
const DAYLIGHT_RADIUS = 2.5;
/** Objects that benefit from being against a wall / near daylight. */
const WALL_HUGGERS = new Set(["beds", "storage"]);
const DAYLIGHT_SEEKERS = new Set(["desk", "armchair", "sofa", "bed-queen", "bed-single"]);

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const r1 = (value: number) => Math.round(value * 10) / 10;

function backToWallDistance(room: Room, item: FurnitureObject) {
  // Midpoint of the object's back edge (local −Z), in room-local coordinates.
  const [bx, bz] = rotateYaw([0, -item.dimensions.depth / 2], item.yawDegrees);
  const [x, z] = worldToRoom(room, [item.position.x + bx, item.position.z + bz]);
  const halfW = room.dimensions.width / 2;
  const halfD = room.dimensions.depth / 2;
  const facing = (((item.yawDegrees - room.yawDegrees) % 360) + 360) % 360;
  // Only count it as "against the wall" when the back faces that wall squarely.
  const candidates: [number, number][] = [[halfD - z, 180], [z + halfD, 0], [halfW - x, 270], [x + halfW, 90]];
  let best = Infinity;
  for (const [distance, needed] of candidates) {
    const off = Math.min(Math.abs(facing - needed), 360 - Math.abs(facing - needed));
    if (off < 5) best = Math.min(best, distance);
  }
  return best;
}

/**
 * Explicit, measurable layout quality (0–100). Hard constraints dominate: validity is 40 points.
 * Components: validity, circulation (reachable floor from the door), wall alignment, daylight access, balance.
 */
export function scoreLayout(scene: Scene, issues?: ValidationIssue[], roomId?: string): LayoutScore {
  const room = scene.rooms.find((entry) => entry.id === roomId) ?? scene.rooms[0];
  if (!room) return { total: 0, components: [] };
  const found = (issues ?? validateScene(scene, { skipBlockerAnalysis: true }).issues).filter((issue) => !issue.roomId || issue.roomId === room.id);
  const obstacle = (item: FurnitureObject) => isWalkingObstacle(item, room.position.y);
  const errors = found.filter((issue) => issue.severity === "error").length;
  const warnings = found.filter((issue) => issue.severity === "warning").length;
  const items = scene.furniture.filter((item) => item.roomId === room.id);
  const components: ScoreComponent[] = [];

  components.push({
    id: "validity", label: "Spatial validity", max: 40,
    score: Math.max(0, 40 - errors * 10 - warnings * 4),
    detail: errors + warnings === 0 ? "No collisions, boundary, clearance or pathway problems." : `${errors} error(s) × 10 and ${warnings} warning(s) × 4 deducted.`,
  });

  // Circulation: share of the floor a person can actually reach from a door.
  const doors = room.openings.filter((opening) => opening.kind === "door");
  let circulation = 0;
  let circulationDetail = "No door — circulation cannot be measured.";
  if (doors.length) {
    const radius = scene.rules.minPassageWidth / 2;
    const grid = buildWalkGrid(room, items.filter(obstacle).map(footprint), radius);
    const starts: number[] = [];
    for (const door of doors) {
      const { center, inward } = openingFrame(room, door);
      const [column, row] = localToCell(grid, [center[0] + inward[0] * (radius + grid.cellSize), center[1] + inward[1] * (radius + grid.cellSize)]);
      if (column >= 0 && row >= 0 && column < grid.columns && row < grid.rows) starts.push(row * grid.columns + column);
    }
    const reached = floodFill(grid, starts);
    let count = 0;
    for (const value of reached) count += value;
    const share = (count * grid.cellSize * grid.cellSize) / (room.dimensions.width * room.dimensions.depth);
    // 30% of the floor reachable as walking space is a comfortable target for a furnished room.
    circulation = 20 * clamp(share / 0.3);
    circulationDetail = `${Math.round(share * 100)}% of the floor is reachable walking space (target ≥ 30%).`;
  }
  components.push({ id: "circulation", label: "Circulation", max: 20, score: circulation, detail: circulationDetail });

  const huggers = items.filter((item) => WALL_HUGGERS.has(item.category) && obstacle(item));
  const aligned = huggers.filter((item) => backToWallDistance(room, item) <= WALL_TOLERANCE);
  components.push({
    id: "walls", label: "Wall alignment", max: 15,
    score: huggers.length ? (15 * aligned.length) / huggers.length : 15,
    detail: huggers.length ? `${aligned.length} of ${huggers.length} beds/storage pieces stand with their back against a wall.` : "No beds or storage to align.",
  });

  const windows = room.openings.filter((opening) => opening.kind === "window").map((window) => {
    const { center } = openingFrame(room, window);
    return center;
  });
  const seekers = items.filter((item) => DAYLIGHT_SEEKERS.has(item.catalogItemId ?? ""));
  const lit = seekers.filter((item) => {
    const [x, z] = worldToRoom(room, [item.position.x, item.position.z]);
    return windows.some(([wx, wz]) => Math.hypot(wx - x, wz - z) <= DAYLIGHT_RADIUS);
  });
  components.push({
    id: "daylight", label: "Daylight access", max: 15,
    score: !windows.length ? 0 : seekers.length ? (15 * lit.length) / seekers.length : 15,
    detail: !windows.length ? "The room has no windows." : seekers.length ? `${lit.length} of ${seekers.length} beds/desks/seats are within ${DAYLIGHT_RADIUS} m of a window.` : "No daylight-sensitive furniture.",
  });

  // Balance: area-weighted centroid of furniture vs. room center.
  let area = 0;
  let cx = 0;
  let cz = 0;
  for (const item of items.filter(obstacle)) {
    const weight = item.dimensions.width * item.dimensions.depth;
    const [x, z] = worldToRoom(room, [item.position.x, item.position.z]);
    area += weight;
    cx += x * weight;
    cz += z * weight;
  }
  const offset = area ? Math.hypot(cx / area, cz / area) : 0;
  const reference = Math.hypot(room.dimensions.width, room.dimensions.depth) / 4;
  components.push({
    id: "balance", label: "Visual balance", max: 10,
    score: 10 * clamp(1 - offset / reference),
    detail: `Furniture mass is ${offset.toFixed(2)} m from the room center.`,
  });

  const rounded = components.map((component) => ({ ...component, score: r1(component.score) }));
  return { total: Math.round(rounded.reduce((sum, component) => sum + component.score, 0)), components: rounded };
}

export type OptimizationResult = {
  before: LayoutScore;
  after: LayoutScore;
  action: SceneAction | null;
  moves: { objectId: string; name: string; from: Point; to: Point; yawFrom: number; yawTo: number }[];
  evaluated: number;
  accepted: number;
  durationMs: number;
};

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * Seeded hill climbing. Every candidate is fully revalidated: a step is accepted only if it introduces no new
 * spatial issue, does not increase the issue count, and strictly improves the score. Locked objects never move.
 */
export function optimizeLayout(scene: Scene, options: { iterations?: number; seed?: number; roomId?: string } = {}): OptimizationResult {
  const started = now();
  const iterations = options.iterations ?? 220;
  let seed = options.seed ?? 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const room = scene.rooms.find((entry) => entry.id === options.roomId) ?? scene.rooms[0];
  const initialIssues = validateScene(scene, { skipBlockerAnalysis: true }).issues;
  const before = scoreLayout(scene, initialIssues, room?.id);
  let current = scene;
  let currentIssues = initialIssues;
  let currentScore = before.total + before.components.reduce((sum, component) => sum + component.score, 0) / 1000;
  let evaluated = 0;
  let accepted = 0;
  const movable = scene.furniture.filter((item) => !item.constraints?.locked && !!room && isWalkingObstacle(item, room.position.y) && item.roomId === room.id);
  if (!room || movable.length === 0) return { before, after: before, action: null, moves: [], evaluated, accepted, durationMs: now() - started };

  for (let step = 0; step < iterations; step += 1) {
    const target = movable[Math.floor(random() * movable.length)]!;
    const item = current.furniture.find((entry) => entry.id === target.id)!;
    const kind = random();
    let next: FurnitureObject;
    if (kind < 0.65) {
      const distance = 0.05 + random() * 0.35;
      const angle = random() * Math.PI * 2;
      next = { ...item, position: { ...item.position, x: round(item.position.x + Math.cos(angle) * distance), z: round(item.position.z + Math.sin(angle) * distance) } };
    } else if (kind < 0.85) {
      next = { ...item, yawDegrees: (((Math.round(item.yawDegrees / 90) * 90 + (random() < 0.5 ? 90 : -90)) % 360) + 360) % 360 };
    } else {
      next = snapToWall(room, item);
    }
    const candidate: Scene = { ...current, furniture: current.furniture.map((entry) => (entry.id === item.id ? next : entry)) };
    evaluated += 1;
    const issues = validateScene(candidate, { skipBlockerAnalysis: true }).issues;
    const known = new Set(currentIssues.map((issue) => issue.id));
    if (issues.length > currentIssues.length || issues.some((issue) => !known.has(issue.id))) continue;
    const score = scoreLayout(candidate, issues, room.id);
    const value = score.total + score.components.reduce((sum, component) => sum + component.score, 0) / 1000;
    if (value > currentScore + 1e-6) {
      current = candidate;
      currentIssues = issues;
      currentScore = value;
      accepted += 1;
    }
  }

  const moves: OptimizationResult["moves"] = [];
  const actions: BaseSceneAction[] = [];
  for (const original of scene.furniture) {
    const final = current.furniture.find((entry) => entry.id === original.id)!;
    if (final.position.x === original.position.x && final.position.z === original.position.z && final.yawDegrees === original.yawDegrees) continue;
    moves.push({ objectId: original.id, name: original.name, from: [original.position.x, original.position.z], to: [final.position.x, final.position.z], yawFrom: original.yawDegrees, yawTo: final.yawDegrees });
    actions.push({ type: "furniture.update", furnitureId: original.id, patch: { position: { x: final.position.x, z: final.position.z }, yawDegrees: final.yawDegrees } });
  }
  const after = scoreLayout(current, currentIssues, room.id);
  return {
    before,
    after,
    action: actions.length ? { type: "batch", label: `Optimize layout (${before.total} → ${after.total})`, actions } : null,
    moves,
    evaluated,
    accepted,
    durationMs: now() - started,
  };
}

/** Moves an object straight back until its back edge touches the nearest wall it faces away from. */
function snapToWall(room: Room, item: FurnitureObject): FurnitureObject {
  const facing = (((Math.round((item.yawDegrees - room.yawDegrees) / 90) * 90) % 360) + 360) % 360;
  const [x, z] = worldToRoom(room, [item.position.x, item.position.z]);
  const halfW = room.dimensions.width / 2;
  const halfD = room.dimensions.depth / 2;
  const d = item.dimensions.depth / 2 + 0.005;
  const local: Point = facing === 0 ? [x, -halfD + d] : facing === 180 ? [x, halfD - d] : facing === 90 ? [-halfW + d, z] : [halfW - d, z];
  const [wx, wz] = rotateYaw(local, room.yawDegrees);
  return { ...item, yawDegrees: facing + room.yawDegrees, position: { ...item.position, x: round(room.position.x + wx), z: round(room.position.z + wz) } };
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}
