import { create } from "zustand";

/** Measured each half-second inside the render loop. Isolated from the workspace store to avoid app re-renders. */
export type PerfSample = { fps: number; frameMs: number; drawCalls: number; triangles: number; geometries: number };

export const usePerfStore = create<PerfSample>(() => ({ fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, geometries: 0 }));

/** World-space floor point under a screen position; registered by the viewport for drag-and-drop placement. */
export const viewportBridge: {
  screenToFloor: ((clientX: number, clientY: number) => { x: number; z: number } | null) | null;
  /** Renders the current view and returns it as an image data URL (screenshots, project thumbnails). */
  capture: ((type: "image/png" | "image/jpeg", maxWidth?: number) => string) | null;
  /** Renders the live scene from a dedicated camera at a fixed resolution (design PDF export). Returns a JPEG data URL. */
  renderView: ((view: RenderViewSpec, width: number, height: number) => string) | null;
} = {
  screenToFloor: null,
  capture: null,
  renderView: null,
};

type Vec3 = [number, number, number];

/**
 * A camera for an offscreen render. `walls` decides what happens to walls between the camera and the room:
 * "cutaway" lowers them like the editor does, "remove" hides them entirely (straight-on elevations).
 */
export type RenderViewSpec = {
  position: Vec3;
  target: Vec3;
  up?: Vec3;
  walls: "cutaway" | "remove";
  background: string;
} & ({ kind: "perspective"; fov: number } | { kind: "ortho"; halfWidth: number; halfHeight: number });
