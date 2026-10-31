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
export const AiRoomExtractionSchema = z.object({
  roomName: z.string().default("Reconstructed room"),
  source: z.enum(["photo", "sketch", "floor-plan"]).default("photo"),
  // Dimension labels written on the image, transcribed verbatim and converted to meters.
  measurements: z.array(z.object({
    label: z.string(),
    meters: z.number().positive(),
    axis: z.enum(["width", "depth", "other"]),
  })).max(20).default([]),
  width: z.number().min(1.5).max(20),
  depth: z.number().min(1.5).max(20),
  height: z.number().min(2).max(5).default(2.7),
  floorColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  wallColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  openings: z.array(z.object({
    kind: z.enum(["door", "window"]),
    wall: WallSideSchema,
    offset: z.number().default(0),
    width: z.number().positive(),
  })).max(8).default([]),
  objects: z.array(z.object({
    catalogItemId: z.string(),
    name: z.string().optional(),
    x: z.number(),
    z: z.number(),
    yawDegrees: z.number().default(0),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  })).max(40),
  notes: z.string().default(""),
});

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
export type AiRoomExtraction = z.infer<typeof AiRoomExtractionSchema>;
export type AiImageRequest = z.infer<typeof AiImageRequestSchema>;
export type AiImageResponse = z.infer<typeof AiImageResponseSchema>;
