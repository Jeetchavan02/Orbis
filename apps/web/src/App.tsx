import { useEffect, useState } from "react";
import {
  Activity,
  Box,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Eye,
  Grid2X2,
  Layers,
  Move3D,
  Plus,
  Rotate3D,
  Search,
  Settings2,
  Share2,
  SlidersHorizontal,
  Undo2,
  Redo2,
} from "lucide-react";
import { ApiHealthSchema, type FurnitureObject } from "@reality-builder/shared";
import { getSpatialEngineStatus } from "@reality-builder/spatial-engine";
import { SceneViewport } from "./components/SceneViewport";
import { starterScene } from "./data/scene";
import { useWorkspaceStore } from "./store/workspace";

type ApiState = "checking" | "connected" | "offline";

function PropertyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="property-value">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatMeters(value: number) {
  return value.toFixed(2) + " m";
}

function App() {
  const [apiState, setApiState] = useState<ApiState>("checking");
  const selectedEntityId = useWorkspaceStore((state) => state.selectedEntityId);
  const resetCameraSignal = useWorkspaceStore((state) => state.resetCameraSignal);
  const selectEntity = useWorkspaceStore((state) => state.selectEntity);
  const requestCameraReset = useWorkspaceStore((state) => state.requestCameraReset);
  const room = starterScene.rooms[0];
  const selectedFurniture = starterScene.furniture.find(
    (item) => item.id === selectedEntityId,
  );
  const engineStatus = getSpatialEngineStatus();

  useEffect(() => {
    let active = true;

    async function checkApi() {
      try {
        const response = await fetch("/api/health");
        if (!response.ok) throw new Error("Health request failed");
        const payload: unknown = await response.json();
        ApiHealthSchema.parse(payload);
        if (active) setApiState("connected");
      } catch {
        if (active) setApiState("offline");
      }
    }

    void checkApi();
    const interval = window.setInterval(checkApi, 15000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const handleSelect = (entityId: string) => selectEntity(entityId);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-cluster">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
          <div className="brand-copy">
            <span className="brand-name">reality builder</span>
            <span className="brand-caption">SPATIAL WORKSPACE</span>
          </div>
          <div className="topbar-divider" />
          <button className="project-switcher" type="button" title="Project menu is not implemented yet">
            <span className="project-icon"><Layers size={16} /></span>
            <span className="project-title">Quiet afternoon studio</span>
            <ChevronDown size={15} className="muted-icon" />
          </button>
          <span className="draft-pill">SAMPLE SCENE</span>
        </div>

        <div className="topbar-actions">
          <div className={"api-status api-status--" + apiState} aria-live="polite">
            <span className="status-dot" />
            <span>{apiState === "connected" ? "API connected" : apiState === "offline" ? "API offline" : "Checking API"}</span>
          </div>
          <button className="icon-button compact-hide" type="button" disabled title="Settings are not implemented yet" aria-label="Settings">
            <Settings2 size={17} />
          </button>
          <button className="share-button" type="button" disabled title="Sharing is planned for a later phase">
            <Share2 size={15} />
            <span>Share</span>
            <span className="coming-soon">LATER</span>
          </button>
          <button className="avatar-button" type="button" disabled title="Accounts are not implemented yet" aria-label="Account">
            RB
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="left-panel" aria-label="Scene sidebar">
          <div className="sidebar-tabs">
            <button className="sidebar-tab sidebar-tab--active" type="button">
              <Layers size={15} /> Scene
            </button>
            <button className="sidebar-tab" type="button" disabled title="Asset catalog is planned for a later phase">
              <Grid2X2 size={15} /> Catalog <span className="tab-later">LATER</span>
            </button>
          </div>

          <div className="scene-summary">
            <div className="scene-summary-icon"><Box size={17} /></div>
            <div className="scene-summary-copy">
              <span className="section-eyebrow">CURRENT SCENE</span>
              <strong>{starterScene.name}</strong>
            </div>
            <ChevronDown size={15} className="muted-icon" />
          </div>

          <div className="panel-section-heading">
            <span>ROOMS</span>
            <button className="tiny-icon-button" type="button" disabled title="Room creation is planned for Phase 2" aria-label="Add room">
              <Plus size={15} />
            </button>
          </div>
          <button className="room-row" type="button" onClick={() => handleSelect(room.id)}>
            <span className="room-row-icon"><Layers size={15} /></span>
            <span className="room-row-label">{room.name}</span>
            <span className="room-area">{(room.dimensions.width * room.dimensions.depth).toFixed(1)} m²</span>
          </button>

          <div className="panel-section-heading object-heading">
            <span>OBJECTS <span className="count-badge">{starterScene.furniture.length}</span></span>
            <button className="tiny-icon-button" type="button" disabled title="Object placement is planned for Phase 2" aria-label="Add object">
              <Plus size={15} />
            </button>
          </div>
          <label className="search-field">
            <Search size={15} />
            <input aria-label="Search scene objects" placeholder="Find in scene" disabled />
            <span>⌘ K</span>
          </label>

          <div className="object-list">
            {starterScene.furniture.map((item) => (
              <ObjectRow
                key={item.id}
                item={item}
                selected={selectedEntityId === item.id}
                onClick={() => handleSelect(item.id)}
              />
            ))}
          </div>

          <div className="sidebar-footer">
            <div className="engine-status-icon"><Activity size={15} /></div>
            <div>
              <strong>Spatial engine</strong>
              <span>{engineStatus.status === "scaffold" ? "Scaffold only · no validation yet" : ""}</span>
            </div>
          </div>
        </aside>

        <section className="editor-main" aria-label="3D room workspace">
          <div className="editor-toolbar">
            <div className="view-switch" aria-label="View mode">
              <button className="view-button" type="button" disabled title="2D editing is planned for Phase 2">2D</button>
              <button className="view-button view-button--active" type="button" aria-pressed="true">3D</button>
            </div>
            <span className="toolbar-divider" />
            <button className="tool-button tool-button--selected" type="button" aria-label="Select mode">
              <Eye size={16} /> <span>Select</span>
            </button>
            <button className="tool-button" type="button" disabled title="Move tools are planned for Phase 2">
              <Move3D size={16} /> <span>Move</span>
            </button>
            <button className="tool-button" type="button" disabled title="Rotation tools are planned for Phase 2">
              <Rotate3D size={16} /> <span>Rotate</span>
            </button>
            <span className="toolbar-spacer" />
            <button className="icon-button undo-button" type="button" disabled title="Undo is planned for a later phase" aria-label="Undo">
              <Undo2 size={16} />
            </button>
            <button className="icon-button undo-button" type="button" disabled title="Redo is planned for a later phase" aria-label="Redo">
              <Redo2 size={16} />
            </button>
            <span className="toolbar-divider" />
            <span className="units-label">METERS</span>
          </div>

          <div className="viewport-wrap">
            <div className="viewport-canvas">
              <SceneViewport
                room={room}
                furniture={starterScene.furniture}
                selectedEntityId={selectedEntityId}
                resetCameraSignal={resetCameraSignal}
                onSelectEntity={handleSelect}
              />
            </div>
            <div className="viewport-label">
              <span className="viewport-live-dot" />
              <span>3D PREVIEW</span>
              <span className="label-divider" />
              <span>PROXY GEOMETRY</span>
            </div>
            <div className="viewport-top-right">
              <span className="mode-tag">PERSPECTIVE</span>
              <button className="viewport-icon-button" type="button" disabled title="Grid settings are planned for Phase 2" aria-label="Grid settings">
                <Grid2X2 size={16} />
              </button>
              <button className="viewport-icon-button" type="button" disabled title="View options are planned for a later phase" aria-label="View options">
                <SlidersHorizontal size={16} />
              </button>
            </div>
            <div className="viewport-help-card">
              <span className="help-card-icon"><CircleHelp size={15} /></span>
              <span>Drag to orbit <b>·</b> Scroll to zoom <b>·</b> Right-drag to pan</span>
            </div>
            <button className="reset-view-button" onClick={requestCameraReset} type="button">
              <span className="reset-view-glyph">↺</span> Reset view
            </button>
            <div className="viewport-scale"><span /> 1 m</div>
          </div>

          <div className="editor-statusbar">
            <div className="statusbar-left">
              <span><span className="statusbar-dot" /> Scene loaded</span>
              <span className="statusbar-separator" />
              <span>{starterScene.furniture.length} objects</span>
              <span className="statusbar-separator" />
              <span>{room.name}</span>
            </div>
            <div className="statusbar-right">
              <span>Orbit controls ready</span>
              <span className="statusbar-separator" />
              <span>Phase 1 foundation</span>
            </div>
          </div>
        </section>

        <aside className="right-panel" aria-label="Properties panel">
          <div className="properties-header">
            <div>
              <span className="section-eyebrow">INSPECTOR</span>
              <h1>Properties</h1>
            </div>
            <button className="tiny-icon-button" type="button" disabled title="Panel controls are not implemented yet" aria-label="Panel options">
              <SlidersHorizontal size={15} />
            </button>
          </div>

          {selectedFurniture ? (
            <FurnitureProperties item={selectedFurniture} />
          ) : selectedEntityId === room.id ? (
            <RoomProperties room={room} />
          ) : (
            <div className="empty-selection">
              <div className="empty-selection-icon"><Box size={20} /></div>
              <strong>Nothing selected</strong>
              <span>Select an object in the scene or from the list.</span>
            </div>
          )}

          <div className="properties-divider" />
          <div className="inspector-section">
            <div className="inspector-section-title">
              <span>TRANSFORM</span>
              <span className="read-only-pill">READ ONLY</span>
            </div>
            <p className="inspector-hint">Editing controls are planned for Phase 2.</p>
          </div>

          <div className="inspector-section spatial-card">
            <div className="spatial-card-title">
              <span className="spatial-icon"><Activity size={15} /></span>
              <div><strong>Spatial checks</strong><span>Not available yet</span></div>
            </div>
            <p>The engine package is a scaffold. Room boundaries, collisions, clearances, and pathways are not validated yet.</p>
            <div className="spatial-card-footer"><span /> VALIDATION · PHASE 2</div>
          </div>

          <div className="inspector-bottom-note">
            <span className="note-mark">i</span>
            <span>Sample scene data is loaded from a deterministic fixture. Changes are not saved.</span>
          </div>
        </aside>
      </div>
    </main>
  );
}

function ObjectRow({
  item,
  selected,
  onClick,
}: {
  item: FurnitureObject;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={"object-row" + (selected ? " object-row--selected" : "")}
      type="button"
      onClick={onClick}
      aria-pressed={selected}
    >
      <span className={"object-swatch swatch--" + item.category} />
      <span className="object-row-copy">
        <strong>{item.name}</strong>
        <span>{item.category}</span>
      </span>
      {selected ? <span className="selected-indicator" /> : <ChevronRight size={14} className="row-chevron" />}
    </button>
  );
}

function FurnitureProperties({ item }: { item: FurnitureObject }) {
  return (
    <>
      <div className="selected-entity-card">
        <span className={"large-swatch swatch--" + item.category} />
        <div className="selected-entity-copy">
          <strong>{item.name}</strong>
          <span>{item.category} · sample item</span>
        </div>
        <button className="tiny-icon-button" type="button" disabled title="Visibility controls are planned for a later phase" aria-label="Visibility">
          <Eye size={15} />
        </button>
      </div>
      <div className="inspector-section">
        <div className="inspector-section-title"><span>DIMENSIONS</span><span className="unit-caption">m</span></div>
        <div className="property-grid">
          <PropertyValue label="Width" value={formatMeters(item.dimensions.width)} />
          <PropertyValue label="Depth" value={formatMeters(item.dimensions.depth)} />
          <PropertyValue label="Height" value={formatMeters(item.dimensions.height)} />
          <PropertyValue label="Yaw" value={item.yawDegrees.toFixed(1) + "°"} />
        </div>
      </div>
      <div className="inspector-section">
        <div className="inspector-section-title"><span>POSITION</span><span className="unit-caption">m</span></div>
        <div className="property-grid">
          <PropertyValue label="X" value={formatMeters(item.position.x)} />
          <PropertyValue label="Y" value={formatMeters(item.position.y)} />
          <PropertyValue label="Z" value={formatMeters(item.position.z)} />
        </div>
      </div>
    </>
  );
}

function RoomProperties({ room }: { room: (typeof starterScene.rooms)[number] }) {
  return (
    <>
      <div className="selected-entity-card">
        <span className="large-swatch swatch--room"><Layers size={16} /></span>
        <div className="selected-entity-copy">
          <strong>{room.name}</strong>
          <span>room · sample scene</span>
        </div>
        <button className="tiny-icon-button" type="button" disabled title="Visibility controls are planned for a later phase" aria-label="Visibility">
          <Eye size={15} />
        </button>
      </div>
      <div className="inspector-section">
        <div className="inspector-section-title"><span>ROOM SIZE</span><span className="unit-caption">m</span></div>
        <div className="property-grid">
          <PropertyValue label="Width" value={formatMeters(room.dimensions.width)} />
          <PropertyValue label="Depth" value={formatMeters(room.dimensions.depth)} />
          <PropertyValue label="Height" value={formatMeters(room.dimensions.height)} />
          <PropertyValue label="Wall" value={formatMeters(room.dimensions.wallThickness)} />
        </div>
      </div>
    </>
  );
}

export default App;
