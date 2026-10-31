import { describe, expect, it } from "vitest";
import { getSpatialEngineStatus } from "./index.js";

describe("spatial engine scaffold", () => {
  it("reports pending capabilities instead of claiming validation", () => {
    const status = getSpatialEngineStatus();

    expect(status.status).toBe("scaffold");
    expect(status.implementedCapabilities).toHaveLength(0);
    expect(status.pendingCapabilities).toContain("collision-detection");
  });
});
