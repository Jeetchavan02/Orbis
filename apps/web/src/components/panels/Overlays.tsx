import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import type { FurnitureObject, Room } from "@reality-builder/shared";
import { usePerfStore } from "../../lib/perf";
import { useWorkspaceStore } from "../../store/workspace";

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
