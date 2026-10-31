import { useMemo, useRef, useState } from "react";
import { ChevronRight, DoorOpen, FileUp, Grid2X2, Layers, Lightbulb, Loader2, Lock, Plus, Search } from "lucide-react";
import { boundsDimensions, meshBounds, type FurnitureCategory, type FurnitureObject, type Scene } from "@reality-builder/shared";
import { catalog, CATEGORY_LABELS, type CatalogItem } from "../../data/catalog";
import { importModelFile } from "../../lib/glb";
import { newEntityId, useWorkspaceStore } from "../../store/workspace";

export const CATALOG_DRAG_TYPE = "application/x-reality-builder-catalog";

/** Finds a free spot near `preferred` (room-local search outward) so new items don't land on top of others. */
function placementFor(scene: Scene, entry: CatalogItem, preferred?: { x: number; z: number }) {
  const room = scene.rooms[0]!;
  const target = preferred ?? { x: room.position.x, z: room.position.z };
  if (entry.elevation !== undefined || entry.constraints?.floorCovering) return target;
  const halfW = room.dimensions.width / 2 - entry.dimensions.width / 2 - 0.02;
  const halfD = room.dimensions.depth / 2 - entry.dimensions.depth / 2 - 0.02;
  const overlaps = (x: number, z: number) => scene.furniture.some((other) =>
    other.position.y < 1.2 && !(other.constraints?.floorCovering || other.dimensions.height <= 0.03) &&
    Math.abs(other.position.x - x) < (Math.max(other.dimensions.width, other.dimensions.depth) + entry.dimensions.width) / 2 &&
    Math.abs(other.position.z - z) < (Math.max(other.dimensions.width, other.dimensions.depth) + entry.dimensions.depth) / 2);
  for (let ring = 0; ring < 40; ring += 1) {
    for (let step = 0; step < Math.max(1, ring * 8); step += 1) {
      const angle = (step / Math.max(1, ring * 8)) * Math.PI * 2;
      const x = Math.max(room.position.x - halfW, Math.min(room.position.x + halfW, target.x + Math.cos(angle) * ring * 0.1));
      const z = Math.max(room.position.z - halfD, Math.min(room.position.z + halfD, target.z + Math.sin(angle) * ring * 0.1));
      if (!overlaps(x, z)) return { x, z };
    }
  }
  return target;
}

export function placeCatalogItem(entry: CatalogItem, at?: { x: number; z: number }) {
  const { scene, dispatch, selectEntity, setTool } = useWorkspaceStore.getState();
  const room = scene.rooms[0];
  if (!room) return;
  const spot = placementFor(scene, entry, at);
  const id = newEntityId("obj");
  const furniture: FurnitureObject = {
    id,
    roomId: room.id,
    name: entry.name,
    category: entry.category,
    catalogItemId: entry.id,
    position: { x: Math.round(spot.x * 100) / 100, y: entry.elevation ?? 0, z: Math.round(spot.z * 100) / 100 },
    yawDegrees: 0,
    dimensions: entry.dimensions,
    color: entry.color,
    version: 1,
    ...(entry.light ? { light: entry.light } : {}),
    ...(entry.constraints ? { constraints: entry.constraints } : {}),
  };
  if (dispatch({ type: "furniture.create", furniture })) {
    selectEntity(id);
    setTool("translate");
  }
}

function CatalogThumb({ entry }: { entry: CatalogItem }) {
  // Proportional plan-view footprint (top-down), scaled into the thumbnail.
  const scale = 34 / Math.max(entry.dimensions.width, entry.dimensions.depth, 0.6);
  return (
    <span className="catalog-thumb" aria-hidden="true">
      <span style={{ width: Math.max(6, entry.dimensions.width * scale), height: Math.max(6, entry.dimensions.depth * scale), background: entry.color, borderRadius: entry.category === "lighting" || entry.id === "plant" ? "50%" : 3 }} />
    </span>
  );
}

export function LeftPanel() {
  const [tab, setTab] = useState<"scene" | "library">("scene");
  const [query, setQuery] = useState("");
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const scene = useWorkspaceStore((state) => state.scene);
  const selectedId = useWorkspaceStore((state) => state.selectedEntityId);
  const validation = useWorkspaceStore((state) => state.validation);
  const { selectEntity, requestFocus } = useWorkspaceStore.getState();
  const needle = query.trim().toLowerCase();

  const severity = useMemo(() => {
    const map = new Map<string, "error" | "warning">();
    for (const issue of validation?.issues ?? []) for (const id of issue.objectIds) if (issue.severity !== "info" && map.get(id) !== "error") map.set(id, issue.severity);
    return map;
  }, [validation]);

  const visible = scene.furniture.length > 300 && !needle
    ? scene.furniture.slice(0, 300)
    : scene.furniture.filter((item) => item.name.toLowerCase().includes(needle));

  const grouped = useMemo(() => {
    const groups = new Map<FurnitureCategory, CatalogItem[]>();
    for (const entry of catalog) {
      if (needle && !entry.name.toLowerCase().includes(needle) && !CATEGORY_LABELS[entry.category].toLowerCase().includes(needle)) continue;
      groups.set(entry.category, [...(groups.get(entry.category) ?? []), entry]);
    }
    return groups;
  }, [needle]);

  const importModel = async (file: File) => {
    const { scene: current, dispatch, notify, selectEntity: select } = useWorkspaceStore.getState();
    const room = current.rooms[0];
    if (!room) return;
    setImporting(true);
    try {
      const model = await importModelFile(file);
      const id = newEntityId("obj");
      const dimensions = boundsDimensions(meshBounds(model.mesh));
      const spot = placementFor(current, { id: "imported", name: model.name, category: "other", dimensions, color: "#b4a99a" });
      const ok = dispatch({
        type: "furniture.create",
        furniture: {
          id, roomId: room.id, name: model.name, category: "other", catalogItemId: "imported",
          position: { x: Math.round(spot.x * 100) / 100, y: 0, z: Math.round(spot.z * 100) / 100 }, yawDegrees: 0,
          dimensions,
          color: "#b4a99a", mesh: model.mesh, version: 1,
        },
      }, { label: "Import " + model.name });
      if (ok) {
        select(id);
        notify("success", `Imported ${model.name} (${model.triangles.toLocaleString()} triangles)${model.scaledFrom ? ` — rescaled from ${model.scaledFrom.toFixed(2)} units to 1 m` : ""}.`);
      }
    } catch (error) {
      notify("error", (error as Error).message);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <aside className="left-panel" aria-label="Scene and library">
      <div className="panel-tabs">
        <button type="button" className={tab === "scene" ? "active" : ""} onClick={() => setTab("scene")}><Layers size={14} /> Scene</button>
        <button type="button" className={tab === "library" ? "active" : ""} onClick={() => setTab("library")}><Grid2X2 size={14} /> Library</button>
      </div>
      <label className="search-field">
        <Search size={14} />
        <input aria-label={tab === "scene" ? "Search scene" : "Search library"} placeholder={tab === "scene" ? "Find in scene" : "Search furniture"} value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>

      {tab === "scene" ? (
        <div className="panel-scroll">
          <div className="list-heading">Rooms</div>
          {scene.rooms.map((room) => (
            <button key={room.id} type="button" className={"tree-row" + (selectedId === room.id ? " tree-row--selected" : "")} onClick={() => selectEntity(room.id)}>
              <span className="tree-icon"><DoorOpen size={14} /></span>
              <span className="tree-copy"><strong>{room.name}</strong><span>{room.dimensions.width.toFixed(1)} × {room.dimensions.depth.toFixed(1)} m · {room.openings.length} openings</span></span>
            </button>
          ))}
          <div className="list-heading">
            Objects <span className="count">{scene.furniture.length}</span>
            <button type="button" className="tiny-icon" title="Add from library" onClick={() => setTab("library")}><Plus size={14} /></button>
          </div>
          {visible.map((item) => (
            <button
              key={item.id}
              type="button"
              className={"tree-row" + (selectedId === item.id ? " tree-row--selected" : "")}
              onClick={() => selectEntity(item.id)}
              onDoubleClick={() => {
                selectEntity(item.id);
                requestFocus();
              }}
            >
              <span className="swatch swatch--sm" style={{ background: item.color }} />
              <span className="tree-copy">
                <strong>{item.name}</strong>
                <span>{CATEGORY_LABELS[item.category]}{item.mesh ? " · mesh" : ""}</span>
              </span>
              {item.light ? <Lightbulb size={12} className={item.light.on ? "light-on" : "muted"} /> : null}
              {item.constraints?.locked ? <Lock size={12} className="muted" /> : null}
              {severity.get(item.id) ? <span className={"severity-pip severity-pip--" + severity.get(item.id)} title={severity.get(item.id)} /> : <ChevronRight size={13} className="muted" />}
            </button>
          ))}
          {scene.furniture.length > 300 && !needle ? <p className="field-note pad">Showing 300 of {scene.furniture.length}. Search to find others.</p> : null}
          {visible.length === 0 ? <p className="field-note pad">No objects match “{query}”.</p> : null}
        </div>
      ) : (
        <div className="panel-scroll">
          <p className="field-note pad">Click to place, or drag into the viewport.</p>
          {[...grouped].map(([category, entries]) => (
            <div key={category}>
              <div className="list-heading">{CATEGORY_LABELS[category]}</div>
              <div className="catalog-grid">
                {entries.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className="catalog-card"
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData(CATALOG_DRAG_TYPE, entry.id);
                      event.dataTransfer.effectAllowed = "copy";
                    }}
                    onClick={() => placeCatalogItem(entry)}
                    title={`Place ${entry.name} (${entry.dimensions.width} × ${entry.dimensions.depth} × ${entry.dimensions.height} m)`}
                  >
                    <CatalogThumb entry={entry} />
                    <strong>{entry.name}</strong>
                    <span>{entry.dimensions.width} × {entry.dimensions.depth} × {entry.dimensions.height} m</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="list-heading">Import</div>
          <button type="button" className="import-card" onClick={() => fileRef.current?.click()} disabled={importing}>
            {importing ? <Loader2 size={16} className="spin" /> : <FileUp size={16} />}
            <span><strong>{importing ? "Importing model…" : "Import GLB / GLTF"}</strong><span>Becomes an editable, collidable mesh</span></span>
          </button>
          <input ref={fileRef} type="file" accept=".glb,.gltf,model/gltf-binary,model/gltf+json" hidden onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importModel(file);
          }} />
        </div>
      )}
    </aside>
  );
}
