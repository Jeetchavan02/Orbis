import { z } from "zod";
import { FurnitureCategorySchema } from "./schemas.js";

/** Compass zones of a room (center = middle third) and 4/8-way directions. */
export const CompassZoneSchema = z.enum(["N", "NE", "E", "SE", "S", "SW", "W", "NW", "C"]);
export const CompassDirectionSchema = z.enum(["N", "NE", "E", "SE", "S", "SW", "W", "NW"]);

/**
 * A configurable guideline pack (e.g. Vastu). Guidelines are advisory: they are reported separately
 * from spatial validation and never make a layout invalid.
 */
export const GuidelineRuleSchema = z.object({
  id: z.string(),
  title: z.string(),
  appliesTo: z.object({ catalogItemIds: z.array(z.string()).optional(), categories: z.array(FurnitureCategorySchema).optional() }),
  /** zone: object center lies in one of `zones`; facing: front points to one of `directions`; backing: back points to one of `directions`. */
  check: z.enum(["zone", "facing", "backing"]),
  zones: z.array(CompassZoneSchema).optional(),
  directions: z.array(CompassDirectionSchema).optional(),
  weight: z.number().min(0).max(5).default(1),
  explanation: z.string(),
});

export const GuidelinePackSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  disclaimer: z.string(),
  rules: z.array(GuidelineRuleSchema),
});

export type CompassZone = z.infer<typeof CompassZoneSchema>;
export type CompassDirection = z.infer<typeof CompassDirectionSchema>;
export type GuidelineRule = z.infer<typeof GuidelineRuleSchema>;
export type GuidelinePack = z.infer<typeof GuidelinePackSchema>;
