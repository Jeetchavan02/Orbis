import type { CompassDirection, CompassZone, FurnitureObject, GuidelinePack, Room, Scene } from "@reality-builder/shared";
import { rotateYaw, worldToRoom } from "./geometry.js";

export type GuidelineResult = {
  ruleId: string;
  title: string;
  objectId: string;
  objectName: string;
  satisfied: boolean;
  /** What was measured, e.g. "zone NE" or "faces S". */
  observed: string;
  expected: string;
  explanation: string;
  weight: number;
};

export type GuidelineReport = { packId: string; packName: string; disclaimer: string; score: number; results: GuidelineResult[] };

const DIRECTIONS: CompassDirection[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** Compass bearing (0 = north, 90 = east) of a room-local vector, given the bearing of the room's −Z axis. */
export function bearingOf([x, z]: [number, number], northOffsetDegrees: number) {
  const local = (Math.atan2(x, -z) * 180) / Math.PI;
  return (((local + northOffsetDegrees) % 360) + 360) % 360;
}

export function directionOf(bearing: number): CompassDirection {
  return DIRECTIONS[Math.round(bearing / 45) % 8]!;
}

export function zoneOf(room: Room, item: FurnitureObject, northOffsetDegrees: number): CompassZone {
  const [x, z] = worldToRoom(room, [item.position.x, item.position.z]);
  if (Math.abs(x) <= room.dimensions.width / 6 && Math.abs(z) <= room.dimensions.depth / 6) return "C";
  // Normalize by room proportions so zones form a 3×3 grid rather than a circle.
  return directionOf(bearingOf([x / (room.dimensions.width / 2), z / (room.dimensions.depth / 2)], northOffsetDegrees));
}

function frontBearing(room: Room, item: FurnitureObject, northOffsetDegrees: number, back: boolean) {
  const [fx, fz] = rotateYaw([0, back ? -1 : 1], item.yawDegrees - room.yawDegrees);
  return bearingOf([fx, fz], northOffsetDegrees);
}

/** Evaluates an advisory guideline pack. Results never feed into spatial validity. */
export function evaluateGuidelines(scene: Scene, pack: GuidelinePack, roomId?: string): GuidelineReport {
  const room = scene.rooms.find((entry) => entry.id === roomId) ?? scene.rooms[0];
  const north = scene.environment.northOffsetDegrees;
  const results: GuidelineResult[] = [];
  if (room) {
    for (const rule of pack.rules) {
      const targets = scene.furniture.filter((item) =>
        item.roomId === room.id &&
        (rule.appliesTo.catalogItemIds?.includes(item.catalogItemId ?? "") || rule.appliesTo.categories?.includes(item.category)));
      for (const item of targets) {
        let observed: string;
        let satisfied: boolean;
        let expected: string;
        if (rule.check === "zone") {
          const zone = zoneOf(room, item, north);
          observed = zone === "C" ? "center" : `${zone} zone`;
          satisfied = (rule.zones ?? []).includes(zone);
          expected = (rule.zones ?? []).join(" / ");
        } else {
          const direction = directionOf(frontBearing(room, item, north, rule.check === "backing"));
          observed = `${rule.check === "backing" ? "back points" : "faces"} ${direction}`;
          satisfied = (rule.directions ?? []).includes(direction);
          expected = (rule.directions ?? []).join(" / ");
        }
        results.push({ ruleId: rule.id, title: rule.title, objectId: item.id, objectName: item.name, satisfied, observed, expected, explanation: rule.explanation, weight: rule.weight });
      }
    }
  }
  const total = results.reduce((sum, result) => sum + result.weight, 0);
  const met = results.reduce((sum, result) => sum + (result.satisfied ? result.weight : 0), 0);
  return { packId: pack.id, packName: pack.name, disclaimer: pack.disclaimer, score: total ? Math.round((100 * met) / total) : 100, results };
}
