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
import { CATEGORY_LABELS } from "../../data/catalog";
import { newEntityId, useWorkspaceStore } from "../../store/workspace";
import { commitMesh } from "../viewport/MeshEditor";
import { ColorField, NumberField, Section, Toggle } from "./fields";

export function Inspector() {
  const scene = useWorkspaceStore((state) => state.scene);
  const selectedId = useWorkspaceStore((state) => state.selectedEntityId);
  const item = scene.furniture.find((entry) => entry.id === selectedId);
  const room = scene.rooms.find((entry) => entry.id === selectedId);

  if (item) return <ObjectInspector key={item.id} item={item} />;
  if (room) return <RoomInspector key={room.id} room={room} />;
  return (
    <div className="empty-state">
      <div className="empty-state-icon"><Box size={20} /></div>
      <strong>Nothing selected</strong>
      <span>Click an object in the viewport or the scene list. Drag items in from the Library.</span>
      {scene.rooms[0] ? (
        <button type="button" className="ghost-button" onClick={() => useWorkspaceStore.getState().selectEntity(scene.rooms[0]!.id)}>
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

      <div className={"validation-chip validation-chip--" + (issues.some((issue) => issue.severity === "error") ? "error" : issues.length ? "warning" : "ok")}>
        {issues.length === 0 ? "No spatial issues" : `${issues.length} spatial issue${issues.length > 1 ? "s" : ""}`}
      </div>
      {issues.map((issue) => <p key={issue.id} className="issue-inline">{issue.message}</p>)}

      <Section title="Transform">
        <div className="field-grid">
          <NumberField label="X" value={item.position.x} onBegin={begin} onCommit={(x) => patch({ position: { x } })} disabled={locked} />
          <NumberField label="Z" value={item.position.z} onBegin={begin} onCommit={(z) => patch({ position: { z } })} disabled={locked} />
          <NumberField label="Elevation" value={item.position.y} min={0} onBegin={begin} onCommit={(y) => patch({ position: { y } })} disabled={locked} />
          <NumberField label="Rotation" suffix="°" step={15} value={item.yawDegrees} onBegin={begin} onCommit={(yawDegrees) => patch({ yawDegrees })} disabled={locked} />
        </div>
      </Section>

      <Section title="Dimensions">
        <div className="field-grid field-grid--3">
          <NumberField label="Width" value={item.dimensions.width} min={0.02} onBegin={begin} onCommit={(width) => patch({ dimensions: { width } })} />
          <NumberField label="Depth" value={item.dimensions.depth} min={0.02} onBegin={begin} onCommit={(depth) => patch({ dimensions: { depth } })} />
          <NumberField label="Height" value={item.dimensions.height} min={0.01} onBegin={begin} onCommit={(height) => patch({ dimensions: { height } })} />
        </div>
      </Section>

      <Section title="Material">
        <ColorField label="Color" value={item.color ?? "#9aa39e"} onChange={(color) => patch({ color })} />
      </Section>

      <Section title="Constraints" aside={<span className="section-hint">used by validation & recovery</span>}>
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

      <Section title="Geometry" aside={item.mesh ? <span className="section-hint">{item.mesh.positions.length / 3} verts · {item.mesh.indices.length / 3} tris</span> : null}>
        {!item.mesh ? (
          <>
            <p className="field-note">Convert to an editable mesh to move vertices and extrude faces. The procedural model is replaced by real geometry.</p>
            <button type="button" className="primary-button" onClick={() => {
              if (patchMesh(item)) setTool("vertex");
            }}>
              <Spline size={14} /> Convert to editable mesh
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
    <Section title="Light" aside={<span className="section-hint">{light.kind === "spot" ? "spotlight" : "point light"}</span>}>
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
          <button type="button" className="tiny-button" onClick={() => setOpenings([...room.openings, { id: newEntityId("door"), kind: "door", wall: "south", offset: 0, width: 0.85, height: 2.05, sillHeight: 0 }])}><DoorOpen size={13} /> Door</button>
          <button type="button" className="tiny-button" onClick={() => setOpenings([...room.openings, { id: newEntityId("window"), kind: "window", wall: "north", offset: 0, width: 1.2, height: 1.3, sillHeight: 0.9 }])}><Plus size={13} /> Window</button>
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
              {opening.kind === "window" ? <NumberField label="Sill" value={opening.sillHeight} min={0} max={room.dimensions.height - opening.height} onBegin={begin} onCommit={(sillHeight) => updateOpening(opening.id, { sillHeight })} /> : null}
            </div>
          </div>
        ))}
      </Section>
    </div>
  );
}
