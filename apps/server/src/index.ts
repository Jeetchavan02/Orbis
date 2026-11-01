import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
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
import { Accounts } from "./auth.js";
import { assetKey, createStorage, reportKey, sceneKey, thumbnailKey } from "./storage.js";

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
const DEFAULT_FIXTURE = resolve(here, "../../fixtures/bedroom-scene.json");
const SCENE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const AUTOSAVE_DELAY_MS = 1500;
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
// Behind Railway/Render/Fly the TLS proxy sets X-Forwarded-Proto; trust it so secure cookies and https links work.
// On AWS the chain is CloudFront → ALB → EC2, so RB_TRUST_PROXY=2 there.
app.set("trust proxy", Number(process.env.RB_TRUST_PROXY ?? 1));
/**
 * On AWS free mode CloudFront reaches the instance directly; its security group already only admits CloudFront,
 * and this header (set on our distribution only) shuts out requests routed through anyone else's distribution.
 */
const ORIGIN_SECRET = process.env.RB_ORIGIN_SECRET?.trim() || null;
const fromOurCdn = (header: string | string[] | undefined) => !ORIGIN_SECRET || header === ORIGIN_SECRET;
app.use((request, response, next) => (fromOurCdn(request.headers["x-orbis-origin"]) ? next() : response.status(403).send("Forbidden")));
app.use(express.json({ limit: "40mb" }));

/** Local data directory (default) or S3 + DynamoDB (RB_STORAGE=aws); see storage.ts. */
const storage = await createStorage(DATA_ROOT);
const accounts = new Accounts(DATA_ROOT, storage.accounts, {
  production: PRODUCTION,
  googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() || null,
  // Without an email provider, reset links are logged on the server; dev/demo builds also show them on the page.
  showResetLinks: process.env.ORBIS_SHOW_RESET_LINKS ? process.env.ORBIS_SHOW_RESET_LINKS === "1" : !PRODUCTION,
});
app.use("/api/auth", accounts.router());
const server = createServer(app);
const websocketServer = new WebSocketServer({ server, path: "/ws", maxPayload: 40 * 1024 * 1024 });

const sessions = new Map<string, Promise<SceneSession>>();
const saveTimers = new Map<string, NodeJS.Timeout>();
const lastSaved = new Map<string, string>();

async function readScene(id: string): Promise<Scene | null> {
  const bytes = await storage.blobs.get(sceneKey(id));
  return bytes ? SceneSchema.parse(JSON.parse(bytes.toString("utf8"))) : null;
}

async function loadInitialScene(id: string): Promise<Scene> {
  // A storage outage must not be mistaken for "no such project" (that would overwrite it with the demo scene).
  let bytes: Buffer | null;
  try {
    bytes = await storage.blobs.get(sceneKey(id));
  } catch (error) {
    console.error(`Could not read scene "${id}" from storage`, error);
    throw error;
  }
  try {
    if (bytes) return SceneSchema.parse(JSON.parse(bytes.toString("utf8")));
  } catch (error) {
    console.error(`Saved scene "${id}" is unreadable; starting from the demo scene.`, error);
  }
  const scene = SceneSchema.parse(JSON.parse(await readFile(DEFAULT_FIXTURE, "utf8")));
  return { ...scene, id };
}

async function persist(id: string, session: SceneSession) {
  // A deleted project's last autosave must not bring its file back.
  const live = sessions.get(id);
  if (!live || (await live) !== session) return;
  const scene = session.scene;
  await writeProject(scene);
  // Only clear the flag if nothing changed while the write was in flight.
  if (session.scene === scene) session.dirty = false;
  const savedAt = new Date().toISOString();
  lastSaved.set(id, savedAt);
  session.broadcast({ type: "saved", savedAt, path: storage.kind === "aws" ? "cloud" : PRODUCTION ? "server" : "server/data/scenes/" + id + ".json" });
}

function scheduleSave(id: string, session: SceneSession, immediate = false) {
  clearTimeout(saveTimers.get(id));
  saveTimers.set(id, setTimeout(() => {
    persist(id, session).catch((error) => {
      console.error(`Failed to save scene "${id}"`, error);
      session.broadcast({ type: "error", message: "Saving failed on the server; retrying: " + (error as Error).message });
      // Keep the changes in memory and try again, so a storage blip never drops edits.
      if (sessions.has(id)) saveTimers.set(id, setTimeout(() => scheduleSave(id, session, true), 5000));
    });
  }, immediate ? 0 : AUTOSAVE_DELAY_MS));
}

function getSession(id: string): Promise<SceneSession> {
  let session = sessions.get(id);
  if (!session) {
    session = Promise.all([loadInitialScene(id), storage.projects.get(id)]).then(([scene, meta]) => {
      const created = new SceneSession(scene, (changed, immediate) => scheduleSave(id, changed, immediate));
      created.linkAccess = meta?.linkAccess ?? "edit";
      return created;
    });
    sessions.set(id, session);
    // A failed load must not stay cached: the next request tries again.
    session.catch(() => sessions.delete(id));
  }
  return session;
}

app.get("/api/health", (_request, response) => {
  response.status(200).json(ApiHealthSchema.parse({ status: "ok", service: "reality-builder-api", timestamp: new Date().toISOString() }));
});

// ---------- Projects (one scene document per project + a metadata record) ----------
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "project";
const newProjectId = (name: string) => `${slug(name)}-${randomUUID().slice(0, 4)}`;

async function currentScene(id: string): Promise<Scene | null> {
  const live = sessions.get(id);
  if (live) return (await live).scene;
  return readScene(id).catch(() => null);
}

// ---------- Owner keys: whoever created a project gets a secret that is required to delete it ----------
const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");
/** Creates the owner key for a new project and returns it (only the hash is stored). */
async function claim(id: string) {
  const key = randomUUID();
  await storage.projects.update(id, { ownerKeyHash: hashKey(key) });
  return key;
}
async function isOwner(id: string, key: string | undefined) {
  const hash = (await storage.projects.get(id))?.ownerKeyHash;
  if (!hash) return !PUBLIC; // Projects made before owner keys existed: deletable locally, never on the public server.
  return !!key && hashKey(key) === hash;
}
/** Owner = the signed-in account that created the project, or whoever holds its owner key. */
async function ownsProject(id: string, user: { id: string } | null, key: string | undefined) {
  if (user && (await storage.projects.get(id))?.ownerUserId === user.id) return true;
  return isOwner(id, key);
}

async function sceneExists(id: string) {
  return sessions.has(id) || (await storage.blobs.stat(sceneKey(id))) !== null;
}

/** Saves the scene document and refreshes the list summary kept in the project record. */
async function writeProject(scene: Scene) {
  await storage.blobs.put(sceneKey(scene.id), JSON.stringify(scene, null, 2), "application/json");
  await storage.projects.update(scene.id, {
    name: scene.name, roomType: scene.roomType ?? (scene.rooms.length > 1 ? "apartment" : "bedroom"),
    objects: scene.furniture.length, floors: scene.rooms.length, updatedAt: new Date().toISOString(),
  });
}

async function thumbnailUrl(id: string, stamp: number | undefined) {
  const version = stamp ?? (await storage.blobs.stat(thumbnailKey(id)))?.getTime();
  return version ? `/api/projects/${id}/thumbnail?v=${version}` : null;
}

app.get("/api/projects", async (request, response) => {
  // On a public server nobody gets a list of everyone's projects: the browser asks for the ids it knows.
  const wanted = new Set(typeof request.query.ids === "string" ? request.query.ids.split(",").filter((id) => SCENE_ID_PATTERN.test(id)) : []);
  const user = await accounts.userFor(request);
  // Signed in: your own projects plus the ones you opened from a share link.
  if (user) {
    for (const id of await storage.projects.ownedBy(user.id)) wanted.add(id);
    for (const id of user.recent) wanted.add(id);
  }
  const ids = PUBLIC ? [...wanted] : [...new Set([...(await storage.projects.ids()), ...wanted])];
  const projects = (await Promise.all(ids.map(async (id) => {
    const meta = await storage.projects.get(id);
    const live = sessions.get(id) ? (await sessions.get(id)!).scene : null;
    // Records written before the summary existed (local data, migrated data) fall back to reading the scene.
    const scene = live ?? (meta?.name === undefined ? await currentScene(id) : null);
    if (!scene && meta?.name === undefined) return null;
    const updated = meta?.updatedAt ?? (await storage.blobs.stat(sceneKey(id)))?.toISOString();
    if (!updated) return null;
    const owner = meta?.ownerUserId;
    return {
      id, name: scene?.name ?? meta!.name!, roomType: scene ? (scene.roomType ?? (scene.rooms.length > 1 ? "apartment" : "bedroom")) : meta!.roomType ?? "bedroom",
      objects: scene?.furniture.length ?? meta!.objects ?? 0, floors: scene?.rooms.length ?? meta!.floors ?? 1, updatedAt: updated,
      owned: !!user && owner === user.id, shared: !!user && !!owner && owner !== user.id,
      thumbnail: await thumbnailUrl(id, meta?.thumbnailAt),
    };
  }))).filter((project) => project !== null);
  projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  response.json({ projects });
});

app.post("/api/projects", async (request, response) => {
  const user = await accounts.userFor(request);
  if (PUBLIC && !user) return response.status(401).json({ error: "Sign in to create projects." });
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
  if (user) await storage.projects.update(id, { ownerUserId: user.id });
  response.status(201).json({ id, ownerKey: await claim(id) });
});

app.post("/api/projects/:id/duplicate", async (request, response) => {
  if (!SCENE_ID_PATTERN.test(request.params.id)) return response.status(400).json({ error: "Invalid project id." });
  const scene = await currentScene(request.params.id);
  if (!scene) return response.status(404).json({ error: "Project not found." });
  const user = await accounts.userFor(request);
  if (PUBLIC && !user) return response.status(401).json({ error: "Sign in to duplicate projects." });
  const name = scene.name + " (copy)";
  const id = newProjectId(name);
  await writeProject({ ...scene, id, name });
  if (user) await storage.projects.update(id, { ownerUserId: user.id });
  await storage.blobs.copy(thumbnailKey(request.params.id), thumbnailKey(id));
  const thumbnailAt = (await storage.projects.get(request.params.id))?.thumbnailAt;
  if (thumbnailAt) await storage.projects.update(id, { thumbnailAt });
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

app.put("/api/projects/:id/access", async (request, response) => {
  const id = request.params.id;
  if (!SCENE_ID_PATTERN.test(id)) return response.status(400).json({ error: "Invalid project id." });
  const access = (request.body as { linkAccess?: unknown } | undefined)?.linkAccess;
  if (access !== "edit" && access !== "view") return response.status(400).json({ error: "linkAccess must be \"edit\" or \"view\"." });
  if (!(await sceneExists(id))) return response.status(404).json({ error: "Project not found." });
  if (!(await ownsProject(id, await accounts.userFor(request), request.get("x-owner-key")))) return response.status(403).json({ error: "Only the project owner can change link access." });
  await storage.projects.update(id, { linkAccess: access });
  (await getSession(id)).setLinkAccess(access);
  response.json({ linkAccess: access });
});

app.delete("/api/projects/:id", async (request, response) => {
  const id = request.params.id;
  if (!SCENE_ID_PATTERN.test(id)) return response.status(400).json({ error: "Invalid project id." });
  const user = await accounts.userFor(request);
  const ownedByUser = !!user && (await storage.projects.get(id))?.ownerUserId === user.id;
  if (!ownedByUser && !(await isOwner(id, request.get("x-owner-key")))) return response.status(403).json({ error: "Only the person who created this project can delete it." });
  const live = sessions.get(id);
  sessions.delete(id);
  clearTimeout(saveTimers.get(id));
  saveTimers.delete(id);
  if (live) (await live).closeAll({ type: "project-deleted" });
  // The record and scene go first, so the project is gone at once; its files (thumbnail, reports) are removed
  // by the background worker when a queue is configured, otherwise right here.
  await storage.projects.remove(id);
  await storage.blobs.delete(sceneKey(id));
  await accounts.forgetProject(id);
  const queued = await storage.jobs.send({ type: "delete-project", projectId: id }).catch((error) => {
    console.error("Could not queue project cleanup; cleaning up inline", error);
    return false;
  });
  if (!queued) await storage.blobs.deletePrefix(`projects/${id}/`);
  response.json({ ok: true });
});

app.put("/api/projects/:id/thumbnail", async (request, response) => {
  const id = request.params.id;
  const dataUrl = String((request.body as { dataUrl?: string })?.dataUrl ?? "");
  const match = /^data:image\/jpeg;base64,(.+)$/.exec(dataUrl);
  if (!SCENE_ID_PATTERN.test(id) || !match) return response.status(400).json({ error: "Expected a JPEG data URL." });
  if (!(await sceneExists(id))) return response.status(404).json({ error: "Project not found." });
  await storage.blobs.put(thumbnailKey(id), Buffer.from(match[1]!, "base64"), "image/jpeg");
  await storage.projects.update(id, { thumbnailAt: Date.now() });
  response.json({ ok: true });
});

// Uploaded images (photo cutouts, floor-plan underlays) and imported 3D models. Uploads go through the server
// (not straight to S3) so the type, size and GLB header are checked before anything is stored.
const ASSET_FILE = /^[a-z0-9-]{8,64}\.(png|jpg|webp|glb)$/;
const IMAGE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
app.post("/api/assets", async (request, response) => {
  const body = (request.body ?? {}) as { dataUrl?: string; kind?: string; projectId?: string };
  const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.+)$/.exec(String(body.dataUrl ?? ""));
  const ext = match ? (IMAGE_TYPES[match[1]!] ?? (match[1] === "model/gltf-binary" || match[1] === "application/octet-stream" ? "glb" : null)) : null;
  if (!match || !ext) return response.status(400).json({ error: "Expected a PNG, JPG, WebP or GLB data URL." });
  const bytes = Buffer.from(match[2]!, "base64");
  const limit = ext === "glb" ? 20 * 1024 * 1024 : 8 * 1024 * 1024;
  if (bytes.length > limit) return response.status(413).json({ error: `File is larger than ${limit / 1024 / 1024} MB.` });
  if (ext === "glb" && bytes.subarray(0, 4).toString("latin1") !== "glTF") return response.status(400).json({ error: "That isn't a valid .glb file." });
  const prefix = ext === "glb" ? "model" : body.kind === "plan" ? "plan" : "cutout";
  const file = `${prefix}-${randomUUID().slice(0, 12)}.${ext}`;
  const project = typeof body.projectId === "string" && SCENE_ID_PATTERN.test(body.projectId) ? body.projectId : undefined;
  await storage.blobs.put(assetKey(file), bytes, ext === "glb" ? "model/gltf-binary" : "image/" + (ext === "jpg" ? "jpeg" : ext), project ? { project } : undefined);
  response.json({ id: file.replace(/\.[a-z]+$/, ""), url: `/api/assets/${file}` });
});
/** Streams a stored file from the same origin (keeps WebGL textures untainted for the PDF export). */
async function sendBlob(response: express.Response, key: string, type: string, cache: string) {
  const blob = await storage.blobs.open(key);
  if (!blob) return response.status(404).end();
  response.setHeader("Cache-Control", cache);
  response.type(type);
  if (blob.length !== undefined) response.setHeader("Content-Length", String(blob.length));
  blob.body.on("error", () => response.destroy());
  blob.body.pipe(response);
}

app.get("/api/assets/:file", async (request, response) => {
  const file = request.params.file;
  if (!ASSET_FILE.test(file)) return response.status(404).end();
  const ext = file.split(".").pop()!;
  await sendBlob(response, assetKey(file), ext === "glb" ? "model/gltf-binary" : ext === "jpg" ? "image/jpeg" : "image/" + ext, "public, max-age=31536000, immutable");
});

app.get("/api/projects/:id/thumbnail", async (request, response) => {
  const id = request.params.id;
  if (!SCENE_ID_PATTERN.test(id)) return response.status(404).end();
  await sendBlob(response, thumbnailKey(id), "image/jpeg", "public, max-age=300");
});

// ---------- Design PDF reports: kept with the project so a download link can be shared ----------
const REPORT_FILE = /^[A-Za-z0-9_-]{1,80}-[a-f0-9]{8}\.pdf$/;
app.post("/api/projects/:id/reports", express.raw({ type: "application/pdf", limit: "40mb" }), async (request, response) => {
  const id = request.params.id;
  if (!SCENE_ID_PATTERN.test(id)) return response.status(400).json({ error: "Invalid project id." });
  const bytes = request.body as Buffer;
  if (!Buffer.isBuffer(bytes) || bytes.subarray(0, 5).toString("latin1") !== "%PDF-") return response.status(400).json({ error: "Expected a PDF." });
  if (!(await sceneExists(id))) return response.status(404).json({ error: "Project not found." });
  const base = String(request.query.name ?? "Orbis_Design").replace(/\.pdf$/i, "").replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 80) || "Orbis_Design";
  const file = `${base}-${randomUUID().replace(/-/g, "").slice(0, 8)}.pdf`;
  await storage.blobs.put(reportKey(id, file), bytes, "application/pdf");
  response.status(201).json({ url: `/api/projects/${id}/reports/${file}` });
});
app.get("/api/projects/:id/reports/:file", async (request, response) => {
  const { id, file } = request.params;
  if (!SCENE_ID_PATTERN.test(id) || !REPORT_FILE.test(file)) return response.status(404).end();
  const key = reportKey(id, file);
  if (!(await storage.blobs.stat(key))) return response.status(404).end();
  const name = file.replace(/-[a-f0-9]{8}\.pdf$/, ".pdf");
  // On S3: a 15-minute presigned link, so large PDFs download straight from S3 instead of through the server.
  const direct = await storage.blobs.downloadUrl(key, name, "application/pdf");
  if (direct) {
    response.setHeader("Cache-Control", "no-store");
    return response.redirect(302, direct);
  }
  response.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  await sendBlob(response, key, "application/pdf", "private, max-age=3600");
});

app.get("/api/scenes/:id", async (request, response) => {
  if (!SCENE_ID_PATTERN.test(request.params.id)) return response.status(400).json({ error: "Invalid scene id." });
  if (PUBLIC && !(await sceneExists(request.params.id))) return response.status(404).json({ error: "Project not found." });
  const session = await getSession(request.params.id);
  response.json({ scene: session.scene, seq: session.seq, savedAt: lastSaved.get(request.params.id) ?? null });
});

const newId = () => "ai-" + randomUUID().slice(0, 8);

/** LAN addresses so the Share dialog can offer links other devices can open. */
/**
 * The public address people should use to open projects (e.g. the Cloudflare tunnel started by `npm run share`).
 * Set RB_PUBLIC_URL, or `npm run share` writes it to RB_DATA_DIR/public-url.txt once the tunnel is reachable.
 */
app.get("/api/public-url", async (_request, response) => {
  let url = process.env.RB_PUBLIC_URL?.trim() || null;
  if (!url) url = (await readFile(resolve(DATA_ROOT, "public-url.txt"), "utf8").catch(() => "")).trim() || null;
  response.json({ url: url && /^https?:\/\/[^\s/]+$/.test(url.replace(/\/$/, "")) ? url.replace(/\/$/, "") : null });
});

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
  if (!fromOurCdn(request.headers["x-orbis-origin"])) {
    socket.close(1008, "Forbidden");
    return;
  }
  const url = new URL(request.url ?? "/ws", "http://localhost");
  const sceneId = url.searchParams.get("scene") ?? "default";
  if (!SCENE_ID_PATTERN.test(sceneId)) {
    socket.close(1008, "Invalid scene id");
    return;
  }
  // A link to a project that doesn't exist (typo, deleted) must not silently create a new one on a public server.
  alive.set(socket, true);
  socket.on("pong", () => alive.set(socket, true));
  // Signed-in collaborators see projects they've joined on their dashboard.
  void accounts.userFromCookie(request.headers.cookie).then((user) => user && accounts.touchProject(user, sceneId)).catch(() => undefined);
  const handle: ClientHandle = {
    send: (message: ServerMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    },
    close: () => socket.close(4000, "Replaced by a newer connection from the same tab"),
  };
  const ownerKey = url.searchParams.get("key") ?? undefined;
  const exists = PUBLIC ? sceneExists(sceneId) : Promise.resolve(true);
  const ready = exists.then((found) => {
    if (!found) {
      socket.close(4004, "Project not found");
      throw new Error("missing project");
    }
  }).then(() => Promise.all([getSession(sceneId), accounts.userFromCookie(request.headers.cookie).catch(() => null)]).then(async ([session, user]) => {
    handle.owner = await ownsProject(sceneId, user, ownerKey);
    session.connect(handle);
    return session;
  }));
  ready.catch((error) => {
    if ((error as Error).message === "missing project") return;
    console.error(`Could not open project "${sceneId}"`, error);
    socket.close(1011, "Project could not be loaded");
  });

  socket.on("message", async (data) => {
    const session = await ready.catch(() => null);
    if (!session) return;
    let payload: unknown;
    try {
      payload = JSON.parse(String(data));
    } catch {
      handle.send({ type: "error", message: "Messages must be JSON." });
      return;
    }
    session.handle(handle, payload);
  });

  socket.on("close", () => void ready.then((session) => session.disconnect(handle), () => undefined));
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
  console.log(`Orbis ${PRODUCTION ? "server" : "API"} listening at http://${HOST}:${port}${PUBLIC ? " (public mode)" : ""} · ${storage.describe}`);
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
