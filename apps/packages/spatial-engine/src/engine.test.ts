import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applySceneAction, SceneSchema, type FurnitureObject, type Scene, type SceneAction } from "@reality-builder/shared";
import { footprint, satPenetration } from "./geometry.js";
import { generateRecoveryCandidates } from "./recovery.js";
import { validateScene } from "./validate.js";

const bedroom = SceneSchema.parse(JSON.parse(readFileSync(resolve(process.cwd(), "fixtures/bedroom-scene.json"), "utf8")));

function move(scene: Scene, id: string, x: number, z: number, yawDegrees?: number): Scene {
  const action: SceneAction = { type: "furniture.update", furnitureId: id, patch: { position: { x, z }, ...(yawDegrees === undefined ? {} : { yawDegrees }) } };
  return applySceneAction(scene, action).scene;
}

const rules = (scene: Scene) => validateScene(scene).issues.map((issue) => issue.ruleId);

describe("geometry", () => {
  it("SAT separates rotated boxes that AABBs would report as overlapping", () => {
    const base = { roomId: "r", category: "other" as const, version: 1, dimensions: { width: 2, depth: 0.2, height: 1 } };
    const a: FurnitureObject = { ...base, id: "a", name: "A", position: { x: 0, y: 0, z: 0 }, yawDegrees: 45 };
    const b: FurnitureObject = { ...base, id: "b", name: "B", position: { x: 0.5, y: 0, z: 0.5 }, yawDegrees: 45 };
    expect(satPenetration(footprint(a), footprint(b))).toBeLessThanOrEqual(0);
    const c: FurnitureObject = { ...b, position: { x: 0.1, y: 0, z: 0 } };
    expect(satPenetration(footprint(a), footprint(c))).toBeGreaterThan(0);
  });
});

describe("spatial validation", () => {
  it("accepts the designed demo bedroom with no issues", () => {
    expect(validateScene(bedroom).issues).toEqual([]);
  });

  it("detects collisions with the overlap depth and both object ids", () => {
    const scene = move(bedroom, "obj-nightstand-right", 0.6, -1.9);
    const issue = validateScene(scene).issues.find((entry) => entry.ruleId === "collision.overlap")!;
    expect(issue.objectIds.sort()).toEqual(["obj-bed", "obj-nightstand-right"]);
    expect(issue.measured).toBeCloseTo(0.4, 2); // min penetration axis is z (0.40) not x (0.45)
    expect(issue.message).toMatch(/Queen bed overlaps Nightstand \(right\)|Nightstand \(right\) overlaps Queen bed/);
  });

  it("ignores stacked objects (desk lamp on desk) and floor coverings (rug under bed)", () => {
    expect(rules(bedroom)).not.toContain("collision.overlap");
  });

  it("detects objects past a wall, naming the wall and the distance", () => {
    const issue = validateScene(move(bedroom, "obj-plant", 2.3, -1.8)).issues.find((entry) => entry.ruleId === "boundary.outside-room")!;
    expect(issue.message).toContain("east wall");
    expect(issue.measured).toBeCloseTo(0.225, 2);
  });

  it("measures the available front clearance against the requirement", () => {
    // Desk chair 0.4 m in front of the dresser (which needs 0.70 m).
    const scene = move(bedroom, "obj-desk-chair", 1.5, 0.4);
    const issue = validateScene(scene).issues.find((entry) => entry.id === "clearance.front:obj-dresser")!;
    expect(issue.threshold).toBe(0.7);
    expect(issue.measured).toBeGreaterThan(0.1);
    expect(issue.measured).toBeLessThan(0.7);
    expect(issue.objectIds).toContain("obj-desk-chair");
    expect(issue.highlight.zones).toHaveLength(1);
  });

  it("detects a blocked door and objects that become unreachable, and names the blocker", () => {
    const scene = move(bedroom, "obj-desk-chair", 1.5, 1.6);
    const issues = validateScene(scene).issues;
    expect(issues.some((issue) => issue.ruleId === "pathway.door-blocked" && issue.objectIds.includes("obj-desk-chair"))).toBe(true);
    const unreachable = issues.filter((issue) => issue.ruleId === "pathway.blocked");
    expect(unreachable.length).toBeGreaterThan(0);
    expect(unreachable.some((issue) => issue.objectIds.includes("obj-desk-chair"))).toBe(true);
  });

  it("respects per-object clearance constraints and rule toggles", () => {
    const scene = move(bedroom, "obj-desk-chair", 1.5, 0.4);
    const relaxed = applySceneAction(scene, { type: "furniture.update", furnitureId: "obj-dresser", patch: { constraints: { frontClearance: 0.1 } } }).scene;
    expect(validateScene(relaxed).issues.some((issue) => issue.id === "clearance.front:obj-dresser")).toBe(false);
    const disabled = applySceneAction(scene, { type: "scene.update", patch: { rules: { clearances: false } } }).scene;
    expect(rules(disabled)).not.toContain("clearance.front");
  });

  it("uses the broad phase to test far fewer pairs than brute force on 500 objects", () => {
    const furniture: FurnitureObject[] = [];
    for (let i = 0; i < 500; i += 1) {
      furniture.push({
        id: "o" + i, roomId: "big", name: "Box " + i, category: "storage", version: 1, yawDegrees: (i * 37) % 360,
        position: { x: -19 + (i % 25) * 1.55, y: 0, z: -19 + Math.floor(i / 25) * 1.9 },
        dimensions: { width: 0.9, depth: 0.6, height: 0.8 },
        constraints: { frontClearance: 0 },
      });
    }
    const scene = SceneSchema.parse({
      schemaVersion: 1, id: "big", name: "Big", coordinateSystem: "y-up-xz-meters", furniture,
      rooms: [{ id: "big", name: "Hall", position: { x: 0, y: 0, z: 0 }, yawDegrees: 0, dimensions: { width: 40, depth: 40, height: 3, wallThickness: 0.2 } }],
    });
    const { stats } = validateScene(scene);
    expect(stats.naivePairs).toBe(124_750);
    expect(stats.broadPhasePairs).toBeLessThan(2_000);
    expect(stats.durationMs).toBeLessThan(500);
  });
});

describe("layout recovery", () => {
  const broken = move(move(bedroom, "obj-wardrobe", -0.9, 0.3), "obj-desk-chair", 1.5, 1.6);

  it("generates revalidated candidates that never introduce new issues", () => {
    const before = validateScene(broken).issues;
    expect(before.length).toBeGreaterThan(3);
    const result = generateRecoveryCandidates(broken);
    expect(result.candidates.length).toBeGreaterThan(0);
    for (const candidate of result.candidates) {
      const after = validateScene(applySceneAction(broken, candidate.action).scene).issues;
      const beforeIds = new Set(before.map((issue) => issue.id));
      expect(after.every((issue) => beforeIds.has(issue.id))).toBe(true);
      expect(after.length).toBe(candidate.issuesAfter);
      expect(after.length).toBeLessThan(before.length);
    }
  });

  it("finds a complete fix for the broken bedroom and leaves untouched objects in place", () => {
    const best = generateRecoveryCandidates(broken).candidates[0]!;
    expect(best.issuesAfter).toBe(0);
    const fixed = applySceneAction(broken, best.action).scene;
    const movedIds = new Set(best.moves.map((entry) => entry.objectId));
    for (const item of broken.furniture) {
      if (!movedIds.has(item.id)) expect(fixed.furniture.find((entry) => entry.id === item.id)!.position).toEqual(item.position);
    }
  });

  it("never moves locked objects", () => {
    const locked = applySceneAction(broken, { type: "furniture.update", furnitureId: "obj-desk-chair", patch: { constraints: { frontClearance: 0, locked: true } } }).scene;
    for (const candidate of generateRecoveryCandidates(locked).candidates) {
      expect(candidate.moves.some((entry) => entry.objectId === "obj-desk-chair")).toBe(false);
    }
  });
});
