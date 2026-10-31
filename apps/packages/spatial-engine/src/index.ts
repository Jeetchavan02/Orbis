export type SpatialEngineStatus = {
  status: "scaffold";
  implementedCapabilities: readonly [];
  pendingCapabilities: readonly [
    "room-boundary-validation",
    "collision-detection",
    "furniture-clearance",
    "blocked-path-detection",
  ];
};

/** Reports implementation state; it does not analyze or validate a scene. */
export function getSpatialEngineStatus(): SpatialEngineStatus {
  return {
    status: "scaffold",
    implementedCapabilities: [],
    pendingCapabilities: [
      "room-boundary-validation",
      "collision-detection",
      "furniture-clearance",
      "blocked-path-detection",
    ],
  };
}
