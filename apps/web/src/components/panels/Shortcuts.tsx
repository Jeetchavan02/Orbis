import { create } from "zustand";
import { Keyboard, X } from "lucide-react";
import { useAnnotate } from "../../lib/tools";

export const useShortcutHelp = create<{ open: boolean; toggle: () => void; close: () => void }>((set) => ({
  open: false,
  toggle: () => set((state) => ({ open: !state.open })),
  close: () => set({ open: false }),
}));

const GROUPS: { title: string; keys: [string, string][] }[] = [
  { title: "Tools", keys: [["A", "Select"], ["W", "Move"], ["O", "Rotate"], ["R", "Scale"], ["V", "Vertices"], ["G", "Faces"]] },
  { title: "Create", keys: [["S", "Square (box)"], ["C", "Circle (cylinder)"], ["L", "Line / measure"], ["T", "Text label"], ["E", "Extrude face"], ["⇧E", "Push face in"]] },
  { title: "Views", keys: [["1–7", "Perspective … Floor plan"], ["F", "Frame selection"], ["H", "Reset view"], ["P", "Performance"]] },
  { title: "Edit", keys: [["⌘Z / ⇧⌘Z", "Undo / redo"], ["⌘C / ⌘V", "Copy / paste"], ["⌘X", "Cut"], ["⌘D", "Duplicate"], ["Del", "Delete"], ["[ ]", "Rotate 15°"], ["Arrows", "Nudge"], ["Esc", "Cancel"]] },
];

/** Compact cheat-sheet (press ? or click the keyboard button). */
export function ShortcutHelp() {
  const open = useShortcutHelp((state) => state.open);
  const close = useShortcutHelp((state) => state.close);
  if (!open) return null;
  return (
    <div className="shortcut-card" role="dialog" aria-label="Keyboard shortcuts">
      <header><Keyboard size={15} /><strong>Shortcuts</strong><button type="button" className="icon-button" aria-label="Close" onClick={close}><X size={14} /></button></header>
      <div className="shortcut-grid">
        {GROUPS.map((group) => (
          <section key={group.title}>
            <h3>{group.title}</h3>
            {group.keys.map(([key, label]) => <div key={key + label}><kbd>{key}</kbd><span>{label}</span></div>)}
          </section>
        ))}
      </div>
    </div>
  );
}

export function ShortcutButton() {
  const toggle = useShortcutHelp((state) => state.toggle);
  return <button type="button" onClick={toggle} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts"><Keyboard size={16} /></button>;
}

/** Tells you which drawing tool is on and how to leave it. */
export function ToolBanner() {
  const mode = useAnnotate((state) => state.mode);
  const start = useAnnotate((state) => state.start);
  if (!mode) return null;
  return (
    <div className="tool-banner" role="status">
      <strong>{mode === "line" ? "Line" : "Text"}</strong>
      <span>{mode === "line" ? (start ? "Click the end point" : "Click the start point on the floor") : "Click the floor where the label goes"} · Shift = no snap · <kbd>Esc</kbd> to finish</span>
    </div>
  );
}
