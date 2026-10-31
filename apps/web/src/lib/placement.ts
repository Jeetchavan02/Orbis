import { create } from "zustand";
import type { FurnitureObject, Opening, Room, Scene, WallSide } from "@reality-builder/shared";
import { footprint, isFloorCovering, satPenetration, worldToRoom, roomToWorld } from "@reality-builder/spatial-engine";
import { catalogById, type CatalogItem } from "../data/catalog";
import { newEntityId, useWorkspaceStore } from "../store/workspace";

/** Live placement session: dragging from the library or "armed" click-to-place. */
export const usePlacement = create<{
  entryId: string | null;
  mode: "drag" | "click" | null;
  /** Resolved pose of the ghost (null until the pointer is over the floor). */
  pose: { x: number; z: number; yaw: number; valid: boolean } | null;
  start: (entryId: string, mode: "drag" | "click") => void;
  update: (pose: { x: number; z: number; yaw: number; valid: boolean } | null) => void;
  cancel: () => void;
}>((set) => ({
  entryId: null,
  mode: null,
  pose: null,
  start: (entryId, mode) => set({ entryId, mode, pose: null }),
  update: (pose) => set({ pose }),
  cancel: () => set({ entryId: null, mode: null, pose: null }),
}));

export function activeRoom(scene: Scene) {
  const id = useWorkspaceStore.getState().activeRoomId;
  return scene.rooms.find((room) => room.id === id) ?? scene.rooms[0];
}

const WALL_SNAP = 0.45;

/**
 * Resolves where an item would land for a floor point: clamped inside the room, snapped to 5 cm, and turned
 * to stand with its back against a wall when dropped close to one (the way people place furniture).
 */
export function resolvePose(entry: CatalogItem, room: Room, scene: Scene, x: number, z: number) {
  const [lx, lz] = worldToRoom(room, [x, z]);
  const halfW = room.dimensions.width / 2;
  const halfD = room.dimensions.depth / 2;
  const { width, depth } = entry.dimensions;
  const distances: [WallSide, number][] = [["north", lz + halfD], ["south", halfD - lz], ["west", lx + halfW], ["east", halfW - lx]];
  distances.sort((a, b) => a[1] - b[1]);
  const [wall, distance] = distances[0]!;
  let yaw = 0;
  let px = lx;
  let pz = lz;
  const snap = (value: number) => Math.round(value / 0.05) * 0.05;
  const againstWall = !entry.constraints?.floorCovering && entry.family !== "pendant" && entry.family !== "ceiling-light" && distance < depth / 2 + WALL_SNAP;
  if (againstWall) {
    yaw = { north: 0, south: 180, west: 90, east: 270 }[wall];
    const along = wall === "north" || wall === "south" ? width : width;
    if (wall === "north") pz = -halfD + depth / 2;
    if (wall === "south") pz = halfD - depth / 2;
    if (wall === "west") px = -halfW + depth / 2;
    if (wall === "east") px = halfW - depth / 2;
    if (wall === "north" || wall === "south") px = Math.max(-halfW + along / 2, Math.min(halfW - along / 2, snap(px)));
    else pz = Math.max(-halfD + along / 2, Math.min(halfD - along / 2, snap(pz)));
  } else {
    px = Math.max(-halfW + width / 2, Math.min(halfW - width / 2, snap(px)));
    pz = Math.max(-halfD + depth / 2, Math.min(halfD - depth / 2, snap(pz)));
  }
  const [wx, wz] = roomToWorld(room, [px, pz]);
  const yawWorld = (yaw + room.yawDegrees) % 360;
  const probe = itemFromEntry(entry, room, wx, wz, yawWorld, "probe");
  const others = scene.furniture.filter((item) => item.roomId === room.id && !isFloorCovering(item) && Math.min(item.position.y + item.dimensions.height, probe.position.y + probe.dimensions.height) - Math.max(item.position.y, probe.position.y) > 0.005);
  const shape = footprint(probe);
  const valid = isFloorCovering(probe) || !others.some((other) => satPenetration(shape, footprint(other)) > 0.005);
  return { x: Math.round(wx * 1000) / 1000, z: Math.round(wz * 1000) / 1000, yaw: yawWorld, valid };
}

export function itemFromEntry(entry: CatalogItem, room: Room, x: number, z: number, yaw: number, id = newEntityId("obj")): FurnitureObject {
  return {
    id,
    roomId: room.id,
    name: entry.name,
    category: entry.category,
    catalogItemId: entry.id,
    position: { x, y: room.position.y + (entry.elevation ?? 0), z },
    yawDegrees: yaw,
    dimensions: entry.dimensions,
    color: entry.color,
    version: 1,
    ...(entry.light ? { light: entry.light } : {}),
    ...(entry.constraints ? { constraints: entry.constraints } : {}),
  };
}

/** Free spot near the room centre (used for click-to-add without pointing). */
export function freeSpot(entry: CatalogItem, room: Room, scene: Scene) {
  for (let ring = 0; ring < 30; ring += 1) {
    const steps = Math.max(1, ring * 8);
    for (let step = 0; step < steps; step += 1) {
      const angle = (step / steps) * Math.PI * 2;
      const [x, z] = roomToWorld(room, [Math.cos(angle) * ring * 0.15, Math.sin(angle) * ring * 0.15]);
      const pose = resolvePose(entry, room, scene, x, z);
      if (pose.valid) return pose;
    }
  }
  return resolvePose(entry, room, scene, room.position.x, room.position.z);
}

/** Adds a door/window to the wall nearest the point, as a room opening (one undoable action). */
function placeOpening(entry: CatalogItem, room: Room, x: number, z: number) {
  const opening = entry.opening!;
  const [lx, lz] = worldToRoom(room, [x, z]);
  const halfW = room.dimensions.width / 2;
  const halfD = room.dimensions.depth / 2;
  const distances: [WallSide, number][] = [["north", lz + halfD], ["south", halfD - lz], ["west", lx + halfW], ["east", halfW - lx]];
  distances.sort((a, b) => a[1] - b[1]);
  const wall = distances[0]![0];
  const length = wall === "north" || wall === "south" ? room.dimensions.width : room.dimensions.depth;
  const along = wall === "north" || wall === "south" ? lx : lz;
  const offset = Math.max(-length / 2 + opening.width / 2 + 0.05, Math.min(length / 2 - opening.width / 2 - 0.05, Math.round(along / 0.05) * 0.05));
  const next: Opening = { id: newEntityId(opening.kind), kind: opening.kind, wall, offset, width: opening.width, height: opening.height, sillHeight: opening.sillHeight, hinge: "left", swing: "in" };
  const ok = useWorkspaceStore.getState().dispatch({ type: "room.update", roomId: room.id, patch: { openings: [...room.openings, next] } }, { label: `Add ${entry.name.toLowerCase()}` });
  if (ok) useWorkspaceStore.getState().notify("success", `${entry.name} added to the ${wall} wall.`);
}

/** Places the exact catalog entry; `at` = floor point, or a free spot when omitted. */
export function placeEntry(entryId: string, at?: { x: number; z: number }) {
  const entry = catalogById(entryId);
  const { scene, dispatch, selectEntity, setTool } = useWorkspaceStore.getState();
  const room = activeRoom(scene);
  if (!entry || !room) return;
  if (entry.opening) {
    placeOpening(entry, room, at?.x ?? room.position.x, at?.z ?? room.position.z - room.dimensions.depth / 2);
    return;
  }
  const pose = at ? resolvePose(entry, room, scene, at.x, at.z) : freeSpot(entry, room, scene);
  const furniture = itemFromEntry(entry, room, pose.x, pose.z, pose.yaw);
  if (dispatch({ type: "furniture.create", furniture }, { label: "Add " + entry.name })) {
    selectEntity(furniture.id);
    setTool("select");
  }
}
