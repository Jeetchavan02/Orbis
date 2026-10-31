import { z } from "zod";

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
});

export const FurnitureCategorySchema = z.enum([
  "seating",
  "tables",
  "storage",
  "lighting",
  "decor",
  "other",
]);

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
  dimensions: Dimensions3DSchema,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export const SceneSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  name: z.string().min(1),
  coordinateSystem: z.literal("y-up-xz-meters"),
  rooms: z.array(RoomSchema),
  furniture: z.array(FurnitureObjectSchema),
});

export const ValidationViolationSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  severity: z.enum(["info", "warning", "error"]),
  message: z.string().min(1),
  entityIds: z.array(z.string().min(1)),
  roomId: z.string().optional(),
  measurements: z.record(z.number().finite()).optional(),
});

const RoomUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  position: Vector3Schema.partial().optional(),
  dimensions: Dimensions3DSchema.extend({
    wallThickness: z.number().positive(),
  }).partial().optional(),
  yawDegrees: z.number().finite().optional(),
});

const FurnitureUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  category: FurnitureCategorySchema.optional(),
  position: Vector3Schema.partial().optional(),
  yawDegrees: z.number().finite().optional(),
  dimensions: Dimensions3DSchema.partial().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export const SceneActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("room.create"), room: RoomSchema }),
  z.object({ type: z.literal("room.update"), roomId: z.string().min(1), patch: RoomUpdateSchema }),
  z.object({ type: z.literal("room.delete"), roomId: z.string().min(1) }),
  z.object({ type: z.literal("furniture.create"), furniture: FurnitureObjectSchema }),
  z.object({ type: z.literal("furniture.update"), furnitureId: z.string().min(1), patch: FurnitureUpdateSchema }),
  z.object({ type: z.literal("furniture.delete"), furnitureId: z.string().min(1) }),
]);

export const ApiHealthSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("reality-builder-api"),
  timestamp: z.string().datetime(),
});

export type Vector3 = z.infer<typeof Vector3Schema>;
export type Dimensions3D = z.infer<typeof Dimensions3DSchema>;
export type Room = z.infer<typeof RoomSchema>;
export type FurnitureCategory = z.infer<typeof FurnitureCategorySchema>;
export type FurnitureObject = z.infer<typeof FurnitureObjectSchema>;
export type Scene = z.infer<typeof SceneSchema>;
export type ValidationViolation = z.infer<typeof ValidationViolationSchema>;
export type SceneAction = z.infer<typeof SceneActionSchema>;
export type ApiHealth = z.infer<typeof ApiHealthSchema>;
