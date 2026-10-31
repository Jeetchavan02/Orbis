import { useEffect, useRef, useState } from "react";
import { Bell, Home, PersonStanding, Users } from "lucide-react";
import { useShareDialog } from "../../lib/ui";
import { Check, ChevronDown, Layers, CloudOff, Download, FolderOpen, Gauge, Loader2, Moon, Redo2, RotateCcw, Save, Sun, Sunset, Undo2, Wifi } from "lucide-react";
import type { EnvironmentMode } from "@reality-builder/shared";
import { apartmentScene, starterScene } from "../../data/scene";
import { createStressScene } from "../../lib/stress";
import { currentIdentity, downloadScene, useWorkspaceStore } from "../../store/workspace";

function relativeTime(iso: string | null) {
  if (!iso) return "";
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return seconds + "s ago";
  return Math.round(seconds / 60) + "m ago";
}

const MODES: { id: EnvironmentMode; label: string; icon: typeof Sun }[] = [
  { id: "day", label: "Day", icon: Sun },
  { id: "evening", label: "Evening", icon: Sunset },
  { id: "night", label: "Night", icon: Moon },
];

export function TopBar() {
  const scene = useWorkspaceStore((state) => state.scene);
  const history = useWorkspaceStore((state) => state.history);
  const connection = useWorkspaceStore((state) => state.connection);
  const peers = useWorkspaceStore((state) => state.peers);
  const selfId = useWorkspaceStore((state) => state.selfId);
  const saveStatus = useWorkspaceStore((state) => state.saveStatus);
  const showPerf = useWorkspaceStore((state) => state.showPerf);
  const activeRoomId = useWorkspaceStore((state) => state.activeRoomId);
  const viewMode = useWorkspaceStore((state) => state.viewMode);
  const { setViewMode } = useWorkspaceStore.getState();
  const { undo, redo, dispatch, save, replaceScene, setShowPerf, notify } = useWorkspaceStore.getState();
  const [menuOpen, setMenuOpen] = useState(false);
  const [name, setName] = useState(scene.name);
  const [, tick] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setName(scene.name), [scene.name]);
  useEffect(() => {
    const timer = window.setInterval(() => tick((value) => value + 1), 15000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const others = peers.filter((peer) => peer.clientId !== selfId);
  const mode = scene.environment.mode;
  const saveLabel =
    saveStatus.state === "saving" ? "Saving…"
    : saveStatus.state === "local" ? "Local only — not saved"
    : saveStatus.state === "unsaved" ? "Autosaving…"
    : saveStatus.savedAt ? "Saved " + relativeTime(saveStatus.savedAt) : "All changes saved";

  return (
    <header className="topbar">
      <div className="topbar-left">
        <a className="icon-button" href="/" title="Back to projects" aria-label="Back to projects"><Home size={16} /></a>
        <div className="brand" aria-label="Reality Builder">
          <span className="brand-mark"><span /><span /><span /><span /></span>
          <span className="brand-name">Reality Builder</span>
        </div>
        <span className="divider" />
        <input
          className="scene-name"
          aria-label="Scene name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => (name.trim() && name !== scene.name ? dispatch({ type: "scene.update", patch: { name: name.trim() } }, { base: { scene: scene.settingsVersion } }) : setName(scene.name))}
          onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
        />
        <span className={"save-state save-state--" + saveStatus.state} title={saveStatus.path ? "Saved to " + saveStatus.path : undefined}>
          {saveStatus.state === "saving" || saveStatus.state === "unsaved" ? <Loader2 size={12} className="spin" /> : saveStatus.state === "local" ? <CloudOff size={12} /> : <Check size={12} />}
          {saveLabel}
        </span>
      </div>

      <div className="topbar-center">
        {scene.rooms.length > 1 ? (
          <label className="floor-select" title="Switch floor">
            <Layers size={14} />
            <select aria-label="Floor" value={activeRoomId} onChange={(event) => useWorkspaceStore.getState().setActiveRoom(event.target.value)}>
              {[...scene.rooms].sort((a, b) => b.position.y - a.position.y).map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
            </select>
          </label>
        ) : null}
        <div className="segmented" role="radiogroup" aria-label="Environment">
          {MODES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="radio"
              aria-checked={mode === entry.id}
              className={mode === entry.id ? "active" : ""}
              onClick={() => mode !== entry.id && dispatch({ type: "scene.update", patch: { environment: { mode: entry.id } } }, { base: { scene: scene.settingsVersion } })}
              title={entry.label + " lighting"}
            >
              <entry.icon size={14} /> {entry.label}
            </button>
          ))}
        </div>
      </div>

      <div className="topbar-right">
        <button type="button" className="icon-button" onClick={undo} disabled={history.past.length === 0} title={history.past.length ? `Undo ${history.past.at(-1)!.label} (⌘Z)` : "Nothing to undo"} aria-label="Undo"><Undo2 size={16} /></button>
        <button type="button" className="icon-button" onClick={redo} disabled={history.future.length === 0} title={history.future.length ? `Redo ${history.future[0]!.label} (⇧⌘Z)` : "Nothing to redo"} aria-label="Redo"><Redo2 size={16} /></button>
        <span className="divider" />

        <div className="presence" aria-label="Collaborators">
          <span className="avatar avatar--self" style={{ background: currentIdentity.color }} title={currentIdentity.name + " (you)"}>{initials(currentIdentity.name)}</span>
          {others.slice(0, 4).map((peer) => (
            <span key={peer.clientId} className="avatar" style={{ background: peer.color }} title={peer.name + (peer.selectedId ? " · editing " + (scene.furniture.find((item) => item.id === peer.selectedId)?.name ?? "") : "")}>
              {initials(peer.name)}
            </span>
          ))}
          {others.length > 4 ? <span className="avatar avatar--more">+{others.length - 4}</span> : null}
        </div>
        <span className={"connection connection--" + connection} title={connection === "online" ? "Connected to the collaboration server" : connection === "connecting" ? "Connecting…" : "Offline — edits stay local and you'll be asked how to merge on reconnect"}>
          {connection === "online" ? <Wifi size={13} /> : connection === "connecting" ? <Loader2 size={13} className="spin" /> : <CloudOff size={13} />}
          {connection === "online" ? "Live" : connection === "connecting" ? "Connecting" : "Offline"}
        </span>
        <button type="button" className={"icon-button" + (showPerf ? " icon-button--active" : "")} onClick={() => setShowPerf(!showPerf)} title="Performance overlay (P)" aria-label="Performance overlay"><Gauge size={16} /></button>
        <button type="button" className={"ghost-button" + (viewMode === "walk" ? " ghost-button--active" : "")} onClick={() => setViewMode(viewMode === "walk" ? "perspective" : "walk")} title="Walk through the room at eye height (WASD to move)"><PersonStanding size={14} /> {viewMode === "walk" ? "Exit walk" : "Walkthrough"}</button>
        <NotificationsBell />
        <button type="button" className="ghost-button" onClick={() => useShareDialog.getState().setOpen(true)} title="Invite collaborators"><Users size={14} /> Share</button>
        <button type="button" className="primary-button" onClick={save} title="Save (⌘S)"><Save size={14} /> Save</button>
        <div className="menu" ref={menuRef}>
          <button type="button" className="icon-button" onClick={() => setMenuOpen(!menuOpen)} aria-haspopup="menu" aria-expanded={menuOpen} aria-label="Scene menu"><ChevronDown size={16} /></button>
          {menuOpen ? (
            <div className="menu-popover" role="menu">
              <button type="button" role="menuitem" onClick={() => { downloadScene(scene); setMenuOpen(false); }}><Download size={14} /> Export scene (.json)</button>
              <button type="button" role="menuitem" onClick={() => { fileRef.current?.click(); setMenuOpen(false); }}><FolderOpen size={14} /> Open scene file…</button>
              <span className="menu-sep" />
              <button type="button" role="menuitem" onClick={() => { replaceScene(starterScene, "Loaded the demo bedroom."); setMenuOpen(false); }}><RotateCcw size={14} /> Load demo bedroom</button>
              <button type="button" role="menuitem" onClick={() => { replaceScene(apartmentScene, "Loaded the 3-floor demo apartment."); setMenuOpen(false); }}><Layers size={14} /> Load demo apartment (3 floors)</button>
              <button type="button" role="menuitem" onClick={() => { replaceScene(createStressScene(500), "Loaded 500-object stress scene."); setShowPerf(true); setMenuOpen(false); }}><Gauge size={14} /> Load 500-object stress test</button>
              <button type="button" role="menuitem" onClick={() => { replaceScene(createStressScene(1000), "Loaded 1000-object stress scene."); setShowPerf(true); setMenuOpen(false); }}><Gauge size={14} /> Load 1,000-object stress test</button>
            </div>
          ) : null}
        </div>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          try {
            replaceScene(JSON.parse(await file.text()), `Opened ${file.name}.`);
          } catch (error) {
            notify("error", `${file.name} is not valid JSON: ${(error as Error).message}`);
          }
        }} />
      </div>
    </header>
  );
}

function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function NotificationsBell() {
  const log = useWorkspaceStore((state) => state.activityLog);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  const unread = log.filter((entry) => entry.id > seen).length;
  return (
    <div className="menu" ref={ref}>
      <button type="button" className="icon-button bell" onClick={() => { setOpen(!open); setSeen(log[0]?.id ?? 0); }} aria-label="Activity" title="Activity">
        <Bell size={16} />{unread ? <span className="bell-dot">{Math.min(unread, 9)}</span> : null}
      </button>
      {open ? (
        <div className="menu-popover activity-popover" role="dialog" aria-label="Activity">
          <div className="context-title">Activity</div>
          {log.length ? log.map((entry) => (
            <div key={entry.id} className={"activity-row activity-row--" + entry.tone}>
              <span>{entry.text}</span><small>{relativeTime(new Date(entry.at).toISOString())}</small>
            </div>
          )) : <p className="field-note pad">No activity yet.</p>}
        </div>
      ) : null}
    </div>
  );
}
