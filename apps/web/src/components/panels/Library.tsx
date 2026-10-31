import { memo, useMemo, useState } from "react";
import * as Icons from "lucide-react";
import { FileUp, Loader2, Plus, Search } from "lucide-react";
import { catalog, GROUPS, ROOM_TYPES, type CatalogItem, type GroupId, type RoomType } from "../../data/catalog";
import { placeEntry, usePlacement } from "../../lib/placement";
import { useThumbnail } from "../../lib/thumbnails";
import { useWorkspaceStore } from "../../store/workspace";

export const LIBRARY_DRAG_TYPE = "application/x-reality-builder-catalog";
/** The id being dragged (dataTransfer contents are not readable during dragover). */
export const dragging: { id: string | null } = { id: null };

export function GroupIcon({ group, size = 14 }: { group: GroupId; size?: number }) {
  const meta = GROUPS[group];
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[meta.icon] ?? Icons.Box;
  return <Icon size={size} color={meta.color} aria-hidden="true" />;
}

const Card = memo(function Card({ entry, armed }: { entry: CatalogItem; armed: boolean }) {
  const [element, setElement] = useState<HTMLButtonElement | null>(null);
  const thumbnail = useThumbnail(entry, element);
  const { start, cancel } = usePlacement.getState();
  return (
    <button
      ref={setElement}
      type="button"
      className={"lib-card" + (armed ? " lib-card--armed" : "")}
      draggable
      onDragStart={(event) => {
        dragging.id = entry.id;
        event.dataTransfer.setData(LIBRARY_DRAG_TYPE, entry.id);
        event.dataTransfer.effectAllowed = "copy";
        if (thumbnail) {
          const image = new Image();
          image.src = thumbnail;
          event.dataTransfer.setDragImage(image, 40, 40);
        }
        start(entry.id, "drag");
      }}
      onDragEnd={() => {
        dragging.id = null;
        cancel();
      }}
      onClick={() => (armed ? cancel() : start(entry.id, "click"))}
      onDoubleClick={() => {
        cancel();
        placeEntry(entry.id);
      }}
      title={`${entry.name}\n${entry.dimensions.width} × ${entry.dimensions.depth} × ${entry.dimensions.height} m\nDrag into the room, or click then click the floor. Double-click to add.`}
    >
      <span className="lib-thumb">
        {thumbnail ? <img src={thumbnail} alt="" draggable={false} /> : <GroupIcon group={entry.group} size={22} />}
      </span>
      <span className="lib-name">{entry.name}</span>
      <span className="lib-dims">{entry.dimensions.width} × {entry.dimensions.depth} m</span>
    </button>
  );
});

const PAGE = 60;

export function Library({ onImport, importing }: { onImport: () => void; importing: boolean }) {
  const [room, setRoom] = useState<RoomType | "all">(() => {
    const scene = useWorkspaceStore.getState().scene;
    return (scene.roomType as RoomType | undefined) ?? "all";
  });
  const [group, setGroup] = useState<GroupId | "all">("all");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const armedId = usePlacement((state) => (state.mode === "click" ? state.entryId : null));
  const needle = query.trim().toLowerCase();

  // Search always spans the full catalogue; room and group narrow the browsing view.
  const inRoom = useMemo(() => (needle ? catalog : catalog.filter((entry) => room === "all" || entry.rooms.includes(room))), [room, needle]);
  const groups = useMemo(() => {
    const counts = new Map<GroupId, number>();
    for (const entry of inRoom) counts.set(entry.group, (counts.get(entry.group) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]);
  }, [inRoom]);
  const visible = useMemo(() => inRoom.filter((entry) =>
    (group === "all" || entry.group === group) &&
    (!needle || entry.name.toLowerCase().includes(needle) || GROUPS[entry.group].label.toLowerCase().includes(needle))), [inRoom, group, needle]);

  return (
    <div className="library">
      <div className="lib-controls">
        <select aria-label="Room type" value={room} onChange={(event) => { setRoom(event.target.value as RoomType | "all"); setGroup("all"); setLimit(PAGE); }}>
          <option value="all">All objects ({catalog.length})</option>
          {ROOM_TYPES.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
        </select>
        <label className="search-field search-field--tight">
          <Search size={14} />
          <input aria-label="Search library" placeholder={`Search ${catalog.length} items`} value={query} onChange={(event) => { setQuery(event.target.value); setLimit(PAGE); }} />
        </label>
      </div>
      <div className="lib-groups" role="tablist" aria-label="Categories">
        <button type="button" role="tab" aria-selected={group === "all"} className={group === "all" ? "active" : ""} onClick={() => setGroup("all")} title="All categories">All</button>
        {groups.map(([id, count]) => (
          <button key={id} type="button" role="tab" aria-selected={group === id} className={group === id ? "active" : ""} onClick={() => { setGroup(id); setLimit(PAGE); }} title={`${GROUPS[id].label} (${count})`}>
            <GroupIcon group={id} /> <span>{GROUPS[id].label}</span>
          </button>
        ))}
      </div>
      {armedId ? <div className="lib-armed">Click the floor to place · <kbd>Esc</kbd> to cancel</div> : null}
      <div className="panel-scroll lib-scroll" onScroll={(event) => {
        const target = event.currentTarget;
        if (target.scrollTop + target.clientHeight > target.scrollHeight - 300 && limit < visible.length) setLimit(limit + PAGE);
      }}>
        <div className="lib-grid">
          {visible.slice(0, limit).map((entry) => <Card key={entry.id} entry={entry} armed={armedId === entry.id} />)}
        </div>
        {visible.length === 0 ? <p className="field-note pad">Nothing matches “{query}”.</p> : null}
        {limit < visible.length ? <button type="button" className="ghost-button lib-more" onClick={() => setLimit(limit + PAGE)}><Plus size={13} /> Show more ({visible.length - limit})</button> : null}
        <button type="button" className="import-card" onClick={onImport} disabled={importing}>
          {importing ? <Loader2 size={16} className="spin" /> : <FileUp size={16} />}
          <span><strong>{importing ? "Importing model…" : "Import GLB / GLTF"}</strong><span>Becomes an editable, collidable mesh</span></span>
        </button>
      </div>
    </div>
  );
}

/** Small 3D thumbnail of an object's catalog model (category icon while it renders, or for imported meshes). */
export const ObjectThumb = memo(function ObjectThumb({ entry, group }: { entry: CatalogItem | undefined; group: GroupId }) {
  const [element, setElement] = useState<HTMLSpanElement | null>(null);
  const thumbnail = useThumbnail(entry ?? catalog[0]!, entry ? element : null);
  return (
    <span ref={setElement} className="tree-thumb" aria-hidden="true">
      {entry && thumbnail ? <img src={thumbnail} alt="" draggable={false} /> : <GroupIcon group={group} size={16} />}
    </span>
  );
});
