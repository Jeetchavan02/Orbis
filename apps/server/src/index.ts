import { createServer } from "node:http";
import { copyFile, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer, type WebSocket } from "ws";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { AiBriefRequestSchema, AiEditRequestSchema, AiImageRequestSchema, AiPlanAnalyzeRequestSchema, AiPlanBuildRequestSchema, ApiHealthSchema, SceneSchema, type Scene, type ServerMessage } from "@reality-builder/shared";
import { AiQuotaError, AiUnavailableError, aiModel, assembleRoom, runAiEdit, runBriefToRoom, runImageToRoom, runPlanAnalyze } from "./ai.js";
import { SceneSession, type ClientHandle } from "./sessions.js";

const here = dirname(fileURLToPath(import.meta.url));
// Secrets live in apps/.env (or server/.env); they are only ever read on the server.
for (const file of [resolve(here, "../.env"), resolve(here, "../../.env")]) {
  if (existsSync(file)) process.loadEnvFile(file);
}
/** Production = the deployed single-service build (serves the web app, listens publicly, private project list). */
const PRODUCTION = process.env.NODE_ENV === "production";
/** Where projects live. On a host with a persistent volume, point this at the volume (e.g. RB_DATA_DIR=/data). */
const DATA_ROOT = process.env.RB_DATA_DIR ? resolve(process.env.RB_DATA_DIR) : resolve(here, "../data");
/**
 * Public mode: the server is reachable by anyone on the internet. The homepage then only lists projects a browser
 * created or opened (by id), share links to unknown projects 404 instead of creating one, and deleting needs the
 * owner key. Defaults to on in production; RB_PUBLIC=1/0 overrides.
 */
const PUBLIC = process.env.RB_PUBLIC ? process.env.RB_PUBLIC === "1" : PRODUCTION;
const WEB_DIST = resolve(here, "../../web/dist");
const DATA_DIR = resolve(DATA_ROOT, "scenes");
const DEFAULT_FIXTURE = resolve(here, "../../fixtures/bedroom-scene.json");
const SCENE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const AUTOSAVE_DELAY_MS = 1500;
const THUMB_DIR = resolve(DATA_ROOT, "thumbnails");
const OWNERS_FILE = resolve(DATA_ROOT, "owners.json");
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
  // A deleted project's last autosave must not bring its file back.
  const live = sessions.get(id);
  if (!live || (await live) !== session) return;
  await mkdir(DATA_DIR, { recursive: true });
  const target = scenePath(id);
  const temp = target + ".tmp";
  await writeFile(temp, JSON.stringify(session.scene, null, 2));
  await rename(temp, target);
  session.dirty = false;
  const savedAt = new Date().toISOString();
  lastSaved.set(id, savedAt);
  session.broadcast({ type: "saved", savedAt, path: PRODUCTION ? "server" : "server/data/scenes/" + id + ".json" });
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

// ---------- Owner keys: whoever created a project gets a secret that is required to delete it ----------
const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");
let owners: Record<string, string> | null = null;
async function loadOwners() {
  if (owners) return owners;
  try {
    owners = JSON.parse(await readFile(OWNERS_FILE, "utf8")) as Record<string, string>;
  } catch {
    owners = {};
  }
  return owners;
}
async function setOwner(id: string, key: string | null) {
  const map = await loadOwners();
  if (key) map[id] = hashKey(key);
  else delete map[id];
  await mkdir(DATA_ROOT, { recursive: true });
  await writeFile(OWNERS_FILE + ".tmp", JSON.stringify(map, null, 2));
  await rename(OWNERS_FILE + ".tmp", OWNERS_FILE);
}
/** Creates the owner key for a new project and returns it (only the hash is stored). */
async function claim(id: string) {
  const key = randomUUID();
  await setOwner(id, key);
  return key;
}
async function isOwner(id: string, key: string | undefined) {
  const hash = (await loadOwners())[id];
  if (!hash) return !PUBLIC; // Projects made before owner keys existed: deletable locally, never on the public server.
  return !!key && hashKey(key) === hash;
}

const sceneExists = (id: string) => sessions.has(id) || existsSync(scenePath(id));

async function writeProject(scene: Scene) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(scenePath(scene.id), JSON.stringify(scene, null, 2));
}

app.get("/api/projects", async (request, response) => {
  await mkdir(DATA_DIR, { recursive: true });
  // On a public server nobody gets a list of everyone's projects: the browser asks for the ids it knows.
  const wanted = typeof request.query.ids === "string" ? new Set(request.query.ids.split(",").filter((id) => SCENE_ID_PATTERN.test(id))) : null;
  let files = (await readdir(DATA_DIR)).filter((file) => file.endsWith(".json"));
  if (PUBLIC) files = files.filter((file) => wanted?.has(file.replace(/\.json$/, "")) ?? false);
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
  const { name, roomType, template, width, depth, scene: provided } = (request.body ?? {}) as { name?: string; roomType?: string; template?: string; width?: number; depth?: number; scene?: unknown };
  const title = (name ?? "").trim().slice(0, 80) || "Untitled project";
  let scene: Scene;
  if (provided !== undefined) {
    // A full scene (e.g. one generated by the AI): validated like any upload.
    const parsed = SceneSchema.safeParse(provided);
    if (!parsed.success) return response.status(400).json({ error: "Invalid scene: " + parsed.error.issues[0]?.message });
    scene = parsed.data;
  } else if (template && TEMPLATE_FILES[template]) {
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
  response.status(201).json({ id, ownerKey: await claim(id) });
});

app.post("/api/projects/:id/duplicate", async (request, response) => {
  if (!SCENE_ID_PATTERN.test(request.params.id)) return response.status(400).json({ error: "Invalid project id." });
  const scene = await currentScene(request.params.id);
  if (!scene) return response.status(404).json({ error: "Project not found." });
  const name = scene.name + " (copy)";
  const id = newProjectId(name);
  await writeProject({ ...scene, id, name });
  if (existsSync(thumbPath(request.params.id))) await copyFile(thumbPath(request.params.id), thumbPath(id));
  response.status(201).json({ id, ownerKey: await claim(id) });
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
  if (!(await isOwner(id, request.get("x-owner-key")))) return response.status(403).json({ error: "Only the person who created this project can delete it." });
  const live = sessions.get(id);
  sessions.delete(id);
  clearTimeout(saveTimers.get(id));
  saveTimers.delete(id);
  if (live) (await live).closeAll({ type: "project-deleted" });
  await setOwner(id, null);
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

// Photo cutouts (transparent PNGs) used by "Photo → 3D" objects.
const ASSET_DIR = resolve(DATA_ROOT, "assets");
const ASSET_ID = /^[a-z0-9-]{8,64}$/;
app.post("/api/assets", async (request, response) => {
  const dataUrl = String((request.body as { dataUrl?: string })?.dataUrl ?? "");
  const match = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
  if (!match) return response.status(400).json({ error: "Expected a PNG data URL." });
  const bytes = Buffer.from(match[1]!, "base64");
  if (bytes.length > 8 * 1024 * 1024) return response.status(413).json({ error: "Image is larger than 8 MB." });
  const id = "cutout-" + randomUUID().slice(0, 12);
  await mkdir(ASSET_DIR, { recursive: true });
  await writeFile(resolve(ASSET_DIR, id + ".png"), bytes);
  response.json({ id, url: `/api/assets/${id}.png` });
});
app.get("/api/assets/:file", (request, response) => {
  const id = request.params.file.replace(/\.png$/, "");
  const path = resolve(ASSET_DIR, id + ".png");
  if (!ASSET_ID.test(id) || !existsSync(path)) return response.status(404).end();
  response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  response.sendFile(path);
});

app.get("/api/projects/:id/thumbnail", (request, response) => {
  const id = request.params.id;
  if (!SCENE_ID_PATTERN.test(id) || !existsSync(thumbPath(id))) return response.status(404).end();
  response.sendFile(thumbPath(id));
});

app.get("/api/scenes/:id", async (request, response) => {
  if (!SCENE_ID_PATTERN.test(request.params.id)) return response.status(400).json({ error: "Invalid scene id." });
  if (PUBLIC && !sceneExists(request.params.id)) return response.status(404).json({ error: "Project not found." });
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
    response.status(error instanceof AiUnavailableError ? 503 : error instanceof AiQuotaError ? 429 : 502).json({ error: (error as Error).message });
  }
});

app.post("/api/ai/image-to-room", async (request, response) => {
  const parsed = AiImageRequestSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: "Invalid request: " + parsed.error.issues[0]?.message });
  try {
    response.json(await runImageToRoom(parsed.data, newId));
  } catch (error) {
    console.error("Image-to-room failed", error);
    response.status(error instanceof AiUnavailableError ? 503 : error instanceof AiQuotaError ? 429 : 502).json({ error: (error as Error).message });
  }
});

app.post("/api/ai/plan/analyze", async (request, response) => {
  const parsed = AiPlanAnalyzeRequestSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: "Invalid request: " + parsed.error.issues[0]?.message });
  try {
    response.json(await runPlanAnalyze(parsed.data));
  } catch (error) {
    console.error("Plan analysis failed", error);
    response.status(error instanceof AiUnavailableError ? 503 : error instanceof AiQuotaError ? 429 : 502).json({ error: (error as Error).message });
  }
});

app.post("/api/ai/plan/build", (request, response) => {
  const parsed = AiPlanBuildRequestSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: "Invalid request: " + parsed.error.issues[0]?.message });
  try {
    response.json(assembleRoom(parsed.data.extraction, parsed.data.catalog, newId, parsed.data.settings));
  } catch (error) {
    response.status(400).json({ error: (error as Error).message });
  }
});

app.post("/api/ai/brief-to-room", async (request, response) => {
  const parsed = AiBriefRequestSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: "Invalid request: " + parsed.error.issues[0]?.message });
  try {
    response.json(await runBriefToRoom(parsed.data, newId));
  } catch (error) {
    console.error("Brief-to-room failed", error);
    response.status(error instanceof AiUnavailableError ? 503 : error instanceof AiQuotaError ? 429 : 502).json({ error: (error as Error).message });
  }
});

// Heartbeat: drops connections whose device went to sleep or changed networks without closing the socket,
// so presence stays accurate, and keeps idle sockets alive through hosting proxies.
const alive = new WeakMap<WebSocket, boolean>();
setInterval(() => {
  for (const socket of websocketServer.clients) {
    if (alive.get(socket) === false) {
      socket.terminate();
      continue;
    }
    alive.set(socket, false);
    socket.ping();
  }
}, 25_000).unref();

websocketServer.on("connection", (socket: WebSocket, request) => {
  const url = new URL(request.url ?? "/ws", "http://localhost");
  const sceneId = url.searchParams.get("scene") ?? "default";
  if (!SCENE_ID_PATTERN.test(sceneId)) {
    socket.close(1008, "Invalid scene id");
    return;
  }
  // A link to a project that doesn't exist (typo, deleted) must not silently create a new one on a public server.
  if (PUBLIC && !sceneExists(sceneId)) {
    socket.close(4004, "Project not found");
    return;
  }
  alive.set(socket, true);
  socket.on("pong", () => alive.set(socket, true));
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

// ---------- Production: serve the built web app from the same origin (so /api and /ws need no extra config) ----------
if (existsSync(resolve(WEB_DIST, "index.html"))) {
  app.use("/assets", express.static(resolve(WEB_DIST, "assets"), { immutable: true, maxAge: "1y", fallthrough: false }));
  app.use(express.static(WEB_DIST, { index: false, maxAge: "1h" }));
  // Client-side routes (/, /project/<id>, ?scene=<id>) load the app shell. Paths that look like files
  // (/models/x.gltf) 404 instead, so a missing asset never comes back as HTML.
  app.get(/^\/(?!api\/|ws$)(?!.*\.[a-zA-Z0-9]+$).*/, (_request, response) => {
    response.setHeader("Cache-Control", "no-cache");
    response.sendFile(resolve(WEB_DIST, "index.html"));
  });
} else if (PRODUCTION) {
  console.warn(`web/dist not found at ${WEB_DIST}; run "npm run build" so the server can serve the app.`);
}

// Hosts (Railway, Render, Fly) tell the app which port to use via PORT; locally the API stays on API_PORT/3001.
const port = Number(process.env.API_PORT ?? (PRODUCTION ? process.env.PORT : undefined) ?? 3001);
const HOST = process.env.HOST ?? (PRODUCTION ? "0.0.0.0" : "127.0.0.1");

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("API_PORT must be an integer between 1 and 65535.");
}

server.listen(port, HOST, () => {
  console.log(`Reality Builder ${PRODUCTION ? "server" : "API"} listening at http://${HOST}:${port}${PUBLIC ? " (public mode)" : ""} · data in ${DATA_ROOT}`);
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
