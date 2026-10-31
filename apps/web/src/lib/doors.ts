import type { Opening, Room } from "@reality-builder/shared";
import { openingFrame } from "@reality-builder/spatial-engine";

type P = [number, number];

/**
 * Door leaf geometry in room-local coordinates (metres). "Left/right" is the hinge side as seen from inside
 * the room facing the door; the leaf opens 90° into the room ("in") or out of it ("out").
 */
export function doorGeometry(room: Room, door: Opening) {
  const { center, inward } = openingFrame(room, door);
  const facing: P = [-inward[0], -inward[1]];
  const left: P = [facing[1], -facing[0]];
  const side = door.hinge === "right" ? -1 : 1;
  const half = door.width / 2;
  const hinge: P = [center[0] + left[0] * half * side, center[1] + left[1] * half * side];
  const closedEnd: P = [center[0] - left[0] * half * side, center[1] - left[1] * half * side];
  const swingDir: P = door.swing === "out" ? facing : inward;
  const openEnd: P = [hinge[0] + swingDir[0] * door.width, hinge[1] + swingDir[1] * door.width];
  return { hinge, closedEnd, openEnd, swingDir, inward, center };
}
