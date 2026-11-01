import { ServerMessageSchema, type ClientMessage, type ServerMessage } from "@reality-builder/shared";

/** "missing": the server says this project doesn't exist (bad link or deleted); no reconnect is attempted. */
/**
 * crypto.randomUUID only exists in secure contexts (HTTPS or localhost). Over plain http://<LAN-IP> it is undefined,
 * which used to crash the editor on "same Wi-Fi" links, so fall back to getRandomValues (available everywhere).
 */
export function uuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type ConnectionState = "connecting" | "online" | "offline" | "missing";

type Handlers = {
  onMessage: (message: ServerMessage) => void;
  onState: (state: ConnectionState) => void;
};

const PALETTE = ["#d9603b", "#3b82d9", "#8a5cd6", "#2f9e6e", "#c2417a", "#c79a1e"];
const ADJECTIVES = ["Amber", "Cobalt", "Juniper", "Coral", "Slate", "Saffron", "Indigo", "Moss"];
const ANIMALS = ["Fox", "Heron", "Otter", "Lynx", "Wren", "Ibex", "Marten", "Finch"];

/**
 * Collaborator identity. The display name/colour persist per tab; the clientId is new on every page load,
 * so duplicated or restored tabs (which copy sessionStorage) never share a connection identity.
 */
export function sessionIdentity() {
  const key = "rb.identity";
  let profile: { name: string; color: string } | null = null;
  try {
    const stored = sessionStorage.getItem(key);
    if (stored) profile = JSON.parse(stored) as { name: string; color: string };
  } catch {
    // Storage may be unavailable (private mode); fall through to a fresh profile.
  }
  // A default profile set on the homepage (Settings) applies to new tabs.
  if (!profile) {
    try {
      const stored = localStorage.getItem("rb.profile");
      if (stored) profile = JSON.parse(stored) as { name: string; color: string };
    } catch {
      // Ignore unreadable storage.
    }
  }
  if (!profile) {
    const random = crypto.getRandomValues(new Uint32Array(3));
    profile = {
      name: ADJECTIVES[random[0]! % ADJECTIVES.length] + " " + ANIMALS[random[1]! % ANIMALS.length],
      color: PALETTE[random[2]! % PALETTE.length]!,
    };
    try {
      sessionStorage.setItem(key, JSON.stringify(profile));
    } catch {
      // Not persisted; a reload will produce a new name.
    }
  }
  return { clientId: uuid(), ...profile };
}

/** Default profile for the homepage greeting and new tabs. */
export function loadProfile(): { name: string; color: string } {
  try {
    const stored = localStorage.getItem("rb.profile");
    if (stored) return JSON.parse(stored) as { name: string; color: string };
  } catch {
    // Fall through.
  }
  return { name: "Designer", color: "#6a3de8" };
}

export function saveDefaultProfile(name: string, color: string) {
  try {
    localStorage.setItem("rb.profile", JSON.stringify({ name, color }));
    sessionStorage.setItem("rb.identity", JSON.stringify({ name, color }));
  } catch {
    // Not persisted.
  }
}

/** Persists a new display name/colour for this tab. */
export function saveProfile(name: string, color: string) {
  try {
    sessionStorage.setItem("rb.identity", JSON.stringify({ name, color }));
  } catch {
    // Not persisted; applies to this session only.
  }
}

/** WebSocket client with exponential-backoff reconnection. The server is authoritative. */
export class CollabClient {
  private socket: WebSocket | null = null;
  private retry = 0;
  private timer: number | null = null;
  private closed = false;

  constructor(
    private readonly sceneId: string,
    private readonly identity: { clientId: string; name: string; color: string },
    private readonly handlers: Handlers,
  ) {}

  connect() {
    this.closed = false;
    this.handlers.onState("connecting");
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${location.host}/ws?scene=${encodeURIComponent(this.sceneId)}`);
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.retry = 0;
      this.send({ type: "hello", sceneId: this.sceneId, ...this.identity });
    });
    socket.addEventListener("message", (event) => {
      let payload: unknown;
      try {
        payload = JSON.parse(String(event.data));
      } catch (error) {
        console.error("Collaboration message is not JSON", error);
        return;
      }
      const parsed = ServerMessageSchema.safeParse(payload);
      if (!parsed.success) {
        console.error("Unexpected collaboration message", parsed.error.issues);
        return;
      }
      if (parsed.data.type === "welcome") this.handlers.onState("online");
      this.handlers.onMessage(parsed.data);
    });
    socket.addEventListener("close", (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (event.code === 4004) {
        this.handlers.onState("missing");
        return;
      }
      this.handlers.onState("offline");
      // 4000 = replaced by a newer connection from this same tab (or the project was deleted); reconnecting would fight it.
      if (!this.closed && event.code !== 4000) this.scheduleReconnect();
    });
  }

  private scheduleReconnect() {
    if (this.timer !== null) window.clearTimeout(this.timer);
    // Exponential backoff with jitter so many clients don't hammer a restarting server in lockstep.
    const delay = Math.min(10_000, 500 * 2 ** this.retry) * (0.8 + Math.random() * 0.4);
    this.retry += 1;
    this.timer = window.setTimeout(() => this.connect(), delay);
  }

  /** Skips the backoff wait (e.g. the browser just came back online). */
  reconnectNow() {
    if (this.closed || this.socket) return;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.retry = 0;
    this.connect();
  }

  /** Returns false when not connected; callers then fall back to local-only editing. */
  send(message: ClientMessage): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  close() {
    this.closed = true;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.socket?.close();
  }
}
