import { memo, useEffect, useMemo, useRef, useState } from "react";
import * as Icons from "lucide-react";
import { Check, ChevronDown, FileUp, Heart, Loader2, Plus, Search, Wand2 } from "lucide-react";
import { usePhotoDialog } from "../../lib/ui";
import { create } from "zustand";
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

const FAVOURITES_KEY = "rb.favourites";
function readFavourites(): string[] {
  try {
    return JSON.parse(localStorage.getItem(FAVOURITES_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}
/** Per-browser favourite library items. */
export const useFavourites = create<{ ids: string[]; toggle: (id: string) => void }>((set, get) => ({
  ids: readFavourites(),
  toggle: (id) => {
    const ids = get().ids.includes(id) ? get().ids.filter((entry) => entry !== id) : [...get().ids, id];
    set({ ids });
    try {
      localStorage.setItem(FAVOURITES_KEY, JSON.stringify(ids));
    } catch {
      /* storage unavailable: favourites last for this page only */
    }
  },
}));

const QUICK_ROOMS: { id: RoomType | "all"; label: string }[] = [{ id: "all", label: "All" }, { id: "bedroom", label: "Bedroom" }, { id: "living", label: "Living" }, { id: "dining", label: "Dining" }];

/** "More" pill: the room types not shown as quick pills, in a small popover. Shows the picked room when active. */
function MoreRooms({ room, onPick }: { room: RoomType | "all"; onPick: (room: RoomType) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  const others = ROOM_TYPES.filter((entry) => !QUICK_ROOMS.some((quick) => quick.id === entry.id));
  const picked = others.find((entry) => entry.id === room);
  return (
    <div className="lib-more" ref={ref}>
      <button type="button" className={picked ? "active" : ""} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {picked ? picked.label : "More"} <ChevronDown size={13} />
      </button>
      {open ? (
        <div className="lib-more-menu" role="menu">
          {others.map((entry) => (
            <button key={entry.id} type="button" role="menuitemradio" aria-checked={entry.id === room} className={entry.id === room ? "active" : ""} onClick={() => { onPick(entry.id); setOpen(false); }}>
              <span>{entry.label}</span>{entry.id === room ? <Check size={13} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const Card = memo(function Card({ entry, armed }: { entry: CatalogItem; armed: boolean }) {
  const [element, setElement] = useState<HTMLButtonElement | null>(null);
  const thumbnail = useThumbnail(entry, element);
  const { start, cancel } = usePlacement.getState();
  const favourite = useFavourites((state) => state.ids.includes(entry.id));
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
      onClick={() => {
        // Click adds the exact item at the centre of the room (nearest free spot) and selects it.
        cancel();
        placeEntry(entry.id);
      }}
      title={`${entry.name}\n${entry.dimensions.width} × ${entry.dimensions.depth} × ${entry.dimensions.height} m\nClick to add to the centre of the room, or drag it to a spot.`}
    >
      <span className="lib-thumb">
        {thumbnail ? <img src={thumbnail} alt="" draggable={false} /> : <GroupIcon group={entry.group} size={22} />}
      </span>
      <span
        role="button"
        tabIndex={0}
        className={"lib-fav" + (favourite ? " lib-fav--on" : "")}
        aria-label={favourite ? "Remove from favourites" : "Add to favourites"}
        aria-pressed={favourite}
        onClick={(event) => { event.stopPropagation(); useFavourites.getState().toggle(entry.id); }}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); useFavourites.getState().toggle(entry.id); } }}
      ><Heart size={13} fill={favourite ? "currentColor" : "none"} /></span>
      <span className="lib-name">{entry.name}</span>
      <span className="lib-dims">{entry.dimensions.width} × {entry.dimensions.depth} m</span>
    </button>
  );
});

const PAGE = 60;

export function Library({ onImport, importing, initialGroup = "all" }: { onImport: () => void; importing: boolean; initialGroup?: GroupId | "all" | "favourites" }) {
  const [room, setRoom] = useState<RoomType | "all">(() => {
    const scene = useWorkspaceStore.getState().scene;
    return (scene.roomType as RoomType | undefined) ?? "all";
  });
  const [group, setGroup] = useState<GroupId | "all" | "favourites">(initialGroup);
  const favourites = useFavourites((state) => state.ids);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const armedId = usePlacement((state) => (state.mode === "click" ? state.entryId : null));
  const needle = query.trim().toLowerCase();

  // Search always spans the full catalogue; room and group narrow the browsing view.
  const inRoom = useMemo(() => (needle || initialGroup === "openings" || initialGroup === "lighting" ? catalog : catalog.filter((entry) => room === "all" || entry.rooms.includes(room))), [room, needle, initialGroup]);
  const groups = useMemo(() => {
    const counts = new Map<GroupId, number>();
    for (const entry of inRoom) counts.set(entry.group, (counts.get(entry.group) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]);
  }, [inRoom]);
  const visible = useMemo(() => inRoom.filter((entry) =>
    (group === "all" || entry.group === group || (group === "favourites" && favourites.includes(entry.id))) &&
    (!needle || entry.name.toLowerCase().includes(needle) || GROUPS[entry.group].label.toLowerCase().includes(needle))), [inRoom, group, needle, favourites]);

  return (
    <div className="library">
      <div className="lib-controls">
        <label className="search-field search-field--tight">
          <Search size={14} />
          <input aria-label="Search library" placeholder={`Search ${catalog.length} items`} value={query} onChange={(event) => { setQuery(event.target.value); setLimit(PAGE); }} />
        </label>
      </div>
      <div className="lib-pills" role="radiogroup" aria-label="Room type">
        {QUICK_ROOMS.map((entry) => (
          <button key={entry.id} type="button" role="radio" aria-checked={room === entry.id} className={room === entry.id ? "active" : ""} onClick={() => { setRoom(entry.id); setGroup("all"); setLimit(PAGE); }}>{entry.label}</button>
        ))}
        <MoreRooms room={room} onPick={(id) => { setRoom(id); setGroup("all"); setLimit(PAGE); }} />
      </div>
      <div className="lib-categories" role="tablist" aria-label="Categories">
        <button type="button" role="tab" aria-selected={group === "all"} className={group === "all" ? "active" : ""} onClick={() => setGroup("all")}><span>All items</span><small>{inRoom.length}</small></button>
        <button type="button" role="tab" aria-selected={group === "favourites"} className={group === "favourites" ? "active" : ""} onClick={() => setGroup("favourites")}><Heart size={13} color="#e5483d" /> <span>Favourites</span><small>{favourites.length}</small></button>
        {groups.map(([id, count]) => (
          <button key={id} type="button" role="tab" aria-selected={group === id} className={group === id ? "active" : ""} onClick={() => { setGroup(id); setLimit(PAGE); }}>
            <GroupIcon group={id} /> <span>{GROUPS[id].label}</span><small>{count}</small>
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
        {visible.length === 0 ? <p className="field-note pad">{group === "favourites" && !needle ? "No favourites yet — tap the heart on any item." : `Nothing matches “${query}”.`}</p> : null}
        {limit < visible.length ? <button type="button" className="ghost-button lib-more" onClick={() => setLimit(limit + PAGE)}><Plus size={13} /> Show more ({visible.length - limit})</button> : null}
        <button type="button" className="import-card import-card--photo" onClick={() => usePhotoDialog.getState().setOpen(true)}>
          <Wand2 size={16} />
          <span><strong>Photo → 3D</strong><span>Remove the background and place the cutout in the room</span></span>
        </button>
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
