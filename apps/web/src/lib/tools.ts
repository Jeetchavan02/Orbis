import { create } from "zustand";
import { createBoxMesh, createCylinderMesh, extrudeFace, type Annotation, type FurnitureObject } from "@reality-builder/shared";
import { catalogById } from "../data/catalog";
import { activeRoom, freeSpot } from "./placement";
import { newEntityId, useWorkspaceStore } from "../store/workspace";
import { commitMesh } from "../components/viewport/MeshEditor";

/** Drawing tools for floor annotations. `start` is the first click of a line; `pending` is where a label goes. */
type AnnotateState = {
  mode: "line" | "text" | null;
  start: { x: number; z: number } | null;
  hover: { x: number; z: number } | null;
  pending: { x: number; z: number; clientX: number; clientY: number } | null;
  set: (patch: Partial<Omit<AnnotateState, "set">>) => void;
};
export const useAnnotate = create<AnnotateState>((set) => ({ mode: null, start: null, hover: null, pending: null, set: (patch) => set(patch) }));

export function startAnnotating(mode: "line" | "text") {
  const { mode: current, set } = useAnnotate.getState();
  if (current === mode) return set({ mode: null, start: null, hover: null, pending: null });
  set({ mode, start: null, hover: null, pending: null });
  useWorkspaceStore.getState().notify("info", mode === "line" ? "Line: click two points on the floor to measure. Esc to stop." : "Text: click the floor where the label goes. Esc to stop.");
}

export function addAnnotation(annotation: Omit<Annotation, "id" | "color"> & { color?: string }) {
  const { scene, dispatch } = useWorkspaceStore.getState();
  const next: Annotation = { id: newEntityId("ann"), color: "#6a3de8", ...annotation };
  dispatch({ type: "scene.update", patch: { annotations: [...(scene.annotations ?? []), next] } }, { label: annotation.kind === "line" ? "Add measurement" : "Add label" });
}

export function removeAnnotation(id: string) {
  const { scene, dispatch } = useWorkspaceStore.getState();
  dispatch({ type: "scene.update", patch: { annotations: (scene.annotations ?? []).filter((entry) => entry.id !== id) } }, { label: "Remove annotation" });
}

/** S / C: drop an editable box or cylinder at the nearest free spot in the active room and select it. */
export function addShape(kind: "square" | "circle") {
  const { scene, dispatch, selectEntity, setTool, notify } = useWorkspaceStore.getState();
  const room = activeRoom(scene);
  const footprint = catalogById("box");
  if (!room || !footprint) return;
  const dimensions = kind === "square" ? { width: 0.6, depth: 0.6, height: 0.6 } : { width: 0.6, depth: 0.6, height: 0.75 };
  const pose = freeSpot({ ...footprint, dimensions }, room, scene);
  const furniture: FurnitureObject = {
    id: newEntityId("obj"),
    roomId: room.id,
    name: kind === "square" ? "Box" : "Cylinder",
    category: "other",
    catalogItemId: kind === "square" ? "box" : "shape-cylinder",
    position: { x: pose.x, y: room.position.y, z: pose.z },
    yawDegrees: 0,
    dimensions,
    color: kind === "square" ? "#a9b3c2" : "#b6a7d9",
    mesh: kind === "square" ? createBoxMesh(dimensions) : createCylinderMesh(dimensions),
    version: 1,
  };
  if (dispatch({ type: "furniture.create", furniture }, { label: "Add " + furniture.name.toLowerCase() })) {
    selectEntity(furniture.id);
    setTool("select");
    notify("info", `${furniture.name} added. Press E, click a face, then E again to extrude.`);
  }
}

/**
 * E: extrude. On a plain object it first becomes an editable mesh and Face mode opens; with a face selected,
 * E pushes it out 10 cm (Shift+E pulls it in).
 */
export function extrudeShortcut(inward: boolean) {
  const state = useWorkspaceStore.getState();
  const item = state.scene.furniture.find((entry) => entry.id === state.selectedEntityId);
  if (!item) return state.notify("info", "Select an object first, then press E to extrude one of its faces.");
  if (item.constraints?.locked) return state.notify("info", `${item.name} is locked.`);
  if (!item.mesh) {
    const converted = state.dispatch({ type: "furniture.update", furnitureId: item.id, patch: { mesh: createBoxMesh(item.dimensions) } }, { base: { [item.id]: item.version }, label: "Convert to mesh" });
    if (converted) {
      state.setTool("face");
      state.notify("info", "Now editable. Click a face, then press E to extrude it.");
    }
    return;
  }
  if (state.tool !== "face" || !state.mesh.face) {
    state.setTool("face");
    return state.notify("info", "Click a face, then press E to extrude it (Shift+E pulls it in).");
  }
  try {
    commitMesh(item, extrudeFace(item.mesh, state.mesh.face, inward ? -0.1 : 0.1), inward ? "Push face in" : "Extrude face");
    state.setMeshSelection({ face: null });
  } catch (error) {
    state.notify("error", (error as Error).message);
  }
}
