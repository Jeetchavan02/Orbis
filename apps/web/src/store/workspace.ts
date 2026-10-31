import { create } from "zustand";

type WorkspaceStore = {
  selectedEntityId: string;
  resetCameraSignal: number;
  selectEntity: (entityId: string) => void;
  requestCameraReset: () => void;
};

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  selectedEntityId: "furniture-sofa",
  resetCameraSignal: 0,
  selectEntity: (selectedEntityId) => set({ selectedEntityId }),
  requestCameraReset: () => set((state) => ({
    resetCameraSignal: state.resetCameraSignal + 1,
  })),
}));
