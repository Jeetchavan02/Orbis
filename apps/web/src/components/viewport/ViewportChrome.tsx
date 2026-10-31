import { useEffect, useRef, useState } from "react";
import { Camera, Check, Eye, Pencil, ChevronDown, Crosshair, Expand, Footprints, Grid3X3, Hand, Maximize2, MousePointer2, Move3D, RectangleHorizontal, Rotate3D, Rotate3d, Waypoints } from "lucide-react";
import { viewportBridge } from "../../lib/perf";
import { useWorkspaceStore, type TransformTool, type ViewMode } from "../../store/workspace";

export const CAMERAS: { id: ViewMode; label: string }[] = [
  { id: "perspective", label: "Perspective" },
  { id: "top", label: "Top" },
  { id: "front", label: "Front" },
  { id: "side", label: "Side" },
  { id: "iso", label: "Isometric" },
  { id: "walk", label: "Walkthrough" },
  { id: "plan", label: "Floor plan" },
];

export const TOOLS: { id: TransformTool; label: string; key: string; icon: typeof Move3D; mesh?: boolean }[] = [
  { id: "select", label: "Select", key: "Q", icon: MousePointer2 },
  { id: "translate", label: "Move", key: "W", icon: Move3D },
  { id: "rotate", label: "Rotate", key: "E", icon: Rotate3D },
  { id: "scale", label: "Scale", key: "R", icon: Maximize2 },
  { id: "vertex", label: "Vertex", key: "V", icon: Waypoints, mesh: true },
  { id: "face", label: "Face", key: "G", icon: RectangleHorizontal, mesh: true },
];

const GRID_SIZES = [0.1, 0.25, 0.5, 1];

/** Floating viewport controls: camera preset, tool pill, navigation and capture buttons, grid spacing. */
export function ViewportChrome({ container }: { container: React.RefObject<HTMLDivElement | null> }) {
  const viewMode = useWorkspaceStore((state) => state.viewMode);
  const tool = useWorkspaceStore((state) => state.tool);
  const panMode = useWorkspaceStore((state) => state.panMode);
  const showGrid = useWorkspaceStore((state) => state.showGrid);
  const gridSize = useWorkspaceStore((state) => state.gridSize);
  const showRoutes = useWorkspaceStore((state) => state.showRoutes);
  const selected = useWorkspaceStore((state) => state.scene.furniture.find((item) => item.id === state.selectedEntityId));
  const { setViewMode, setTool, setPanMode, setGrid, setShowRoutes, requestFocus, requestCameraReset, notify } = useWorkspaceStore.getState();
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const screenshot = () => {
    const image = viewportBridge.capture?.("image/png");
    if (!image) return notify("error", "The viewport isn't ready to capture yet.");
    const link = document.createElement("a");
    link.href = image;
    link.download = `${useWorkspaceStore.getState().scene.name.replace(/[^\w-]+/g, "-")}.png`;
    link.click();
    notify("success", "Screenshot saved.");
  };
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void container.current?.requestFullscreen();
  };
  const threeD = viewMode !== "plan";

  return (
    <>
      <CameraMenu viewMode={viewMode} onPick={setViewMode} />
      {viewMode === "walk" ? <WalkBar /> : null}

      <div className="vp-pill" role="toolbar" aria-label="Transform tools">
        {TOOLS.filter((entry) => !entry.mesh || selected?.mesh).map((entry) => (
          <button key={entry.id} type="button" className={tool === entry.id ? "active" : ""} aria-pressed={tool === entry.id} onClick={() => setTool(entry.id)} title={`${entry.label} (${entry.key})`}>
            <entry.icon size={16} />
          </button>
        ))}
        <span className="vp-sep" />
        <button type="button" onClick={() => (selected ? requestFocus() : requestCameraReset())} title={selected ? "Frame selection (F)" : "Frame room (H)"}><Crosshair size={16} /></button>
        <button type="button" className={showGrid ? "active" : ""} aria-pressed={showGrid} onClick={() => setGrid({ showGrid: !showGrid })} title="Toggle grid" disabled={!threeD}><Grid3X3 size={16} /></button>
        <button type="button" className={showRoutes ? "active" : ""} aria-pressed={showRoutes} onClick={() => setShowRoutes(!showRoutes)} title="Show walking routes from the door"><Footprints size={16} /></button>
      </div>

      {threeD && viewMode !== "walk" ? (
        <label className="vp-grid" title="Grid spacing">
          <Grid3X3 size={13} />
          <select aria-label="Grid spacing" value={gridSize} onChange={(event) => setGrid({ gridSize: Number(event.target.value) })}>
            {GRID_SIZES.map((size) => <option key={size} value={size}>{size < 1 ? `${size * 100} cm` : `${size} m`}</option>)}
          </select>
        </label>
      ) : null}

      <div className="vp-controls" role="toolbar" aria-label="View controls">
        {viewMode === "perspective" ? (
          <>
            <button type="button" className={panMode ? "active" : ""} aria-pressed={panMode} onClick={() => setPanMode(true)} title="Drag to pan"><Hand size={16} /></button>
            <button type="button" className={!panMode ? "active" : ""} aria-pressed={!panMode} onClick={() => setPanMode(false)} title="Drag to orbit"><Rotate3d size={16} /></button>
            <span className="vp-sep" />
          </>
        ) : null}
        <button type="button" onClick={requestCameraReset} title="Fit room to view (H)"><Expand size={16} /></button>
        <button type="button" onClick={screenshot} title="Download screenshot (PNG)" disabled={!threeD}><Camera size={16} /></button>
        <button type="button" className={fullscreen ? "active" : ""} onClick={toggleFullscreen} title="Fullscreen"><Maximize2 size={16} /></button>
      </div>
    </>
  );
}

function WalkBar() {
  const walkMode = useWorkspaceStore((state) => state.walkMode);
  const { setWalkMode } = useWorkspaceStore.getState();
  return (
    <div className="vp-walk" role="group" aria-label="Walkthrough mode">
      <div className="segmented">
        <button type="button" className={walkMode === "view" ? "active" : ""} aria-pressed={walkMode === "view"} onClick={() => setWalkMode("view")} title="Eye-level tour inside the room; objects can't be moved"><Eye size={14} /> View</button>
        <button type="button" className={walkMode === "roam" ? "active" : ""} aria-pressed={walkMode === "roam"} onClick={() => setWalkMode("roam")} title="Fly anywhere and edit objects"><Pencil size={14} /> Free roam &amp; edit</button>
      </div>
      <span className="vp-walk-keys">
        {walkMode === "view"
          ? <><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk · drag to look</>
          : <><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> fly · <kbd>E</kbd>/<kbd>Q</kbd> up/down · <kbd>Shift</kbd> fast · right-drag to look · click objects to edit</>}
      </span>
    </div>
  );
}

function CameraMenu({ viewMode, onPick }: { viewMode: ViewMode; onPick: (mode: ViewMode) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const current = CAMERAS.find((entry) => entry.id === viewMode) ?? CAMERAS[0]!;
  return (
    <div className="vp-camera" ref={ref}>
      <button type="button" className="vp-camera-trigger" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} title="Camera view">
        <Camera size={14} /> <strong>{current.label}</strong> <ChevronDown size={14} />
      </button>
      {open ? (
        <div className="vp-camera-menu" role="menu" aria-label="Camera view">
          {CAMERAS.map((entry, index) => (
            <button key={entry.id} type="button" role="menuitemradio" aria-checked={entry.id === viewMode} className={entry.id === viewMode ? "active" : ""} onClick={() => { onPick(entry.id); setOpen(false); }}>
              <span className="vp-check">{entry.id === viewMode ? <Check size={14} /> : null}</span>
              <span className="vp-label">{entry.label}</span>
              <kbd>{index + 1}</kbd>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
