import {
  AiPlanSchema,
  AiRoomExtractionSchema,
  applySceneAction,
  SceneActionError,
  SceneSchema,
  type AiCatalogItem,
  type AiEditRequest,
  type AiEditResponse,
  type AiImageRequest,
  type AiImageResponse,
  type AiToolCall,
  type BaseSceneAction,
  type FurnitureObject,
  type Room,
  type Scene,
  type ValidationIssue,
  type WallSide,
} from "@reality-builder/shared";
import { requiredFrontClearance, roomToWorld, rotateYaw, validateScene } from "@reality-builder/spatial-engine";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MAX_ATTEMPTS = 3;

export class AiUnavailableError extends Error {}

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

async function callModel(model: string, key: string, system: string, contents: Content[], signal: AbortSignal) {
  const response = await fetch(`${API_BASE}/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { responseMimeType: "application/json", temperature: 0.2 } }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(40_000)]),
  });
  const payload = (await response.json().catch(() => null)) as GeminiPayload | null;
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
async function generateJson(system: string, contents: Content[]): Promise<{ text: string; model: string }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new AiUnavailableError("GEMINI_API_KEY is not set on the server (apps/.env).");
  const chain = modelChain();
  const failures: string[] = [];
  const race = new AbortController();
  try {
    const result = await Promise.any(chain.slice(0, 2).map((model) => callModel(model, key, system, contents, race.signal)));
    race.abort();
    return result;
  } catch (error) {
    for (const reason of (error as AggregateError).errors ?? [error]) failures.push((reason as Error).message);
  }
  for (const model of chain.slice(2)) {
    try {
      return await callModel(model, key, system, contents, new AbortController().signal);
    } catch (error) {
      failures.push((error as Error).message);
    }
  }
  throw new Error(`No Gemini model answered — ${failures.join("; ")}`);
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

const EDIT_SYSTEM = `You are the layout assistant inside Reality Builder, a 3D interior design editor.
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
  const contents: Content[] = [{ role: "user", parts: [{ text: `Scene:\n${describeScene(scene, catalog, room)}\n\nRequest: ${instruction}` }] }];
  const attempts: AiEditResponse["attempts"] = [];
  let best: { action: AiEditResponse["action"]; newIssues: ValidationIssue[]; summary: string } | null = null;
  let usedModel = aiModel();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const { text, model } = await generateJson(EDIT_SYSTEM, contents);
    usedModel = model;
    contents.push({ role: "model", parts: [{ text }] });
    let feedback: string;

    let plan;
    try {
      plan = AiPlanSchema.parse(JSON.parse(text));
    } catch (error) {
      feedback = "Your response did not match the required JSON schema: " + (error instanceof Error ? error.message.slice(0, 600) : String(error));
      attempts.push({ attempt, calls: [], outcome: "malformed", feedback });
      contents.push({ role: "user", parts: [{ text: feedback + "\nReturn corrected JSON only." }] });
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
    contents.push({ role: "user", parts: [{ text: feedback + "\nPropose a corrected full set of calls (it replaces the previous proposal). JSON only." }] });
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

export async function runImageToRoom(request: AiImageRequest, newId: () => string): Promise<AiImageResponse> {
  const catalogText = JSON.stringify(request.catalog.map((entry) => ({ catalogItemId: entry.id, name: entry.name, width: entry.dimensions.width, depth: entry.dimensions.depth, height: entry.dimensions.height })));
  const { text, model } = await generateJson(IMAGE_SYSTEM, [{
    role: "user",
    parts: [
      { inlineData: { mimeType: request.mimeType, data: request.imageBase64 } },
      { text: "Catalog:\n" + catalogText },
    ],
  }]);
  const extraction = AiRoomExtractionSchema.parse(JSON.parse(text));
  // Written dimensions win over the model's own estimate; scale its object positions to match.
  const written = (axis: "width" | "depth") => extraction.measurements.filter((entry) => entry.axis === axis && entry.meters >= 1.5 && entry.meters <= 20).sort((a, b) => b.meters - a.meters)[0];
  const corrections: string[] = [];
  for (const axis of ["width", "depth"] as const) {
    const measured = written(axis);
    if (!measured || Math.abs(measured.meters - extraction[axis]) < 0.01) continue;
    const scale = measured.meters / extraction[axis];
    for (const object of extraction.objects) object[axis === "width" ? "x" : "z"] *= scale;
    for (const opening of extraction.openings) if ((axis === "width") === (opening.wall === "north" || opening.wall === "south")) opening.offset *= scale;
    corrections.push(`${axis} set to the written ${measured.label} (model estimated ${extraction[axis].toFixed(2)} m)`);
    extraction[axis] = measured.meters;
  }
  const roomId = newId();
  const halfW = extraction.width / 2;
  const halfD = extraction.depth / 2;
  const furniture: FurnitureObject[] = [];
  for (const object of extraction.objects) {
    const entry = request.catalog.find((item) => item.id === object.catalogItemId);
    if (!entry) continue; // Unknown types are dropped (reported via notes count below).
    const yaw = ((Math.round(object.yawDegrees / 90) * 90) % 360 + 360) % 360;
    const rotated = yaw === 90 || yaw === 270;
    const halfX = (rotated ? entry.dimensions.depth : entry.dimensions.width) / 2;
    const halfZ = (rotated ? entry.dimensions.width : entry.dimensions.depth) / 2;
    furniture.push({
      id: newId(), roomId, name: object.name || entry.name, category: entry.category, catalogItemId: entry.id,
      // Clamp into the room; the spatial engine reports anything still wrong.
      position: { x: fmt(Math.max(-halfW + halfX, Math.min(halfW - halfX, object.x))), y: entry.elevation ?? 0, z: fmt(Math.max(-halfD + halfZ, Math.min(halfD - halfZ, object.z))) },
      yawDegrees: yaw, dimensions: entry.dimensions, color: object.color ?? entry.color,
      ...(entry.light ? { light: entry.light } : {}), ...(entry.constraints ? { constraints: entry.constraints } : {}), version: 1,
    });
  }
  const dropped = extraction.objects.length - furniture.length;
  const scene = SceneSchema.parse({
    schemaVersion: 1,
    id: "scene-photo-" + roomId,
    name: extraction.roomName,
    coordinateSystem: "y-up-xz-meters",
    rooms: [{
      id: roomId, name: extraction.roomName, position: { x: 0, y: 0, z: 0 }, yawDegrees: 0,
      dimensions: { width: extraction.width, depth: extraction.depth, height: extraction.height, wallThickness: 0.14 },
      floorColor: extraction.floorColor ?? "#c8ab86", wallColor: extraction.wallColor ?? "#f1eee8",
      openings: extraction.openings.map((opening) => {
        const length = opening.wall === "north" || opening.wall === "south" ? extraction.width : extraction.depth;
        const width = Math.min(opening.width, length - 0.2);
        return {
          id: newId(), kind: opening.kind, wall: opening.wall, width,
          offset: fmt(Math.max(-length / 2 + width / 2, Math.min(length / 2 - width / 2, opening.offset))),
          height: opening.kind === "door" ? 2.05 : 1.3, sillHeight: opening.kind === "door" ? 0 : 0.9,
        };
      }),
    }],
    furniture,
  });
  const read = extraction.measurements.length ? `Read from image: ${extraction.measurements.map((entry) => `${entry.label} → ${entry.meters} m (${entry.axis})`).join(", ")}. ` : "";
  const notes = read + (corrections.length ? corrections.join("; ") + ". " : "") + extraction.notes + (dropped > 0 ? ` (${dropped} object${dropped === 1 ? "" : "s"} without a catalog match were skipped.)` : "");
  return { scene, notes: notes.trim(), issues: validateScene(scene).issues, model };
}
