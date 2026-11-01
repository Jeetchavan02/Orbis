import { useEffect } from "react";
import { Settings, X } from "lucide-react";
import { useSettingsDialog } from "../../lib/ui";
import { useWorkspaceStore } from "../../store/workspace";
import { Toggle } from "./fields";
import { RulesPanel } from "./RulesPanel";

/** Project settings: validation rules (what counts as a problem) and display options. */
export function SettingsDialog() {
  const open = useSettingsDialog((state) => state.open);
  const setOpen = useSettingsDialog((state) => state.setOpen);
  const showGrid = useWorkspaceStore((state) => state.showGrid);
  const showPerf = useWorkspaceStore((state) => state.showPerf);
  const showRoutes = useWorkspaceStore((state) => state.showRoutes);
  const { setGrid, setShowPerf, setShowRoutes } = useWorkspaceStore.getState();
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
      <div className="modal settings-modal">
        <header className="settings-head">
          <h2 id="settings-title"><Settings size={17} /> Settings</h2>
          <button type="button" className="icon-button" onClick={() => setOpen(false)} aria-label="Close"><X size={16} /></button>
        </header>
        <div className="settings-grid">
          <section>
            <h3>Display</h3>
            <Toggle label="Show floor grid" checked={showGrid} onChange={(value) => setGrid({ showGrid: value })} />
            <Toggle label="Show walking routes from the door" checked={showRoutes} onChange={setShowRoutes} />
            <Toggle label="Show performance overlay (P)" checked={showPerf} onChange={setShowPerf} />
          </section>
          <section>
            <h3>Layout rules</h3>
            <p className="field-note">What the app checks for. Problems show in the Issues tab.</p>
            <RulesPanel />
          </section>
        </div>
      </div>
    </div>
  );
}
