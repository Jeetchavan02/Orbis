import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  FurnitureObjectSchema,
  SceneActionSchema,
  SceneSchema,
  ValidationViolationSchema,
} from "./index.js";

const fixturePath = resolve(process.cwd(), "fixtures/studio-scene.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as unknown;

describe("shared scene contracts", () => {
  it("accepts the deterministic starter scene", () => {
    expect(SceneSchema.parse(fixture).coordinateSystem).toBe("y-up-xz-meters");
  });

  it("requires positive furniture dimensions", () => {
    const result = FurnitureObjectSchema.safeParse({
      id: "bad-object",
      roomId: "room",
      name: "Bad object",
      category: "other",
      position: { x: 0, y: 0, z: 0 },
      yawDegrees: 0,
      dimensions: { width: 1, depth: 0, height: 1 },
    });

    expect(result.success).toBe(false);
  });

  it("parses typed furniture actions and validation violations", () => {
    expect(SceneActionSchema.parse({
      type: "furniture.delete",
      furnitureId: "furniture-chair",
    }).type).toBe("furniture.delete");

    expect(ValidationViolationSchema.parse({
      id: "violation-1",
      code: "clearance.insufficient",
      severity: "warning",
      message: "Clearance is below the requested threshold.",
      entityIds: ["furniture-chair"],
      measurements: { clearanceMeters: 0.35 },
    }).severity).toBe("warning");
  });
});
