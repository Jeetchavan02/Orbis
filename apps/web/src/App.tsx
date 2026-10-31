import { useEffect, useState } from "react";
import {
  Redo2,
  Undo2,
  CircleAlert,
  Copy,
  Crosshair,
  Footprints,
  Lock,
  Maximize2,
  MousePointer2,
  Move3D,
  RectangleHorizontal,
  Rotate3D,
  RotateCw,
  SlidersHorizontal,
  Trash2,
  Unlock,
  Waypoints,
} from "lucide-react";
import { SceneViewport } from "./components/SceneViewport";
import { FloorPlan } from "./components/FloorPlan";
import { duplicate, Inspector } from "./components/panels/Inspector";
import { AiPanel } from "./components/panels/AiPanel";
import { InsightsPanel } from "./components/panels/InsightsPanel";
import { IssuesPanel } from "./components/panels/IssuesPanel";
import { LeftPanel } from "./components/panels/LeftPanel";
import { dragging, LIBRARY_DRAG_TYPE } from "./components/panels/Library";
import { poseAt } from "./components/viewport/Placement";
import { placeEntry, usePlacement } from "./lib/placement";
import { ConflictDialog, Notices, OfflineDialog, PerfOverlay, ShareDialog } from "./components/panels/Overlays";
import { RulesPanel } from "./components/panels/RulesPanel";
import { TopBar } from "./components/panels/TopBar";
import { useContextMenu } from "./lib/ui";
import { useWorkspaceStore, type TransformTool } from "./store/workspace";

type RightTab = "properties" | "issues" | "rules" | "insights" | "ai";

const TOOLS: { id: TransformTool; label: string; key: string; icon: typeof Move3D; mesh?: boolean }[] = [
  { id: "select", label: "Drag", key: "Q", icon: MousePointer2 },
  { id: "translate", label: "Axis move", key: "W", icon: Move3D },
  { id: "rotate", label: "Axis rotate", key: "E", icon: Rotate3D },
  { id: "scale", label: "Resize", key: "R", icon: Maximize2 },
  { id: "vertex", label: "Vertex", key: "V", icon: Waypoints, mesh: true },
  { id: "face", label: "Face", key: "G", icon: RectangleHorizontal, mesh: true },
];

function deleteSelected() {
  const { scene, selectedEntityId, dispatch, selectEntity } = useWorkspaceStore.getState();
  const item = scene.furniture.find((entry) => entry.id === selectedEntityId);
  if (item && dispatch({ type: "furniture.delete", furnitureId: item.id }, { base: { [item.id]: item.version } })) selectEntity("");
}

function rotateSelected(degrees: number) {
  const { scene, selectedEntityId, dispatch } = useWorkspaceStore.getState();
  const item = scene.furniture.find((entry) => entry.id === selectedEntityId);
  if (item) dispatch({ type: "furniture.update", furnitureId: item.id, patch: { yawDegrees: (((item.yawDegrees + degrees) % 360) + 360) % 360 } });
}

export default function App() {
  const [rightTab, setRightTab] = useState<RightTab>("properties");
  const scene = useWorkspaceStore((state) => state.scene);
  const tool = useWorkspaceStore((state) => state.tool);
  const selectedId = useWorkspaceStore((state) => state.selectedEntityId);
  const validation = useWorkspaceStore((state) => state.validation);
  const history = useWorkspaceStore((state) => state.history);
  const showRoutes = useWorkspaceStore((state) => state.showRoutes);
  const connection = useWorkspaceStore((state) => state.connection);
  const peers = useWorkspaceStore((state) => state.peers);
  const contextMenu = useContextMenu((state) => state.menu);
  const viewMode = useWorkspaceStore((state) => state.viewMode);
  const { setViewMode } = useWorkspaceStore.getState();
  const { setTool, selectEntity, requestCameraReset, requestFocus, setShowRoutes } = useWorkspaceStore.getState();

  const selected = scene.furniture.find((item) => item.id === selectedId);
  const selectedRoom = scene.rooms.find((room) => room.id === selectedId);
  const issues = validation?.issues ?? [];
  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;
      const state = useWorkspaceStore.getState();
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (mod && key === "z") {
        event.preventDefault();
        if (event.shiftKey) state.redo();
        else state.undo();
      } else if (mod && key === "y") {
        event.preventDefault();
        state.redo();
      } else if (mod && key === "s") {
        event.preventDefault();
        state.save();
      } else if (mod && key === "d") {
        event.preventDefault();
        const item = state.scene.furniture.find((entry) => entry.id === state.selectedEntityId);
        if (item) duplicate(item);
      } else if (key === "delete" || key === "backspace") {
        deleteSelected();
      } else if (key === "escape") {
        useContextMenu.getState().close();
        if (state.tool === "vertex" || state.tool === "face") state.setTool("translate");
        else state.selectEntity("");
      } else if (!mod && key === "f") {
        if (state.selectedEntityId) state.requestFocus();
        else state.requestCameraReset();
      } else if (!mod && key === "h") {
        state.requestCameraReset();
      } else if (!mod && (key === "1" || key === "2" || key === "3")) {
        state.setViewMode(key === "1" ? "plan" : key === "2" ? "2d" : "3d");
      } else if (!mod && key === "p") {
        state.setShowPerf(!state.showPerf);
      } else if (key.startsWith("arrow") && state.selectedEntityId) {
        const item = state.scene.furniture.find((entry) => entry.id === state.selectedEntityId);
        if (!item || item.constraints?.locked) return;
        event.preventDefault();
        const step = event.shiftKey ? 0.25 : 0.05;
        const dx = key === "arrowleft" ? -step : key === "arrowright" ? step : 0;
        const dz = key === "arrowup" ? -step : key === "arrowdown" ? step : 0;
        state.dispatch({ type: "furniture.update", furnitureId: item.id, patch: { position: { x: Math.round((item.position.x + dx) * 1000) / 1000, z: Math.round((item.position.z + dz) * 1000) / 1000 } } });
      } else if (!mod && key === "[") {
        rotateSelected(-15);
      } else if (!mod && key === "]") {
        rotateSelected(15);
      } else if (!mod) {
        const match = TOOLS.find((entry) => entry.key.toLowerCase() === key);
        if (!match) return;
        const item = state.scene.furniture.find((entry) => entry.id === state.selectedEntityId);
        if (match.mesh && !item?.mesh) {
          state.notify("info", "Select an object and use “Convert to editable mesh” in the inspector first.");
          return;
        }
        state.setTool(match.id);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => useContextMenu.getState().close();
    window.addEventListener("mousedown", close);
    window.addEventListener("wheel", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("wheel", close);
    };
  }, [contextMenu]);

  const contextItem = contextMenu ? scene.furniture.find((item) => item.id === contextMenu.id) : undefined;
  const peerCount = peers.length;

  return (
    <main className="app-shell">
      <TopBar />
      <div className="workspace">
        <LeftPanel />

        <section className="editor-main" aria-label="3D workspace">
          <div className="editor-toolbar">
            <div className="segmented view-toggle" role="radiogroup" aria-label="View mode">
              {([["plan", "Floor plan", "Architectural floor plan with door swings (1)"], ["2d", "2D", "2D top view (2)"], ["3d", "3D", "3D view (3)"]] as const).map(([mode, label, tip]) => (
                <button key={mode} type="button" role="radio" aria-checked={viewMode === mode} className={viewMode === mode ? "active" : ""} onClick={() => setViewMode(mode)} title={tip}>
                  {label}
                </button>
              ))}
            </div>
            <span className="toolbar-divider" />
            <div className="tool-group">
              {TOOLS.map((entry) => {
                const disabled = entry.mesh && !selected?.mesh;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    className={"tool-button" + (tool === entry.id ? " tool-button--active" : "")}
                    onClick={() => setTool(entry.id)}
                    disabled={disabled}
                    aria-pressed={tool === entry.id}
                    aria-label={entry.label}
                    title={`${entry.label} (${entry.key})${disabled ? " — convert the object to an editable mesh first" : ""}`}
                  >
                    <entry.icon size={15} /> <span>{entry.label}</span>
                  </button>
                );
              })}
            </div>
            <span className="toolbar-divider" />
            <button type="button" className="tool-button" onClick={() => selected && duplicate(selected)} disabled={!selected} title="Duplicate (⌘D)" aria-label="Duplicate"><Copy size={15} /> <span>Duplicate</span></button>
            <button type="button" className="tool-button" onClick={deleteSelected} disabled={!selected} title="Delete (Del)" aria-label="Delete"><Trash2 size={15} /> <span>Delete</span></button>
            <span className="toolbar-divider" />
            <button type="button" className="tool-button" onClick={() => useWorkspaceStore.getState().undo()} disabled={history.past.length === 0} title={history.past.length ? `Undo ${history.past.at(-1)!.label} (⌘Z)` : "Nothing to undo"} aria-label="Undo"><Undo2 size={15} /> <span>Undo</span></button>
            <button type="button" className="tool-button" onClick={() => useWorkspaceStore.getState().redo()} disabled={history.future.length === 0} title={history.future.length ? `Redo ${history.future[0]!.label} (⇧⌘Z)` : "Nothing to redo"} aria-label="Redo"><Redo2 size={15} /> <span>Redo</span></button>
            <span className="toolbar-spacer" />
            <button type="button" className={"tool-button" + (showRoutes ? " tool-button--active" : "")} onClick={() => setShowRoutes(!showRoutes)} title="Show A* walking routes from the door" aria-label="Walking routes"><Footprints size={15} /> <span>Routes</span></button>
            <button type="button" className="tool-button" onClick={() => (selected ? requestFocus() : requestCameraReset())} title="Frame selection (F) · Reset view (H)"><Crosshair size={15} /> <span>{selected ? "Frame" : "Reset view"}</span></button>
          </div>

          <div
            className="viewport-wrap"
            onDragOver={(event) => {
              if (!event.dataTransfer.types.includes(LIBRARY_DRAG_TYPE) || !dragging.id) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
              // Live 3D preview of the exact item under the pointer.
              usePlacement.getState().update(poseAt(dragging.id, event.clientX, event.clientY));
            }}
            onDragLeave={() => usePlacement.getState().update(null)}
            onDrop={(event) => {
              const id = event.dataTransfer.getData(LIBRARY_DRAG_TYPE);
              if (!id) return;
              event.preventDefault();
              const pose = poseAt(id, event.clientX, event.clientY);
              placeEntry(id, pose ? { x: pose.x, z: pose.z } : undefined);
              usePlacement.getState().cancel();
            }}
            onContextMenu={(event) => event.preventDefault()}
          >
            <div className="viewport-canvas"><SceneViewport /></div>
            {viewMode === "plan" ? <FloorPlan /> : null}
            <PerfOverlay />
            {tool === "vertex" || tool === "face" ? (
              <div className="mode-banner">
                Editing mesh · {tool === "vertex" ? "click a vertex, drag the gizmo" : "click a face, then Extrude in the inspector"} · <kbd>Esc</kbd> to exit
              </div>
            ) : null}
            {selected && tool !== "vertex" && tool !== "face" ? (
              <div className="quick-bar" aria-label="Selection quick actions">
                <strong>{selected.name}</strong>
                <span>{selected.dimensions.width.toFixed(2)} × {selected.dimensions.depth.toFixed(2)} × {selected.dimensions.height.toFixed(2)} m</span>
                <button type="button" onClick={() => rotateSelected(-90)} title="Rotate −90°"><RotateCw size={13} style={{ transform: "scaleX(-1)" }} /></button>
                <button type="button" onClick={() => rotateSelected(90)} title="Rotate +90° ( ] rotates 15°)"><RotateCw size={13} /></button>
                <button type="button" onClick={() => setRightTab("properties")} title="Open properties"><SlidersHorizontal size={13} /></button>
              </div>
            ) : null}
            {!selected ? <div className="viewport-hint">{viewMode === "2d" ? "Drag furniture to move it · drag empty space to pan · scroll to zoom · press 3 for 3D" : "Drag furniture to move it · drag empty space to orbit · right-drag to pan · scroll to zoom · press 2 for plan"}</div> : null}
            {contextMenu && contextItem ? (
              <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onMouseDown={(event) => event.stopPropagation()} role="menu">
                <div className="context-title">{contextItem.name}</div>
                <button type="button" role="menuitem" onClick={() => { duplicate(contextItem); useContextMenu.getState().close(); }}><Copy size={13} /> Duplicate <kbd>⌘D</kbd></button>
                <button type="button" role="menuitem" onClick={() => { rotateSelected(90); useContextMenu.getState().close(); }}><RotateCw size={13} /> Rotate 90°</button>
                <button type="button" role="menuitem" onClick={() => { requestFocus(); useContextMenu.getState().close(); }}><Crosshair size={13} /> Frame <kbd>F</kbd></button>
                <button type="button" role="menuitem" onClick={() => {
                  useWorkspaceStore.getState().dispatch({ type: "furniture.update", furnitureId: contextItem.id, patch: { constraints: { ...contextItem.constraints, locked: !contextItem.constraints?.locked } } });
                  useContextMenu.getState().close();
                }}>{contextItem.constraints?.locked ? <Unlock size={13} /> : <Lock size={13} />} {contextItem.constraints?.locked ? "Unlock" : "Lock"}</button>
                <span className="menu-sep" />
                <button type="button" role="menuitem" className="danger" onClick={() => { deleteSelected(); useContextMenu.getState().close(); }}><Trash2 size={13} /> Delete <kbd>Del</kbd></button>
              </div>
            ) : null}
          </div>

          <footer className="statusbar">
            <span>{TOOLS.find((entry) => entry.id === tool)!.label} tool</span>
            <span className="sep" />
            <span>{selected ? selected.name : selectedRoom ? selectedRoom.name : "No selection"}</span>
            <span className="sep" />
            <span>{scene.furniture.length.toLocaleString()} objects</span>
            <span className="sep" />
            <button type="button" className={"status-validation status-validation--" + (errorCount ? "error" : warningCount ? "warning" : "ok")} onClick={() => setRightTab("issues")}>
              <CircleAlert size={12} />
              {validation ? (issues.length ? `${errorCount} errors · ${warningCount} warnings` : "Layout valid") : "Validating…"}
              {validation ? <small>{validation.stats.durationMs.toFixed(1)} ms</small> : null}
            </button>
            <span className="statusbar-spacer" />
            <span>{history.past.length} undo · {history.future.length} redo</span>
            <span className="sep" />
            <span>{connection === "online" ? `${peerCount} in session` : connection === "offline" ? "Offline (local)" : "Connecting…"}</span>
          </footer>
        </section>

        <aside className="right-panel" aria-label="Inspector">
          <div className="panel-tabs">
            <button type="button" className={rightTab === "properties" ? "active" : ""} onClick={() => setRightTab("properties")}>Properties</button>
            <button type="button" className={rightTab === "issues" ? "active" : ""} onClick={() => setRightTab("issues")}>
              Issues {issues.length ? <span className={"tab-count tab-count--" + (errorCount ? "error" : "warning")}>{issues.length}</span> : null}
            </button>
            <button type="button" className={rightTab === "rules" ? "active" : ""} onClick={() => setRightTab("rules")}>Rules</button>
            <button type="button" className={rightTab === "insights" ? "active" : ""} onClick={() => setRightTab("insights")}>Insights</button>
            <button type="button" className={rightTab === "ai" ? "active" : ""} onClick={() => setRightTab("ai")}>AI</button>
          </div>
          {rightTab === "properties" ? <Inspector /> : rightTab === "issues" ? <IssuesPanel /> : rightTab === "rules" ? <RulesPanel /> : rightTab === "insights" ? <InsightsPanel /> : <AiPanel />}
        </aside>
      </div>
      <ConflictDialog />
      <ShareDialog />
      <OfflineDialog />
      <Notices />
    </main>
  );
}
