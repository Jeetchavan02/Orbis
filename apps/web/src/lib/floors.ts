import type { BaseSceneAction, FurnitureObject, Room } from "@reality-builder/shared";
import { newEntityId, useWorkspaceStore } from "../store/workspace";

/** Slab between storeys, added to the room height to get the floor-to-floor distance. */
const SLAB = 0.3;
const round = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Inserts a storey directly above or below `sourceId`, as one undoable batch.
 * Floors at or above the insertion level (and their furniture) move up by one storey,
 * so the building never goes below ground. `copy` duplicates the source's furniture and openings.
 */
export function insertFloor(sourceId: string, where: "above" | "below", copy: boolean) {
  const { scene, dispatch, setActiveRoom, selectEntity, notify } = useWorkspaceStore.getState();
  const source = scene.rooms.find((room) => room.id === sourceId);
  if (!source) return;
  const storey = round(source.dimensions.height + SLAB);
  const level = where === "above" ? round(source.position.y + storey) : source.position.y;
  const actions: BaseSceneAction[] = [];

  // Make room: lift every floor at or above the new level, with its furniture.
  for (const room of scene.rooms) {
    if (room.position.y < level - 0.01) continue;
    actions.push({ type: "room.update", roomId: room.id, patch: { position: { ...room.position, y: round(room.position.y + storey) } } });
    for (const item of scene.furniture) {
      if (item.roomId === room.id) actions.push({ type: "furniture.update", furnitureId: item.id, patch: { position: { y: round(item.position.y + storey) } } });
    }
  }

  const id = newEntityId("room");
  const floorNumber = scene.rooms.length + 1;
  const room: Room = {
    ...source,
    id,
    name: copy ? `${source.name} (copy)` : `Floor ${floorNumber}`,
    position: { ...source.position, y: level },
    openings: copy ? source.openings.map((opening) => ({ ...opening, id: newEntityId(opening.kind) })) : [],
    version: 1,
  } as Room;
  actions.push({ type: "room.create", room });
  if (copy) {
    for (const item of scene.furniture.filter((entry) => entry.roomId === source.id)) {
      const furniture: FurnitureObject = { ...item, id: newEntityId("obj"), roomId: id, position: { ...item.position, y: round(level + (item.position.y - source.position.y)) }, version: 1 };
      actions.push({ type: "furniture.create", furniture });
    }
  }

  const label = `${copy ? "Duplicate" : "Add"} floor ${where}`;
  if (dispatch({ type: "batch", label, actions }, { label })) {
    // Online edits apply when the server echoes them, so switch once the new floor exists.
    const activate = () => {
      setActiveRoom(id);
      selectEntity(id);
    };
    if (useWorkspaceStore.getState().scene.rooms.some((entry) => entry.id === id)) activate();
    else {
      const unsubscribe = useWorkspaceStore.subscribe((state) => {
        if (!state.scene.rooms.some((entry) => entry.id === id)) return;
        unsubscribe();
        activate();
      });
      window.setTimeout(unsubscribe, 10000);
    }
    notify("success", `${copy ? `Duplicated ${source.name}` : "Added an empty floor"} ${where} ${copy ? "" : source.name}`.trim() + ".");
  }
}
