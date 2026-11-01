import { z } from "zod";
import {
  Dimensions3DSchema,
  EnvironmentModeSchema,
  FurnitureCategorySchema,
  LightFixtureSchema,
  ObjectConstraintsSchema,
  SceneActionSchema,
  SceneSchema,
  ValidationIssueSchema,
  WallSideSchema,
} from "./schemas.js";

/** Catalog entry the client sends so the server/LLM can only create known furniture types. */
export const AiCatalogItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: FurnitureCategorySchema,
  dimensions: Dimensions3DSchema,
  color: z.string(),
  elevation: z.number().optional(),
  light: LightFixtureSchema.optional(),
  constraints: ObjectConstraintsSchema.optional(),
});

/**
 * Tool calls the LLM may emit. These are proposals only: the server converts them to canonical scene
 * actions, applies them on a copy, and validates with the spatial engine. The LLM never mutates state.
 */
export const AiToolCallSchema = z.discriminatedUnion("tool", [
  z.object({ tool: z.literal("add_object"), catalogItemId: z.string(), name: z.string().optional(), x: z.number().finite(), z: z.number().finite(), yawDegrees: z.number().finite().default(0) }),
  z.object({ tool: z.literal("move_object"), objectId: z.string(), x: z.number().finite(), z: z.number().finite() }),
  /** Semantic placement: the engine computes exact, validated coordinates. Give catalogItemId (new) or objectId (existing). */
  z.object({ tool: z.literal("place_against_wall"), catalogItemId: z.string().optional(), objectId: z.string().optional(), name: z.string().optional(), wall: WallSideSchema, near: z.enum(["start", "middle", "end"]).default("middle") }),
  z.object({ tool: z.literal("place_near"), catalogItemId: z.string().optional(), objectId: z.string().optional(), name: z.string().optional(), targetId: z.string(), side: z.enum(["left", "right", "front"]) }),
  z.object({ tool: z.literal("rotate_object"), objectId: z.string(), yawDegrees: z.number().finite() }),
  z.object({ tool: z.literal("resize_object"), objectId: z.string(), width: z.number().positive().optional(), depth: z.number().positive().optional(), height: z.number().positive().optional() }),
  z.object({ tool: z.literal("delete_object"), objectId: z.string() }),
  z.object({ tool: z.literal("set_color"), objectId: z.string(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) }),
  z.object({ tool: z.literal("set_light"), objectId: z.string(), on: z.boolean().optional(), intensity: z.number().nonnegative().optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() }),
  z.object({ tool: z.literal("set_environment"), mode: EnvironmentModeSchema }),
]);

export const AiPlanSchema = z.object({
  summary: z.string(),
  calls: z.array(AiToolCallSchema).max(40),
});

export const AiEditRequestSchema = z.object({
  instruction: z.string().min(1).max(2000),
  /** Room/floor the request applies to (defaults to the first room). */
  roomId: z.string().optional(),
  scene: SceneSchema,
  catalog: z.array(AiCatalogItemSchema),
  /** Earlier turns of this conversation (oldest first), so follow-ups like "a bit more left" have context. */
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(2000) })).max(12).default([]),
});

export const AiAttemptSchema = z.object({
  attempt: z.number().int(),
  calls: z.array(AiToolCallSchema),
  outcome: z.enum(["accepted", "invalid-action", "spatial-violations", "malformed"]),
  feedback: z.string().nullable(),
});

export const AiEditResponseSchema = z.object({
  status: z.enum(["ok", "failed"]),
  summary: z.string(),
  /** Single batch action to apply through the normal pipeline (undoable, synced). Null when nothing valid was produced. */
  action: SceneActionSchema.nullable(),
  attempts: z.array(AiAttemptSchema),
  /** Issues the proposal would introduce (empty when accepted cleanly). */
  newIssues: z.array(ValidationIssueSchema),
  model: z.string(),
});

/** Structured room extraction from a photo (approximate). */
/** A box on the uploaded image: [ymin, xmin, ymax, xmax], each 0–1000 of the image height/width (Gemini's native format). */
/** Models sometimes answer a box as {ymin,…}, as two [y,x] corners, or with numeric strings; all mean the same box. */
export const ImageBoxSchema = z.preprocess((value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const box = value as Record<string, unknown>;
    value = [box.ymin ?? box.y0 ?? box.top, box.xmin ?? box.x0 ?? box.left, box.ymax ?? box.y1 ?? box.bottom, box.xmax ?? box.x1 ?? box.right];
  }
  return Array.isArray(value) ? value.flat(2).map((entry) => (typeof entry === "string" ? Number(entry) : entry)) : value;
}, z.tuple([z.number(), z.number(), z.number(), z.number()]));
export type ImageBox = z.infer<typeof ImageBoxSchema>;

export const AiRoomExtractionSchema = z.object({
  roomName: z.string().default("Reconstructed room"),
  source: z.enum(["photo", "sketch", "floor-plan"]).default("photo"),
  // Dimension labels written on the image, transcribed verbatim and converted to meters.
  measurements: z.array(z.object({
    label: z.string(),
    meters: z.number().positive(),
    axis: z.enum(["width", "depth", "other"]),
  })).max(20).default([]),
  /** False when the image is not a room, plan or sketch at all. */
  isRoomPlan: z.boolean().default(true),
  /** Every labelled room when the image is a multi-room (flat or house) plan; only one of them is reconstructed. */
  planRooms: z.array(z.object({ name: z.string(), width: z.number().positive().optional(), depth: z.number().positive().optional(), label: z.string().optional() })).max(30).default([]),
  width: z.number().min(1).max(40),
  depth: z.number().min(1).max(40),
  height: z.number().min(2).max(5).default(2.7),
  /** Plan images: the room's interior (inner faces of its outer walls) on the image. Drives pixel-exact geometry. */
  roomBox: ImageBoxSchema.optional(),
  /**
   * Interior walls, partitions, and wall blocks that make the room non-rectangular (notches, L-shapes), in meters
   * relative to the room center. Built as solid, locked wall segments. `box` is where they are on the image.
   */
  walls: z.array(z.preprocess(
    // Models sometimes return a bare box instead of { box }.
    (value) => (Array.isArray(value) ? { box: value } : value),
    z.object({
      x: z.number().default(0), z: z.number().default(0),
      width: z.number().positive().default(0.1), depth: z.number().positive().default(0.1),
      box: ImageBoxSchema.optional(),
    }),
  )).max(40).default([]),
  /** True once the browser has measured the geometry from the image pixels (see web/src/lib/planGeometry.ts). */
  measured: z.boolean().default(false),
  floorColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  wallColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  openings: z.array(z.object({
    kind: z.enum(["door", "window"]),
    wall: WallSideSchema,
    offset: z.number().default(0),
    width: z.number().positive(),
    hinge: z.enum(["left", "right"]).optional(),
    swing: z.enum(["in", "out"]).optional(),
    confidence: z.number().min(0).max(1).default(0.7),
    box: ImageBoxSchema.optional(),
  })).max(12).default([]),
  objects: z.array(z.object({
    catalogItemId: z.string(),
    name: z.string().optional(),
    x: z.number(),
    z: z.number(),
    yawDegrees: z.number().default(0),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    /** 0–1: how sure the model is about this piece (drawn clearly vs. inferred). */
    confidence: z.number().min(0).max(1).default(0.7),
    box: ImageBoxSchema.optional(),
    /** Footprint measured from the plan (object-local width × depth, meters); otherwise the catalog size is used. */
    width: z.number().positive().optional(),
    depth: z.number().positive().optional(),
  })).max(40),
  notes: z.string().default(""),
});

/** Whole floor plan (house/flat), step 1: what the AI reads. Geometry is then measured from the pixels in the browser. */
export const AiHouseExtractionSchema = z.object({
  isRoomPlan: z.boolean().default(true),
  name: z.string().default("Floor plan"),
  /** Overall dimension lines (e.g. "15.00 m" across the whole building), converted to meters. */
  overall: z.array(z.object({ label: z.string(), meters: z.number().positive(), axis: z.enum(["width", "depth"]) })).max(4).default([]),
  rooms: z.array(z.object({
    name: z.string(),
    /** Size text exactly as written, e.g. "3.60 x 3.30 m" or 12'-0" x 10'-6"; "" if none. */
    label: z.string().default(""),
    /** Interior of the room on the image (inner wall faces). */
    box: ImageBoxSchema,
    objects: z.array(z.object({
      catalogItemId: z.string(),
      name: z.string().optional(),
      box: ImageBoxSchema,
      yawDegrees: z.number().default(0),
    })).max(24).default([]),
  })).min(1).max(30),
  notes: z.string().default(""),
});
export const AiHouseAnalyzeResponseSchema = z.object({ extraction: AiHouseExtractionSchema, model: z.string() });

/** Whole floor plan, step 2: measured geometry (meters, plan center = origin, -Z = top of the image). */
export const MeasuredHouseSchema = z.object({
  name: z.string().min(1).max(80),
  height: z.number().min(2).max(6),
  rooms: z.array(z.object({
    name: z.string().min(1).max(80),
    x: z.number(), z: z.number(),
    width: z.number().min(0.3).max(60), depth: z.number().min(0.3).max(60),
    wallThickness: z.number().min(0.05).max(0.6),
    openings: z.array(z.object({
      kind: z.enum(["door", "window", "passage"]),
      wall: WallSideSchema,
      offset: z.number(),
      width: z.number().positive(),
    })).max(24).default([]),
    objects: z.array(z.object({
      catalogItemId: z.string(), name: z.string().optional(),
      x: z.number(), z: z.number(), width: z.number().positive(), depth: z.number().positive(), yawDegrees: z.number(),
    })).max(24).default([]),
  })).min(1).max(30),
});
export const AiHouseBuildRequestSchema = z.object({ house: MeasuredHouseSchema, catalog: z.array(AiCatalogItemSchema) });
export type AiHouseExtraction = z.infer<typeof AiHouseExtractionSchema>;
export type AiHouseAnalyzeResponse = z.infer<typeof AiHouseAnalyzeResponseSchema>;
export type MeasuredHouse = z.infer<typeof MeasuredHouseSchema>;

/** "Describe a room" → generated, furnished room. */
export const AiBriefRequestSchema = z.object({
  brief: z.string().min(3).max(2000),
  catalog: z.array(AiCatalogItemSchema),
});
export type AiBriefRequest = z.infer<typeof AiBriefRequestSchema>;

export const AiImageRequestSchema = z.object({
  imageBase64: z.string().min(16),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  catalog: z.array(AiCatalogItemSchema),
});

export const AiImageResponseSchema = z.object({
  scene: SceneSchema,
  notes: z.string(),
  issues: z.array(ValidationIssueSchema),
  model: z.string(),
});

export type AiCatalogItem = z.infer<typeof AiCatalogItemSchema>;
export type AiToolCall = z.infer<typeof AiToolCallSchema>;
export type AiPlan = z.infer<typeof AiPlanSchema>;
export type AiEditRequest = z.infer<typeof AiEditRequestSchema>;
export type AiEditResponse = z.infer<typeof AiEditResponseSchema>;
/** Room-plan upload, step 1: read the image into an editable structured extraction (no scene yet). */
export const AiPlanAnalyzeRequestSchema = AiImageRequestSchema.extend({
  /** For a multi-room plan: which labelled room to reconstruct. */
  focusRoom: z.string().max(80).optional(),
});
export const AiPlanAnalyzeResponseSchema = z.object({
  extraction: AiRoomExtractionSchema,
  /** Which of width/depth came from a dimension written on the image, versus estimated. */
  /** written = a dimension on the plan; measured = derived from the plan's pixels at the written scale; estimated = guessed. */
  sources: z.object({ width: z.enum(["written", "measured", "estimated"]), depth: z.enum(["written", "measured", "estimated"]) }),
  model: z.string(),
});

export const PlanBuildSettingsSchema = z.object({
  width: z.number().min(1).max(40),
  depth: z.number().min(1).max(40),
  height: z.number().min(2).max(6),
  wallThickness: z.number().min(0.05).max(0.6),
  openings: z.boolean(),
  furniture: z.boolean(),
  lighting: z.enum(["natural", "warm", "neutral"]),
});
/** Step 2: deterministic build of the scene from the (user-corrected) extraction. No AI involved. */
export const AiPlanBuildRequestSchema = z.object({
  extraction: AiRoomExtractionSchema,
  settings: PlanBuildSettingsSchema,
  catalog: z.array(AiCatalogItemSchema),
});
export type AiPlanAnalyzeRequest = z.infer<typeof AiPlanAnalyzeRequestSchema>;
export type AiPlanAnalyzeResponse = z.infer<typeof AiPlanAnalyzeResponseSchema>;
export type PlanBuildSettings = z.infer<typeof PlanBuildSettingsSchema>;
export type AiPlanBuildRequest = z.infer<typeof AiPlanBuildRequestSchema>;
export type AiRoomExtraction = z.infer<typeof AiRoomExtractionSchema>;
export type AiImageRequest = z.infer<typeof AiImageRequestSchema>;
export type AiImageResponse = z.infer<typeof AiImageResponseSchema>;

/** Parses a room-size label such as 17'-8" X 17'-7", 4.2 x 3.6 m, 3600 x 4000 mm. Returns [first, second] in meters. */
export function parseSizeLabel(label: string): [number, number] | null {
  const parts = label.replace(/[″“”]/g, '"').replace(/[′‘’]/g, "'").split(/\s*[x×X*]\s*/);
  if (parts.length !== 2) return null;
  const mm = /mm/i.test(label);
  const cm = !mm && /cm/i.test(label);
  const one = (text: string) => {
    const feet = text.match(/(\d+(?:\.\d+)?)\s*'\s*-?\s*(?:(\d+(?:\.\d+)?)\s*"?)?/);
    if (feet) return Number(feet[1]) * 0.3048 + Number(feet[2] ?? 0) * 0.0254;
    const number = text.match(/(\d+(?:\.\d+)?)/);
    if (!number) return NaN;
    const value = Number(number[1]);
    return mm ? value / 1000 : cm ? value / 100 : value;
  };
  const [a, b] = [one(parts[0]!), one(parts[1]!)];
  return a >= 1 && a <= 40 && b >= 1 && b <= 40 ? [Math.round(a * 100) / 100, Math.round(b * 100) / 100] : null;
}
