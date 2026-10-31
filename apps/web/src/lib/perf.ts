import { create } from "zustand";

/** Measured each half-second inside the render loop. Isolated from the workspace store to avoid app re-renders. */
export type PerfSample = { fps: number; frameMs: number; drawCalls: number; triangles: number; geometries: number };

export const usePerfStore = create<PerfSample>(() => ({ fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, geometries: 0 }));

/** World-space floor point under a screen position; registered by the viewport for drag-and-drop placement. */
export const viewportBridge: { screenToFloor: ((clientX: number, clientY: number) => { x: number; z: number } | null) | null } = {
  screenToFloor: null,
};
