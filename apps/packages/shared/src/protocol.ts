import { z } from "zod";
import { FurnitureObjectSchema, RoomSchema, SceneActionSchema, SceneSchema } from "./schemas.js";

/** Versions the client believed each touched entity had when it created the action. "scene" = settings. */
export const BaseVersionsSchema = z.record(z.string(), z.number().int().nonnegative());

/** A collaborator's pointer on the floor (world metres), for live cursors. */
export const CursorSchema = z.object({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite(), roomId: z.string() });

export const PeerSchema = z.object({
  clientId: z.string().min(1),
  name: z.string().min(1),
  color: z.string(),
  selectedId: z.string().nullable(),
  cursor: CursorSchema.nullable().default(null),
});

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), sceneId: z.string().min(1), clientId: z.string().min(1), name: z.string().min(1), color: z.string() }),
  z.object({
    type: z.literal("action"),
    requestId: z.string().min(1),
    action: SceneActionSchema,
    baseVersions: BaseVersionsSchema,
    /** History label for the submitting client; echoed back. */
    label: z.string().min(1),
  }),
  z.object({ type: z.literal("presence"), selectedId: z.string().nullable().optional(), cursor: CursorSchema.nullable().optional() }),
  z.object({ type: z.literal("rename"), name: z.string().trim().min(1).max(40), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) }),
  z.object({ type: z.literal("save") }),
  /**
   * Replace the whole scene (JSON import, offline "keep mine"). `baseSeq` is the last server sequence number the
   * client had seen; the server refuses the replacement if anyone changed the scene since, so a stale scene can
   * never silently overwrite newer work.
   */
  z.object({ type: z.literal("load-scene"), requestId: z.string().min(1), baseSeq: z.number().int(), scene: SceneSchema }),
]);

export const ConflictSchema = z.object({
  entityId: z.string(),
  entityName: z.string(),
  baseVersion: z.number().int(),
  currentVersion: z.number().int().nullable(),
  /** The current server state of the entity (null when it was deleted). */
  current: z.union([FurnitureObjectSchema, RoomSchema]).nullable(),
  changedBy: z.string().nullable(),
});

export const ServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("welcome"), scene: SceneSchema, seq: z.number().int(), peers: z.array(PeerSchema), selfId: z.string() }),
  z.object({
    type: z.literal("applied"),
    seq: z.number().int(),
    clientId: z.string(),
    clientName: z.string(),
    requestId: z.string().nullable(),
    label: z.string(),
    action: SceneActionSchema,
  }),
  z.object({
    type: z.literal("rejected"),
    requestId: z.string(),
    reason: z.enum(["stale", "invalid"]),
    message: z.string(),
    conflicts: z.array(ConflictSchema),
  }),
  z.object({ type: z.literal("peers"), peers: z.array(PeerSchema) }),
  z.object({ type: z.literal("saved"), savedAt: z.string(), path: z.string() }),
  z.object({ type: z.literal("scene-replaced"), scene: SceneSchema, seq: z.number().int(), by: z.string() }),
  z.object({ type: z.literal("load-rejected"), requestId: z.string(), seq: z.number().int(), message: z.string() }),
  z.object({ type: z.literal("error"), message: z.string() }),
  /** The project was deleted while you were connected. */
  z.object({ type: z.literal("project-deleted") }),
]);

export type BaseVersions = z.infer<typeof BaseVersionsSchema>;
export type Peer = z.infer<typeof PeerSchema>;
export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type Conflict = z.infer<typeof ConflictSchema>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
