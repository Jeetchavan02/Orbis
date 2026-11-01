import { create } from "zustand";
import type { Opening, Room, WallSide } from "@reality-builder/shared";
import { newEntityId, useWorkspaceStore } from "../store/workspace";

/** The door/window/passage picked in the 3D view, plus a live draft while its handles are dragged. */
export const useOpeningSelection = create<{
  roomId: string | null; openingId: string | null; draft: Opening | null;
  select: (roomId: string | null, openingId: string | null) => void;
  setDraft: (draft: Opening | null) => void;
}>((set) => ({
  roomId: null, openingId: null, draft: null,
  select: (roomId, openingId) => set({ roomId, openingId, draft: null }),
  setDraft: (draft) => set({ draft }),
}));

export const MIN_OPENING = 0.4;
const SNAP = 0.05;
const GAP = 0.05;

export function wallLength(room: Room, wall: WallSide) {
  return wall === "north" || wall === "south" ? room.dimensions.width : room.dimensions.depth;
}

/**
 * Free span [from, to] along the wall that an opening may occupy: between the wall ends (minus a small
 * return) and its neighbouring openings, so doors never overlap each other or run off the wall.
 */
export function freeSpan(room: Room, opening: Opening) {
  const half = wallLength(room, opening.wall) / 2 - GAP;
  let from = -half;
  let to = half;
  for (const other of room.openings) {
    if (other.id === opening.id || other.wall !== opening.wall) continue;
    const a = other.offset - other.width / 2;
    const b = other.offset + other.width / 2;
    if (b <= opening.offset) from = Math.max(from, b + GAP);
    else if (a >= opening.offset) to = Math.min(to, a - GAP);
  }
  return { from, to };
}

const snap = (value: number) => Math.round(value / SNAP) * SNAP;
const round = (value: number) => Math.round(value * 1000) / 1000;

/** Moves one edge of the opening to `edge` (the other edge stays), clamped to the free span. */
export function resizeEdge(room: Room, opening: Opening, side: -1 | 1, edge: number): Opening {
  const span = freeSpan(room, opening);
  const fixed = opening.offset - side * opening.width / 2;
  let moved = snap(edge);
  moved = side > 0 ? Math.min(span.to, Math.max(fixed + MIN_OPENING, moved)) : Math.max(span.from, Math.min(fixed - MIN_OPENING, moved));
  return { ...opening, offset: round((fixed + moved) / 2), width: round(Math.abs(moved - fixed)) };
}

/** Slides the opening along its wall, clamped to the free span. */
export function slide(room: Room, opening: Opening, offset: number): Opening {
  const span = freeSpan(room, opening);
  const half = opening.width / 2;
  return { ...opening, offset: round(Math.min(span.to - half, Math.max(span.from + half, snap(offset)))) };
}

/** Sets the width around the centre, shrinking to fit the free span. */
export function setWidth(room: Room, opening: Opening, width: number): Opening {
  const span = freeSpan(room, opening);
  const w = Math.max(MIN_OPENING, Math.min(span.to - span.from, snap(width)));
  const offset = Math.min(span.to - w / 2, Math.max(span.from + w / 2, opening.offset));
  return { ...opening, width: round(w), offset: round(offset) };
}

/** Default height per kind, kept below the ceiling (same caps as the room inspector). */
export function openingHeight(room: Room, kind: Opening["kind"]) {
  const h = room.dimensions.height;
  return kind === "window" ? Math.min(1.3, h - 1.1) : kind === "passage" ? Math.min(2.4, h - 0.1) : Math.min(2.05, h - 0.2);
}

function patchOpenings(room: Room, openings: Opening[], label: string) {
  return useWorkspaceStore.getState().dispatch({ type: "room.update", roomId: room.id, patch: { openings } }, { base: { [room.id]: room.version }, label });
}

export function commitOpening(room: Room, next: Opening, label = "Edit door") {
  return patchOpenings(room, room.openings.map((opening) => (opening.id === next.id ? next : opening)), label);
}

export function removeOpening(room: Room, id: string) {
  const opening = room.openings.find((entry) => entry.id === id);
  if (!opening) return false;
  const ok = patchOpenings(room, room.openings.filter((entry) => entry.id !== id), `Remove ${opening.kind === "passage" ? "opening" : opening.kind}`);
  if (ok) useOpeningSelection.getState().select(null, null);
  return ok;
}

/** Adds a door in the widest free stretch of the wall (or the room's longest free wall). */
export function addDoor(room: Room, wall?: WallSide, kind: Opening["kind"] = "door") {
  const walls: WallSide[] = wall ? [wall] : ["south", "north", "east", "west"];
  const width = kind === "window" ? 1.2 : kind === "passage" ? 1.2 : 0.85;
  for (const side of walls) {
    const half = wallLength(room, side) / 2 - GAP;
    const taken = room.openings.filter((o) => o.wall === side).map((o) => [o.offset - o.width / 2 - GAP, o.offset + o.width / 2 + GAP] as const).sort((a, b) => a[0] - b[0]);
    let cursor = -half;
    const gaps: [number, number][] = [];
    for (const [a, b] of taken) { if (a > cursor) gaps.push([cursor, a]); cursor = Math.max(cursor, b); }
    if (cursor < half) gaps.push([cursor, half]);
    const best = gaps.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0];
    if (!best || best[1] - best[0] < width) continue;
    const opening: Opening = {
      id: newEntityId(kind), kind, wall: side, offset: round(snap((best[0] + best[1]) / 2)), width,
      height: openingHeight(room, kind),
      sillHeight: kind === "window" ? Math.min(0.9, room.dimensions.height - openingHeight(room, kind) - 0.1) : 0, hinge: "left", swing: "in",
    };
    if (patchOpenings(room, [...room.openings, opening], `Add ${kind === "passage" ? "opening" : kind}`)) {
      useOpeningSelection.getState().select(room.id, opening.id);
      return true;
    }
    return false;
  }
  useWorkspaceStore.getState().notify("info", "No free wall space wide enough for a new " + (kind === "passage" ? "opening" : kind) + ".");
  return false;
}

if (typeof window !== "undefined") {
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && useOpeningSelection.getState().openingId) useOpeningSelection.getState().select(null, null);
  });
}
