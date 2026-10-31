import { useRef, useState } from "react";
import { Box, Copy, DoorOpen, Lightbulb, Lock, Plus, RectangleHorizontal, Spline, Trash2, Unlock, Waypoints } from "lucide-react";
import {
  createBoxMesh,
  extrudeFace,
  type FurnitureObject,
  type FurniturePatch,
  type LightFixture,
  type Opening,
  type Room,
  type RoomPatch,
  type WallSide,
} from "@reality-builder/shared";
import { requiredFrontClearance } from "@reality-builder/spatial-engine";
import { catalogById, CATEGORY_LABELS, GROUPS, ROOM_TYPES, type CatalogItem } from "../../data/catalog";
import { placeEntry, usePlacement } from "../../lib/placement";
import { useThumbnail } from "../../lib/thumbnails";
import { GroupIcon } from "./Library";
import { newEntityId, useWorkspaceStore } from "../../store/workspace";
import { commitMesh } from "../viewport/MeshEditor";
import { ColorField, NumberField, Section, Toggle } from "./fields";

/** Details of a library item the user just picked (before it is placed). */
function CatalogDetails({ entry }: { entry: CatalogItem }) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const thumbnail = useThumbnail(entry, element);
  const roomLabels = ROOM_TYPES.filter((room) => entry.rooms.includes(room.id)).map((room) => room.label);
  const clearance = entry.constraints?.frontClearance ?? useWorkspaceStore.getState().scene.rules.categoryClearance[entry.category] ?? 0;
  const { width, depth, height } = entry.dimensions;
  return (
    <div className="inspector-scroll">
      <div ref={setElement} className="catalog-preview">{thumbnail ? <img src={thumbnail} alt={entry.name} /> : <GroupIcon group={entry.group} size={40} />}</div>
      <div className="entity-card">
        <div className="entity-card-copy">
          <strong>{entry.name}</strong>
          <span className="catalog-group"><GroupIcon group={entry.group} size={13} /> {GROUPS[entry.group].label} · library item</span>
        </div>
      </div>
      <Section title="Dimensions">
        <div className="spec-grid">
          <span>Width</span><strong>{width.toFixed(2)} m</strong>
          <span>Depth</span><strong>{depth.toFixed(2)} m</strong>
          <span>Height</span><strong>{height.toFixed(2)} m</strong>
          {entry.elevation ? <><span>Mounted at</span><strong>{entry.elevation.toFixed(2)} m</strong></> : null}
        </div>
      </Section>
      <Section title="Details">
        <div className="spec-grid">
          <span>Material</span><strong><span className="spec-swatch" style={{ background: entry.color }} /> {entry.color.toUpperCase()}</strong>
          {entry.opening ? <><span>Type</span><strong>{entry.opening.kind === "door" ? "Door (wall opening)" : "Window (wall opening)"}</strong></> : null}
          {!entry.opening ? <><span>Front clearance</span><strong>{entry.constraints?.floorCovering ? "None (floor covering)" : clearance > 0 ? `${clearance.toFixed(2)} m` : "None"}</strong></> : null}
          {entry.light ? <><span>Light</span><strong>{entry.light.kind === "spot" ? "Spotlight" : "Point light"}, {entry.light.intensity} cd</strong></> : null}
        </div>
        {roomLabels.length ? <div className="room-chips">{roomLabels.map((label) => <span key={label}>{label}</span>)}</div> : null}
      </Section>
      <p className="field-note">{entry.opening ? "Click a spot near a wall to add it there, or drag it onto the room." : "Click the floor to place it, drag it into the room, or use the button below."}</p>
      <div className="inspector-actions">
        <button type="button" className="ghost-button" onClick={() => usePlacement.getState().cancel()}>Cancel</button>
        <button type="button" className="primary-button" onClick={() => { usePlacement.getState().cancel(); placeEntry(entry.id); }}><Plus size={14} /> Place in room</button>
      </div>
    </div>
  );
}

export function Inspector() {
  const scene = useWorkspaceStore((state) => state.scene);
  const selectedId = useWorkspaceStore((state) => state.selectedEntityId);
  const pickedId = usePlacement((state) => state.entryId);
  const item = scene.furniture.find((entry) => entry.id === selectedId);
  const room = scene.rooms.find((entry) => entry.id === selectedId);
  const picked = catalogById(pickedId ?? undefined);

  // A freshly picked library item takes precedence until it is placed or cancelled.
  if (picked) return <CatalogDetails key={picked.id} entry={picked} />;
  if (item) return <ObjectInspector key={item.id} item={item} />;
  if (room) return <RoomInspector key={room.id} room={room} />;
  return (
    <div className="empty-state">
      <div className="empty-state-icon"><Box size={20} /></div>
      <strong>Nothing selected</strong>
      <span>Click an object in the viewport or the scene list. Drag items in from the Library.</span>
      {scene.rooms.length ? (
        <button type="button" className="ghost-button" onClick={() => useWorkspaceStore.getState().selectEntity(useWorkspaceStore.getState().activeRoomId)}>
          Edit room, doors & windows
        </button>
      ) : null}
    </div>
  );
}

function ObjectInspector({ item }: { item: FurnitureObject }) {
  const scene = useWorkspaceStore((state) => state.scene);
  const validation = useWorkspaceStore((state) => state.validation);
  const tool = useWorkspaceStore((state) => state.tool);
  const meshSelection = useWorkspaceStore((state) => state.mesh);
  const { dispatch, setTool, selectEntity } = useWorkspaceStore.getState();
  const base = useRef<Record<string, number> | undefined>(undefined);
  const [name, setName] = useState(item.name);
  const [extrudeDistance, setExtrudeDistance] = useState(0.1);
  const [lockAspect, setLockAspect] = useState(false);
  const resize = (axis: "width" | "depth" | "height", value: number) => {
    if (!lockAspect) return patch({ dimensions: { [axis]: value } });
    const ratio = value / item.dimensions[axis];
    const round = (n: number) => Math.round(n * 1000) / 1000;
    patch({ dimensions: { width: round(item.dimensions.width * ratio), depth: round(item.dimensions.depth * ratio), height: round(item.dimensions.height * ratio) } });
  };

  const begin = () => {
    base.current = { [item.id]: item.version };
  };
  const patch = (value: FurniturePatch) => {
    dispatch({ type: "furniture.update", furnitureId: item.id, patch: value }, { base: base.current });
    base.current = undefined;
  };
  const issues = (validation?.issues ?? []).filter((issue) => issue.objectIds.includes(item.id));
  const locked = !!item.constraints?.locked;
  const clearance = requiredFrontClearance(scene, item);
  // Elevation is shown relative to the object's floor (scenes can have several storeys).
  const floorY = scene.rooms.find((room) => room.id === item.roomId)?.position.y ?? 0;

  return (
    <div className="inspector-scroll">
      <div className="entity-card">
        <span className={"swatch swatch--" + item.category} style={{ background: item.color }} />
        <div className="entity-card-copy">
          <input
            className="name-input"
            aria-label="Object name"
            value={name}
            onFocus={begin}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => (name.trim() && name !== item.name ? patch({ name: name.trim() }) : setName(item.name))}
            onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
          />
          <span>{CATEGORY_LABELS[item.category]} · v{item.version}{item.mesh ? ` · ${item.mesh.source === "imported" ? "imported mesh" : "editable mesh"}` : ""}</span>
        </div>
        <button type="button" className="icon-button" title={locked ? "Unlock (recovery may move it)" : "Lock (recovery will not move it)"} onClick={() => patch({ constraints: { ...item.constraints, locked: !locked } })}>
          {locked ? <Lock size={15} /> : <Unlock size={15} />}
        </button>
      </div>

      <Section title="Transform">
        <div className="xyz-label">Position <small>m</small></div>
        <div className="field-grid field-grid--3 xyz">
          <NumberField label="X" value={item.position.x} onBegin={begin} onCommit={(x) => patch({ position: { x } })} disabled={locked} />
          <NumberField label="Y" value={item.position.y - floorY} min={0} onBegin={begin} onCommit={(y) => patch({ position: { y: Math.round((floorY + y) * 1000) / 1000 } })} disabled={locked} />
          <NumberField label="Z" value={item.position.z} onBegin={begin} onCommit={(z) => patch({ position: { z } })} disabled={locked} />
        </div>
        <div className="xyz-label">Rotation <small>yaw about the vertical axis</small></div>
        <div className="field-grid field-grid--3 xyz">
          <NumberField label="Y" suffix="°" step={15} value={item.yawDegrees} onBegin={begin} onCommit={(yawDegrees) => patch({ yawDegrees })} disabled={locked} />
        </div>
        <div className="xyz-label">
          Size <small>m</small>
          <button type="button" className={"tiny-icon" + (lockAspect ? " tiny-icon--active" : "")} aria-pressed={lockAspect} onClick={() => setLockAspect(!lockAspect)} title={lockAspect ? "Proportions locked" : "Lock proportions"}>{lockAspect ? <Lock size={12} /> : <Unlock size={12} />}</button>
        </div>
        <div className="field-grid field-grid--3 xyz">
          <NumberField label="X" value={item.dimensions.width} min={0.02} onBegin={begin} onCommit={(value) => resize("width", value)} />
          <NumberField label="Y" value={item.dimensions.height} min={0.01} onBegin={begin} onCommit={(value) => resize("height", value)} />
          <NumberField label="Z" value={item.dimensions.depth} min={0.02} onBegin={begin} onCommit={(value) => resize("depth", value)} />
        </div>
      </Section>

      <Section title="Material">
        <select className="material-select" aria-label="Material finish" value={MATERIALS.find((entry) => entry.color.toLowerCase() === (item.color ?? "").toLowerCase())?.color ?? ""} onChange={(event) => event.target.value && patch({ color: event.target.value })}>
          <option value="">Custom colour</option>
          {MATERIALS.map((entry) => <option key={entry.color} value={entry.color}>{entry.name}</option>)}
        </select>
        <div className="swatch-row">
          {MATERIALS.map((entry) => (
            <button key={entry.color} type="button" className={"swatch-dot" + (entry.color.toLowerCase() === (item.color ?? "").toLowerCase() ? " swatch-dot--active" : "")} style={{ background: entry.color }} title={entry.name} aria-label={entry.name} onClick={() => patch({ color: entry.color })} />
          ))}
          <label className="swatch-dot swatch-dot--add" title="Custom colour">
            <Plus size={12} />
            <input type="color" value={item.color ?? "#9aa39e"} onChange={(event) => patch({ color: event.target.value })} />
          </label>
        </div>
      </Section>

      <Section title="Spatial validation" collapsible aside={<span className={"validation-chip validation-chip--" + (issues.some((issue) => issue.severity === "error") ? "error" : issues.length ? "warning" : "ok")}>{issues.length === 0 ? "OK" : issues.length}</span>}>
        {issues.length === 0 ? <p className="field-note">No collisions, boundary, clearance or pathway issues for this object.</p> : null}
        {issues.map((issue) => <p key={issue.id} className="issue-inline">{issue.message}</p>)}
      </Section>

      <Section title="Details" collapsible defaultOpen={false} aside={<span className="section-hint">used by validation & recovery</span>}>
        <NumberField
          label="Front clearance"
          value={clearance}
          min={0}
          max={3}
          onBegin={begin}
          onCommit={(frontClearance) => patch({ constraints: { ...item.constraints, frontClearance } })}
        />
        <p className="field-note">
          {item.constraints?.frontClearance !== undefined ? "Custom for this object." : `Default for ${CATEGORY_LABELS[item.category].toLowerCase()} (scene rules).`}
        </p>
        <Toggle label="Floor covering (no collisions)" checked={!!item.constraints?.floorCovering} onChange={(floorCovering) => patch({ constraints: { ...item.constraints, floorCovering } })} />
        <Toggle label="Locked during recovery" checked={locked} onChange={(value) => patch({ constraints: { ...item.constraints, locked: value } })} />
      </Section>

      {item.light ? <LightSection light={item.light} onChange={(light) => patch({ light })} /> : null}
      {item.category === "lighting" && !item.light ? (
        <button type="button" className="ghost-button" onClick={() => patch({ light: { kind: "point", on: true, intensity: 8, color: "#ffd8a8", height: item.dimensions.height * 0.9 } })}>
          <Lightbulb size={14} /> Add light source
        </button>
      ) : null}

      <Section title="Geometry" collapsible defaultOpen={false} aside={item.mesh ? <span className="section-hint">{item.mesh.positions.length / 3} verts · {item.mesh.indices.length / 3} tris</span> : null}>
        {!item.mesh ? (
          <>
            <button type="button" className="primary-button" onClick={() => {
              if (patchMesh(item)) setTool("vertex");
            }}>
              <Spline size={14} /> Edit mesh
            </button>
          </>
        ) : (
          <>
            <div className="segmented segmented--full">
              <button type="button" className={tool === "vertex" ? "active" : ""} onClick={() => setTool("vertex")}><Waypoints size={14} /> Vertices</button>
              <button type="button" className={tool === "face" ? "active" : ""} onClick={() => setTool("face")}><RectangleHorizontal size={14} /> Faces</button>
              <button type="button" className={tool !== "vertex" && tool !== "face" ? "active" : ""} onClick={() => setTool("translate")}>Object</button>
            </div>
            {tool === "vertex" ? (
              <p className="field-note">{meshSelection.vertex === null ? "Click a white vertex, then drag the gizmo arrows." : "Drag the gizmo to move the vertex. Bounds and collisions update on release."}</p>
            ) : null}
            {tool === "face" ? (
              meshSelection.face ? (
                <div className="extrude-row">
                  <NumberField label="Extrude by" value={extrudeDistance} step={0.01} onCommit={setExtrudeDistance} />
                  <button type="button" className="primary-button" onClick={() => {
                    if (!item.mesh || !meshSelection.face) return;
                    try {
                      commitMesh(item, extrudeFace(item.mesh, meshSelection.face, extrudeDistance), "Extrude face");
                      useWorkspaceStore.getState().setMeshSelection({ face: null });
                    } catch (error) {
                      useWorkspaceStore.getState().notify("error", (error as Error).message);
                    }
                  }}>Extrude</button>
                </div>
              ) : <p className="field-note">Click a face of the mesh to select it.</p>
            ) : null}
            <button type="button" className="ghost-button" onClick={() => patch({ mesh: null, dimensions: item.dimensions })}>Revert to parametric model</button>
          </>
        )}
      </Section>

      <div className="inspector-actions">
        <button type="button" className="ghost-button" onClick={() => duplicate(item)}><Copy size={14} /> Duplicate</button>
        <button type="button" className="ghost-button ghost-button--danger" onClick={() => {
          if (dispatch({ type: "furniture.delete", furnitureId: item.id }, { base: { [item.id]: item.version } })) selectEntity("");
        }}><Trash2 size={14} /> Delete</button>
      </div>
    </div>
  );
}

const MATERIALS = [
  { name: "Oak", color: "#b98a5a" }, { name: "Walnut", color: "#6b4a33" }, { name: "Linen", color: "#e8dfd0" },
  { name: "Mauve", color: "#a98a9c" }, { name: "Sage", color: "#9aab8e" }, { name: "Navy", color: "#2f3e5c" },
  { name: "Charcoal", color: "#3a3a3c" }, { name: "White", color: "#f2f0ec" },
];

function patchMesh(item: FurnitureObject) {
  return useWorkspaceStore.getState().dispatch(
    { type: "furniture.update", furnitureId: item.id, patch: { mesh: createBoxMesh(item.dimensions) } },
    { base: { [item.id]: item.version }, label: "Convert to mesh" },
  );
}

export function duplicate(item: FurnitureObject) {
  const id = newEntityId("obj");
  const { dispatch, selectEntity } = useWorkspaceStore.getState();
  const ok = dispatch({
    type: "furniture.create",
    furniture: { ...item, id, name: item.name.replace(/( copy)*$/, "") + " copy", position: { ...item.position, x: item.position.x + 0.3, z: item.position.z + 0.3 }, version: 1 },
  }, { label: "Duplicate " + item.name });
  if (ok) selectEntity(id);
}

function LightSection({ light, onChange }: { light: LightFixture; onChange: (light: LightFixture) => void }) {
  const kelvin: [string, string][] = [["2700K", "#ffc98a"], ["3000K", "#ffd8a8"], ["4000K", "#fff1dc"], ["5000K", "#f4f6ff"]];
  return (
    <Section title="Lighting & shadows" collapsible aside={<span className="section-hint">{light.kind === "spot" ? "spotlight" : "point light"}</span>}>
      <Toggle label="On" checked={light.on} onChange={(on) => onChange({ ...light, on })} />
      <NumberField label="Intensity" suffix="cd" step={1} min={0} max={200} value={light.intensity} onCommit={(intensity) => onChange({ ...light, intensity })} />
      <div className="swatch-row">
        {kelvin.map(([labelText, color]) => (
          <button key={color} type="button" className={"temp-swatch" + (light.color.toLowerCase() === color ? " temp-swatch--active" : "")} style={{ background: color }} onClick={() => onChange({ ...light, color })} title={labelText}>
            {labelText}
          </button>
        ))}
      </div>
      <ColorField label="Custom color" value={light.color} onChange={(color) => onChange({ ...light, color })} />
    </Section>
  );
}

const WALLS: WallSide[] = ["north", "east", "south", "west"];

function RoomInspector({ room }: { room: Room }) {
  const { dispatch } = useWorkspaceStore.getState();
  const base = useRef<Record<string, number> | undefined>(undefined);
  const begin = () => {
    base.current = { [room.id]: room.version };
  };
  const patchRoom = (patch: RoomPatch) => {
    dispatch({ type: "room.update", roomId: room.id, patch }, { base: base.current });
    base.current = undefined;
  };
  const setOpenings = (openings: Opening[]) => patchRoom({ openings });
  const updateOpening = (id: string, change: Partial<Opening>) => setOpenings(room.openings.map((opening) => (opening.id === id ? { ...opening, ...change } : opening)));
  const wallLength = (wall: WallSide) => (wall === "north" || wall === "south" ? room.dimensions.width : room.dimensions.depth);

  return (
    <div className="inspector-scroll">
      <div className="entity-card">
        <span className="swatch swatch--room" />
        <div className="entity-card-copy">
          <strong>{room.name}</strong>
          <span>Room · {(room.dimensions.width * room.dimensions.depth).toFixed(1)} m² · v{room.version}</span>
        </div>
      </div>
      <Section title="Size">
        <div className="field-grid">
          <NumberField label="Width" value={room.dimensions.width} min={1.5} max={80} onBegin={begin} onCommit={(width) => patchRoom({ dimensions: { width } })} />
          <NumberField label="Depth" value={room.dimensions.depth} min={1.5} max={80} onBegin={begin} onCommit={(depth) => patchRoom({ dimensions: { depth } })} />
          <NumberField label="Height" value={room.dimensions.height} min={2} max={6} onBegin={begin} onCommit={(height) => patchRoom({ dimensions: { height } })} />
          <NumberField label="Walls" value={room.dimensions.wallThickness} min={0.05} max={0.5} step={0.01} onBegin={begin} onCommit={(wallThickness) => patchRoom({ dimensions: { wallThickness } })} />
        </div>
      </Section>
      <Section title="Surfaces">
        <ColorField label="Floor" value={room.floorColor} onChange={(floorColor) => patchRoom({ floorColor })} />
        <ColorField label="Walls" value={room.wallColor} onChange={(wallColor) => patchRoom({ wallColor })} />
      </Section>
      <Section title="Doors & windows" aside={
        <span className="inline-actions">
          <button type="button" className="tiny-button" onClick={() => setOpenings([...room.openings, { id: newEntityId("door"), kind: "door", wall: "south", offset: 0, width: 0.85, height: 2.05, sillHeight: 0, hinge: "left", swing: "in" }])}><DoorOpen size={13} /> Door</button>
          <button type="button" className="tiny-button" onClick={() => setOpenings([...room.openings, { id: newEntityId("window"), kind: "window", wall: "north", offset: 0, width: 1.2, height: 1.3, sillHeight: 0.9, hinge: "left", swing: "in" }])}><Plus size={13} /> Window</button>
        </span>
      }>
        {room.openings.length === 0 ? <p className="field-note">No openings. Pathway checks need at least one door.</p> : null}
        {room.openings.map((opening) => (
          <div key={opening.id} className="opening-card">
            <div className="opening-card-head">
              <strong>{opening.kind === "door" ? "Door" : "Window"}</strong>
              <select value={opening.wall} onChange={(event) => updateOpening(opening.id, { wall: event.target.value as WallSide, offset: 0 })} aria-label="Wall">
                {WALLS.map((wall) => <option key={wall} value={wall}>{wall} wall</option>)}
              </select>
              <button type="button" className="icon-button" aria-label="Remove opening" onClick={() => setOpenings(room.openings.filter((entry) => entry.id !== opening.id))}><Trash2 size={13} /></button>
            </div>
            <div className="field-grid">
              <NumberField label="Offset" value={opening.offset} min={-wallLength(opening.wall) / 2 + opening.width / 2} max={wallLength(opening.wall) / 2 - opening.width / 2} onBegin={begin} onCommit={(offset) => updateOpening(opening.id, { offset })} />
              <NumberField label="Width" value={opening.width} min={0.4} max={wallLength(opening.wall)} onBegin={begin} onCommit={(width) => updateOpening(opening.id, { width })} />
              <NumberField label="Height" value={opening.height} min={0.3} max={room.dimensions.height} onBegin={begin} onCommit={(height) => updateOpening(opening.id, { height })} />
              {opening.kind === "door" ? (
                <>
                  <label className="field"><span className="field-label">Hinge</span><select className="field-select" value={opening.hinge} onChange={(event) => updateOpening(opening.id, { hinge: event.target.value as "left" | "right" })}><option value="left">Left</option><option value="right">Right</option></select></label>
                  <label className="field"><span className="field-label">Opens</span><select className="field-select" value={opening.swing} onChange={(event) => updateOpening(opening.id, { swing: event.target.value as "in" | "out" })}><option value="in">Into room</option><option value="out">Outward</option></select></label>
                </>
              ) : null}
              {opening.kind === "window" ? <NumberField label="Sill" value={opening.sillHeight} min={0} max={room.dimensions.height - opening.height} onBegin={begin} onCommit={(sillHeight) => updateOpening(opening.id, { sillHeight })} /> : null}
            </div>
          </div>
        ))}
      </Section>
    </div>
  );
}
