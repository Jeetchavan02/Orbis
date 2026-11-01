import { create } from "zustand";

/** Viewport right-click menu state (screen position + target object). */
export const useContextMenu = create<{ menu: { x: number; y: number; id: string } | null; open: (x: number, y: number, id: string) => void; close: () => void }>((set) => ({
  menu: null,
  open: (x, y, id) => set({ menu: { x, y, id } }),
  close: () => set({ menu: null }),
}));

export const useShareDialog = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({ open: false, setOpen: (open) => set({ open }) }));
export const usePhotoDialog = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({ open: false, setOpen: (open) => set({ open }) }));
export const useAskAi = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({ open: false, setOpen: (open) => set({ open }) }));
export const useSettingsDialog = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({ open: false, setOpen: (open) => set({ open }) }));
