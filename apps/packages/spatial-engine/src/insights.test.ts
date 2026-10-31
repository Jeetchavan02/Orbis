import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applySceneAction, GuidelinePackSchema, SceneSchema, type Scene } from "@reality-builder/shared";
import { evaluateGuidelines, zoneOf } from "./guidelines.js";
import { optimizeLayout, scoreLayout } from "./score.js";
import { sunPosition, sunStudy } from "./sunlight.js";
import { validateScene } from "./validate.js";

const read = (path: string) => JSON.parse(readFileSync(resolve(process.cwd(), path), "utf8"));
const bedroom = SceneSchema.parse(read("fixtures/bedroom-scene.json"));
const pack = GuidelinePackSchema.parse(read("fixtures/vastu-guidelines.json"));
const update = (scene: Scene, id: string, patch: object) => applySceneAction(scene, { type: "furniture.update", furnitureId: id, patch }).scene;

describe("layout score", () => {
  it("is 0–100, explains each component, and weights validity most", () => {
    const score = scoreLayout(bedroom);
    expect(score.total).toBeGreaterThan(80);
    expect(score.total).toBeLessThanOrEqual(100);
    expect(score.components.map((component) => component.id)).toEqual(["validity", "circulation", "walls", "daylight", "balance"]);
    expect(score.components.find((component) => component.id === "validity")!.score).toBe(40);
    const broken = scoreLayout(update(bedroom, "obj-wardrobe", { position: { x: -1.2 } }));
    expect(broken.total).toBeLessThan(score.total);
    expect(broken.components.find((component) => component.id === "validity")!.score).toBeLessThan(40);
  });

  it("hill-climbs to a better layout without introducing issues and as one undoable batch", () => {
    const start = update(bedroom, "obj-wardrobe", { position: { x: -1.2 } });
    const before = validateScene(start).issues;
    const result = optimizeLayout(start);
    expect(result.after.total).toBeGreaterThan(result.before.total);
    const optimized = applySceneAction(start, result.action!).scene;
    const ids = new Set(before.map((issue) => issue.id));
    const after = validateScene(optimized).issues;
    expect(after.every((issue) => ids.has(issue.id))).toBe(true);
    expect(after.length).toBeLessThanOrEqual(before.length);
  });

  it("never moves locked objects", () => {
    const start = update(update(bedroom, "obj-wardrobe", { position: { x: -1.2 } }), "obj-wardrobe", { constraints: { locked: true } });
    expect(optimizeLayout(start).moves.some((move) => move.objectId === "obj-wardrobe")).toBe(false);
  });
});

describe("Vastu guidelines", () => {
  it("reports observed vs expected per object, advisory only", () => {
    const report = evaluateGuidelines(bedroom, pack);
    const bedHead = report.results.find((result) => result.ruleId === "bed-head")!;
    expect(bedHead.observed).toBe("back points N");
    expect(bedHead.satisfied).toBe(false);
    expect(report.score).toBeGreaterThan(0);
    expect(report.score).toBeLessThan(100);
    // Guidelines never change validity.
    expect(validateScene(bedroom).issues).toEqual([]);
  });

  it("follows the room's north offset", () => {
    const bed = bedroom.furniture.find((item) => item.id === "obj-bed")!;
    expect(zoneOf(bedroom.rooms[0]!, bed, 0)).toBe("N");
    expect(zoneOf(bedroom.rooms[0]!, bed, 180)).toBe("S");
    const rotated = applySceneAction(bedroom, { type: "scene.update", patch: { environment: { northOffsetDegrees: 180 } } }).scene;
    expect(evaluateGuidelines(rotated, pack).results.find((result) => result.ruleId === "bed-head")!.satisfied).toBe(true);
  });
});

describe("sunlight study", () => {
  const morning = new Date("2026-03-21T03:30:00Z"); // 09:00 in Mumbai

  it("places the equinox morning sun in the east", () => {
    const sun = sunPosition(morning, 19.076, 72.877);
    expect(sun.bearingDeg).toBeGreaterThan(85);
    expect(sun.bearingDeg).toBeLessThan(115);
    expect(sun.altitudeDeg).toBeGreaterThan(20);
  });

  it("lets sun in only through windows, and furniture casts shade", () => {
    const study = sunStudy(bedroom, morning);
    expect(study.summary).toBeGreaterThan(0);
    const noWindows = applySceneAction(bedroom, { type: "room.update", roomId: "room-bedroom", patch: { openings: bedroom.rooms[0]!.openings.filter((opening) => opening.kind === "door") } }).scene;
    expect(sunStudy(noWindows, morning).summary).toBe(0);
    // A tall wardrobe right inside the east window reduces the lit floor.
    const blocked = update(bedroom, "obj-wardrobe", { position: { x: 1.95, z: -0.9 }, yawDegrees: 270 });
    expect(sunStudy(blocked, morning).summary).toBeLessThan(study.summary);
  });

  it("returns zero at night and accumulates hours over a day", () => {
    expect(sunStudy(bedroom, new Date("2026-03-21T18:30:00Z")).summary).toBe(0);
    const daily = sunStudy(bedroom, morning, "daily");
    expect(Math.max(...daily.values)).toBeGreaterThan(0.5);
  });
});
