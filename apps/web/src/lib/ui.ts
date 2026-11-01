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
/** Design PDF export dialog; `capturing` hides editor overlays in the viewport while views are rendered. */
export const useExportPdf = create<{ open: boolean; capturing: boolean; setOpen: (open: boolean) => void; setCapturing: (capturing: boolean) => void }>((set) => ({
  open: false,
  capturing: false,
  setOpen: (open) => set({ open }),
  setCapturing: (capturing) => set({ capturing }),
}));
