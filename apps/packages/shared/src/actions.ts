import {
  SceneActionSchema,
  type BaseSceneAction,
  type FurnitureObject,
  type FurniturePatch,
  type Room,
  type RoomPatch,
  type Scene,
  type SceneAction,
  type SceneSettingsPatch,
} from "./schemas.js";
import { boundsDimensions, meshBounds, scaleMeshTo } from "./mesh.js";

export class SceneActionError extends Error {
  constructor(
    readonly code: "invalid-action" | "missing-entity" | "duplicate-id",
    message: string,
  ) {
    super(message);
    this.name = "SceneActionError";
  }
}

export type AppliedAction = {
  scene: Scene;
  /** Applying `inverse` to `scene` restores the input scene (modulo entity versions). */
  inverse: SceneAction;
};

/** Pseudo entity id used for scene-level settings (name, rules, environment) in version checks. */
export const SCENE_SETTINGS_ID = "scene";

/**
 * Validates and applies an action without mutating the input scene.
 * Spatial validity is deliberately not checked here: invalid layouts are allowed and reported separately.
 */
export function applySceneAction(scene: Scene, rawAction: SceneAction): AppliedAction {
  const parsed = SceneActionSchema.safeParse(rawAction);
  if (!parsed.success) {
    throw new SceneActionError(
      "invalid-action",
      parsed.error.issues.map((issue) => (issue.path.length ? issue.path.join(".") + ": " : "") + issue.message).join("; "),
    );
  }
  const action = parsed.data;

  if (action.type !== "batch") return applyBase(scene, action);

  let current = scene;
  const inverses: BaseSceneAction[] = [];
  for (const step of action.actions) {
    const result = applyBase(current, step);
    current = result.scene;
    inverses.unshift(result.inverse);
  }
  return { scene: current, inverse: { type: "batch", label: action.label, actions: inverses } };
}

function applyBase(scene: Scene, action: BaseSceneAction): { scene: Scene; inverse: BaseSceneAction } {
  switch (action.type) {
    case "room.create": {
      assertUniqueId(scene, action.room.id);
      return {
        scene: { ...scene, rooms: [...scene.rooms, action.room] },
        inverse: { type: "room.delete", roomId: action.room.id },
      };
    }
    case "room.update": {
      const room = findRoom(scene, action.roomId);
      const { next, inverse } = patchRoom(room, action.patch);
      return {
        scene: { ...scene, rooms: scene.rooms.map((item) => (item.id === room.id ? next : item)) },
        inverse: { type: "room.update", roomId: room.id, patch: inverse },
      };
    }
    case "room.delete": {
      const room = findRoom(scene, action.roomId);
      if (scene.furniture.some((item) => item.roomId === room.id)) {
        throw new SceneActionError("invalid-action", `Room "${room.name}" still contains objects.`);
      }
      return {
        scene: { ...scene, rooms: scene.rooms.filter((item) => item.id !== room.id) },
        inverse: { type: "room.create", room },
      };
    }
    case "furniture.create": {
      assertUniqueId(scene, action.furniture.id);
      findRoom(scene, action.furniture.roomId);
      // A mesh is authoritative for bounds.
      const furniture = action.furniture.mesh
        ? { ...action.furniture, dimensions: boundsDimensions(meshBounds(action.furniture.mesh)) }
        : action.furniture;
      return {
        scene: { ...scene, furniture: insertAt(scene.furniture, furniture, action.index) },
        inverse: { type: "furniture.delete", furnitureId: action.furniture.id },
      };
    }
    case "furniture.update": {
      const item = findFurniture(scene, action.furnitureId);
      const { next, inverse } = patchFurniture(item, action.patch);
      return {
        scene: { ...scene, furniture: scene.furniture.map((entry) => (entry.id === item.id ? next : entry)) },
        inverse: { type: "furniture.update", furnitureId: item.id, patch: inverse },
      };
    }
    case "furniture.delete": {
      const item = findFurniture(scene, action.furnitureId);
      return {
        scene: { ...scene, furniture: scene.furniture.filter((entry) => entry.id !== item.id) },
        inverse: { type: "furniture.create", furniture: item, index: scene.furniture.indexOf(item) },
      };
    }
    case "scene.update": {
      const { next, inverse } = patchSettings(scene, action.patch);
      return { scene: next, inverse: { type: "scene.update", patch: inverse } };
    }
  }
}

function patchRoom(room: Room, patch: RoomPatch) {
  const inverse: RoomPatch = {};
  const next: Room = { ...room, version: room.version + 1 };
  if (patch.name !== undefined) [inverse.name, next.name] = [room.name, patch.name];
  if (patch.yawDegrees !== undefined) [inverse.yawDegrees, next.yawDegrees] = [room.yawDegrees, patch.yawDegrees];
  if (patch.openings !== undefined) [inverse.openings, next.openings] = [room.openings, patch.openings];
  if (patch.floorColor !== undefined) [inverse.floorColor, next.floorColor] = [room.floorColor, patch.floorColor];
  if (patch.wallColor !== undefined) [inverse.wallColor, next.wallColor] = [room.wallColor, patch.wallColor];
  if (patch.position) {
    inverse.position = pick(room.position, patch.position);
    next.position = { ...room.position, ...patch.position };
  }
  if (patch.dimensions) {
    inverse.dimensions = pick(room.dimensions, patch.dimensions);
    next.dimensions = { ...room.dimensions, ...patch.dimensions };
  }
  return { next, inverse };
}

function patchFurniture(item: FurnitureObject, patch: FurniturePatch) {
  const inverse: FurniturePatch = {};
  const next: FurnitureObject = { ...item, version: item.version + 1 };
  if (patch.name !== undefined) [inverse.name, next.name] = [item.name, patch.name];
  if (patch.category !== undefined) [inverse.category, next.category] = [item.category, patch.category];
  if (patch.yawDegrees !== undefined) [inverse.yawDegrees, next.yawDegrees] = [item.yawDegrees, patch.yawDegrees];
  if (patch.position) {
    inverse.position = pick(item.position, patch.position);
    next.position = { ...item.position, ...patch.position };
  }
  for (const key of ["color", "constraints", "light"] as const) {
    if (patch[key] === undefined) continue;
    (inverse as Record<string, unknown>)[key] = item[key] ?? null;
    if (patch[key] === null) delete next[key];
    else (next as Record<string, unknown>)[key] = patch[key];
  }

  // Geometry: a mesh is authoritative for bounds; a resize of a mesh object scales its vertices.
  if (patch.mesh !== undefined) {
    inverse.mesh = item.mesh ?? null;
    inverse.dimensions = { ...item.dimensions };
    if (patch.mesh === null) {
      delete next.mesh;
      if (patch.dimensions) next.dimensions = { ...item.dimensions, ...patch.dimensions };
    } else {
      next.mesh = patch.mesh;
      next.dimensions = boundsDimensions(meshBounds(patch.mesh));
    }
  } else if (patch.dimensions) {
    inverse.dimensions = pick(item.dimensions, patch.dimensions);
    next.dimensions = { ...item.dimensions, ...patch.dimensions };
    if (item.mesh) {
      next.mesh = scaleMeshTo(item.mesh, item.dimensions, next.dimensions);
      inverse.mesh = item.mesh;
      inverse.dimensions = { ...item.dimensions };
    }
  }
  return { next, inverse };
}

function patchSettings(scene: Scene, patch: SceneSettingsPatch) {
  const inverse: SceneSettingsPatch = {};
  const next: Scene = { ...scene, settingsVersion: scene.settingsVersion + 1 };
  if (patch.name !== undefined) [inverse.name, next.name] = [scene.name, patch.name];
  if (patch.rules) {
    inverse.rules = pick(scene.rules, patch.rules);
    next.rules = { ...scene.rules, ...patch.rules };
  }
  if (patch.environment) {
    inverse.environment = pick(scene.environment, patch.environment);
    next.environment = { ...scene.environment, ...patch.environment };
  }
  return { next, inverse };
}

function insertAt<T>(list: T[], item: T, index = list.length): T[] {
  const next = [...list];
  next.splice(Math.min(index, next.length), 0, item);
  return next;
}

/** Returns the current values of exactly the keys present in `patch`. */
function pick<T extends object>(current: T, patch: Partial<T>): Partial<T> {
  const result: Partial<T> = {};
  for (const key of Object.keys(patch) as (keyof T)[]) result[key] = current[key];
  return result;
}

function findRoom(scene: Scene, roomId: string) {
  const room = scene.rooms.find((item) => item.id === roomId);
  if (!room) throw new SceneActionError("missing-entity", `Room "${roomId}" does not exist.`);
  return room;
}

function findFurniture(scene: Scene, furnitureId: string) {
  const item = scene.furniture.find((entry) => entry.id === furnitureId);
  if (!item) throw new SceneActionError("missing-entity", `Object "${furnitureId}" does not exist.`);
  return item;
}

function assertUniqueId(scene: Scene, id: string) {
  if (id === SCENE_SETTINGS_ID || scene.rooms.some((room) => room.id === id) || scene.furniture.some((item) => item.id === id)) {
    throw new SceneActionError("duplicate-id", `An entity with id "${id}" already exists.`);
  }
}

/** Existing entities an action modifies or deletes (created entities are checked by id uniqueness instead). */
export function touchedEntityIds(action: SceneAction): string[] {
  const steps = action.type === "batch" ? action.actions : [action];
  const ids = new Set<string>();
  const created = new Set<string>();
  for (const step of steps) {
    let id: string | null = null;
    if (step.type === "room.update" || step.type === "room.delete") id = step.roomId;
    else if (step.type === "furniture.update" || step.type === "furniture.delete") id = step.furnitureId;
    else if (step.type === "scene.update") id = SCENE_SETTINGS_ID;
    else if (step.type === "furniture.create") created.add(step.furniture.id);
    else if (step.type === "room.create") created.add(step.room.id);
    // Entities created earlier in the same batch have no base version to check.
    if (id && !created.has(id)) ids.add(id);
  }
  return [...ids];
}

export function entityVersion(scene: Scene, id: string): number | null {
  if (id === SCENE_SETTINGS_ID) return scene.settingsVersion;
  return scene.furniture.find((item) => item.id === id)?.version ?? scene.rooms.find((room) => room.id === id)?.version ?? null;
}

/** Base versions for an action as seen from `scene` (the client's current view). */
export function baseVersionsFor(scene: Scene, action: SceneAction): Record<string, number> {
  const versions: Record<string, number> = {};
  for (const id of touchedEntityIds(action)) {
    const version = entityVersion(scene, id);
    if (version !== null) versions[id] = version;
  }
  return versions;
}

/** Inverse-action command stack. Stores actions and their inverses, never scene snapshots. */
export type HistoryEntry = { label: string; forward: SceneAction; inverse: SceneAction };

export type SceneHistory = { past: HistoryEntry[]; future: HistoryEntry[] };

export const emptyHistory = (): SceneHistory => ({ past: [], future: [] });

export function describeAction(action: SceneAction): string {
  switch (action.type) {
    case "batch": return action.label;
    case "room.create": return "Add room";
    case "room.update":
      if (action.patch.openings) return "Edit doors & windows";
      return "Edit room";
    case "room.delete": return "Delete room";
    case "furniture.create": return `Add ${action.furniture.name}`;
    case "furniture.update":
      if (action.patch.mesh) return "Edit mesh";
      if (action.patch.light !== undefined) return "Edit light";
      if (action.patch.position) return "Move object";
      if (action.patch.yawDegrees !== undefined) return "Rotate object";
      if (action.patch.dimensions) return "Resize object";
      if (action.patch.constraints !== undefined) return "Edit constraints";
      if (action.patch.color !== undefined) return "Change material";
      return "Edit object";
    case "furniture.delete": return "Delete object";
    case "scene.update":
      if (action.patch.environment) return "Change environment";
      if (action.patch.rules) return "Change rules";
      return "Edit scene";
  }
}
