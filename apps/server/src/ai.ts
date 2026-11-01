import {
  AiPlanSchema,
  AiRoomExtractionSchema,
  AiHouseExtractionSchema,
  applySceneAction,
  parseSizeLabel,
  SceneActionError,
  SceneSchema,
  type AiCatalogItem,
  type AiEditRequest,
  type AiEditResponse,
  type AiBriefRequest,
  type AiImageRequest,
  type AiPlanAnalyzeRequest,
  type AiPlanAnalyzeResponse,
  type AiRoomExtraction,
  type AiHouseAnalyzeResponse,
  type MeasuredHouse,
  type PlanBuildSettings,
  type AiImageResponse,
  type AiToolCall,
  type BaseSceneAction,
  type FurnitureObject,
  type Room,
  type Scene,
  type ValidationIssue,
  type WallSide,
} from "@reality-builder/shared";
import { generateRecoveryCandidates, requiredFrontClearance, roomToWorld, rotateYaw, validateScene } from "@reality-builder/spatial-engine";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MAX_ATTEMPTS = 3;

export class AiUnavailableError extends Error {}
/** Every model refused for quota/rate reasons. */
export class AiQuotaError extends Error {}

/** Preferred model first; later ones are used when a model is overloaded, retired, or too slow. */
const COOLDOWN_MS = 5 * 60_000;
/** Models that recently failed (overloaded/retired/timed out) are skipped for a while to avoid repeated waits. */
const coolingDown = new Map<string, number>();

function modelChain() {
  const preferred = process.env.GEMINI_MODEL || "gemini-flash-latest";
  const all = [...new Set([preferred, "gemini-flash-latest", "gemini-3.5-flash", "gemini-flash-lite-latest"])];
  const ready = all.filter((model) => (coolingDown.get(model) ?? 0) < Date.now());
  return ready.length > 0 ? ready : all;
}

export function aiModel() {
  return modelChain()[0]!;
}

type Content = { role: "user" | "model"; parts: ({ text: string } | { inlineData: { mimeType: string; data: string } })[] };

type GeminiPayload = { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { message?: string } };

type CallOptions = {
  /** Thinking token budget (0 = off, fastest). Omitted = the model's default. */
  thinkingBudget?: number;
  timeoutMs?: number;
};
/** Models that rejected a thinking budget; they are called without one from then on. */
const noThinkingConfig = new Set<string>();

async function callModel(model: string, key: string, system: string, contents: Content[], signal: AbortSignal, options: CallOptions = {}): Promise<{ text: string; model: string }> {
  const thinking = options.thinkingBudget !== undefined && !noThinkingConfig.has(model) ? { thinkingConfig: { thinkingBudget: options.thinkingBudget } } : {};
  const response = await fetch(`${API_BASE}/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { responseMimeType: "application/json", temperature: 0.2, ...thinking } }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs ?? 40_000)]),
  });
  const payload = (await response.json().catch(() => null)) as GeminiPayload | null;
  // Some models reject a thinking budget with a generic 400: retry once without it and remember.
  if (response.status === 400 && "thinkingConfig" in thinking) {
    noThinkingConfig.add(model);
    return callModel(model, key, system, contents, signal, options);
  }
  if (!response.ok) {
    if (response.status === 404 || response.status === 429 || response.status >= 500) coolingDown.set(model, Date.now() + COOLDOWN_MS);
    throw new Error(`${model}: ${response.status} ${payload?.error?.message?.slice(0, 120) ?? response.statusText}`);
  }
  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
  if (!text) throw new Error(`${model}: empty response`);
  return { text, model };
}

/**
 * Calls Gemini with JSON output. The two preferred models are raced in parallel (first good answer wins,
 * the other request is aborted); remaining models are tried if both fail. The key stays on the server.
 */
async function generateJson(system: string, contents: Content[], options: CallOptions = {}): Promise<{ text: string; model: string }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new AiUnavailableError("GEMINI_API_KEY is not set on the server (apps/.env).");
  const chain = modelChain();
  const failures: string[] = [];
  const race = new AbortController();
  try {
    const result = await Promise.any(chain.slice(0, 2).map((model) => callModel(model, key, system, contents, race.signal, options)));
    race.abort();
    return result;
  } catch (error) {
    for (const reason of (error as AggregateError).errors ?? [error]) failures.push((reason as Error).message);
  }
  for (const model of chain.slice(2)) {
    try {
      return await callModel(model, key, system, contents, new AbortController().signal, options);
    } catch (error) {
      failures.push((error as Error).message);
    }
  }
  if (failures.length && failures.every((failure) => / 429 |quota|timeout|aborted/i.test(failure)) && failures.some((failure) => / 429 |quota/i.test(failure))) {
    throw new AiQuotaError("The AI has hit its usage limit for now. Wait a minute and try again, or enable billing on the Gemini API key for higher limits.");
  }
  throw new Error(`No Gemini model answered — ${failures.join("; ")}`);
}

const SYNONYMS: Record<string, string[]> = {
  couch: ["sofa"], settee: ["sofa"], bookshelf: ["bookcase", "shelf"], shelf: ["bookcase", "shelf"], tv: ["tv", "television", "media"],
  lamp: ["lamp", "light"], light: ["lamp", "light", "pendant"], plant: ["plant", "pot"], carpet: ["rug"], closet: ["wardrobe"],
  table: ["table", "desk"], seat: ["chair", "stool", "armchair"], storage: ["cabinet", "dresser", "wardrobe", "shelf"],
};
const baseName = (name: string) => name.split(" — ")[0]!.trim().toLowerCase();

/**
 * The full catalogue is ~27k tokens; models answer faster and better from a short, relevant list.
 * Items whose words appear in the request rank first; the rest is padded with one variant per product
 * (colour variants collapsed) so the model still sees the range.
 */
export function shortlistCatalog(catalog: AiCatalogItem[], text: string, limit = 40) {
  const words = text.toLowerCase().match(/[a-z]{3,}/g) ?? [];
  const terms = new Set(words.flatMap((word) => [word, word.replace(/s$/, ""), ...(SYNONYMS[word] ?? SYNONYMS[word.replace(/s$/, "")] ?? [])]));
  const score = (entry: AiCatalogItem) => {
    const name = entry.name.toLowerCase();
    let total = 0;
    for (const term of terms) {
      if (name.includes(term)) total += 3;
      if (entry.category.includes(term)) total += 2;
    }
    return total;
  };
  const ranked = catalog.map((entry) => ({ entry, score: score(entry) })).filter((row) => row.score > 0).sort((a, b) => b.score - a.score).map((row) => row.entry);
  const picked = new Map<string, AiCatalogItem>();
  for (const entry of ranked) if (picked.size < Math.ceil(limit * 0.6)) picked.set(entry.id, entry);
  const seen = new Set([...picked.values()].map((entry) => baseName(entry.name)));
  for (const entry of catalog) {
    if (picked.size >= limit) break;
    const base = baseName(entry.name);
    if (seen.has(base)) continue;
    seen.add(base);
    picked.set(entry.id, entry);
  }
  return [...picked.values()];
}

/** One entry per product (colour variants collapsed): the whole range at a fraction of the tokens. */
function distinctProducts(catalog: AiCatalogItem[]) {
  const seen = new Set<string>();
  return catalog.filter((entry) => {
    const base = baseName(entry.name);
    if (seen.has(base)) return false;
    seen.add(base);
    return true;
  });
}

function fmt(value: number) {
  return Math.round(value * 100) / 100;
}

/** Compact scene description: the LLM gets facts, the engine stays authoritative for geometry. */
function describeScene(scene: Scene, catalog: AiCatalogItem[], room: Room) {
  return JSON.stringify({
    coordinateSystem: "meters; Y up; floor is XZ; room center at (x,z); north wall is -Z, south +Z, west -X, east +X; object position = bottom-center; yawDegrees rotates around Y, yaw 0 means the object's front faces +Z (south), 90 faces +X (east), 180 faces -Z (north), 270 faces -X (west)",
    room: {
      name: room.name,
      center: { x: room.position.x, z: room.position.z },
      width_x: room.dimensions.width,
      depth_z: room.dimensions.depth,
      interiorBounds: { minX: fmt(room.position.x - room.dimensions.width / 2), maxX: fmt(room.position.x + room.dimensions.width / 2), minZ: fmt(room.position.z - room.dimensions.depth / 2), maxZ: fmt(room.position.z + room.dimensions.depth / 2) },
      openings: room.openings.map((opening) => ({ kind: opening.kind, wall: opening.wall, offsetAlongWall: opening.offset, width: opening.width })),
    },
    rules: { minPassageWidth: scene.rules.minPassageWidth, note: "objects need free space in front (frontClearance); door swing areas must stay clear; everything must stay inside the room" },
    environment: scene.environment.mode,
    objects: scene.furniture.filter((item) => item.roomId === room.id).map((item) => ({
      id: item.id, name: item.name, category: item.category, x: fmt(item.position.x), z: fmt(item.position.z), elevation: fmt(item.position.y - room.position.y),
      yawDegrees: item.yawDegrees, width: fmt(item.dimensions.width), depth: fmt(item.dimensions.depth), height: fmt(item.dimensions.height),
      frontClearance: requiredFrontClearance(scene, item), locked: !!item.constraints?.locked, light: item.light ? { on: item.light.on, intensity: item.light.intensity } : undefined,
    })),
    catalog: catalog.map((entry) => ({ catalogItemId: entry.id, name: entry.name, category: entry.category, width: entry.dimensions.width, depth: entry.dimensions.depth, height: entry.dimensions.height })),
  });
}

const EDIT_SYSTEM = `You are the layout assistant inside Orbis, a 3D interior design editor.
Translate the user's request into tool calls. Respond with JSON only: {"summary": string, "calls": ToolCall[]}.
ToolCall is one of:
{"tool":"place_against_wall","catalogItemId"?:string,"objectId"?:string,"name"?:string,"wall":"north"|"south"|"east"|"west","near":"start"|"middle"|"end"}   (PREFERRED for adding/moving furniture: the engine computes exact valid coordinates; back of the object goes to the wall; give catalogItemId to add a new item or objectId to move an existing one)
{"tool":"place_near","catalogItemId"?:string,"objectId"?:string,"name"?:string,"targetId":string,"side":"left"|"right"|"front"}   (PREFERRED for grouping, e.g. a nightstand next to a bed or a chair in front of a desk)
{"tool":"add_object","catalogItemId":string,"name"?:string,"x":number,"z":number,"yawDegrees":number}   (only when an exact spot is required)
{"tool":"move_object","objectId":string,"x":number,"z":number}
{"tool":"rotate_object","objectId":string,"yawDegrees":number}
{"tool":"resize_object","objectId":string,"width"?:number,"depth"?:number,"height"?:number}
{"tool":"delete_object","objectId":string}
{"tool":"set_color","objectId":string,"color":"#rrggbb"}
{"tool":"set_light","objectId":string,"on"?:boolean,"intensity"?:number,"color"?:"#rrggbb"}
{"tool":"set_environment","mode":"day"|"evening"|"night"}
Rules: prefer place_against_wall / place_near over raw coordinates; use only object ids and catalogItemIds from the scene JSON; never move locked objects; keep every footprint inside the room bounds (account for width/depth and rotation); keep clear space in front of furniture and door swing areas; do the minimum needed. A spatial engine will validate your proposal and send back any violations for you to correct. If the request is impossible or unclear, return an empty calls array and explain in summary.`;

const WALL_YAW: Record<WallSide, number> = { north: 0, south: 180, west: 90, east: 270 };

/**
 * Finds the nearest pose (from an ordered list of candidates) that keeps the scene free of new issues
 * involving the object. Geometry is decided here by the spatial engine, never by the LLM.
 */
function solvePlacement(work: Scene, candidate: FurnitureObject, poses: { x: number; z: number; yaw: number }[]) {
  const baseline = new Set(validateScene(work, { skipBlockerAnalysis: true }).issues.map((issue) => issue.id));
  const without = work.furniture.filter((item) => item.id !== candidate.id);
  for (const pose of poses.slice(0, 120)) {
    const placed = { ...candidate, position: { ...candidate.position, x: Math.round(pose.x * 1000) / 1000, z: Math.round(pose.z * 1000) / 1000 }, yawDegrees: pose.yaw };
    const issues = validateScene({ ...work, furniture: [...without, placed] }, { skipBlockerAnalysis: true }).issues;
    if (issues.every((issue) => baseline.has(issue.id) || !issue.objectIds.includes(placed.id))) return placed;
  }
  return null;
}

function wallPoses(room: Room, item: FurnitureObject, wall: WallSide, near: "start" | "middle" | "end") {
  const yaw = (WALL_YAW[wall] + room.yawDegrees) % 360;
  const horizontal = wall === "north" || wall === "south";
  const length = horizontal ? room.dimensions.width : room.dimensions.depth;
  const half = length / 2 - item.dimensions.width / 2 - 0.01;
  const inset = (horizontal ? room.dimensions.depth : room.dimensions.width) / 2 - item.dimensions.depth / 2 - 0.005;
  const preferred = near === "start" ? -half : near === "end" ? half : 0;
  const offsets: number[] = [];
  for (let step = 0; step <= Math.ceil((2 * half) / 0.1); step += 1) {
    for (const sign of step === 0 ? [1] : [1, -1]) {
      const value = preferred + sign * step * 0.1;
      if (Math.abs(value) <= half + 1e-9) offsets.push(value);
    }
  }
  return offsets.map((along) => {
    const local: [number, number] = wall === "north" ? [along, -inset] : wall === "south" ? [along, inset] : wall === "west" ? [-inset, along] : [inset, along];
    const [x, z] = roomToWorld(room, local);
    return { x, z, yaw };
  });
}

function nearPoses(target: FurnitureObject, item: FurnitureObject, side: "left" | "right" | "front") {
  const poses: { x: number; z: number; yaw: number }[] = [];
  for (let extra = 0; extra <= 1.2; extra += 0.05) {
    for (const shift of [0, 0.1, -0.1, 0.2, -0.2]) {
      // Target-local frame: +X is the target's left (it faces +Z), +Z is its front.
      const local: [number, number] = side === "front"
        ? [shift, target.dimensions.depth / 2 + item.dimensions.depth / 2 + 0.6 + extra]
        : [(side === "left" ? 1 : -1) * (target.dimensions.width / 2 + item.dimensions.width / 2 + 0.03 + extra), -target.dimensions.depth / 2 + item.dimensions.depth / 2 + shift];
      const [dx, dz] = rotateYaw(local, target.yawDegrees);
      poses.push({ x: target.position.x + dx, z: target.position.z + dz, yaw: side === "front" ? (target.yawDegrees + 180) % 360 : target.yawDegrees });
    }
  }
  return poses;
}

/**
 * Converts tool calls into canonical actions, applying them in order to a working copy so later calls see
 * earlier ones. Throws with a precise, LLM-readable message on unknown ids or unplaceable objects.
 */
export function toolCallsToActions(scene: Scene, calls: AiToolCall[], catalog: AiCatalogItem[], newId: () => string, roomId?: string): BaseSceneAction[] {
  const room = scene.rooms.find((entry) => entry.id === roomId) ?? scene.rooms[0];
  if (!room) throw new Error("The scene has no room.");
  let work = scene;
  const actions: BaseSceneAction[] = [];
  const find = (id: string) => {
    const item = work.furniture.find((entry) => entry.id === id);
    if (!item) throw new Error(`Unknown objectId "${id}". Use ids from the scene JSON.`);
    return item;
  };
  const guardLocked = (item: FurnitureObject) => {
    if (item.constraints?.locked) throw new Error(`${item.name} (${item.id}) is locked and cannot be changed.`);
  };
  const fromCatalog = (catalogItemId: string, name: string | undefined, x: number, z: number, yaw: number): FurnitureObject => {
    const entry = catalog.find((item) => item.id === catalogItemId);
    if (!entry) throw new Error(`Unknown catalogItemId "${catalogItemId}".`);
    return {
      id: newId(), roomId: room.id, name: name || entry.name, category: entry.category, catalogItemId: entry.id,
      position: { x, y: room.position.y + (entry.elevation ?? 0), z }, yawDegrees: yaw, dimensions: entry.dimensions, color: entry.color,
      ...(entry.light ? { light: entry.light } : {}), ...(entry.constraints ? { constraints: entry.constraints } : {}), version: 1,
    };
  };
  const subject = (call: { catalogItemId?: string; objectId?: string; name?: string }) => {
    if (call.objectId) {
      const item = find(call.objectId);
      guardLocked(item);
      return { item, isNew: false };
    }
    if (!call.catalogItemId) throw new Error("Give either catalogItemId (new item) or objectId (existing item).");
    return { item: fromCatalog(call.catalogItemId, call.name, room.position.x, room.position.z, 0), isNew: true };
  };
  const placed = (item: FurnitureObject, isNew: boolean, result: FurnitureObject | null, where: string): BaseSceneAction => {
    if (!result) throw new Error(`No valid spot for ${item.name} ${where}: every position collides, leaves the room, or blocks clearances/paths. Choose another wall or target.`);
    return isNew
      ? { type: "furniture.create", furniture: result }
      : { type: "furniture.update", furnitureId: item.id, patch: { position: { x: result.position.x, z: result.position.z }, yawDegrees: result.yawDegrees } };
  };

  for (const call of calls) {
    let action: BaseSceneAction;
    switch (call.tool) {
      case "place_against_wall": {
        const { item, isNew } = subject(call);
        action = placed(item, isNew, solvePlacement(work, item, wallPoses(room, item, call.wall, call.near)), `against the ${call.wall} wall`);
        break;
      }
      case "place_near": {
        const { item, isNew } = subject(call);
        const target = find(call.targetId);
        action = placed(item, isNew, solvePlacement(work, item, nearPoses(target, item, call.side)), `on the ${call.side} of ${target.name}`);
        break;
      }
      case "add_object":
        action = { type: "furniture.create", furniture: fromCatalog(call.catalogItemId, call.name, call.x, call.z, call.yawDegrees) };
        break;
      case "move_object":
        guardLocked(find(call.objectId));
        action = { type: "furniture.update", furnitureId: call.objectId, patch: { position: { x: call.x, z: call.z } } };
        break;
      case "rotate_object":
        guardLocked(find(call.objectId));
        action = { type: "furniture.update", furnitureId: call.objectId, patch: { yawDegrees: ((call.yawDegrees % 360) + 360) % 360 } };
        break;
      case "resize_object": {
        guardLocked(find(call.objectId));
        const dimensions = Object.fromEntries(Object.entries({ width: call.width, depth: call.depth, height: call.height }).filter(([, value]) => value !== undefined));
        action = { type: "furniture.update", furnitureId: call.objectId, patch: { dimensions } };
        break;
      }
      case "delete_object":
        guardLocked(find(call.objectId));
        action = { type: "furniture.delete", furnitureId: call.objectId };
        break;
      case "set_color":
        find(call.objectId);
        action = { type: "furniture.update", furnitureId: call.objectId, patch: { color: call.color } };
        break;
      case "set_light": {
        const item = find(call.objectId);
        if (!item.light) throw new Error(`${item.name} (${item.id}) is not a light fixture.`);
        action = { type: "furniture.update", furnitureId: item.id, patch: { light: { ...item.light, ...(call.on === undefined ? {} : { on: call.on }), ...(call.intensity === undefined ? {} : { intensity: call.intensity }), ...(call.color ? { color: call.color } : {}) } } };
        break;
      }
      case "set_environment":
        action = { type: "scene.update", patch: { environment: { mode: call.mode } } };
        break;
    }
    work = applySceneAction(work, action).scene;
    actions.push(action);
  }
  return actions;
}

function problems(issues: ValidationIssue[]) {
  return issues.filter((issue) => issue.severity !== "info");
}

/**
 * Propose → convert → apply on a copy → validate → feed violations back; at most three attempts.
 * The returned action is only a proposal; the client applies it through the normal (undoable, synced) pipeline.
 */
export async function runAiEdit(request: AiEditRequest, newId: () => string): Promise<AiEditResponse> {
  const { scene, catalog, instruction } = request;
  const room = scene.rooms.find((entry) => entry.id === request.roomId) ?? scene.rooms[0];
  if (!room) throw new Error("The scene has no room.");
  const baseline = new Set(problems(validateScene(scene, { skipBlockerAnalysis: true }).issues).map((issue) => issue.id));
  const history = request.history ?? [];
  const shortlist = shortlistCatalog(catalog, [instruction, ...history.filter((turn) => turn.role === "user").map((turn) => turn.text)].join(" "));
  // Earlier turns go in as plain text so follow-ups resolve ("move it a bit left").
  const conversation: Content[] = history.map((turn) => ({ role: turn.role === "user" ? "user" : "model", parts: [{ text: turn.role === "user" ? `Request: ${turn.text}` : JSON.stringify({ summary: turn.text, calls: [] }) }] }));
  const opening: Content = { role: "user", parts: [{ text: `Scene:\n${describeScene(scene, shortlist, room)}\n\nRequest: ${instruction}` }] };
  let contents: Content[] = [...conversation, opening];
  const attempts: AiEditResponse["attempts"] = [];
  let best: { action: AiEditResponse["action"]; newIssues: ValidationIssue[]; summary: string } | null = null;
  let usedModel = aiModel();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    // First try fast (no thinking); corrections get a small thinking budget.
    const { text, model } = await generateJson(EDIT_SYSTEM, contents, { thinkingBudget: attempt === 1 ? 0 : 1024, timeoutMs: 25_000 });
    usedModel = model;
    let feedback: string;

    let plan;
    try {
      plan = AiPlanSchema.parse(JSON.parse(text));
    } catch (error) {
      feedback = "Your response did not match the required JSON schema: " + (error instanceof Error ? error.message.slice(0, 600) : String(error));
      attempts.push({ attempt, calls: [], outcome: "malformed", feedback });
      contents = [...conversation, opening, { role: "model", parts: [{ text }] }, { role: "user", parts: [{ text: feedback + "\nReturn corrected JSON only." }] }];
      continue;
    }
    if (plan.calls.length === 0) {
      attempts.push({ attempt, calls: [], outcome: "accepted", feedback: null });
      return { status: "ok", summary: plan.summary, action: null, attempts, newIssues: [], model: usedModel };
    }

    try {
      const actions = toolCallsToActions(scene, plan.calls, catalog, newId, room.id);
      const action = { type: "batch" as const, label: "AI: " + instruction.slice(0, 48), actions };
      const next = applySceneAction(scene, action).scene;
      const newIssues = problems(validateScene(next).issues).filter((issue) => !baseline.has(issue.id));
      if (newIssues.length === 0) {
        attempts.push({ attempt, calls: plan.calls, outcome: "accepted", feedback: null });
        return { status: "ok", summary: plan.summary, action, attempts, newIssues: [], model: usedModel };
      }
      if (!best || newIssues.length < best.newIssues.length) best = { action, newIssues, summary: plan.summary };
      feedback = "The spatial engine found violations caused by your proposal:\n" +
        newIssues.map((issue) => `- [${issue.ruleId}] ${issue.message}${issue.suggestion ? " Suggestion: " + issue.suggestion : ""}`).join("\n");
      attempts.push({ attempt, calls: plan.calls, outcome: "spatial-violations", feedback });
    } catch (error) {
      feedback = "Your tool calls could not be applied: " + (error instanceof SceneActionError || error instanceof Error ? error.message : String(error));
      attempts.push({ attempt, calls: plan.calls, outcome: "invalid-action", feedback });
    }
    // Retries carry only the scene, the latest proposal and its problems, never the whole transcript.
    contents = [...conversation, opening, { role: "model", parts: [{ text }] }, { role: "user", parts: [{ text: feedback + "\nPropose a corrected full set of calls (it replaces the previous proposal). JSON only." }] }];
  }

  return {
    status: "failed",
    summary: best ? best.summary + ` (still causes ${best.newIssues.length} issue${best.newIssues.length === 1 ? "" : "s"} after ${MAX_ATTEMPTS} attempts)` : `No valid proposal after ${MAX_ATTEMPTS} attempts.`,
    action: best?.action ?? null,
    attempts,
    newIssues: best?.newIssues ?? [],
    model: usedModel,
  };
}

const IMAGE_SYSTEM = `You reconstruct a room for a 3D editor from one image: a photo, a hand-drawn sketch, or a floor plan.
Respond with JSON only:
{"roomName":string,"source":"photo"|"sketch"|"floor-plan",
 "measurements":[{"label":string,"meters":number,"axis":"width"|"depth"|"other"}],
 "width":number,"depth":number,"height":number,"floorColor":"#rrggbb","wallColor":"#rrggbb",
 "openings":[{"kind":"door"|"window","wall":"north"|"south"|"east"|"west","offset":number,"width":number}],
 "objects":[{"catalogItemId":string,"name":string,"x":number,"z":number,"yawDegrees":number,"color":"#rrggbb"}],
 "notes":string}
Coordinates in meters, room centered at x=0,z=0; north wall is -Z, the camera is roughly at the south (+Z) side looking north.
width is along X, depth along Z. yawDegrees 0 = object front faces +Z (toward camera), 180 faces -Z.
MEASUREMENTS ARE AUTHORITATIVE. First read every dimension written on the image (e.g. "15m", "7 m", "4.2", "12'6\"", "3600 mm") and list each one in measurements: label = the text exactly as written, meters = its value in meters, axis = "width" if its dimension line runs left-right (horizontal, along X), "depth" if it runs up-down (vertical, along Z), else "other". The room width/depth MUST equal the written values for those sides; never replace them with typical sizes. Only estimate a side when nothing is written for it.
For a sketch or floor plan, include only furniture, doors and windows that are actually drawn or labelled; an empty outline means an empty room (objects: []). Do not invent furniture.
Only use catalogItemIds from the provided catalog; map each visible piece to the closest one. Estimate realistic sizes from typical furniture dimensions. Put objects against walls where they appear to be. In notes, state what was uncertain.`;

const BRIEF_SYSTEM = IMAGE_SYSTEM.replace("from one image: a photo, a hand-drawn sketch, or a floor plan.", "from a written brief (the user's description of the room they want). Design a sensible, well-furnished layout that matches the brief: furniture against walls, clear walkways, a door and at least one window. Set source to \"sketch\" and leave measurements empty unless the brief states sizes; any sizes stated in the brief are authoritative.");

const catalogText = (catalog: AiCatalogItem[]) => JSON.stringify(distinctProducts(catalog).map((entry) => ({ catalogItemId: entry.id, name: entry.name, width: entry.dimensions.width, depth: entry.dimensions.depth, height: entry.dimensions.height })));

export async function runImageToRoom(request: AiImageRequest, newId: () => string): Promise<AiImageResponse> {
  return buildRoom(IMAGE_SYSTEM, [
    { inlineData: { mimeType: request.mimeType, data: request.imageBase64 } },
    { text: "Catalog:\n" + catalogText(request.catalog) },
  ], request.catalog, newId);
}

export async function runBriefToRoom(request: AiBriefRequest, newId: () => string): Promise<AiImageResponse> {
  return buildRoom(BRIEF_SYSTEM, [{ text: `Brief: ${request.brief}\n\nCatalog:\n${catalogText(request.catalog)}` }], request.catalog, newId);
}

async function extract(system: string, parts: Content["parts"]) {
  const { text, model } = await generateJson(system, [{ role: "user", parts }], { thinkingBudget: 512, timeoutMs: 45_000 });
  const extraction = AiRoomExtractionSchema.parse(JSON.parse(text));
  // Written dimensions win over the model's own estimate; scale its object positions to match.
  const written = (axis: "width" | "depth") => extraction.measurements.filter((entry) => entry.axis === axis && entry.meters >= 1 && entry.meters <= 40).sort((a, b) => b.meters - a.meters)[0];
  const corrections: string[] = [];
  const sources = { width: "estimated" as "written" | "measured" | "estimated", depth: "estimated" as "written" | "measured" | "estimated" };
  // A room-size label ("17'-8\" X 17'-7\"") for the reconstructed room beats any other dimension, including the building's overall size.
  const own = extraction.planRooms.find((room) => room.name.toLowerCase() === extraction.roomName.toLowerCase() && room.label)?.label
    ?? extraction.measurements.find((entry) => parseSizeLabel(entry.label))?.label;
  const size = own ? parseSizeLabel(own) : null;
  if (size) {
    const [width, depth] = size;
    for (const object of extraction.objects) { object.x *= width / extraction.width; object.z *= depth / extraction.depth; }
    for (const opening of extraction.openings) opening.offset *= (opening.wall === "north" || opening.wall === "south" ? width / extraction.width : depth / extraction.depth);
    if (Math.abs(width - extraction.width) > 0.05 || Math.abs(depth - extraction.depth) > 0.05) corrections.push(`size set from the room label ${own} (model estimated ${extraction.width.toFixed(2)} × ${extraction.depth.toFixed(2)} m)`);
    extraction.width = width;
    extraction.depth = depth;
    extraction.measurements = extraction.measurements.filter((entry) => entry.label === own);
    if (!extraction.measurements.length) extraction.measurements.push({ label: own!, meters: width, axis: "width" });
    return { extraction: { ...extraction, notes: (corrections.join("; ") + (corrections.length ? ". " : "") + extraction.notes).trim() }, sources: { width: "written" as const, depth: "written" as const }, model };
  }
  // For a multi-room plan the written dimensions include the whole building; the focused room's own label is used instead.
  const multiRoom = extraction.planRooms.length > 1;
  for (const axis of ["width", "depth"] as const) {
    const measured = multiRoom ? undefined : written(axis);
    if (!measured) {
      if (multiRoom || extraction.measurements.some((entry) => Math.abs(entry.meters - extraction[axis]) < 0.05)) sources[axis] = extraction.measurements.length ? "written" : "estimated";
      continue;
    }
    sources[axis] = "written";
    if (Math.abs(measured.meters - extraction[axis]) < 0.01) continue;
    const scale = measured.meters / extraction[axis];
    for (const object of extraction.objects) object[axis === "width" ? "x" : "z"] *= scale;
    for (const opening of extraction.openings) if ((axis === "width") === (opening.wall === "north" || opening.wall === "south")) opening.offset *= scale;
    corrections.push(`${axis} set to the written ${measured.label} (model estimated ${extraction[axis].toFixed(2)} m)`);
    extraction[axis] = measured.meters;
  }
  if (corrections.length) extraction.notes = (corrections.join("; ") + ". " + extraction.notes).trim();
  return { extraction, sources, model };
}

const DEFAULT_SETTINGS = (extraction: AiRoomExtraction): PlanBuildSettings => ({
  width: extraction.width, depth: extraction.depth, height: extraction.height, wallThickness: 0.14, openings: true, furniture: true, lighting: "natural",
});

/** Deterministic: extraction (+ user settings) → validated scene. The AI never produces geometry directly. */
export function assembleRoom(source: AiRoomExtraction, catalog: AiCatalogItem[], newId: () => string, settings: PlanBuildSettings = DEFAULT_SETTINGS(source), model = "engine"): AiImageResponse {
  // Resizing the room scales the AI's positions with it, so furniture keeps its place relative to the walls.
  const sx = settings.width / source.width;
  const sz = settings.depth / source.depth;
  const roomId = newId();
  const halfW = settings.width / 2;
  const halfD = settings.depth / 2;
  const furniture: FurnitureObject[] = [];
  for (const object of settings.furniture ? source.objects : []) {
    const entry = catalog.find((item) => item.id === object.catalogItemId);
    if (!entry) continue;
    const yaw = ((Math.round(object.yawDegrees / 90) * 90) % 360 + 360) % 360;
    const rotated = yaw === 90 || yaw === 270;
    // Footprint measured from the plan (scaled with the room if the user corrects its size), else the catalog size.
    const dimensions = object.width && object.depth
      ? { width: fmt(object.width * (rotated ? sz : sx)), depth: fmt(object.depth * (rotated ? sx : sz)), height: entry.dimensions.height }
      : entry.dimensions;
    const halfX = (rotated ? dimensions.depth : dimensions.width) / 2;
    const halfZ = (rotated ? dimensions.width : dimensions.depth) / 2;
    furniture.push({
      id: newId(), roomId, name: object.name || entry.name, category: entry.category, catalogItemId: entry.id,
      // Clamp into the room; the spatial engine reports anything still wrong.
      position: { x: fmt(Math.max(-halfW + halfX, Math.min(halfW - halfX, object.x * sx))), y: entry.elevation ?? 0, z: fmt(Math.max(-halfD + halfZ, Math.min(halfD - halfZ, object.z * sz))) },
      yawDegrees: yaw, dimensions, color: object.color ?? entry.color,
      ...(entry.light ? { light: entry.light } : {}), ...(entry.constraints ? { constraints: entry.constraints } : {}), version: 1,
    });
  }
  const dropped = settings.furniture ? source.objects.length - furniture.length : 0;
  // Interior walls, partitions and the solid blocks of an L-shape/notch: full-height, locked, collidable segments.
  for (const wall of source.walls) {
    // 1 cm inset so fixtures drawn flush against a partition touch it instead of overlapping by a rounding error.
    const width = fmt(Math.max(0.03, Math.min(settings.width, wall.width * sx) - 0.02));
    const depth = fmt(Math.max(0.03, Math.min(settings.depth, wall.depth * sz) - 0.02));
    furniture.push({
      id: newId(), roomId, name: "Wall", category: "other",
      position: { x: fmt(Math.max(-halfW + width / 2, Math.min(halfW - width / 2, wall.x * sx))), y: 0, z: fmt(Math.max(-halfD + depth / 2, Math.min(halfD - depth / 2, wall.z * sz))) },
      yawDegrees: 0, dimensions: { width, depth, height: settings.height }, color: source.wallColor ?? "#f1eee8",
      constraints: { locked: true, frontClearance: 0 }, version: 1,
    });
  }
  const lighting = settings.lighting === "warm" ? { mode: "evening" as const, artificialLightScale: 1.2 } : settings.lighting === "neutral" ? { mode: "day" as const, artificialLightScale: 0.8 } : { mode: "day" as const, artificialLightScale: 1 };
  const scene = SceneSchema.parse({
    schemaVersion: 1,
    id: "scene-plan-" + roomId,
    name: source.roomName,
    coordinateSystem: "y-up-xz-meters",
    rooms: [{
      id: roomId, name: source.roomName, position: { x: 0, y: 0, z: 0 }, yawDegrees: 0,
      dimensions: { width: settings.width, depth: settings.depth, height: settings.height, wallThickness: settings.wallThickness },
      floorColor: source.floorColor ?? "#c8ab86", wallColor: source.wallColor ?? "#f1eee8",
      openings: (settings.openings ? source.openings : []).map((opening) => {
        const horizontal = opening.wall === "north" || opening.wall === "south";
        const length = horizontal ? settings.width : settings.depth;
        const width = Math.min(opening.width, length - 0.2);
        const offset = opening.offset * (horizontal ? sx : sz);
        return {
          id: newId(), kind: opening.kind, wall: opening.wall, width,
          offset: fmt(Math.max(-length / 2 + width / 2, Math.min(length / 2 - width / 2, offset))),
          height: opening.kind === "door" ? Math.min(2.05, settings.height - 0.2) : Math.min(1.3, settings.height - 1.1), sillHeight: opening.kind === "door" ? 0 : 0.9,
          ...(opening.hinge ? { hinge: opening.hinge } : {}), ...(opening.swing ? { swing: opening.swing } : {}),
        };
      }),
    }],
    furniture,
    environment: lighting,
  });
  const read = source.measurements.length ? `Measurements read: ${source.measurements.map((entry) => `${entry.label} → ${entry.meters} m (${entry.axis})`).join(", ")}. ` : "";
  const notes = read + source.notes + (dropped > 0 ? ` (${dropped} object${dropped === 1 ? "" : "s"} without a catalog match were skipped.)` : "");
  // Let the engine tidy the AI's placement: apply the best recovery candidate a few times while it helps.
  let tidy = scene;
  let fixedBy = 0;
  // Measured plans are reproduced exactly as drawn; the engine still reports any issue, but nothing is moved.
  for (let round = 0; round < (source.measured ? 0 : 3); round += 1) {
    const best = generateRecoveryCandidates(tidy, 1).candidates[0];
    if (!best || best.issuesAfter >= best.issuesBefore) break;
    tidy = applySceneAction(tidy, best.action).scene;
    fixedBy += best.issuesBefore - best.issuesAfter;
  }
  const tidyNote = fixedBy > 0 ? ` Layout recovery fixed ${fixedBy} placement issue${fixedBy === 1 ? "" : "s"} automatically.` : "";
  return { scene: tidy, notes: (notes + tidyNote).trim(), issues: validateScene(tidy).issues, model };
}

async function buildRoom(system: string, parts: Content["parts"], catalog: AiCatalogItem[], newId: () => string): Promise<AiImageResponse> {
  const { extraction, model } = await extract(system, parts);
  return assembleRoom(extraction, catalog, newId, undefined, model);
}

const PLAN_SYSTEM = `You read a 2D ROOM PLAN image (architectural plan, top-down layout or hand sketch) for a 3D editor and reconstruct ONE room.
Respond with JSON only:
{"isRoomPlan":boolean,
 "planRooms":[{"name":string,"label":string}],
 "roomName":string,"source":"floor-plan"|"sketch"|"photo",
 "measurements":[{"label":string,"meters":number,"axis":"width"|"depth"|"other"}],
 "width":number,"depth":number,"height":number,"floorColor":"#rrggbb","wallColor":"#rrggbb",
 "roomBox":[ymin,xmin,ymax,xmax],
 "walls":[{"box":[ymin,xmin,ymax,xmax]}],
 "openings":[{"kind":"door"|"window","wall":"north"|"south"|"east"|"west","offset":number,"width":number,"hinge":"left"|"right","swing":"in"|"out","confidence":number,"box":[ymin,xmin,ymax,xmax]}],
 "objects":[{"catalogItemId":string,"name":string,"x":number,"z":number,"yawDegrees":number,"confidence":number,"box":[ymin,xmin,ymax,xmax]}],
 "notes":string}
BOXES: every box is [ymin, xmin, ymax, xmax] on THIS image, each normalized 0-1000 (0,0 = top-left). Be precise to the drawn lines; the editor measures the 3D room from these boxes.
 roomBox = the reconstructed room's interior bounding rectangle: from the INNER face of its left wall to the inner face of its right wall, and from the inner face of its top wall to the inner face of its bottom wall (do not include wall thickness).
 walls = wall material INSIDE roomBox: interior partitions and dividers, wall stubs, and solid wall blocks that make the room non-rectangular (an L-shape or notch: box the filled area that is not floor). Not the four outer walls. [] if none.
 openings[].box = the gap in the wall (door leaf width or window length). objects[].box = the fixture's drawn outline (e.g. the whole bathtub, basin counter, toilet, bed).
STEP 1. isRoomPlan=false if the image is not a room, plan or sketch at all (then width=depth=3 and empty lists).
STEP 2. If the image shows MORE THAN ONE room (a flat or house plan), planRooms MUST list every labelled room: name = its label text (e.g. "Bedroom", "Kitchen"), label = its size text exactly as written (e.g. 17'-8" X 17'-7"), or "" if none. For a single-room plan planRooms = [].
STEP 3. Pick the room to reconstruct: the one named in Focus, otherwise the living room (or the largest room). roomName = its name.
 width/depth = THAT ROOM's interior size in meters. Use its own size label (first number = left-right = width, second = up-down = depth; 1 ft = 0.3048 m, 1 in = 0.0254 m).
 NEVER use the overall building dimensions (the long dimension lines around the whole plan) for a single room.
 measurements = only the label(s) that belong to that room.
STEP 4. Coordinates in meters relative to THAT room's center: x along width (left-right), z along depth (top of the image = north = -Z). yawDegrees 0 = object front faces +Z (down the image).
 openings: doors (gap with an arc) and windows (thin double/triple lines in a wall) on that room's own walls only; offset = center along the wall from the wall midpoint; give hinge/swing when an arc is drawn.
 objects: only furniture actually drawn inside that room, mapped to the closest catalogItemId from the provided catalog; do not invent furniture. Their real size is measured from the box.
 confidence 0–1 per opening and object (1 = clearly drawn, 0.4 = guessed).
height = 2.8 unless stated. In notes, say briefly what was uncertain.`;


export { parseSizeLabel };

export async function runPlanAnalyze(request: AiPlanAnalyzeRequest): Promise<AiPlanAnalyzeResponse> {
  const focus = request.focusRoom ? `Focus: reconstruct the room labelled "${request.focusRoom}".\n` : "";
  return extract(PLAN_SYSTEM, [
    { inlineData: { mimeType: request.mimeType, data: request.imageBase64 } },
    { text: focus + "Catalog:\n" + catalogText(request.catalog) },
  ]);
}

// ---------------------------------------------------------------- whole floor plans ----------

const HOUSE_SYSTEM = `You read a 2D FLOOR PLAN of a whole house or flat for a 3D editor. The editor measures all geometry from the
image pixels itself; your job is to say WHAT is WHERE. Respond with JSON only:
{"isRoomPlan":boolean,"name":string,
 "overall":[{"label":string,"meters":number,"axis":"width"|"depth"}],
 "rooms":[{"name":string,"label":string,"box":[ymin,xmin,ymax,xmax],
   "objects":[{"catalogItemId":string,"name":string,"box":[ymin,xmin,ymax,xmax],"yawDegrees":number}]}],
 "notes":string}
Boxes are [ymin, xmin, ymax, xmax] on THIS image, normalized 0-1000 (0,0 = top-left). Be precise to the drawn lines.
- overall: the dimension lines around the whole building (e.g. "15.00 m" along the top = width, "10.00 m" down the side = depth), in meters. [] if none.
- rooms: EVERY labelled space (bedrooms, toilets, kitchen, utility, dining, living, porch, balcony...). name = its label text in Title Case.
  label = its size text exactly as written ("3.60 x 3.30 m"), "" if none.
  box = that room's interior: from the inner face of the wall on its left to the inner face of the wall on its right, and inner face of the top wall to inner face of the bottom wall. Where two spaces are open to each other (no wall, e.g. dining and living), split them where the plan's labels and furniture suggest, so the two boxes touch but don't overlap.
- objects: furniture and fixtures drawn inside that room (beds, wardrobes, sofas, tables, chairs, toilets, basins, showers, kitchen counters, hobs, sinks, washing machines), each mapped to the closest catalogItemId in the catalog. box = the drawn outline of that piece. yawDegrees: 0 = the piece's front faces DOWN the image, 90 = faces right, 180 = faces up, 270 = faces left (a bed's front is its foot end). Do not invent pieces; skip plants and rugs.
- isRoomPlan=false if the image is not a floor plan.`;

export async function runHouseAnalyze(request: AiPlanAnalyzeRequest): Promise<AiHouseAnalyzeResponse> {
  const { text, model } = await generateJson(HOUSE_SYSTEM, [{ role: "user", parts: [
    { inlineData: { mimeType: request.mimeType, data: request.imageBase64 } },
    { text: "Catalog:\n" + catalogText(request.catalog) },
  ] }], { thinkingBudget: 1024, timeoutMs: 90_000 });
  const parsed = AiHouseExtractionSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    console.error("Floor plan answer did not match the schema:", text.slice(0, 1500));
    throw new Error("The AI's answer for this plan was malformed; please try again.");
  }
  return { extraction: parsed.data, model };
}

/** Deterministic build of a measured whole plan: one room per space, openings on both sides of shared walls. */
export function assembleHouse(house: MeasuredHouse, catalog: AiCatalogItem[], newId: () => string): AiImageResponse {
  const rooms: Room[] = [];
  const furniture: FurnitureObject[] = [];
  let skipped = 0;
  for (const source of house.rooms) {
    const roomId = newId();
    rooms.push({
      id: roomId, name: source.name, position: { x: fmt(source.x), y: 0, z: fmt(source.z) }, yawDegrees: 0,
      dimensions: { width: fmt(source.width), depth: fmt(source.depth), height: house.height, wallThickness: fmt(source.wallThickness) },
      floorColor: /toilet|bath|utility|wash|porch|balcony/i.test(source.name) ? "#d9d6cf" : /kitchen/i.test(source.name) ? "#cfc6b8" : "#c8ab86",
      wallColor: "#f1eee8",
      openings: source.openings.map((opening) => {
        const length = opening.wall === "north" || opening.wall === "south" ? source.width : source.depth;
        const width = fmt(Math.max(0.3, Math.min(opening.width, length - 0.1)));
        const offset = fmt(Math.max(-length / 2 + width / 2, Math.min(length / 2 - width / 2, opening.offset)));
        // A passage is an open side (no wall drawn): an opening up to just under the ceiling.
        const height = opening.kind === "window" ? Math.min(1.3, house.height - 1.1) : opening.kind === "passage" ? house.height - 0.05 : Math.min(2.1, house.height - 0.2);
        return { id: newId(), kind: opening.kind === "window" ? "window" as const : "door" as const, wall: opening.wall, offset, width, height, sillHeight: opening.kind === "window" ? 0.9 : 0, hinge: "left" as const, swing: "in" as const };
      }),
      version: 1,
    });
    for (const object of source.objects) {
      const entry = catalog.find((item) => item.id === object.catalogItemId);
      if (!entry) { skipped += 1; continue; }
      furniture.push({
        id: newId(), roomId, name: object.name || entry.name, category: entry.category, catalogItemId: entry.id,
        position: { x: fmt(source.x + object.x), y: entry.elevation ?? 0, z: fmt(source.z + object.z) },
        yawDegrees: object.yawDegrees, dimensions: { width: fmt(object.width), depth: fmt(object.depth), height: entry.dimensions.height },
        color: entry.color, ...(entry.light ? { light: entry.light } : {}), ...(entry.constraints ? { constraints: entry.constraints } : {}), version: 1,
      });
    }
  }
  const scene = SceneSchema.parse({ schemaVersion: 1, id: "scene-house-" + newId(), name: house.name, coordinateSystem: "y-up-xz-meters", rooms, furniture, environment: { mode: "day", artificialLightScale: 1 } });
  const notes = `${rooms.length} rooms, ${furniture.length} pieces measured from the plan.` + (skipped ? ` ${skipped} piece${skipped === 1 ? "" : "s"} without a catalog match were skipped.` : "");
  return { scene, notes, issues: validateScene(scene).issues, model: "engine" };
}
