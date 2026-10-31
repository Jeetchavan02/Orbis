import { createServer } from "node:http";
import { copyFile, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer, type WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { AiEditRequestSchema, AiImageRequestSchema, ApiHealthSchema, SceneSchema, type Scene, type ServerMessage } from "@reality-builder/shared";
import { AiUnavailableError, aiModel, runAiEdit, runImageToRoom } from "./ai.js";
import { SceneSession, type ClientHandle } from "./sessions.js";

const here = dirname(fileURLToPath(import.meta.url));
// Secrets live in apps/.env (or server/.env); they are only ever read on the server.
for (const file of [resolve(here, "../.env"), resolve(here, "../../.env")]) {
  if (existsSync(file)) process.loadEnvFile(file);
}
const DATA_DIR = resolve(here, "../data/scenes");
const DEFAULT_FIXTURE = resolve(here, "../../fixtures/bedroom-scene.json");
const SCENE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const AUTOSAVE_DELAY_MS = 1500;
const THUMB_DIR = resolve(here, "../data/thumbnails");
const FIXTURES = resolve(here, "../../fixtures");
/** Starting points offered by the homepage; each validates cleanly with the spatial engine. */
const TEMPLATE_FILES: Record<string, string> = {
  bedroom: "bedroom-scene.json",
  apartment: "apartment-scene.json",
  living: "templates/living.json",
  dining: "templates/dining.json",
  kitchen: "templates/kitchen.json",
  office: "templates/office.json",
};

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

// ---------- Projects (one JSON scene file per project) ----------
const thumbPath = (id: string) => resolve(THUMB_DIR, id + ".jpg");
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "project";
const newProjectId = (name: string) => `${slug(name)}-${randomUUID().slice(0, 4)}`;

async function currentScene(id: string): Promise<Scene | null> {
  const live = sessions.get(id);
  if (live) return (await live).scene;
  try {
    return SceneSchema.parse(JSON.parse(await readFile(scenePath(id), "utf8")));
  } catch {
    return null;
  }
}

async function writeProject(scene: Scene) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(scenePath(scene.id), JSON.stringify(scene, null, 2));
}

app.get("/api/projects", async (_request, response) => {
  await mkdir(DATA_DIR, { recursive: true });
  const files = (await readdir(DATA_DIR)).filter((file) => file.endsWith(".json"));
  const projects = [];
  for (const file of files) {
    const id = file.replace(/\.json$/, "");
    const scene = await currentScene(id);
    if (!scene) continue;
    const info = await stat(scenePath(id));
    projects.push({
      id, name: scene.name, roomType: scene.roomType ?? (scene.rooms.length > 1 ? "apartment" : "bedroom"),
      objects: scene.furniture.length, floors: scene.rooms.length, updatedAt: info.mtime.toISOString(),
      thumbnail: existsSync(thumbPath(id)) ? `/api/projects/${id}/thumbnail?v=${(await stat(thumbPath(id))).mtimeMs}` : null,
    });
  }
  projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  response.json({ projects });
});

app.post("/api/projects", async (request, response) => {
  const { name, roomType, template, width, depth } = (request.body ?? {}) as { name?: string; roomType?: string; template?: string; width?: number; depth?: number };
  const title = (name ?? "").trim().slice(0, 80) || "Untitled project";
  let scene: Scene;
  if (template && TEMPLATE_FILES[template]) {
    scene = SceneSchema.parse(JSON.parse(await readFile(resolve(FIXTURES, TEMPLATE_FILES[template]), "utf8")));
  } else {
    // Blank room of the requested size with one door and one window.
    const w = Math.min(30, Math.max(2, Number(width) || 4.5));
    const d = Math.min(30, Math.max(2, Number(depth) || 4));
    scene = SceneSchema.parse({
      schemaVersion: 1, id: "blank", name: title, coordinateSystem: "y-up-xz-meters", furniture: [],
      rooms: [{ id: "room-main", name: title, position: { x: 0, y: 0, z: 0 }, yawDegrees: 0, dimensions: { width: w, depth: d, height: 2.7, wallThickness: 0.14 },
        openings: [{ id: "door-main", kind: "door", wall: "south", offset: Math.min(w / 2 - 0.6, 1), width: 0.9, height: 2.05, sillHeight: 0 }, { id: "window-main", kind: "window", wall: "north", offset: 0, width: Math.min(1.6, w - 0.6), height: 1.3, sillHeight: 0.9 }] }],
    });
  }
  const id = newProjectId(title);
  scene = { ...scene, id, name: title, roomType: roomType || scene.roomType };
  await writeProject(scene);
  response.status(201).json({ id });
});

app.post("/api/projects/:id/duplicate", async (request, response) => {
  if (!SCENE_ID_PATTERN.test(request.params.id)) return response.status(400).json({ error: "Invalid project id." });
  const scene = await currentScene(request.params.id);
  if (!scene) return response.status(404).json({ error: "Project not found." });
  const name = scene.name + " (copy)";
  const id = newProjectId(name);
  await writeProject({ ...scene, id, name });
  if (existsSync(thumbPath(request.params.id))) await copyFile(thumbPath(request.params.id), thumbPath(id));
  response.status(201).json({ id });
});

app.patch("/api/projects/:id", async (request, response) => {
  const id = request.params.id;
  const name = String((request.body as { name?: string })?.name ?? "").trim().slice(0, 80);
  if (!SCENE_ID_PATTERN.test(id) || !name) return response.status(400).json({ error: "A project name is required." });
  const live = sessions.get(id);
  if (live) {
    // Rename through the session so connected collaborators see it.
    const session = await live;
    session.scene = { ...session.scene, name, settingsVersion: session.scene.settingsVersion + 1 };
    session.broadcast({ type: "scene-replaced", scene: session.scene, seq: ++session.seq, by: "Rename" });
    await persist(id, session);
  } else {
    const scene = await currentScene(id);
    if (!scene) return response.status(404).json({ error: "Project not found." });
    await writeProject({ ...scene, name });
  }
  response.json({ ok: true });
});

app.delete("/api/projects/:id", async (request, response) => {
  const id = request.params.id;
  if (!SCENE_ID_PATTERN.test(id)) return response.status(400).json({ error: "Invalid project id." });
  sessions.delete(id);
  clearTimeout(saveTimers.get(id));
  await unlink(scenePath(id)).catch(() => undefined);
  await unlink(thumbPath(id)).catch(() => undefined);
  response.json({ ok: true });
});

app.put("/api/projects/:id/thumbnail", async (request, response) => {
  const id = request.params.id;
  const dataUrl = String((request.body as { dataUrl?: string })?.dataUrl ?? "");
  const match = /^data:image\/jpeg;base64,(.+)$/.exec(dataUrl);
  if (!SCENE_ID_PATTERN.test(id) || !match) return response.status(400).json({ error: "Expected a JPEG data URL." });
  await mkdir(THUMB_DIR, { recursive: true });
  await writeFile(thumbPath(id), Buffer.from(match[1]!, "base64"));
  response.json({ ok: true });
});

app.get("/api/projects/:id/thumbnail", (request, response) => {
  const id = request.params.id;
  if (!SCENE_ID_PATTERN.test(id) || !existsSync(thumbPath(id))) return response.status(404).end();
  response.sendFile(thumbPath(id));
});

app.get("/api/scenes/:id", async (request, response) => {
  if (!SCENE_ID_PATTERN.test(request.params.id)) return response.status(400).json({ error: "Invalid scene id." });
  const session = await getSession(request.params.id);
  response.json({ scene: session.scene, seq: session.seq, savedAt: lastSaved.get(request.params.id) ?? null });
});

const newId = () => "ai-" + randomUUID().slice(0, 8);

/** LAN addresses so the Share dialog can offer links other devices can open. */
app.get("/api/network", (_request, response) => {
  const addresses = Object.values(networkInterfaces()).flat()
    .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry!.address);
  response.json({ addresses });
});

app.get("/api/ai/status", (_request, response) => {
  response.json({ available: !!process.env.GEMINI_API_KEY, model: aiModel() });
});

app.post("/api/ai/edit", async (request, response) => {
  const parsed = AiEditRequestSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: "Invalid request: " + parsed.error.issues[0]?.message });
  try {
    response.json(await runAiEdit(parsed.data, newId));
  } catch (error) {
    console.error("AI edit failed", error);
    response.status(error instanceof AiUnavailableError ? 503 : 502).json({ error: (error as Error).message });
  }
});

app.post("/api/ai/image-to-room", async (request, response) => {
  const parsed = AiImageRequestSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: "Invalid request: " + parsed.error.issues[0]?.message });
  try {
    response.json(await runImageToRoom(parsed.data, newId));
  } catch (error) {
    console.error("Image-to-room failed", error);
    response.status(error instanceof AiUnavailableError ? 503 : 502).json({ error: (error as Error).message });
  }
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
    close: () => socket.close(4000, "Replaced by a newer connection from the same tab"),
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
