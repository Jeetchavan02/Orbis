import { AlertTriangle, Check, CheckCircle2, Copy, Globe2, Info, Laptop, Link2, X } from "lucide-react";
import type { FurnitureObject, Room } from "@reality-builder/shared";
import { usePerfStore } from "../../lib/perf";
import { useEffect, useState } from "react";
import { currentIdentity, useWorkspaceStore } from "../../store/workspace";
import { useShareDialog } from "../../lib/ui";
import { saveDefaultProfile } from "../../lib/collab";
import { currentProjectId, projectUrl } from "../../lib/project";

/** Live measurements only: FPS/draw calls from the render loop, the rest from the last validation run. */
export function PerfOverlay() {
  const show = useWorkspaceStore((state) => state.showPerf);
  const stats = useWorkspaceStore((state) => state.validation?.stats);
  const perf = usePerfStore();
  if (!show) return null;
  const reduction = stats && stats.naivePairs > 0 ? (1 - stats.broadPhasePairs / stats.naivePairs) * 100 : 0;
  return (
    <div className="perf-overlay" aria-label="Performance">
      <div className="perf-title">Performance <span>live</span></div>
      <dl>
        <dt>FPS</dt><dd className={perf.fps < 30 ? "warn" : ""}>{perf.fps ? perf.fps.toFixed(0) : "—"}</dd>
        <dt>Frame</dt><dd>{perf.frameMs ? perf.frameMs.toFixed(1) + " ms" : "—"}</dd>
        <dt>Draw calls</dt><dd>{perf.drawCalls.toLocaleString()}</dd>
        <dt>Triangles</dt><dd>{perf.triangles.toLocaleString()}</dd>
        <dt>Objects</dt><dd>{stats?.objectCount.toLocaleString() ?? "—"}</dd>
        <dt>Validation</dt><dd>{stats ? stats.durationMs.toFixed(1) + " ms" : "—"} <small>worker</small></dd>
        <dt>Naive pairs</dt><dd>{stats?.naivePairs.toLocaleString() ?? "—"}</dd>
        <dt>Broad phase</dt><dd>{stats?.broadPhasePairs.toLocaleString() ?? "—"} <small>RBush</small></dd>
        <dt>Narrow phase</dt><dd>{stats?.narrowPhaseTests.toLocaleString() ?? "—"} <small>SAT</small></dd>
        <dt>Pairs skipped</dt><dd>{stats ? reduction.toFixed(2) + "%" : "—"}</dd>
        <dt>Walk grid</dt><dd>{stats?.walkGridCells.toLocaleString() ?? "—"} cells</dd>
      </dl>
      {stats ? (
        <div className="perf-breakdown" title="Validation time per phase">
          {(["index", "collisions", "boundaries", "clearances", "pathways"] as const).map((key) => (
            <span key={key}>{key} {stats.timings[key].toFixed(1)}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function describeEntity(entity: FurnitureObject | Room | null) {
  if (!entity) return "deleted";
  const position = `x ${entity.position.x.toFixed(2)}, z ${entity.position.z.toFixed(2)}`;
  if ("category" in entity) return `${position}, ${entity.yawDegrees.toFixed(0)}°, ${entity.dimensions.width.toFixed(2)} × ${entity.dimensions.depth.toFixed(2)} m`;
  return `${entity.dimensions.width.toFixed(2)} × ${entity.dimensions.depth.toFixed(2)} m`;
}

export function ConflictDialog() {
  const conflict = useWorkspaceStore((state) => state.conflict);
  const resolve = useWorkspaceStore((state) => state.resolveConflict);
  if (!conflict) return null;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="conflict-title">
      <div className="modal">
        <div className="modal-icon modal-icon--warn"><AlertTriangle size={18} /></div>
        <h2 id="conflict-title">Edit conflict</h2>
        <p>{conflict.message} Your change “{conflict.pending.label}” was <strong>not</strong> applied, so nothing was overwritten.</p>
        <ul className="conflict-list">
          {conflict.conflicts.map((entry) => (
            <li key={entry.entityId}>
              <strong>{entry.entityName}</strong>
              <span>You edited version {entry.baseVersion}; it is now {entry.currentVersion === null ? "deleted" : "version " + entry.currentVersion}{entry.changedBy ? ` (by ${entry.changedBy})` : ""}.</span>
              <span className="muted">Their state: {describeEntity(entry.current)}</span>
            </li>
          ))}
        </ul>
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={() => resolve("theirs")} autoFocus>Take theirs</button>
          <button type="button" className="primary-button" onClick={() => resolve("mine")} disabled={conflict.conflicts.some((entry) => entry.currentVersion === null)}>
            Keep mine (apply on top)
          </button>
        </div>
      </div>
    </div>
  );
}

export function OfflineDialog() {
  const offline = useWorkspaceStore((state) => state.offlineConflict);
  const resolve = useWorkspaceStore((state) => state.resolveOfflineConflict);
  if (!offline) return null;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="offline-title">
      <div className="modal">
        <div className="modal-icon"><Info size={18} /></div>
        <h2 id="offline-title">Reconnected</h2>
        <p>You made {offline.edits} edit{offline.edits === 1 ? "" : "s"} while offline. The server has its own version of “{offline.serverScene.name}” ({offline.serverScene.furniture.length} objects). Choose which one to keep — nothing is merged silently.</p>
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={() => resolve("theirs")}>Use server version</button>
          <button type="button" className="primary-button" onClick={() => resolve("mine")}>Upload my version ({offline.localScene.furniture.length} objects)</button>
        </div>
      </div>
    </div>
  );
}

export function Notices() {
  const notices = useWorkspaceStore((state) => state.notices);
  const dismiss = useWorkspaceStore((state) => state.dismissNotice);
  return (
    <div className="notices" aria-live="polite">
      {notices.map((notice) => (
        <div key={notice.id} className={"notice notice--" + notice.tone}>
          {notice.tone === "error" ? <AlertTriangle size={14} /> : notice.tone === "success" ? <CheckCircle2 size={14} /> : <Info size={14} />}
          <span>{notice.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => dismiss(notice.id)}><X size={12} /></button>
        </div>
      ))}
    </div>
  );
}

const SHARE_COLORS = ["#d9603b", "#3b82d9", "#8a5cd6", "#2f9e6e", "#c2417a", "#c79a1e"];

/** Invite people to the live scene and set how you appear to them. */
export function ShareDialog() {
  const open = useShareDialog((state) => state.open);
  const setOpen = useShareDialog((state) => state.setOpen);
  const peers = useWorkspaceStore((state) => state.peers);
  const selfId = useWorkspaceStore((state) => state.selfId);
  const connection = useWorkspaceStore((state) => state.connection);
  const scene = useWorkspaceStore((state) => state.scene);
  const [addresses, setAddresses] = useState<string[]>([]);
  const [name, setName] = useState(currentIdentity.name);
  const [color, setColor] = useState(currentIdentity.color);
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setName(currentIdentity.name);
    setColor(currentIdentity.color);
    fetch("/api/network").then((response) => response.json()).then((data: { addresses: string[] }) => setAddresses(data.addresses)).catch(() => setAddresses([]));
  }, [open]);
  if (!open) return null;

  const sceneId = currentProjectId() ?? "default";
  const link = projectUrl(sceneId);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(location.hostname);
  const lanLinks = loopback ? addresses.map((address) => `${location.protocol}//${address}:${location.port}/project/${encodeURIComponent(sceneId)}`) : [];
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      useWorkspaceStore.getState().notify("error", "Copy failed. Select the link and copy it manually.");
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="share-title" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
      <div className="modal share-modal">
        <header className="share-head">
          <h2 id="share-title">Share “{scene.name}”</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={() => setOpen(false)}><X size={16} /></button>
        </header>
        <div className={"share-access" + (loopback ? " share-access--local" : "")}>
          <span className="share-access-icon">{loopback ? <Laptop size={16} /> : <Globe2 size={16} />}</span>
          <span>
            <strong>{loopback ? "Only this computer can open this link" : "Anyone with the link can edit"}</strong>
            <span>{loopback
              ? "You're running Orbis locally. Use the deployed site to share over the internet."
              : "No sign-up needed. Everyone who opens it joins this live scene, and conflicting edits are never silently overwritten."}</span>
          </span>
        </div>
        <div className="share-primary">
          <span className="share-url"><Link2 size={14} /><input readOnly value={link} onFocus={(event) => event.currentTarget.select()} aria-label="Project link" /></span>
          <button type="button" className="primary-button" onClick={() => void copy(link)}>{copied === link ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy link</>}</button>
        </div>
        {lanLinks.length ? (
          <details className="share-lan">
            <summary>Same Wi-Fi links</summary>
            <p className="field-note">Work only for devices on your network, and only when started with <code>npm run dev:share</code>.</p>
            {lanLinks.map((lan) => (
              <div key={lan} className="share-link">
                <input readOnly value={lan} onFocus={(event) => event.currentTarget.select()} aria-label="Same network link" />
                <button type="button" className="ghost-button" onClick={() => void copy(lan)}>{copied === lan ? "Copied" : "Copy"}</button>
              </div>
            ))}
          </details>
        ) : null}
        <div className="share-section-title">You appear as</div>
        <div className="share-identity">
          <input className="share-name" value={name} maxLength={40} onChange={(event) => setName(event.target.value)} aria-label="Your display name" />
          <div className="share-colors" role="radiogroup" aria-label="Your colour">
            {SHARE_COLORS.map((swatch) => <button key={swatch} type="button" role="radio" aria-checked={color === swatch} aria-label={swatch} className={"share-color" + (color === swatch ? " share-color--active" : "")} style={{ background: swatch }} onClick={() => setColor(swatch)} />)}
          </div>
          <button type="button" className="primary-button" disabled={!name.trim() || (name.trim() === currentIdentity.name && color === currentIdentity.color)} onClick={() => useWorkspaceStore.getState().rename(name.trim(), color)}>Update</button>
        </div>
        <div className="share-section-title">In this scene now · {connection === "online" ? peers.length : 0}</div>
        <ul className="share-people">
          {connection !== "online" ? <li className="field-note">Not connected to the collaboration server.</li> : null}
          {peers.map((peer) => (
            <li key={peer.clientId}>
              <span className="avatar" style={{ background: peer.color, marginLeft: 0 }}>{peer.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span>
              <span><strong>{peer.name}{peer.clientId === selfId ? " (you)" : ""}</strong><span className="muted">{peer.selectedId ? "editing " + (scene.furniture.find((item) => item.id === peer.selectedId)?.name ?? scene.rooms.find((room) => room.id === peer.selectedId)?.name ?? "an object") : "viewing"}</span></span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Shown when a link points to a project that doesn't exist (typo) or was deleted while open. */
export function MissingProject() {
  const connection = useWorkspaceStore((state) => state.connection);
  if (connection !== "missing") return null;
  return (
    <div className="modal-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="missing-title">
      <div className="modal join-modal">
        <h2 id="missing-title">This project isn't available</h2>
        <p className="field-note">The link may be mistyped, or the project was deleted by the person who created it. Ask them for a fresh link.</p>
        <div className="join-actions"><button type="button" className="primary-button" onClick={() => location.assign("/")}>Go to my projects</button></div>
      </div>
    </div>
  );
}

const PROFILE_SET = "rb.profile";

/** First visit in this browser: pick the name collaborators will see. Never blocks editing (Skip keeps the guest name). */
export function JoinPrompt() {
  const connection = useWorkspaceStore((state) => state.connection);
  const scene = useWorkspaceStore((state) => state.scene);
  const peers = useWorkspaceStore((state) => state.peers);
  const [open, setOpen] = useState(() => {
    try {
      return !localStorage.getItem(PROFILE_SET);
    } catch {
      return false;
    }
  });
  const [name, setName] = useState(currentIdentity.name);
  if (!open || connection !== "online") return null;
  const finish = (save: boolean) => {
    const value = name.trim().slice(0, 40) || currentIdentity.name;
    saveDefaultProfile(save ? value : currentIdentity.name, currentIdentity.color);
    if (save && value !== currentIdentity.name) useWorkspaceStore.getState().rename(value, currentIdentity.color);
    setOpen(false);
  };
  const others = peers.filter((peer) => peer.name !== currentIdentity.name);
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="join-title">
      <form className="modal join-modal" onSubmit={(event) => { event.preventDefault(); finish(true); }}>
        <h2 id="join-title">Join “{scene.name}”</h2>
        <p className="field-note">{others.length ? `${others.map((peer) => peer.name).slice(0, 3).join(", ")}${others.length > 3 ? " and others are" : others.length > 1 ? " are" : " is"} here. ` : ""}Pick the name others will see next to your edits.</p>
        <input className="share-name join-name" autoFocus value={name} maxLength={40} onChange={(event) => setName(event.target.value)} aria-label="Your display name" />
        <div className="join-actions">
          <button type="button" className="ghost-button" onClick={() => finish(false)}>Skip</button>
          <button type="submit" className="primary-button" disabled={!name.trim()}>Start editing</button>
        </div>
      </form>
    </div>
  );
}
