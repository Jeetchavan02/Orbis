import {
  applySceneAction,
  ClientMessageSchema,
  entityVersion,
  SceneActionError,
  SceneSchema,
  touchedEntityIds,
  type Conflict,
  type Peer,
  type Scene,
  type SceneAction,
  type ServerMessage,
} from "@reality-builder/shared";

/** `owner`: the project's creator (account or owner key); owners can edit even when the link is view-only. */
export type ClientHandle = { send: (message: ServerMessage) => void; close?: () => void; owner?: boolean };
export type LinkAccess = "edit" | "view";

type Connected = { handle: ClientHandle; peer: Peer | null };

/**
 * Authoritative state for one scene. All edits are validated against per-entity base versions;
 * stale edits are rejected with conflict details instead of being applied (no silent overwrites).
 */
export class SceneSession {
  scene: Scene;
  seq = 0;
  dirty = false;
  private clients = new Map<ClientHandle, Connected>();
  /** Display name of whoever last changed each entity, for conflict explanations. */
  private lastChangedBy = new Map<string, string>();

  /** What anyone with the share link may do. */
  linkAccess: LinkAccess = "edit";

  canEdit(handle: ClientHandle) {
    return this.linkAccess === "edit" || !!handle.owner;
  }

  private accessMessage(handle: ClientHandle): ServerMessage {
    return { type: "access", linkAccess: this.linkAccess, canEdit: this.canEdit(handle), owner: !!handle.owner };
  }

  /** Changes the link permission and tells every connected client what it may now do. */
  setLinkAccess(access: LinkAccess) {
    this.linkAccess = access;
    for (const client of this.clients.values()) if (client.peer) client.handle.send(this.accessMessage(client.handle));
  }

  constructor(scene: Scene, private readonly onChange: (session: SceneSession, immediate: boolean) => void = () => {}) {
    this.scene = SceneSchema.parse(scene);
  }

  connect(handle: ClientHandle) {
    this.clients.set(handle, { handle, peer: null });
  }

  disconnect(handle: ClientHandle) {
    const had = this.clients.get(handle)?.peer;
    this.clients.delete(handle);
    if (had) this.broadcastPeers();
  }

  get peers(): Peer[] {
    return [...this.clients.values()].flatMap((client) => (client.peer ? [client.peer] : []));
  }

  handle(handle: ClientHandle, raw: unknown) {
    const parsed = ClientMessageSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const detail = (issue?.path.join(".") ?? "") + ": " + (issue?.message ?? "invalid");
      const candidate = raw as { type?: unknown; requestId?: unknown };
      if (candidate?.type === "action" && typeof candidate.requestId === "string") {
        handle.send({ type: "rejected", requestId: candidate.requestId, reason: "invalid", message: "Invalid action — " + detail, conflicts: [] });
      } else {
        handle.send({ type: "error", message: "Malformed message — " + detail });
      }
      return;
    }
    const message = parsed.data;
    const client = this.clients.get(handle);
    if (!client) return;

    switch (message.type) {
      case "hello": {
        // A reconnecting tab reuses its clientId: drop the stale connection so presence has no duplicates.
        for (const [other, entry] of this.clients) {
          if (other !== handle && entry.peer?.clientId === message.clientId) {
            this.clients.delete(other);
            other.close?.();
          }
        }
        client.peer = { clientId: message.clientId, name: message.name, color: message.color, selectedId: null, cursor: null };
        handle.send({ type: "welcome", scene: this.scene, seq: this.seq, peers: this.peers, selfId: message.clientId });
        handle.send(this.accessMessage(handle));
        this.broadcastPeers();
        return;
      }
      case "presence": {
        if (!client.peer) return;
        client.peer = {
          ...client.peer,
          ...(message.selectedId !== undefined ? { selectedId: message.selectedId } : {}),
          ...(message.cursor !== undefined ? { cursor: message.cursor } : {}),
        };
        this.broadcastPeers();
        return;
      }
      case "rename": {
        if (!client.peer) return;
        client.peer = { ...client.peer, name: message.name, color: message.color };
        this.broadcastPeers();
        return;
      }
      case "action": {
        if (!client.peer) {
          handle.send({ type: "error", message: "Send hello before editing." });
          return;
        }
        if (!this.canEdit(handle)) {
          handle.send({ type: "rejected", requestId: message.requestId, reason: "invalid", message: "This link is view only. Ask the owner for edit access.", conflicts: [] });
          return;
        }
        this.applyAction(handle, client.peer, message.requestId, message.action, message.baseVersions, message.label);
        return;
      }
      case "load-scene": {
        if (!client.peer) return;
        if (!this.canEdit(handle)) {
          handle.send({ type: "load-rejected", requestId: message.requestId, seq: this.seq, message: "This link is view only, so the scene wasn't replaced." });
          return;
        }
        if (message.baseSeq !== this.seq) {
          // Someone changed the scene after this client last synced: never let an older snapshot win silently.
          const by = [...new Set(this.lastChangedBy.values())].filter((name) => name !== client.peer!.name);
          handle.send({
            type: "load-rejected",
            requestId: message.requestId,
            seq: this.seq,
            message: `The scene changed${by.length ? " (" + by.slice(0, 3).join(", ") + ")" : ""} since you last synced, so your version was not applied. Nothing was overwritten.`,
          });
          return;
        }
        this.scene = supersede(this.scene, message.scene);
        this.seq += 1;
        this.lastChangedBy.clear();
        this.dirty = true;
        this.broadcast({ type: "scene-replaced", scene: this.scene, seq: this.seq, by: client.peer.name });
        this.onChange(this, true);
        return;
      }
      case "save": {
        this.onChange(this, true);
        return;
      }
    }
  }

  private applyAction(handle: ClientHandle, peer: Peer, requestId: string, action: SceneAction, baseVersions: Record<string, number>, label: string) {
    const conflicts: Conflict[] = [];
    for (const id of touchedEntityIds(action)) {
      const current = entityVersion(this.scene, id);
      const base = baseVersions[id];
      if (base === undefined || current !== base) {
        const entity = this.scene.furniture.find((item) => item.id === id) ?? this.scene.rooms.find((room) => room.id === id) ?? null;
        conflicts.push({
          entityId: id,
          entityName: entity?.name ?? (id === "scene" ? "Scene settings" : id),
          baseVersion: base ?? -1,
          currentVersion: current,
          current: entity,
          changedBy: this.lastChangedBy.get(id) ?? null,
        });
      }
    }
    if (conflicts.length > 0) {
      const names = conflicts.map((conflict) => conflict.entityName).join(", ");
      const by = conflicts.find((conflict) => conflict.changedBy)?.changedBy;
      handle.send({
        type: "rejected",
        requestId,
        reason: "stale",
        message: conflicts.some((conflict) => conflict.currentVersion === null)
          ? `${names} no longer exists${by ? ` (deleted by ${by})` : ""}.`
          : `${names} was changed${by ? ` by ${by}` : " elsewhere"} after you started editing.`,
        conflicts,
      });
      return;
    }

    try {
      this.scene = applySceneAction(this.scene, action).scene;
    } catch (error) {
      handle.send({
        type: "rejected",
        requestId,
        reason: "invalid",
        message: error instanceof SceneActionError ? error.message : "The action could not be applied.",
        conflicts: [],
      });
      if (!(error instanceof SceneActionError)) console.error("Unexpected action failure", error);
      return;
    }

    this.seq += 1;
    this.dirty = true;
    const steps = action.type === "batch" ? action.actions : [action];
    for (const id of touchedEntityIds(action)) this.lastChangedBy.set(id, peer.name);
    for (const step of steps) {
      if (step.type === "furniture.create") this.lastChangedBy.set(step.furniture.id, peer.name);
      if (step.type === "room.create") this.lastChangedBy.set(step.room.id, peer.name);
    }
    this.broadcast({ type: "applied", seq: this.seq, clientId: peer.clientId, clientName: peer.name, requestId, label, action });
    this.onChange(this, false);
  }

  /** Disconnects everyone (e.g. the project was deleted). */
  closeAll(message: ServerMessage) {
    for (const client of this.clients.values()) {
      client.handle.send(message);
      client.handle.close?.();
    }
    this.clients.clear();
  }

  get size() {
    return this.clients.size;
  }

  broadcast(message: ServerMessage) {
    for (const client of this.clients.values()) if (client.peer) client.handle.send(message);
  }

  private broadcastPeers() {
    this.broadcast({ type: "peers", peers: this.peers });
  }
}

/**
 * A replacement scene gets entity versions strictly above anything the old scene had, so an edit that was in
 * flight against the old scene is always rejected as stale instead of landing on a same-id object by accident.
 */
export function supersede(previous: Scene, next: Scene): Scene {
  const old = new Map<string, number>();
  for (const item of previous.furniture) old.set(item.id, item.version);
  for (const room of previous.rooms) old.set(room.id, room.version);
  const bump = (id: string, version: number) => Math.max(version, old.get(id) ?? 0) + 1;
  return {
    ...next,
    id: previous.id,
    settingsVersion: Math.max(next.settingsVersion, previous.settingsVersion) + 1,
    furniture: next.furniture.map((item) => ({ ...item, version: bump(item.id, item.version) })),
    rooms: next.rooms.map((room) => ({ ...room, version: bump(room.id, room.version) })),
  };
}
