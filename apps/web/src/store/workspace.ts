import { create } from "zustand";
import {
  applySceneAction,
  baseVersionsFor,
  describeAction,
  entityVersion,
  SceneActionError,
  SceneSchema,
  touchedEntityIds,
  type Conflict,
  type HistoryEntry,
  type Peer,
  type Scene,
  type SceneAction,
  type ServerMessage,
} from "@reality-builder/shared";
import type { RecoveryCandidate, RecoveryResult, ValidationResult } from "@reality-builder/spatial-engine";
import { starterScene } from "../data/scene";
import { CollabClient, sessionIdentity, type ConnectionState } from "../lib/collab";
import type { WorkerRequest, WorkerResponse } from "../workers/spatial.worker";

export type TransformTool = "select" | "translate" | "rotate" | "scale" | "vertex" | "face";

/** History entry plus the entity versions to use as the base for its next undo/redo (stale-checked by the server). */
export type TrackedEntry = HistoryEntry & { versions: Record<string, number> };

type PendingKind = "do" | "undo" | "redo";
type Pending = { kind: PendingKind; label: string; action: SceneAction; entry?: TrackedEntry };

export type ConflictState = {
  requestId: string;
  message: string;
  conflicts: Conflict[];
  pending: Pending;
};

export type OfflineConflict = { localScene: Scene; serverScene: Scene; edits: number };

export type Notice = { id: number; tone: "info" | "error" | "success"; text: string };

export type MeshSelection = { vertex: number | null; face: number[] | null };

type WorkspaceStore = {
  scene: Scene;
  history: { past: TrackedEntry[]; future: TrackedEntry[] };
  selectedEntityId: string;
  tool: TransformTool;
  resetCameraSignal: number;
  focusSignal: number;

  connection: ConnectionState;
  selfId: string;
  peers: Peer[];
  conflict: ConflictState | null;
  offlineConflict: OfflineConflict | null;
  /** Edits applied locally while disconnected (not on the server). */
  offlineEdits: number;
  saveStatus: { state: "saved" | "unsaved" | "saving" | "local"; savedAt: string | null; path: string | null };

  validation: ValidationResult | null;
  showRoutes: boolean;
  showPerf: boolean;
  recovery: { status: "idle" | "running" | "done" | "error"; result: RecoveryResult | null; previewId: string | null; message?: string };
  mesh: MeshSelection;
  notices: Notice[];

  /** Every scene mutation goes through here. `base` = entity versions when the user started the edit. */
  dispatch: (action: SceneAction, options?: { base?: Record<string, number>; label?: string }) => boolean;
  undo: () => void;
  redo: () => void;
  replaceScene: (scene: Scene, reason: string) => void;
  save: () => void;
  resolveConflict: (choice: "mine" | "theirs") => void;
  resolveOfflineConflict: (choice: "mine" | "theirs") => void;
  selectEntity: (entityId: string) => void;
  setTool: (tool: TransformTool) => void;
  setMeshSelection: (selection: Partial<MeshSelection>) => void;
  requestCameraReset: () => void;
  requestFocus: () => void;
  runRecovery: () => void;
  previewCandidate: (id: string | null) => void;
  applyCandidate: (candidate: RecoveryCandidate) => void;
  setShowRoutes: (show: boolean) => void;
  revalidate: () => void;
  setShowPerf: (show: boolean) => void;
  notify: (tone: Notice["tone"], text: string) => void;
  dismissNotice: (id: number) => void;
};

const HISTORY_LIMIT = 200;
let requestCounter = 0;
let noticeCounter = 0;

function versionsFor(scene: Scene, ...actions: SceneAction[]) {
  const versions: Record<string, number> = {};
  for (const action of actions) {
    for (const id of touchedEntityIds(action)) {
      const version = entityVersion(scene, id);
      if (version !== null) versions[id] = version;
    }
  }
  return versions;
}

function pick(versions: Record<string, number>, action: SceneAction) {
  const result: Record<string, number> = {};
  for (const id of touchedEntityIds(action)) if (versions[id] !== undefined) result[id] = versions[id]!;
  return result;
}

const identity = sessionIdentity();
const OFFLINE_KEY = "rb.offline-scene";

/** Offline edits survive a reload of this tab until they are reconciled with the server. */
function loadOfflineWork(): { scene: Scene; edits: number } | null {
  try {
    const raw = sessionStorage.getItem(OFFLINE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { scene: unknown; edits: number };
    const scene = SceneSchema.safeParse(parsed.scene);
    return scene.success && parsed.edits > 0 ? { scene: scene.data, edits: parsed.edits } : null;
  } catch {
    return null;
  }
}
function storeOfflineWork(scene: Scene, edits: number) {
  try {
    if (edits > 0) sessionStorage.setItem(OFFLINE_KEY, JSON.stringify({ scene, edits }));
    else sessionStorage.removeItem(OFFLINE_KEY);
  } catch (error) {
    console.warn("Could not persist offline edits for this tab", error);
  }
}
const restoredOfflineWork = loadOfflineWork();
const sceneId = new URLSearchParams(location.search).get("scene") ?? "default";

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => {
  const pending = new Map<string, Pending>();

  const apply = (scene: Scene, action: SceneAction) => applySceneAction(scene, action);

  const notify = (tone: Notice["tone"], text: string) => {
    const id = ++noticeCounter;
    set((state) => ({ notices: [...state.notices.slice(-3), { id, tone, text }] }));
    window.setTimeout(() => get().dismissNotice(id), tone === "error" ? 7000 : 4000);
  };

  const sendAction = (kind: PendingKind, action: SceneAction, label: string, base: Record<string, number>, entry?: TrackedEntry) => {
    const requestId = identity.clientId.slice(0, 8) + "-" + ++requestCounter;
    const sent = client.send({ type: "action", requestId, action, baseVersions: base, label });
    if (sent) pending.set(requestId, { kind, label, action, entry });
    return sent;
  };

  /** Local-only application (no server reachable). */
  const applyLocally = (kind: PendingKind, action: SceneAction, label: string, entry?: TrackedEntry) => {
    try {
      const { scene, inverse } = apply(get().scene, action);
      recordApplied(kind, scene, action, inverse, label, entry);
      set((state) => ({ offlineEdits: state.offlineEdits + 1, saveStatus: { ...state.saveStatus, state: "local" } }));
      storeOfflineWork(get().scene, get().offlineEdits);
      return true;
    } catch (error) {
      notify("error", error instanceof SceneActionError ? error.message : String(error));
      if (!(error instanceof SceneActionError)) console.error(error);
      return false;
    }
  };

  const recordApplied = (kind: PendingKind, scene: Scene, action: SceneAction, inverse: SceneAction, label: string, entry?: TrackedEntry) => {
    const { history, selectedEntityId } = get();
    let past = history.past;
    let future = history.future;
    if (kind === "do") {
      const tracked: TrackedEntry = { label, forward: action, inverse, versions: versionsFor(scene, action, inverse) };
      past = [...past, tracked].slice(-HISTORY_LIMIT);
      future = [];
    } else if (kind === "undo" && entry) {
      past = past.filter((item) => item !== entry);
      future = [{ ...entry, versions: versionsFor(scene, entry.forward, entry.inverse) }, ...future];
    } else if (kind === "redo" && entry) {
      future = future.filter((item) => item !== entry);
      past = [...past, { ...entry, inverse, versions: versionsFor(scene, entry.forward, inverse) }];
    }
    const stillExists = !selectedEntityId || scene.furniture.some((item) => item.id === selectedEntityId) || scene.rooms.some((room) => room.id === selectedEntityId);
    set({ scene, history: { past, future }, selectedEntityId: stillExists ? selectedEntityId : "", saveStatus: { ...get().saveStatus, state: get().connection === "online" ? "unsaved" : "local" } });
  };

  const handleMessage = (message: ServerMessage) => {
    switch (message.type) {
      case "welcome": {
        const { offlineEdits, scene: localScene } = get();
        pending.clear();
        if (offlineEdits > 0) {
          // Never silently drop offline work: ask which version wins.
          set({ selfId: message.selfId, peers: message.peers, offlineConflict: { localScene, serverScene: message.scene, edits: offlineEdits } });
          return;
        }
        set({ scene: message.scene, selfId: message.selfId, peers: message.peers, saveStatus: { state: "saved", savedAt: null, path: null } });
        return;
      }
      case "applied": {
        let result;
        try {
          result = apply(get().scene, message.action);
        } catch (error) {
          console.error("Failed to apply a server-accepted action; resynchronizing.", error);
          client.close();
          client.connect();
          return;
        }
        const own = message.clientId === get().selfId && message.requestId ? pending.get(message.requestId) : undefined;
        if (own && message.requestId) {
          pending.delete(message.requestId);
          recordApplied(own.kind, result.scene, message.action, result.inverse, own.label, own.entry);
        } else {
          const { selectedEntityId } = get();
          const exists = !selectedEntityId || result.scene.furniture.some((item) => item.id === selectedEntityId) || result.scene.rooms.some((room) => room.id === selectedEntityId);
          set({ scene: result.scene, selectedEntityId: exists ? selectedEntityId : "", saveStatus: { ...get().saveStatus, state: "unsaved" } });
        }
        return;
      }
      case "rejected": {
        const entry = pending.get(message.requestId);
        pending.delete(message.requestId);
        if (!entry) return;
        if (message.reason === "stale") {
          set({ conflict: { requestId: message.requestId, message: message.message, conflicts: message.conflicts, pending: entry } });
        } else {
          notify("error", message.message);
          if (entry.entry) dropEntry(entry.entry);
        }
        return;
      }
      case "peers":
        set({ peers: message.peers });
        return;
      case "saved":
        set({ saveStatus: { state: "saved", savedAt: message.savedAt, path: message.path } });
        return;
      case "scene-replaced": {
        pending.clear();
        set({ scene: message.scene, history: { past: [], future: [] }, selectedEntityId: "", recovery: { status: "idle", result: null, previewId: null } });
        if (message.by !== identity.name) notify("info", `${message.by} loaded a different scene.`);
        return;
      }
      case "error":
        notify("error", message.message);
        return;
    }
  };

  const dropEntry = (entry: TrackedEntry) => {
    set((state) => ({ history: { past: state.history.past.filter((item) => item !== entry), future: state.history.future.filter((item) => item !== entry) } }));
  };

  const client = new CollabClient(sceneId, identity, {
    onMessage: handleMessage,
    onState: (connection) => {
      set({ connection });
      if (connection === "offline") {
        // In-flight requests may or may not have been applied; the next welcome is authoritative.
        pending.clear();
      }
    },
  });

  // ---- Spatial worker: validation runs off the main thread on every scene change.
  const worker = new Worker(new URL("../workers/spatial.worker.ts", import.meta.url), { type: "module" });
  let validateId = 0;
  let inFlight = false;
  let queued = false;
  let recoverId = 0;
  const requestValidation = () => {
    if (inFlight) {
      queued = true;
      return;
    }
    inFlight = true;
    queued = false;
    worker.postMessage({ type: "validate", id: ++validateId, scene: get().scene, routes: get().showRoutes } satisfies WorkerRequest);
  };
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const response = event.data;
    if (response.type === "validate") {
      inFlight = false;
      set({ validation: response.result });
      if (queued) requestValidation();
    } else if (response.type === "recover") {
      if (response.id !== recoverId) return;
      set({ recovery: { status: "done", result: response.result, previewId: response.result.candidates[0]?.id ?? null } });
    } else {
      inFlight = false;
      console.error("Spatial worker error:", response.message);
      set({ recovery: { ...get().recovery, status: get().recovery.status === "running" ? "error" : get().recovery.status, message: response.message } });
      notify("error", "Spatial engine error: " + response.message);
    }
  };
  worker.onerror = (event) => {
    console.error("Spatial worker crashed", event);
    notify("error", "The spatial engine worker failed to start.");
  };

  queueMicrotask(() => {
    requestValidation();
    client.connect();
  });

  return {
    scene: restoredOfflineWork?.scene ?? starterScene,
    history: { past: [], future: [] },
    selectedEntityId: "",
    tool: "translate",
    resetCameraSignal: 0,
    focusSignal: 0,
    connection: "connecting",
    selfId: "",
    peers: [],
    conflict: null,
    offlineConflict: null,
    offlineEdits: restoredOfflineWork?.edits ?? 0,
    saveStatus: { state: restoredOfflineWork ? "local" : "saved", savedAt: null, path: null },
    validation: null,
    showRoutes: false,
    showPerf: false,
    recovery: { status: "idle", result: null, previewId: null },
    mesh: { vertex: null, face: null },
    notices: [],

    dispatch: (action, options = {}) => {
      const label = options.label ?? describeAction(action);
      const state = get();
      let ok: boolean;
      if (state.connection === "online") {
        const base = { ...baseVersionsFor(state.scene, action), ...(options.base ? pick(options.base, action) : {}) };
        ok = sendAction("do", action, label, base);
        if (!ok) ok = applyLocally("do", action, label);
      } else {
        ok = applyLocally("do", action, label);
      }
      return ok;
    },

    undo: () => {
      const entry = get().history.past.at(-1);
      if (!entry || [...pending.values()].some((item) => item.kind !== "do")) return;
      if (get().connection === "online" && sendAction("undo", entry.inverse, "Undo " + entry.label, pick(entry.versions, entry.inverse), entry)) return;
      applyLocally("undo", entry.inverse, entry.label, entry);
    },

    redo: () => {
      const entry = get().history.future[0];
      if (!entry || [...pending.values()].some((item) => item.kind !== "do")) return;
      if (get().connection === "online" && sendAction("redo", entry.forward, "Redo " + entry.label, pick(entry.versions, entry.forward), entry)) return;
      applyLocally("redo", entry.forward, entry.label, entry);
    },

    replaceScene: (raw, reason) => {
      const parsed = SceneSchema.safeParse(raw);
      if (!parsed.success) {
        notify("error", "That scene file is not valid: " + parsed.error.issues.slice(0, 2).map((issue) => issue.path.join(".") + " " + issue.message).join("; "));
        return;
      }
      const scene = parsed.data;
      if (get().connection === "online" && client.send({ type: "load-scene", scene })) {
        notify("success", reason);
        return;
      }
      set({ scene, history: { past: [], future: [] }, selectedEntityId: "", offlineEdits: get().offlineEdits + 1, saveStatus: { state: "local", savedAt: null, path: null } });
      storeOfflineWork(scene, get().offlineEdits);
      notify("success", reason + " (local only)");
    },

    save: () => {
      if (get().connection === "online" && client.send({ type: "save" })) {
        set((state) => ({ saveStatus: { ...state.saveStatus, state: "saving" } }));
      } else {
        downloadScene(get().scene);
        notify("info", "Server unavailable — scene downloaded as a JSON file instead.");
      }
    },

    resolveConflict: (choice) => {
      const conflict = get().conflict;
      if (!conflict) return;
      set({ conflict: null });
      const { pending: request } = conflict;
      if (choice === "mine") {
        // Explicit user choice: resubmit against the versions that are current now.
        const base = baseVersionsFor(get().scene, request.action);
        if (!sendAction(request.kind, request.action, request.label, base, request.entry)) notify("error", "Not connected — could not resubmit.");
      } else if (request.entry) {
        dropEntry(request.entry);
        notify("info", "Kept their version. That step was removed from your history.");
      }
    },

    resolveOfflineConflict: (choice) => {
      const offline = get().offlineConflict;
      if (!offline) return;
      set({ offlineConflict: null, offlineEdits: 0, history: { past: [], future: [] } });
      storeOfflineWork(offline.localScene, 0);
      if (choice === "mine") {
        client.send({ type: "load-scene", scene: offline.localScene });
      } else {
        set({ scene: offline.serverScene, saveStatus: { state: "saved", savedAt: null, path: null } });
      }
    },

    selectEntity: (selectedEntityId) => {
      if (selectedEntityId === get().selectedEntityId) return;
      set({ selectedEntityId, mesh: { vertex: null, face: null } });
      if (get().tool === "vertex" || get().tool === "face") set({ tool: "translate" });
      client.send({ type: "presence", selectedId: selectedEntityId || null });
    },
    setTool: (tool) => set({ tool, mesh: { vertex: null, face: null } }),
    setMeshSelection: (selection) => set((state) => ({ mesh: { ...state.mesh, ...selection } })),
    requestCameraReset: () => set((state) => ({ resetCameraSignal: state.resetCameraSignal + 1 })),
    requestFocus: () => set((state) => ({ focusSignal: state.focusSignal + 1 })),

    runRecovery: () => {
      recoverId += 1;
      set({ recovery: { status: "running", result: null, previewId: null } });
      worker.postMessage({ type: "recover", id: recoverId, scene: get().scene } satisfies WorkerRequest);
    },
    previewCandidate: (previewId) => set((state) => ({ recovery: { ...state.recovery, previewId } })),
    applyCandidate: (candidate) => {
      if (get().dispatch(candidate.action, { label: candidate.action.type === "batch" ? candidate.action.label : "Apply layout fix" })) {
        set({ recovery: { status: "idle", result: null, previewId: null } });
        notify("success", `Applied “${candidate.label}”. Undo with ⌘Z.`);
      }
    },
    setShowRoutes: (showRoutes) => {
      set({ showRoutes });
      requestValidation();
    },
    revalidate: requestValidation,
    setShowPerf: (showPerf) => set({ showPerf }),
    notify,
    dismissNotice: (id) => set((state) => ({ notices: state.notices.filter((notice) => notice.id !== id) })),
  };
});

// Any scene change (local, remote, undo, load) re-runs validation and invalidates stale recovery results.
let previousScene = useWorkspaceStore.getState().scene;
useWorkspaceStore.subscribe((state) => {
  if (state.scene === previousScene) return;
  previousScene = state.scene;
  state.revalidate();
  if (state.recovery.status === "done" || state.recovery.status === "error") {
    useWorkspaceStore.setState({ recovery: { status: "idle", result: null, previewId: null } });
  }
});

export function downloadScene(scene: Scene) {
  const blob = new Blob([JSON.stringify(scene, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = scene.name.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase() + ".json";
  link.click();
  URL.revokeObjectURL(url);
}

export function newEntityId(prefix: string) {
  return prefix + "-" + crypto.randomUUID().slice(0, 8);
}

export const currentIdentity = identity;
