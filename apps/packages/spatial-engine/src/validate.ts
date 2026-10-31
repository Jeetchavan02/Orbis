import RBush from "rbush";
import type { FurnitureObject, Opening, Room, Scene, ValidationIssue } from "@reality-builder/shared";
import {
  footprint,
  polygonAabb,
  rectPolygon,
  roomToWorld,
  satPenetration,
  verticalRange,
  worldToRoom,
  type Point,
  type Polygon,
} from "./geometry.js";
import { buildWalkGrid, cellCenterLocal, cellToWorld, findPath, floodFill, localToCell, type WalkGrid } from "./pathways.js";

export type ValidationStats = {
  objectCount: number;
  /** Pairs a brute-force check would test: n(n−1)/2. */
  naivePairs: number;
  /** Candidate pairs returned by the RBush broad phase. */
  broadPhasePairs: number;
  /** Pairs that reached the SAT narrow phase (after vertical-range and layer filtering). */
  narrowPhaseTests: number;
  collisions: number;
  walkGridCells: number;
  durationMs: number;
  timings: { index: number; collisions: number; boundaries: number; clearances: number; pathways: number };
};

export type Route = { targetId: string; doorId: string; points: Point[] };

export type ValidationResult = {
  issues: ValidationIssue[];
  stats: ValidationStats;
  routes: Route[];
};

export type ValidateOptions = {
  /** Compute A* walking routes from the first door to each reachable object (for visualization). */
  routes?: boolean;
  /** Skip the expensive "which object blocks this path" analysis (used inside recovery search). */
  skipBlockerAnalysis?: boolean;
};

type Entry = { minX: number; minY: number; maxX: number; maxY: number; index: number };

const COLLISION_TOLERANCE = 0.005;
const BOUNDARY_TOLERANCE = 0.005;
/** Objects mounted higher than this do not obstruct walking or front clearance. */
const WALKING_HEIGHT = 1.2;

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const fmt = (meters: number) => meters.toFixed(2) + " m";

export function isFloorCovering(item: FurnitureObject) {
  return item.constraints?.floorCovering ?? item.dimensions.height <= 0.03;
}

/** Whether the object physically obstructs walking at floor level. */
export function isWalkingObstacle(item: FurnitureObject) {
  return !isFloorCovering(item) && item.position.y < WALKING_HEIGHT;
}

export function requiredFrontClearance(scene: Scene, item: FurnitureObject) {
  return item.constraints?.frontClearance ?? scene.rules.categoryClearance[item.category] ?? 0;
}

/** Free-space zone in front of an object (local +Z) of the given depth. */
export function frontZone(item: FurnitureObject, depth: number): Polygon {
  const { width, depth: itemDepth } = item.dimensions;
  return rectPolygon(item, -width / 2, width / 2, itemDepth / 2, itemDepth / 2 + depth);
}

/** Opening geometry in room-local coordinates. */
export function openingFrame(room: Room, opening: Opening) {
  const w = room.dimensions.width / 2;
  const d = room.dimensions.depth / 2;
  switch (opening.wall) {
    case "north": return { center: [opening.offset, -d] as Point, inward: [0, 1] as Point, along: [1, 0] as Point };
    case "south": return { center: [opening.offset, d] as Point, inward: [0, -1] as Point, along: [1, 0] as Point };
    case "west": return { center: [-w, opening.offset] as Point, inward: [1, 0] as Point, along: [0, 1] as Point };
    case "east": return { center: [w, opening.offset] as Point, inward: [-1, 0] as Point, along: [0, 1] as Point };
  }
}

/** Square swing zone just inside a door, in world coordinates. */
export function doorSwingZone(room: Room, door: Opening): Polygon {
  const { center, inward, along } = openingFrame(room, door);
  const half = door.width / 2;
  const depth = door.width;
  const corner = (a: number, b: number): Point => roomToWorld(room, [
    center[0] + along[0] * a + inward[0] * b,
    center[1] + along[1] * a + inward[1] * b,
  ]);
  return [corner(-half, 0), corner(half, 0), corner(half, depth), corner(-half, depth)];
}

export function validateScene(scene: Scene, options: ValidateOptions = {}): ValidationResult {
  const started = now();
  const issues: ValidationIssue[] = [];
  const furniture = scene.furniture;
  const rooms = new Map(scene.rooms.map((room) => [room.id, room]));

  // ---- Index: colliders are derived from geometry + transform on every run.
  const t0 = now();
  const polygons = furniture.map(footprint);
  const ranges = furniture.map(verticalRange);
  const tree = new RBush<Entry>();
  tree.load(polygons.map((polygon, index) => {
    const box = polygonAabb(polygon);
    return { minX: box.minX, minY: box.minZ, maxX: box.maxX, maxY: box.maxZ, index };
  }));
  const tIndex = now() - t0;

  // ---- Collisions: RBush broad phase → vertical filter → SAT narrow phase.
  const t1 = now();
  let broadPhasePairs = 0;
  let narrowPhaseTests = 0;
  let collisions = 0;
  if (scene.rules.collisions) {
    for (let i = 0; i < furniture.length; i += 1) {
      const box = polygonAabb(polygons[i]!);
      const candidates = tree.search({ minX: box.minX, minY: box.minZ, maxX: box.maxX, maxY: box.maxZ });
      for (const candidate of candidates) {
        const j = candidate.index;
        if (j <= i) continue;
        broadPhasePairs += 1;
        const a = furniture[i]!;
        const b = furniture[j]!;
        if (isFloorCovering(a) || isFloorCovering(b)) continue;
        const [aMin, aMax] = ranges[i]!;
        const [bMin, bMax] = ranges[j]!;
        if (Math.min(aMax, bMax) - Math.max(aMin, bMin) <= COLLISION_TOLERANCE) continue;
        narrowPhaseTests += 1;
        const depth = satPenetration(polygons[i]!, polygons[j]!);
        if (depth <= COLLISION_TOLERANCE) continue;
        collisions += 1;
        issues.push({
          id: `collision.overlap:${a.id}:${b.id}`,
          ruleId: "collision.overlap",
          severity: "error",
          objectIds: [a.id, b.id],
          roomId: a.roomId,
          message: `${a.name} overlaps ${b.name} by ${fmt(depth)}.`,
          measured: round(depth),
          threshold: 0,
          suggestion: `Move ${a.name} or ${b.name} at least ${fmt(depth)} apart.`,
          highlight: { objectIds: [a.id, b.id], zones: [] },
        });
      }
    }
  }
  const tCollisions = now() - t1;

  // ---- Room boundaries.
  const t2 = now();
  if (scene.rules.boundaries) {
    furniture.forEach((item, index) => {
      const room = rooms.get(item.roomId);
      if (!room) return;
      const halfW = room.dimensions.width / 2;
      const halfD = room.dimensions.depth / 2;
      let excess = 0;
      let side = "";
      for (const point of polygons[index]!) {
        const [x, z] = worldToRoom(room, point);
        const candidates: [number, string][] = [[x - halfW, "east"], [-halfW - x, "west"], [z - halfD, "south"], [-halfD - z, "north"]];
        for (const [value, wall] of candidates) {
          if (value > excess) [excess, side] = [value, wall];
        }
      }
      if (excess > BOUNDARY_TOLERANCE) {
        issues.push({
          id: `boundary.outside-room:${item.id}`,
          ruleId: "boundary.outside-room",
          severity: "error",
          objectIds: [item.id],
          roomId: room.id,
          message: `${item.name} extends ${fmt(excess)} past the ${side} wall of ${room.name}.`,
          measured: round(excess),
          threshold: 0,
          suggestion: `Move ${item.name} ${fmt(excess)} away from the ${side} wall.`,
          highlight: { objectIds: [item.id], zones: [] },
        });
      }
      const top = item.position.y + item.dimensions.height;
      if (top > room.dimensions.height + BOUNDARY_TOLERANCE) {
        issues.push({
          id: `boundary.outside-room:${item.id}:ceiling`,
          ruleId: "boundary.outside-room",
          severity: "error",
          objectIds: [item.id],
          roomId: room.id,
          message: `${item.name} is ${fmt(top - room.dimensions.height)} taller than the ${fmt(room.dimensions.height)} ceiling.`,
          measured: round(top),
          threshold: room.dimensions.height,
          highlight: { objectIds: [item.id], zones: [] },
        });
      }
    });
  }
  const tBoundaries = now() - t2;

  const obstacleIndices = furniture.map((_, index) => index).filter((index) => isWalkingObstacle(furniture[index]!));
  const isObstacle = new Set(obstacleIndices);
  const overlappingObstacles = (zone: Polygon, excludeIndex: number) => {
    const box = polygonAabb(zone);
    return tree
      .search({ minX: box.minX, minY: box.minZ, maxX: box.maxX, maxY: box.maxZ })
      .map((entry) => entry.index)
      .filter((index) => index !== excludeIndex && isObstacle.has(index) && satPenetration(zone, polygons[index]!) > COLLISION_TOLERANCE);
  };

  // ---- Front clearances (binary search for the free depth against obstacles and walls).
  const t3 = now();
  if (scene.rules.clearances) {
    furniture.forEach((item, index) => {
      const required = requiredFrontClearance(scene, item);
      const room = rooms.get(item.roomId);
      if (required <= 0 || !room || !isWalkingObstacle(item)) return;
      const zone = frontZone(item, required);
      const wallBlocked = (depth: number) => frontZone(item, depth).some((point) => {
        const [x, z] = worldToRoom(room, point);
        return Math.abs(x) > room.dimensions.width / 2 + BOUNDARY_TOLERANCE || Math.abs(z) > room.dimensions.depth / 2 + BOUNDARY_TOLERANCE;
      });
      const blockers = overlappingObstacles(zone, index);
      const wall = wallBlocked(required);
      if (blockers.length === 0 && !wall) return;

      let low = 0;
      let high = required;
      for (let step = 0; step < 14; step += 1) {
        const mid = (low + high) / 2;
        if (overlappingObstacles(frontZone(item, mid), index).length > 0 || wallBlocked(mid)) high = mid;
        else low = mid;
      }
      const blockerNames = blockers.map((blocker) => furniture[blocker]!.name);
      if (wall) blockerNames.push("the wall");
      issues.push({
        id: `clearance.front:${item.id}`,
        ruleId: "clearance.front",
        severity: "warning",
        objectIds: [item.id, ...blockers.map((blocker) => furniture[blocker]!.id)],
        roomId: room.id,
        message: `${item.name} needs ${fmt(required)} of free space in front; only ${fmt(low)} is available (blocked by ${joinNames(blockerNames)}).`,
        measured: round(low),
        threshold: required,
        suggestion: `Keep ${fmt(required)} clear in front of ${item.name}.`,
        highlight: { objectIds: [item.id, ...blockers.map((blocker) => furniture[blocker]!.id)], zones: [zone] },
      });
    });
  }
  const tClearances = now() - t3;

  // ---- Doors and walking paths.
  const t4 = now();
  const routes: Route[] = [];
  let walkGridCells = 0;
  if (scene.rules.pathways) {
    const walkerRadius = scene.rules.minPassageWidth / 2;
    for (const room of scene.rooms) {
      const doors = room.openings.filter((opening) => opening.kind === "door");
      for (const door of doors) {
        const zone = doorSwingZone(room, door);
        const blockers = overlappingObstacles(zone, -1).filter((index) => furniture[index]!.roomId === room.id);
        if (blockers.length > 0) {
          issues.push({
            id: `pathway.door-blocked:${room.id}:${door.id}`,
            ruleId: "pathway.door-blocked",
            severity: "error",
            objectIds: blockers.map((index) => furniture[index]!.id),
            roomId: room.id,
            message: `The door on the ${door.wall} wall cannot open fully: ${joinNames(blockers.map((index) => furniture[index]!.name))} ${blockers.length === 1 ? "is" : "are"} inside its ${fmt(door.width)} swing area.`,
            measured: 0,
            threshold: door.width,
            suggestion: "Keep the door swing area clear.",
            highlight: { objectIds: blockers.map((index) => furniture[index]!.id), zones: [zone] },
          });
        }
      }
      if (doors.length === 0) continue;

      const roomObstacles = obstacleIndices.filter((index) => furniture[index]!.roomId === room.id);
      const build = (excluded: number) => buildWalkGrid(room, roomObstacles.filter((index) => index !== excluded).map((index) => polygons[index]!), walkerRadius);
      const grid = build(-1);
      walkGridCells += grid.columns * grid.rows;
      const starts = doors.flatMap((door) => doorStartCells(grid, door, walkerRadius));
      const reached = floodFill(grid, starts);

      const targets = roomObstacles.filter((index) => requiredFrontClearance(scene, furniture[index]!) > 0);
      let analyzed = 0;
      for (const index of targets) {
        const item = furniture[index]!;
        const goalCells = accessCells(grid, item, Math.max(requiredFrontClearance(scene, item), walkerRadius) + walkerRadius);
        if (goalCells.length === 0) continue;
        if (goalCells.some((cell) => reached[cell])) {
          if (options.routes && starts.length > 0) {
            const path = findPath(grid, starts.find((cell) => !grid.blocked[cell]) ?? starts[0]!, new Set(goalCells.filter((cell) => reached[cell])));
            if (path) routes.push({ targetId: item.id, doorId: doors[0]!.id, points: path.map((cell) => cellToWorld(grid, cell)) });
          }
          continue;
        }
        // Unreachable: find obstacles whose removal reconnects the object (bounded search).
        const blockers: number[] = [];
        if (!options.skipBlockerAnalysis && analyzed < 5) {
          analyzed += 1;
          const zone = frontZone(item, requiredFrontClearance(scene, item));
          const center = centroid(zone);
          const nearby = roomObstacles
            .filter((other) => other !== index)
            .map((other) => ({ other, distance: Math.hypot(...sub(centroid(polygons[other]!), center)) }))
            .sort((a, b) => a.distance - b.distance)
            .slice(0, 8);
          for (const { other } of nearby) {
            const alt = build(other);
            const altReached = floodFill(alt, doors.flatMap((door) => doorStartCells(alt, door, walkerRadius)));
            if (goalCells.some((cell) => altReached[cell])) blockers.push(other);
          }
        }
        const blockerIds = blockers.map((other) => furniture[other]!.id);
        issues.push({
          id: `pathway.blocked:${item.id}`,
          ruleId: "pathway.blocked",
          severity: "error",
          objectIds: [item.id, ...blockerIds],
          roomId: room.id,
          message: `${item.name} cannot be reached from the door: there is no walking path at least ${fmt(scene.rules.minPassageWidth)} wide` +
            (blockers.length ? ` (${joinNames(blockers.map((other) => furniture[other]!.name))} ${blockers.length === 1 ? "blocks" : "block"} it).` : "."),
          threshold: scene.rules.minPassageWidth,
          suggestion: blockers.length ? `Move ${joinNames(blockers.map((other) => furniture[other]!.name))} to open a ${fmt(scene.rules.minPassageWidth)} passage.` : undefined,
          highlight: { objectIds: [item.id, ...blockerIds], zones: [frontZone(item, requiredFrontClearance(scene, item))] },
        });
      }
    }
  }
  const tPathways = now() - t4;

  return {
    issues,
    routes,
    stats: {
      objectCount: furniture.length,
      naivePairs: (furniture.length * (furniture.length - 1)) / 2,
      broadPhasePairs,
      narrowPhaseTests,
      collisions,
      walkGridCells,
      durationMs: now() - started,
      timings: { index: tIndex, collisions: tCollisions, boundaries: tBoundaries, clearances: tClearances, pathways: tPathways },
    },
  };
}

function doorStartCells(grid: WalkGrid, door: Opening, walkerRadius: number): number[] {
  const { center, inward, along } = openingFrame(grid.room, door);
  const cells: number[] = [];
  const halfSpan = Math.max(grid.cellSize / 2, door.width / 2 - 0.05);
  for (let a = -halfSpan; a <= halfSpan + 1e-9; a += grid.cellSize / 2) {
    for (const depth of [walkerRadius + grid.cellSize * 0.5, walkerRadius + grid.cellSize * 1.5]) {
      const [column, row] = localToCell(grid, [center[0] + along[0] * a + inward[0] * depth, center[1] + along[1] * a + inward[1] * depth]);
      if (column >= 0 && row >= 0 && column < grid.columns && row < grid.rows) cells.push(row * grid.columns + column);
    }
  }
  return cells;
}

/** Walkable cells where a person can stand to use the object's front. */
function accessCells(grid: WalkGrid, item: FurnitureObject, depth: number): number[] {
  const zone = frontZone(item, depth).map((point) => worldToRoom(grid.room, point));
  const xs = zone.map((point) => point[0]);
  const zs = zone.map((point) => point[1]);
  const [c0, r0] = localToCell(grid, [Math.min(...xs), Math.min(...zs)]);
  const [c1, r1] = localToCell(grid, [Math.max(...xs), Math.max(...zs)]);
  const cells: number[] = [];
  for (let row = Math.max(0, r0); row <= Math.min(grid.rows - 1, r1); row += 1) {
    for (let column = Math.max(0, c0); column <= Math.min(grid.columns - 1, c1); column += 1) {
      const index = row * grid.columns + column;
      if (!grid.blocked[index] && insideConvex(cellCenterLocal(grid, column, row), zone)) cells.push(index);
    }
  }
  return cells;
}

function insideConvex(point: Point, polygon: Polygon) {
  let sign = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const cross = (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0]);
    const current = Math.sign(cross);
    if (current === 0) continue;
    if (sign === 0) sign = current;
    else if (current !== sign) return false;
  }
  return true;
}

function centroid(polygon: Polygon): Point {
  const sum = polygon.reduce<Point>((acc, point) => [acc[0] + point[0], acc[1] + point[1]], [0, 0]);
  return [sum[0] / polygon.length, sum[1] / polygon.length];
}

function sub(a: Point, b: Point): [number, number] {
  return [a[0] - b[0], a[1] - b[1]];
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

function joinNames(names: string[]) {
  if (names.length <= 1) return names.join("");
  return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
}
