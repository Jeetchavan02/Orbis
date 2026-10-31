import { useMemo, useRef, useState } from "react";
import { ChevronRight, DoorOpen, LayoutGrid, Layers, Lightbulb, Lock, Paintbrush, Plus, Search } from "lucide-react";
import { boundsDimensions, meshBounds } from "@reality-builder/shared";
import { catalogById, type GroupId } from "../../data/catalog";
import { importModelFile } from "../../lib/glb";
import { activeRoom, placeEntry } from "../../lib/placement";
import { newEntityId, useWorkspaceStore } from "../../store/workspace";
import { Library, ObjectThumb } from "./Library";

export { LIBRARY_DRAG_TYPE as CATALOG_DRAG_TYPE } from "./Library";

/** Kept for callers that place by catalog id (drop handler, AI quick actions). */
export function placeCatalogItem(entry: { id: string }, at?: { x: number; z: number }) {
  placeEntry(entry.id, at);
}

export function LeftPanel() {
  const [tab, setTab] = useState<"scene" | "library" | "elements" | "lights">("library");
  const [query, setQuery] = useState("");
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const scene = useWorkspaceStore((state) => state.scene);
  const selectedId = useWorkspaceStore((state) => state.selectedEntityId);
  const activeRoomId = useWorkspaceStore((state) => state.activeRoomId);
  const validation = useWorkspaceStore((state) => state.validation);
  const { selectEntity, requestFocus } = useWorkspaceStore.getState();
  const needle = query.trim().toLowerCase();

  const severity = useMemo(() => {
    const map = new Map<string, "error" | "warning">();
    for (const issue of validation?.issues ?? []) for (const id of issue.objectIds) if (issue.severity !== "info" && map.get(id) !== "error") map.set(id, issue.severity);
    return map;
  }, [validation]);

  const floorItems = scene.furniture.filter((item) => item.roomId === activeRoomId);
  const visible = floorItems.filter((item) => item.name.toLowerCase().includes(needle)).slice(0, 300);

  const importModel = async (file: File) => {
    const { scene: current, dispatch, notify, selectEntity: select } = useWorkspaceStore.getState();
    const room = activeRoom(current);
    if (!room) return;
    setImporting(true);
    try {
      const model = await importModelFile(file);
      const id = newEntityId("obj");
      const ok = dispatch({
        type: "furniture.create",
        furniture: {
          id, roomId: room.id, name: model.name, category: "other", catalogItemId: "imported",
          position: { x: room.position.x, y: room.position.y, z: room.position.z }, yawDegrees: 0,
          dimensions: boundsDimensions(meshBounds(model.mesh)), color: "#b4a99a", mesh: model.mesh, version: 1,
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
    <div className="left-dock">
    <nav className="left-rail" aria-label="Editor sections">
      {RAIL.map((entry) => (
        <button key={entry.id} type="button" className={tab === entry.id ? "active" : ""} aria-pressed={tab === entry.id} onClick={() => setTab(entry.id)} title={entry.tip}>
          <entry.icon size={18} /><span>{entry.label}</span>
        </button>
      ))}
      <button type="button" onClick={() => { const room = activeRoom(useWorkspaceStore.getState().scene); if (room) selectEntity(room.id); }} title="Floor, wall and ceiling materials of the active room (opens in Properties)">
        <Paintbrush size={18} /><span>Materials</span>
      </button>
    </nav>
    <aside className="left-panel" aria-label="Scene and library">
      <div className="left-panel-head">{RAIL.find((entry) => entry.id === tab)!.title}</div>

      {tab === "scene" ? (
        <>
          <label className="search-field">
            <Search size={14} />
            <input aria-label="Search scene" placeholder="Find in scene" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <div className="panel-scroll">
            <div className="list-heading">{scene.rooms.length > 1 ? "Floors" : "Room"}</div>
            {[...scene.rooms].sort((a, b) => a.position.y - b.position.y).map((room) => (
              <button key={room.id} type="button" className={"tree-row" + (selectedId === room.id || (activeRoomId === room.id && scene.rooms.length > 1) ? " tree-row--selected" : "")} onClick={() => selectEntity(room.id)} title="Edit room size, surfaces, doors and windows">
                <span className="tree-icon"><DoorOpen size={14} /></span>
                <span className="tree-copy"><strong>{room.name}</strong><span>{room.dimensions.width.toFixed(1)} × {room.dimensions.depth.toFixed(1)} m · {room.openings.length} openings</span></span>
              </button>
            ))}
            <div className="list-heading">
              Objects <span className="count">{floorItems.length}</span>
              <button type="button" className="tiny-icon" title="Add from library" aria-label="Add from library" onClick={() => setTab("library")}><Plus size={14} /></button>
            </div>
            {visible.map((item) => (
              <button key={item.id} type="button" className={"tree-row" + (selectedId === item.id ? " tree-row--selected" : "")} onClick={() => selectEntity(item.id)} onDoubleClick={() => { selectEntity(item.id); requestFocus(); }}>
                <ObjectThumb entry={item.mesh ? undefined : catalogById(item.catalogItemId)} group={(catalogById(item.catalogItemId)?.group ?? "basic") as GroupId} />
                <span className="tree-copy"><strong>{item.name}</strong><span>{item.dimensions.width.toFixed(2)} × {item.dimensions.depth.toFixed(2)} m{item.mesh ? " · mesh" : ""}</span></span>
                {item.light ? <Lightbulb size={12} className={item.light.on ? "light-on" : "muted"} aria-label={item.light.on ? "Light on" : "Light off"} /> : null}
                {item.constraints?.locked ? <Lock size={12} className="muted" aria-label="Locked" /> : null}
                {severity.get(item.id) ? <span className={"severity-pip severity-pip--" + severity.get(item.id)} title={severity.get(item.id) === "error" ? "Has errors" : "Has warnings"} /> : <ChevronRight size={13} className="muted" />}
              </button>
            ))}
            {floorItems.length === 0 ? <p className="field-note pad">Empty room. Open the Library and drag furniture in.</p> : null}
            {floorItems.length > 0 && visible.length === 0 ? <p className="field-note pad">No objects match “{query}”.</p> : null}
          </div>
        </>
      ) : (
        <Library key={tab} onImport={() => fileRef.current?.click()} importing={importing} initialGroup={tab === "elements" ? "openings" : tab === "lights" ? "lighting" : "all"} />
      )}
      <input ref={fileRef} type="file" accept=".glb,.gltf,model/gltf-binary,model/gltf+json" hidden onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) void importModel(file);
      }} />
    </aside>
    </div>
  );
}

const RAIL = [
  { id: "library", label: "Library", title: "Asset library", icon: LayoutGrid, tip: "Furniture and decor" },
  { id: "scene", label: "Rooms", title: "Rooms & objects", icon: Layers, tip: "Rooms and the objects in them" },
  { id: "elements", label: "Elements", title: "Doors & windows", icon: DoorOpen, tip: "Doors and windows" },
  { id: "lights", label: "Lights", title: "Lighting", icon: Lightbulb, tip: "Lamps and light fixtures" },
] as const;
