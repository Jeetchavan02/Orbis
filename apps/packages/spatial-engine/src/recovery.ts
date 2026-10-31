import RBush from "rbush";
import type { BaseSceneAction, FurnitureObject, Scene, SceneAction, ValidationIssue } from "@reality-builder/shared";
import { footprint, polygonAabb, roomToWorld, satPenetration, worldToRoom, type Polygon } from "./geometry.js";
import { doorSwingZone, frontZone, isWalkingObstacle, requiredFrontClearance, validateScene } from "./validate.js";

export type RecoveryMove = {
  objectId: string;
  name: string;
  from: { x: number; z: number; yawDegrees: number };
  to: { x: number; z: number; yawDegrees: number };
  distance: number;
};

export type RecoveryCandidate = {
  id: string;
  label: string;
  description: string;
  moves: RecoveryMove[];
  /** A single batch action; applying it goes through the normal action pipeline (and undoes as one step). */
  action: SceneAction;
  issuesBefore: number;
  issuesAfter: number;
  /** Issues still present after applying; a candidate never introduces new ones. */
  remaining: ValidationIssue[];
  totalDisplacement: number;
};

export type RecoveryResult = {
  candidates: RecoveryCandidate[];
  /** Candidates generated but rejected by revalidation, for transparency. */
  rejected: number;
  evaluated: number;
  durationMs: number;
};

type Strategy = { id: string; label: string; pick: "smaller" | "larger"; rotations: boolean };

const STRATEGIES: Strategy[] = [
  { id: "nudge", label: "Minimal nudge", pick: "smaller", rotations: false },
  { id: "rotate", label: "Rotate & reposition", pick: "smaller", rotations: true },
  { id: "move-larger", label: "Move the larger piece", pick: "larger", rotations: true },
];

const GRID_STEP = 0.1;
const MAX_FULL_VALIDATIONS_PER_OBJECT = 60;
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

const problemIssues = (issues: ValidationIssue[]) => issues.filter((issue) => issue.severity !== "info");

/**
 * Generates layout corrections for the current spatial violations. Every candidate is produced by
 * search (not templates) and is revalidated with the full spatial engine before it is returned.
 */
export function generateRecoveryCandidates(scene: Scene, maxCandidates = 3): RecoveryResult {
  const started = now();
  const baseline = problemIssues(validateScene(scene, { skipBlockerAnalysis: true }).issues);
  let evaluated = 0;
  let rejected = 0;
  const candidates: RecoveryCandidate[] = [];
  if (baseline.length === 0) return { candidates, rejected, evaluated, durationMs: now() - started };

  const seen = new Set<string>();
  for (const strategy of STRATEGIES) {
    if (candidates.length >= maxCandidates) break;
    const outcome = runStrategy(scene, baseline, strategy, () => (evaluated += 1));
    if (!outcome) continue;
    const signature = outcome.moves.map((move) => `${move.objectId}@${move.to.x.toFixed(2)},${move.to.z.toFixed(2)},${move.to.yawDegrees}`).join("|");
    if (seen.has(signature)) continue;
    seen.add(signature);

    // Final authoritative revalidation (with full pathway blocker analysis).
    const finalIssues = problemIssues(validateScene(outcome.scene).issues);
    const baselineIds = new Set(baseline.map((issue) => issue.id));
    const introducesNew = finalIssues.some((issue) => !baselineIds.has(issue.id));
    if (introducesNew || issueCost(finalIssues) >= issueCost(baseline)) {
      rejected += 1;
      continue;
    }

    const actions: BaseSceneAction[] = outcome.moves.map((move) => ({
      type: "furniture.update",
      furnitureId: move.objectId,
      patch: { position: { x: move.to.x, z: move.to.z }, yawDegrees: move.to.yawDegrees },
    }));
    const totalDisplacement = outcome.moves.reduce((sum, move) => sum + move.distance, 0);
    candidates.push({
      id: strategy.id,
      label: strategy.label,
      description: describe(outcome.moves, baseline.length - finalIssues.length),
      moves: outcome.moves,
      action: { type: "batch", label: "Apply layout fix: " + strategy.label, actions },
      issuesBefore: baseline.length,
      issuesAfter: finalIssues.length,
      remaining: finalIssues,
      totalDisplacement,
    });
  }
  candidates.sort((a, b) => issueCost(a.remaining) - issueCost(b.remaining) || a.totalDisplacement - b.totalDisplacement);
  return { candidates, rejected, evaluated, durationMs: now() - started };
}

const RULE_PRIORITY: Record<string, number> = {
  "pathway.door-blocked": 0,
  "collision.overlap": 1,
  "boundary.outside-room": 2,
  "clearance.front": 3,
  "pathway.blocked": 4,
};

const SEVERITY_WEIGHT = { error: 10, warning: 3, info: 0 } as const;

export function issueCost(issues: ValidationIssue[]) {
  return issues.reduce((sum, issue) => sum + SEVERITY_WEIGHT[issue.severity], 0);
}

function byPriority(issues: ValidationIssue[]) {
  return [...issues].sort((a, b) => (RULE_PRIORITY[a.ruleId] ?? 9) - (RULE_PRIORITY[b.ruleId] ?? 9));
}

function runStrategy(scene: Scene, baseline: ValidationIssue[], strategy: Strategy, onEvaluate: () => void) {
  let current = scene;
  let currentIssues = baseline;
  const moved = new Map<string, RecoveryMove>();
  const attempted = new Set<string>();

  for (let iteration = 0; iteration < 16 && currentIssues.length > 0; iteration += 1) {
    const choice = chooseTarget(current, byPriority(currentIssues), strategy, attempted);
    if (!choice) break;
    const { issue, item: target } = choice;
    attempted.add(issue.id + "|" + target.id);
    const placed = findPose(current, target, issue, currentIssues, strategy, onEvaluate);
    if (!placed) continue;
    current = placed.scene;
    currentIssues = placed.issues;
    const original = scene.furniture.find((item) => item.id === target.id)!;
    const to = { x: placed.x, z: placed.z, yawDegrees: placed.yaw };
    moved.set(target.id, {
      objectId: target.id,
      name: target.name,
      from: { x: original.position.x, z: original.position.z, yawDegrees: original.yawDegrees },
      to,
      distance: Math.hypot(to.x - original.position.x, to.z - original.position.z),
    });
  }
  if (moved.size === 0) return null;
  return { scene: current, moves: [...moved.values()] };
}

function area(item: FurnitureObject) {
  return item.dimensions.width * item.dimensions.depth;
}

function chooseTarget(scene: Scene, issues: ValidationIssue[], strategy: Strategy, attempted: Set<string>) {
  const byId = new Map(scene.furniture.map((item) => [item.id, item]));
  for (const issue of issues) {
    const options = issue.objectIds
      .map((id) => byId.get(id))
      .filter((item): item is FurnitureObject => !!item && !item.constraints?.locked && !attempted.has(issue.id + "|" + item.id));
    if (options.length === 0) continue;
    // Clearance and pathway issues name the object needing space first; the rest are the obstructions.
    const obstructions = options.filter((item) => item.id !== issue.objectIds[0]);
    const pool = (issue.ruleId === "clearance.front" || issue.ruleId === "pathway.blocked") && obstructions.length > 0 ? obstructions : options;
    pool.sort((a, b) => (strategy.pick === "smaller" ? area(a) - area(b) : area(b) - area(a)));
    return { issue, item: pool[0]! };
  }
  return null;
}

/**
 * Searches poses in rings of increasing distance from the current position. A cheap geometric prefilter
 * (room bounds, SAT against nearby obstacles, front zone) runs before the full validation of each pose.
 */
function findPose(scene: Scene, item: FurnitureObject, target: ValidationIssue, issues: ValidationIssue[], strategy: Strategy, onEvaluate: () => void) {
  const room = scene.rooms.find((entry) => entry.id === item.roomId);
  if (!room) return null;
  const others = scene.furniture.filter((other) => other.id !== item.id && isWalkingObstacle(other));
  const tree = new RBush<{ minX: number; minY: number; maxX: number; maxY: number; polygon: Polygon }>();
  tree.load(others.map((other) => {
    const polygon = footprint(other);
    const box = polygonAabb(polygon);
    return { minX: box.minX, minY: box.minZ, maxX: box.maxX, maxY: box.maxZ, polygon };
  }));
  const hits = (polygon: Polygon) => {
    const box = polygonAabb(polygon);
    return tree.search({ minX: box.minX, minY: box.minZ, maxX: box.maxX, maxY: box.maxZ }).some((entry) => satPenetration(polygon, entry.polygon) > 0.005);
  };
  // Space that must stay free: every door swing, plus the zones of the issue being fixed (unless they belong to this object).
  const reserved: Polygon[] = room.openings.filter((opening) => opening.kind === "door").map((door) => doorSwingZone(room, door));
  if (target.objectIds[0] !== item.id) reserved.push(...target.highlight.zones);
  const hitsReserved = (polygon: Polygon) => reserved.some((zone) => satPenetration(polygon, zone) > 0.005);
  const insideRoom = (polygon: Polygon) => polygon.every((point) => {
    const [x, z] = worldToRoom(room, point);
    return Math.abs(x) <= room.dimensions.width / 2 - 0.002 && Math.abs(z) <= room.dimensions.depth / 2 - 0.002;
  });

  const yaws = strategy.rotations ? [0, 90, 180, 270].map((delta) => normalizeYaw(item.yawDegrees + delta)) : [item.yawDegrees];
  const baselineIds = new Set(issues.map((issue) => issue.id));
  const clearance = requiredFrontClearance(scene, item);
  const maxRadius = Math.hypot(room.dimensions.width, room.dimensions.depth);
  const [originX, originZ] = worldToRoom(room, [item.position.x, item.position.z]);
  let fullValidations = 0;

  for (let ring = 0; ring * GRID_STEP <= maxRadius; ring += 1) {
    const offsets = ringOffsets(ring);
    for (const [dx, dz] of offsets) {
      const [world_x, world_z] = roomToWorld(room, [originX + dx * GRID_STEP, originZ + dz * GRID_STEP]);
      for (const yaw of yaws) {
        if (ring === 0 && yaw === item.yawDegrees) continue;
        const candidate: FurnitureObject = { ...item, position: { ...item.position, x: round(world_x), z: round(world_z) }, yawDegrees: yaw };
        const polygon = footprint(candidate);
        if (!insideRoom(polygon) || hits(polygon) || (isWalkingObstacle(item) && hitsReserved(polygon))) continue;
        if (clearance > 0) {
          const zone = frontZone(candidate, clearance);
          if (!insideRoom(zone) || hits(zone)) continue;
        }
        fullValidations += 1;
        onEvaluate();
        const nextScene: Scene = { ...scene, furniture: scene.furniture.map((entry) => (entry.id === item.id ? candidate : entry)) };
        const nextIssues = problemIssues(validateScene(nextScene, { skipBlockerAnalysis: true }).issues);
        // Accept the nearest pose that resolves the targeted issue, introduces nothing new, and lowers the total cost.
        const resolved = !nextIssues.some((issue) => issue.id === target.id);
        const noNew = nextIssues.every((issue) => baselineIds.has(issue.id));
        if (resolved && noNew && issueCost(nextIssues) < issueCost(issues)) {
          return { scene: nextScene, issues: nextIssues, x: candidate.position.x, z: candidate.position.z, yaw };
        }
        if (fullValidations >= MAX_FULL_VALIDATIONS_PER_OBJECT) return null;
      }
    }
  }
  return null;
}

/** Integer grid offsets on the square ring at Chebyshev distance `ring`, nearest-to-center first. */
function ringOffsets(ring: number): [number, number][] {
  if (ring === 0) return [[0, 0]];
  const points: [number, number][] = [];
  for (let x = -ring; x <= ring; x += 1) {
    for (let z = -ring; z <= ring; z += 1) {
      if (Math.max(Math.abs(x), Math.abs(z)) === ring) points.push([x, z]);
    }
  }
  return points.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
}

function normalizeYaw(yaw: number) {
  return ((Math.round(yaw) % 360) + 360) % 360;
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

function describe(moves: RecoveryMove[], resolved: number) {
  const parts = moves.map((move) => {
    const turned = move.to.yawDegrees !== normalizeYaw(move.from.yawDegrees) ? `, rotated to ${move.to.yawDegrees}°` : "";
    return `${move.name} ${move.distance.toFixed(2)} m${turned}`;
  });
  return `Moves ${parts.join("; ")}. Resolves ${resolved} issue${resolved === 1 ? "" : "s"}.`;
}

