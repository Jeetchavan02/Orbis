import { createServer } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer, type WebSocket } from "ws";
import { ApiHealthSchema, SceneSchema, type Scene, type ServerMessage } from "@reality-builder/shared";
import { SceneSession, type ClientHandle } from "./sessions.js";

const here = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(here, "../data/scenes");
const DEFAULT_FIXTURE = resolve(here, "../../fixtures/bedroom-scene.json");
const SCENE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const AUTOSAVE_DELAY_MS = 1500;

const app = express();
app.use(express.json({ limit: "25mb" }));
const server = createServer(app);
const websocketServer = new WebSocketServer({ server, path: "/ws", maxPayload: 25 * 1024 * 1024 });

const sessions = new Map<string, Promise<SceneSession>>();
const saveTimers = new Map<string, NodeJS.Timeout>();
const lastSaved = new Map<string, string>();

const scenePath = (id: string) => resolve(DATA_DIR, id + ".json");

async function loadInitialScene(id: string): Promise<Scene> {
  try {
    return SceneSchema.parse(JSON.parse(await readFile(scenePath(id), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(`Saved scene "${id}" is unreadable; starting from the demo scene.`, error);
    }
    const scene = SceneSchema.parse(JSON.parse(await readFile(DEFAULT_FIXTURE, "utf8")));
    return { ...scene, id };
  }
}

async function persist(id: string, session: SceneSession) {
  await mkdir(DATA_DIR, { recursive: true });
  const target = scenePath(id);
  const temp = target + ".tmp";
  await writeFile(temp, JSON.stringify(session.scene, null, 2));
  await rename(temp, target);
  session.dirty = false;
  const savedAt = new Date().toISOString();
  lastSaved.set(id, savedAt);
  session.broadcast({ type: "saved", savedAt, path: "server/data/scenes/" + id + ".json" });
}

function scheduleSave(id: string, session: SceneSession, immediate = false) {
  clearTimeout(saveTimers.get(id));
  saveTimers.set(id, setTimeout(() => {
    persist(id, session).catch((error) => {
      console.error(`Failed to save scene "${id}"`, error);
      session.broadcast({ type: "error", message: "Saving failed on the server: " + (error as Error).message });
    });
  }, immediate ? 0 : AUTOSAVE_DELAY_MS));
}

function getSession(id: string): Promise<SceneSession> {
  let session = sessions.get(id);
  if (!session) {
    session = loadInitialScene(id).then((scene) => new SceneSession(scene, (changed, immediate) => scheduleSave(id, changed, immediate)));
    sessions.set(id, session);
  }
  return session;
}

app.get("/api/health", (_request, response) => {
  response.status(200).json(ApiHealthSchema.parse({ status: "ok", service: "reality-builder-api", timestamp: new Date().toISOString() }));
});

app.get("/api/scenes/:id", async (request, response) => {
  if (!SCENE_ID_PATTERN.test(request.params.id)) return response.status(400).json({ error: "Invalid scene id." });
  const session = await getSession(request.params.id);
  response.json({ scene: session.scene, seq: session.seq, savedAt: lastSaved.get(request.params.id) ?? null });
});

websocketServer.on("connection", (socket: WebSocket, request) => {
  const url = new URL(request.url ?? "/ws", "http://localhost");
  const sceneId = url.searchParams.get("scene") ?? "default";
  if (!SCENE_ID_PATTERN.test(sceneId)) {
    socket.close(1008, "Invalid scene id");
    return;
  }
  const handle: ClientHandle = {
    send: (message: ServerMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    },
  };
  const ready = getSession(sceneId).then((session) => {
    session.connect(handle);
    return session;
  });

  socket.on("message", async (data) => {
    const session = await ready;
    let payload: unknown;
    try {
      payload = JSON.parse(String(data));
    } catch {
      handle.send({ type: "error", message: "Messages must be JSON." });
      return;
    }
    session.handle(handle, payload);
  });

  socket.on("close", async () => (await ready).disconnect(handle));
  socket.on("error", (error) => console.error("WebSocket error", error));
});

const port = Number(process.env.API_PORT ?? 3001);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("API_PORT must be an integer between 1 and 65535.");
}

server.listen(port, "127.0.0.1", () => {
  console.log("Reality Builder API listening at http://127.0.0.1:" + port);
});

async function shutdown() {
  // Flush pending autosaves before exiting.
  for (const [id, timer] of saveTimers) {
    clearTimeout(timer);
    const session = await sessions.get(id);
    if (session?.dirty) await persist(id, session).catch((error) => console.error(error));
  }
  websocketServer.close();
  server.close(() => process.exit(0));
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
