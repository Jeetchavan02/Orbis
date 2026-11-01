import { z } from "zod";

const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const Vector3Schema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
});

export const Dimensions3DSchema = z.object({
  width: z.number().positive(),
  depth: z.number().positive(),
  height: z.number().positive(),
});

/** Walls are named by the room-local side they bound: north = −Z, south = +Z, west = −X, east = +X. */
export const WallSideSchema = z.enum(["north", "south", "east", "west"]);

export const OpeningSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["door", "window"]),
  wall: WallSideSchema,
  /** Center of the opening along its wall, measured from the wall midpoint (room-local meters). */
  offset: z.number().finite(),
  width: z.number().positive(),
  height: z.number().positive(),
  /** Bottom of the opening above the floor; 0 for doors. */
  sillHeight: z.number().nonnegative(),
  /** Doors: hinge side as seen from inside the room facing the door, and which way the leaf swings. */
  hinge: z.enum(["left", "right"]).default("left"),
  swing: z.enum(["in", "out"]).default("in"),
});

export const RoomSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Room center on XZ; y is the floor elevation. */
  position: Vector3Schema,
  dimensions: Dimensions3DSchema.extend({
    wallThickness: z.number().positive(),
  }),
  /** Serialized yaw around +Y, in degrees. */
  yawDegrees: z.number().finite(),
  openings: z.array(OpeningSchema).default([]),
  floorColor: HexColorSchema.default("#c9b99f"),
  wallColor: HexColorSchema.default("#f2f1ec"),
  /** Incremented on every accepted mutation; used for collaboration base-version checks. */
  version: z.number().int().nonnegative().default(1),
});

export const FurnitureCategorySchema = z.enum([
  "beds",
  "seating",
  "tables",
  "storage",
  "lighting",
  "decor",
  "other",
]);

/** Local-space triangle mesh: origin at the bottom-center of the object, +Z is the front, meters. */
export const MeshDataSchema = z.object({
  positions: z.array(z.number().finite()).refine((list) => list.length >= 9 && list.length % 3 === 0, "positions must be xyz triples"),
  indices: z.array(z.number().int().nonnegative()).refine((list) => list.length >= 3 && list.length % 3 === 0, "indices must be triangles"),
  source: z.enum(["primitive", "imported"]).default("primitive"),
});

export const ObjectConstraintsSchema = z.object({
  /** Free space required in front of the object (local +Z). Overrides the rule-set default for its category. */
  frontClearance: z.number().nonnegative().optional(),
  /** Locked objects are never moved by layout recovery. */
  locked: z.boolean().optional(),
  /** Floor coverings (rugs) do not collide and do not block walking paths. */
  floorCovering: z.boolean().optional(),
});

export const LightFixtureSchema = z.object({
  kind: z.enum(["point", "spot"]),
  on: z.boolean(),
  /** Candela-like intensity used directly by three.js physically-correct lights. */
  intensity: z.number().nonnegative(),
  color: HexColorSchema,
  /** Height of the light source above the object's base, meters. */
  height: z.number().nonnegative(),
});

export const FurnitureObjectSchema = z.object({
  id: z.string().min(1),
  roomId: z.string().min(1),
  name: z.string().min(1),
  category: FurnitureCategorySchema,
  catalogItemId: z.string().optional(),
  /** Bottom-center anchor in meters; world up is +Y and floor is the XZ plane. */
  position: Vector3Schema,
  /** Serialized yaw around +Y, in degrees; local +Z is the object's front. */
  yawDegrees: z.number().finite(),
  /** Bounding-box size. For mesh objects this always equals the mesh bounds. */
  dimensions: Dimensions3DSchema,
  color: HexColorSchema.optional(),
  mesh: MeshDataSchema.optional(),
  constraints: ObjectConstraintsSchema.optional(),
  light: LightFixtureSchema.optional(),
  version: z.number().int().nonnegative().default(1),
});

export const RuleSettingsSchema = z.object({
  collisions: z.boolean().default(true),
  boundaries: z.boolean().default(true),
  clearances: z.boolean().default(true),
  pathways: z.boolean().default(true),
  /** Optional Vastu guidelines: advisory only, never affect validity. */
  vastu: z.boolean().default(false),
  /** Narrowest passage a person can walk through, meters. */
  minPassageWidth: z.number().positive().default(0.6),
  /** Default front clearance per category, meters. */
  categoryClearance: z.record(FurnitureCategorySchema, z.number().nonnegative()).default({
    beds: 0.6,
    storage: 0.7,
    seating: 0.45,
    tables: 0,
    lighting: 0,
    decor: 0,
    other: 0,
  }),
});

export const EnvironmentModeSchema = z.enum(["day", "evening", "night"]);

export const EnvironmentSchema = z.object({
  mode: EnvironmentModeSchema.default("day"),
  /** Scales every artificial light at once. */
  artificialLightScale: z.number().nonnegative().default(1),
  shadows: z.boolean().default(true),
  /** Site used for sun studies (default: Mumbai). */
  latitude: z.number().min(-90).max(90).default(19.076),
  longitude: z.number().min(-180).max(180).default(72.877),
  /** Compass bearing of the room's −Z ("north" wall) direction; 0 = true north. */
  northOffsetDegrees: z.number().finite().default(0),
});

/**
 * A reference image (usually a floor plan) laid flat on a room's floor, for tracing walls and furniture.
 * Position is the image centre in world metres; width is the image's real-world width (height follows its aspect).
 */
export const UnderlaySchema = z.object({
  url: z.string().min(1).max(300),
  name: z.string().max(120).default("Floor plan"),
  roomId: z.string().optional(),
  x: z.number().finite().default(0),
  z: z.number().finite().default(0),
  width: z.number().positive().max(200),
  aspect: z.number().positive().max(20),
  rotationDegrees: z.number().finite().default(0),
  opacity: z.number().min(0).max(1).default(0.6),
  visible: z.boolean().default(true),
});

/** A floor annotation: a measuring line (two points, shows its length) or a text label. World metres on the XZ plane. */
export const AnnotationSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(["line", "text"]),
  roomId: z.string().optional(),
  x: z.number().finite(),
  z: z.number().finite(),
  /** Line end point (lines only). */
  x2: z.number().finite().optional(),
  z2: z.number().finite().optional(),
  text: z.string().max(120).optional(),
  color: HexColorSchema.default("#6a3de8"),
});

export const SceneSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  name: z.string().min(1),
  coordinateSystem: z.literal("y-up-xz-meters"),
  rooms: z.array(RoomSchema),
  furniture: z.array(FurnitureObjectSchema),
  rules: RuleSettingsSchema.default({}),
  environment: EnvironmentSchema.default({}),
  /** Room type chosen at project creation (bedroom, living, …); drives library suggestions. */
  roomType: z.string().optional(),
  /** Floor-plan reference image under the room (scene setting: undoable, saved and shared). */
  underlay: UnderlaySchema.nullable().default(null),
  /** Measuring lines and text labels drawn on the floor. */
  annotations: z.array(AnnotationSchema).max(500).default([]),
  /** Version of scene-level settings (name, rules, environment, underlay). */
  settingsVersion: z.number().int().nonnegative().default(1),
});

export const IssueSeveritySchema = z.enum(["info", "warning", "error"]);

export const SpatialRuleIdSchema = z.enum([
  "collision.overlap",
  "boundary.outside-room",
  "clearance.front",
  "pathway.blocked",
  "pathway.door-blocked",
]);

/** A polygon on the floor plane (x, z pairs), used for viewport highlights. */
export const FloorPolygonSchema = z.array(z.tuple([z.number(), z.number()]));

export const ValidationIssueSchema = z.object({
  id: z.string().min(1),
  ruleId: SpatialRuleIdSchema,
  severity: IssueSeveritySchema,
  /** Objects the issue is about; the first is the primary object. */
  objectIds: z.array(z.string().min(1)),
  roomId: z.string().optional(),
  message: z.string().min(1),
  /** Measured value (meters) and the threshold it was compared to, where applicable. */
  measured: z.number().finite().optional(),
  threshold: z.number().finite().optional(),
  suggestion: z.string().optional(),
  highlight: z.object({
    objectIds: z.array(z.string()),
    zones: z.array(FloorPolygonSchema),
  }),
});

const RoomUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  position: Vector3Schema.partial().optional(),
  dimensions: Dimensions3DSchema.extend({
    wallThickness: z.number().positive(),
  }).partial().optional(),
  yawDegrees: z.number().finite().optional(),
  openings: z.array(OpeningSchema).optional(),
  floorColor: HexColorSchema.optional(),
  wallColor: HexColorSchema.optional(),
});

const FurnitureUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  category: FurnitureCategorySchema.optional(),
  position: Vector3Schema.partial().optional(),
  yawDegrees: z.number().finite().optional(),
  dimensions: Dimensions3DSchema.partial().optional(),
  /** null clears the field so inverse patches can restore an unset value. */
  color: HexColorSchema.nullable().optional(),
  mesh: MeshDataSchema.nullable().optional(),
  constraints: ObjectConstraintsSchema.nullable().optional(),
  light: LightFixtureSchema.nullable().optional(),
});

const SceneSettingsUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  rules: RuleSettingsSchema.partial().optional(),
  environment: EnvironmentSchema.partial().optional(),
  /** Replaces the whole underlay (null removes it). */
  underlay: UnderlaySchema.nullable().optional(),
  /** Replaces the whole annotation list (small; keeps inverses exact). */
  annotations: z.array(AnnotationSchema).max(500).optional(),
});

export const BaseSceneActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("room.create"), room: RoomSchema }),
  z.object({ type: z.literal("room.update"), roomId: z.string().min(1), patch: RoomUpdateSchema }),
  z.object({ type: z.literal("room.delete"), roomId: z.string().min(1) }),
  z.object({
    type: z.literal("furniture.create"),
    furniture: FurnitureObjectSchema,
    /** List position to insert at; used by undo of a delete to restore ordering. */
    index: z.number().int().nonnegative().optional(),
  }),
  z.object({ type: z.literal("furniture.update"), furnitureId: z.string().min(1), patch: FurnitureUpdateSchema }),
  z.object({ type: z.literal("furniture.delete"), furnitureId: z.string().min(1) }),
  z.object({ type: z.literal("scene.update"), patch: SceneSettingsUpdateSchema }),
]);

/** A batch applies atomically and undoes as one history entry (e.g. multi-object recovery). */
export const SceneActionSchema = z.union([
  BaseSceneActionSchema,
  z.object({
    type: z.literal("batch"),
    label: z.string().min(1),
    actions: z.array(BaseSceneActionSchema).min(1),
  }),
]);

export const ApiHealthSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("reality-builder-api"),
  timestamp: z.string().datetime(),
});

export type Vector3 = z.infer<typeof Vector3Schema>;
export type Dimensions3D = z.infer<typeof Dimensions3DSchema>;
export type WallSide = z.infer<typeof WallSideSchema>;
export type Opening = z.infer<typeof OpeningSchema>;
export type Room = z.infer<typeof RoomSchema>;
export type FurnitureCategory = z.infer<typeof FurnitureCategorySchema>;
export type MeshData = z.infer<typeof MeshDataSchema>;
export type ObjectConstraints = z.infer<typeof ObjectConstraintsSchema>;
export type LightFixture = z.infer<typeof LightFixtureSchema>;
export type FurnitureObject = z.infer<typeof FurnitureObjectSchema>;
export type RuleSettings = z.infer<typeof RuleSettingsSchema>;
export type EnvironmentMode = z.infer<typeof EnvironmentModeSchema>;
export type Environment = z.infer<typeof EnvironmentSchema>;
export type Scene = z.infer<typeof SceneSchema>;
export type Underlay = z.infer<typeof UnderlaySchema>;
export type Annotation = z.infer<typeof AnnotationSchema>;
export type IssueSeverity = z.infer<typeof IssueSeveritySchema>;
export type SpatialRuleId = z.infer<typeof SpatialRuleIdSchema>;
export type FloorPolygon = z.infer<typeof FloorPolygonSchema>;
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;
export type BaseSceneAction = z.infer<typeof BaseSceneActionSchema>;
export type SceneAction = z.infer<typeof SceneActionSchema>;
export type RoomPatch = z.infer<typeof RoomUpdateSchema>;
export type FurniturePatch = z.infer<typeof FurnitureUpdateSchema>;
export type SceneSettingsPatch = z.infer<typeof SceneSettingsUpdateSchema>;
export type ApiHealth = z.infer<typeof ApiHealthSchema>;

