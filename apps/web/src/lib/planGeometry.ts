/**
 * Pixel-exact plan geometry. The AI reads the plan (what is a wall, which fixture is a bathtub, which dimension
 * belongs to the room) and gives rough boxes; this module measures everything else from the image itself:
 *
 *  1. Each box edge is snapped to the nearest drawn line (wall faces, fixture outlines) in the image pixels.
 *  2. One scale (meters per pixel) comes from a written dimension and the measured interior in pixels. With one
 *     written side the other is measured, so proportions match the drawing instead of the model's guess.
 *  3. Every position and size (room, fixtures, openings, partition walls) is converted with that same scale, so the
 *     3D room is a 1:1 copy of the drawing.
 */
import { parseSizeLabel, type AiHouseExtraction, type AiPlanAnalyzeResponse, type AiRoomExtraction, type ImageBox, type MeasuredHouse } from "@reality-builder/shared";

export type PxRect = { x0: number; y0: number; x1: number; y1: number };
export type PlanOverlay = {
  imageWidth: number;
  imageHeight: number;
  room: PxRect;
  /** Whole plans: every room's measured interior. */
  rooms?: PxRect[];
  walls: PxRect[];
  objects: { rect: PxRect; label: string }[];
  openings: { rect: PxRect; kind: "door" | "window" }[];
  /** Meters per image pixel (x, z). */
  scale: { x: number; z: number };
};
export type MeasuredPlan = { response: AiPlanAnalyzeResponse; overlay: PlanOverlay; notes: string[] };

type Pixels = { width: number; height: number; luminance: Uint8Array };

/** Walls are drawn solid and dark; fixture outlines are thinner and lighter. */
const WALL_DARK = 90;
const LINE_INK = 175;

async function loadPixels(dataUrl: string): Promise<Pixels> {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  const luminance = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < luminance.length; i += 1) luminance[i] = (data[i * 4]! * 299 + data[i * 4 + 1]! * 587 + data[i * 4 + 2]! * 114) / 1000;
  return { width: canvas.width, height: canvas.height, luminance };
}

const toRect = (box: ImageBox, pixels: Pixels): PxRect => {
  const [ymin, xmin, ymax, xmax] = box.map((value) => Math.max(0, Math.min(1000, value))) as ImageBox;
  return { x0: (Math.min(xmin, xmax) / 1000) * pixels.width, y0: (Math.min(ymin, ymax) / 1000) * pixels.height, x1: (Math.max(xmin, xmax) / 1000) * pixels.width, y1: (Math.max(ymin, ymax) / 1000) * pixels.height };
};

/** Share of pixels darker than `threshold` along a column (vertical = true) or row, between `from` and `to`. */
function ratio(pixels: Pixels, vertical: boolean, at: number, from: number, to: number, threshold: number) {
  const line = Math.round(at);
  const limit = vertical ? pixels.width : pixels.height;
  if (line < 0 || line >= limit) return 0;
  const start = Math.max(0, Math.round(from));
  const end = Math.min(vertical ? pixels.height : pixels.width, Math.round(to));
  if (end <= start) return 0;
  let dark = 0;
  for (let i = start; i < end; i += 1) {
    const value = vertical ? pixels.luminance[i * pixels.width + line]! : pixels.luminance[line * pixels.width + i]!;
    if (value < threshold) dark += 1;
  }
  return dark / (end - start);
}

/**
 * Moves one box edge to the strongest drawn boundary near it. `outward` is +1 when the outside of the box is at higher
 * coordinates (right/bottom edges). mode "face": light inside / dark outside (room interior against its walls);
 * "solid": dark inside / light outside (a wall block); "line": a drawn outline at the edge itself (fixtures).
 */
function snapEdge(pixels: Pixels, vertical: boolean, position: number, outward: 1 | -1, span: [number, number], range: number, mode: "face" | "solid" | "line") {
  const [from, to] = span;
  const band: [number, number] = [from + (to - from) * 0.2, to - (to - from) * 0.2];
  let best = position;
  let bestScore = mode === "line" ? 0.35 : 0.4;
  for (let at = Math.round(position - range); at <= Math.round(position + range); at += 1) {
    let score: number;
    if (mode === "line") {
      score = ratio(pixels, vertical, at, band[0], band[1], LINE_INK);
    } else {
      const outside = ratio(pixels, vertical, at + 2 * outward, band[0], band[1], WALL_DARK);
      const inside = ratio(pixels, vertical, at - 2 * outward, band[0], band[1], WALL_DARK);
      score = mode === "face" ? outside - inside : inside - outside;
    }
    // Prefer the candidate closest to the AI's edge among equally strong ones.
    if (score > bestScore + 1e-6 || (Math.abs(score - bestScore) < 1e-6 && Math.abs(at - position) < Math.abs(best - position))) {
      best = at;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Fixtures: shrink-wraps the box to the drawn ink. Each edge moves inward over blank rows/columns, then outward
 * while the next row/column still has ink (curved outlines like a toilet bowl included), within `range`.
 */
function wrapInk(pixels: Pixels, rect: PxRect, room: PxRect, rangeShare: number): PxRect {
  const result = { ...rect };
  // Only fixture lines count: solid wall pixels and the anti-aliased wall faces at the interior border are ignored.
  const inset = { x0: room.x0 + 3, y0: room.y0 + 3, x1: room.x1 - 3, y1: room.y1 - 3 };
  const has = (vertical: boolean, at: number) => {
    if (vertical ? at < inset.x0 || at > inset.x1 : at < inset.y0 || at > inset.y1) return false;
    const from = Math.max(vertical ? inset.y0 : inset.x0, vertical ? result.y0 : result.x0);
    const to = Math.min(vertical ? inset.y1 : inset.x1, vertical ? result.y1 : result.x1);
    return ratio(pixels, vertical, at, from, to, LINE_INK) - ratio(pixels, vertical, at, from, to, WALL_DARK) > 0;
  };
  const edges: [keyof PxRect, boolean, 1 | -1, number][] = [["x0", true, -1, pixels.width], ["x1", true, 1, pixels.width], ["y0", false, -1, pixels.height], ["y1", false, 1, pixels.height]];
  for (const [key, vertical, outward, size] of edges) {
    const range = Math.max(3, size * rangeShare);
    const start = result[key];
    // Fixtures drawn against a wall: that edge is the wall face.
    if (Math.abs(start - room[key]) <= range) {
      result[key] = room[key];
      continue;
    }
    let at = Math.round(start);
    while (!has(vertical, at) && Math.abs(at - start) < range) at -= outward;
    // Nothing drawn here (e.g. the fixture edge is the wall itself): keep the AI's edge.
    if (!has(vertical, at)) continue;
    while (has(vertical, at + outward) && Math.abs(at + outward - start) <= range) at += outward;
    result[key] = at;
  }
  return result.x1 - result.x0 > 2 && result.y1 - result.y0 > 2 ? result : rect;
}

/**
 * Wall material inside the room, measured from pixels: the floor is the largest region of the interior that isn't
 * solid wall (fixture outlines are light enough to be crossed). Everything else inside the interior rectangle (wall
 * stubs, partitions, the closed-off part of an L-shape or notch) becomes rectangles on a fine grid.
 */
function solidRegions(pixels: Pixels, room: PxRect): PxRect[] {
  const x0 = Math.ceil(room.x0), y0 = Math.ceil(room.y0), x1 = Math.floor(room.x1), y1 = Math.floor(room.y1);
  const w = x1 - x0, h = y1 - y0;
  if (w < 10 || h < 10) return [];
  const light = (x: number, y: number) => pixels.luminance[(y0 + y) * pixels.width + x0 + x]! >= WALL_DARK;
  // Label connected light regions; keep the largest as the floor.
  const label = new Int32Array(w * h).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let start = 0; start < w * h; start += 1) {
    if (label[start] !== -1 || !light(start % w, Math.floor(start / w))) continue;
    const id = sizes.length;
    let size = 0;
    label[start] = id;
    stack.push(start);
    while (stack.length) {
      const index = stack.pop()!;
      size += 1;
      const x = index % w, y = (index - x) / w;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const next = ny * w + nx;
        if (label[next] !== -1 || !light(nx, ny)) continue;
        label[next] = id;
        stack.push(next);
      }
    }
    sizes.push(size);
  }
  if (!sizes.length) return [];
  const floor = sizes.indexOf(Math.max(...sizes));
  // Grid cells ~1/80 of the room; a cell is solid when most of it isn't floor.
  const cell = Math.max(2, Math.round(Math.min(w, h) / 80));
  const cols = Math.ceil(w / cell), rows = Math.ceil(h / cell);
  const solid: boolean[][] = [];
  for (let r = 0; r < rows; r += 1) {
    solid.push([]);
    for (let c = 0; c < cols; c += 1) {
      let off = 0, total = 0;
      for (let y = r * cell; y < Math.min(h, (r + 1) * cell); y += 1) for (let x = c * cell; x < Math.min(w, (c + 1) * cell); x += 1) {
        total += 1;
        if (label[y * w + x] !== floor) off += 1;
      }
      solid[r]!.push(off / total > 0.5);
    }
  }
  // Merge runs of solid cells into rectangles (same column span on consecutive rows).
  const rects: { c0: number; c1: number; r0: number; r1: number }[] = [];
  let open: typeof rects = [];
  for (let r = 0; r <= rows; r += 1) {
    const runs: [number, number][] = [];
    if (r < rows) for (let c = 0; c < cols; c += 1) {
      if (!solid[r]![c]) continue;
      const begin = c;
      while (c + 1 < cols && solid[r]![c + 1]) c += 1;
      runs.push([begin, c + 1]);
    }
    const next: typeof rects = [];
    for (const [c0, c1] of runs) {
      const match = open.find((rect) => rect.c0 === c0 && rect.c1 === c1);
      if (match) { match.r1 = r + 1; next.push(match); open = open.filter((rect) => rect !== match); }
      else next.push({ c0, c1, r0: r, r1: r + 1 });
    }
    rects.push(...open);
    open = next;
  }
  // Drop slivers: anti-aliased wall edges along the interior border, or specks thinner than ~3 cells.
  return rects
    .filter((rect) => rect.c1 - rect.c0 >= 3 && rect.r1 - rect.r0 >= 3)
    .map((rect) => ({ x0: x0 + rect.c0 * cell, y0: y0 + rect.r0 * cell, x1: Math.min(x1, x0 + rect.c1 * cell), y1: Math.min(y1, y0 + rect.r1 * cell) }));
}

function snapRect(pixels: Pixels, rect: PxRect, mode: "face" | "solid" | "line", rangeShare: number): PxRect {
  const rangeX = Math.max(3, pixels.width * rangeShare);
  const rangeY = Math.max(3, pixels.height * rangeShare);
  const snapped = {
    x0: snapEdge(pixels, true, rect.x0, -1, [rect.y0, rect.y1], rangeX, mode),
    x1: snapEdge(pixels, true, rect.x1, 1, [rect.y0, rect.y1], rangeX, mode),
    y0: snapEdge(pixels, false, rect.y0, -1, [rect.x0, rect.x1], rangeY, mode),
    y1: snapEdge(pixels, false, rect.y1, 1, [rect.x0, rect.x1], rangeY, mode),
  };
  // Never let snapping collapse or invert a box.
  return snapped.x1 - snapped.x0 > 2 && snapped.y1 - snapped.y0 > 2 ? snapped : rect;
}

/**
 * Fixtures stand with their back to a wall: the front (local +Z) faces the side that touches nothing. Returns the
 * yaw (0 = front faces down the image / +Z, 90 = +X, 180 = up, 270 = -X), or null when the drawing doesn't decide it.
 */
function facing(rect: PxRect, room: PxRect, walls: PxRect[], pixels: Pixels): number | null {
  const near = Math.max(4, Math.min(pixels.width, pixels.height) * 0.015);
  const touches = (side: "north" | "south" | "west" | "east") => {
    const edge = { north: rect.y0, south: rect.y1, west: rect.x0, east: rect.x1 }[side];
    const roomEdge = { north: room.y0, south: room.y1, west: room.x0, east: room.x1 }[side];
    if (Math.abs(edge - roomEdge) <= near) return true;
    return walls.some((wall) => {
      const overlapX = Math.min(wall.x1, rect.x1) - Math.max(wall.x0, rect.x0) > 0;
      const overlapY = Math.min(wall.y1, rect.y1) - Math.max(wall.y0, rect.y0) > 0;
      if (side === "north") return overlapX && Math.abs(edge - wall.y1) <= near;
      if (side === "south") return overlapX && Math.abs(edge - wall.y0) <= near;
      if (side === "west") return overlapY && Math.abs(edge - wall.x1) <= near;
      return overlapY && Math.abs(edge - wall.x0) <= near;
    });
  };
  const sides = (["north", "south", "west", "east"] as const).filter((side) => touches(side));
  const front: Record<string, number> = { south: 0, east: 90, north: 180, west: 270 };
  const opposite = { north: "south", south: "north", west: "east", east: "west" } as const;
  const free = (["north", "south", "west", "east"] as const).filter((side) => !sides.includes(side));
  if (free.length === 1) return front[free[0]!]!;
  if (sides.length === 1) return front[opposite[sides[0]!]]!;
  // In a corner: face away from the longer wall contact (the side the fixture is drawn along).
  if (sides.length === 2 && free.length === 2) {
    const along = sides.find((side) => (side === "north" || side === "south" ? rect.x1 - rect.x0 >= rect.y1 - rect.y0 : rect.y1 - rect.y0 > rect.x1 - rect.x0));
    if (along) return front[opposite[along]]!;
  }
  return null;
}

const round = (value: number) => Math.round(value * 100) / 100;

export async function measurePlan(imageDataUrl: string, response: AiPlanAnalyzeResponse): Promise<MeasuredPlan | null> {
  const source = response.extraction;
  if (!source.roomBox) return null;
  const pixels = await loadPixels(imageDataUrl);
  const notes: string[] = [];
  const room = snapRect(pixels, toRect(source.roomBox, pixels), "face", 0.06);
  const pxWidth = room.x1 - room.x0;
  const pxDepth = room.y1 - room.y0;
  if (pxWidth < 10 || pxDepth < 10) return null;

  // One scale from the written dimension(s); square pixels unless both sides are written.
  const sources = { ...response.sources };
  let width = source.width;
  let depth = source.depth;
  let sx: number;
  let sz: number;
  if (sources.width === "written" && sources.depth === "written") {
    sx = width / pxWidth;
    sz = depth / pxDepth;
    if (Math.abs(sx - sz) / Math.max(sx, sz) > 0.08) notes.push("The plan isn't drawn to scale: the written sizes were used for each side.");
  } else if (sources.depth === "written") {
    sz = sx = depth / pxDepth;
    width = round(pxWidth * sx);
    sources.width = "measured";
  } else {
    sx = sz = width / pxWidth;
    depth = round(pxDepth * sz);
    sources.depth = "measured";
    if (sources.width !== "written") notes.push("No dimension is written on the plan: proportions are measured exactly, the overall scale is estimated. Correct the width and everything rescales.");
  }
  const cx = (room.x0 + room.x1) / 2;
  const cy = (room.y0 + room.y1) / 2;
  const toX = (px: number) => round((px - cx) * sx);
  const toZ = (py: number) => round((py - cy) * sz);
  const inside = (rect: PxRect): PxRect => ({ x0: Math.max(room.x0, rect.x0), y0: Math.max(room.y0, rect.y0), x1: Math.min(room.x1, rect.x1), y1: Math.min(room.y1, rect.y1) });

  const overlay: PlanOverlay = { imageWidth: pixels.width, imageHeight: pixels.height, room, walls: [], objects: [], openings: [], scale: { x: sx, z: sz } };

  // Interior walls and non-rectangular parts come from the pixels, not the AI's guess.
  const walls: AiRoomExtraction["walls"] = [];
  for (const rect of solidRegions(pixels, room)) {
    overlay.walls.push(rect);
    walls.push({ x: toX((rect.x0 + rect.x1) / 2), z: toZ((rect.y0 + rect.y1) / 2), width: Math.max(0.05, round((rect.x1 - rect.x0) * sx)), depth: Math.max(0.05, round((rect.y1 - rect.y0) * sz)) });
  }

  const objects = source.objects.map((object) => {
    if (!object.box) return object;
    const rect = inside(wrapInk(pixels, toRect(object.box, pixels), room, 0.03));
    // A fixture drawn flush against a partition ends where the wall starts (no overlap from anti-aliasing).
    for (const wall of overlay.walls) {
      const overlapX = Math.min(wall.x1, rect.x1) - Math.max(wall.x0, rect.x0);
      const overlapY = Math.min(wall.y1, rect.y1) - Math.max(wall.y0, rect.y0);
      if (overlapX <= 0 || overlapY <= 0) continue;
      if (overlapX <= overlapY) {
        if (wall.x0 <= rect.x0) rect.x0 = wall.x1 + 1;
        else rect.x1 = wall.x0 - 1;
      } else if (wall.y0 <= rect.y0) rect.y0 = wall.y1 + 1;
      else rect.y1 = wall.y0 - 1;
    }
    overlay.objects.push({ rect, label: object.name || object.catalogItemId });
    const worldWidth = Math.max(0.1, round((rect.x1 - rect.x0) * sx));
    const worldDepth = Math.max(0.1, round((rect.y1 - rect.y0) * sz));
    const yaw = facing(rect, room, overlay.walls, pixels) ?? ((Math.round(object.yawDegrees / 90) * 90) % 360 + 360) % 360;
    const turned = yaw === 90 || yaw === 270;
    return { ...object, yawDegrees: yaw, x: toX((rect.x0 + rect.x1) / 2), z: toZ((rect.y0 + rect.y1) / 2), width: turned ? worldDepth : worldWidth, depth: turned ? worldWidth : worldDepth };
  });

  const openings = source.openings.map((opening) => {
    if (!opening.box) return opening;
    const rect = toRect(opening.box, pixels);
    const mx = (rect.x0 + rect.x1) / 2;
    const my = (rect.y0 + rect.y1) / 2;
    // The wall is whichever side of the measured interior the opening sits on.
    const distances = { north: Math.abs(my - room.y0), south: Math.abs(my - room.y1), west: Math.abs(mx - room.x0), east: Math.abs(mx - room.x1) };
    const wall = (Object.keys(distances) as (keyof typeof distances)[]).sort((a, b) => distances[a] - distances[b])[0]!;
    const horizontal = wall === "north" || wall === "south";
    overlay.openings.push({ rect, kind: opening.kind });
    return {
      ...opening, wall,
      offset: horizontal ? toX(mx) : toZ(my),
      width: Math.max(0.3, round(horizontal ? (rect.x1 - rect.x0) * sx : (rect.y1 - rect.y0) * sz)),
    };
  });

  const scaleNote = `Measured from the image: interior ${Math.round(pxWidth)} × ${Math.round(pxDepth)} px at ${(sx * 100).toFixed(2)} cm/px.`;
  return {
    response: {
      ...response,
      sources,
      extraction: { ...source, width: round(width), depth: round(depth), walls, objects, openings, measured: true, notes: [scaleNote, ...notes, source.notes].filter(Boolean).join(" ") },
    },
    overlay,
    notes,
  };
}

// ---------------------------------------------------------------- whole floor plans ----------

export type RoomCheck = { name: string; label: string; written: [number, number] | null; measured: [number, number]; error: number | null };
export type MeasuredHousePlan = { house: MeasuredHouse; overlay: PlanOverlay; checks: RoomCheck[]; notes: string[] };

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)]! : NaN;
};

/** Dark run length (wall thickness) going outward from an interior face, sampled along the side. */
function wallThickness(pixels: Pixels, rect: PxRect): number[] {
  const out: number[] = [];
  const sides: [boolean, number, 1 | -1, number, number][] = [
    [true, rect.x0, -1, rect.y0, rect.y1], [true, rect.x1, 1, rect.y0, rect.y1],
    [false, rect.y0, -1, rect.x0, rect.x1], [false, rect.y1, 1, rect.x0, rect.x1],
  ];
  for (const [vertical, face, outward, from, to] of sides) {
    for (let k = 1; k < 8; k += 1) {
      const along = Math.round(from + ((to - from) * k) / 8);
      let run = 0;
      for (let step = 1; step < 80; step += 1) {
        const at = Math.round(face + outward * step);
        const x = vertical ? at : along;
        const y = vertical ? along : at;
        if (x < 0 || y < 0 || x >= pixels.width || y >= pixels.height) break;
        if (pixels.luminance[y * pixels.width + x]! < WALL_DARK) run += 1;
        else if (run > 0) break;
        else if (step > 4) break;
      }
      if (run >= 3) out.push(run);
    }
  }
  return out;
}

/**
 * Doors, windows and open sides along one side of a room, from the pixels on the wall's centre line: wherever the wall
 * isn't solid for at least ~45 cm there is an opening. On the building's outside with thin lines in it: a window;
 * otherwise a door, or an open passage when it is wider than a door.
 */
function openingsOnSide(pixels: Pixels, rect: PxRect, side: "north" | "south" | "west" | "east", thickness: number, outer: PxRect, scale: number) {
  const vertical = side === "west" || side === "east";
  const outward = side === "south" || side === "east" ? 1 : -1;
  const face = { north: rect.y0, south: rect.y1, west: rect.x0, east: rect.x1 }[side];
  // Sample just inside the wall: interior partitions are often thinner than the outer walls.
  const line = Math.round(face + outward * Math.max(2, Math.min(thickness / 2, 5)));
  const [from, to] = vertical ? [rect.y0 + 2, rect.y1 - 2] : [rect.x0 + 2, rect.x1 - 2];
  const at = (i: number) => (vertical ? pixels.luminance[Math.round(i) * pixels.width + line]! : pixels.luminance[line * pixels.width + Math.round(i)]!);
  if (line < 0 || line >= (vertical ? pixels.width : pixels.height)) return [];
  const outerFace = { north: outer.y0, south: outer.y1, west: outer.x0, east: outer.x1 }[side];
  const exterior = Math.abs(face + outward * thickness - outerFace) <= thickness * 0.6 + 4;
  const runs: [number, number][] = [];
  let start: number | null = null;
  for (let i = Math.round(from); i <= Math.round(to); i += 1) {
    const solid = at(i) < WALL_DARK;
    if (!solid && start === null) start = i;
    if ((solid || i === Math.round(to)) && start !== null) {
      runs.push([start, i]);
      start = null;
    }
  }
  const minimum = 0.45 / scale;
  // A real gap is open straight through the wall: across the full thickness (and a little beyond) at its middle there
  // is no solid wall. A "gap" that came from sampling beside the wall instead runs into the wall here.
  const throughWall = (a: number, b: number) => [0.35, 0.5, 0.65].every((share) => {
    const along = Math.round(a + (b - a) * share);
    let run = 0;
    for (let step = -2; step <= Math.round(thickness * 1.4) + 2; step += 1) {
      const across = Math.round(face + outward * step);
      const value = vertical ? pixels.luminance[along * pixels.width + across] : pixels.luminance[across * pixels.width + along];
      run = value !== undefined && value < WALL_DARK ? run + 1 : 0;
      if (run >= 3) return false;
    }
    return true;
  });
  return runs.filter(([a, b]) => b - a >= minimum && throughWall(a, b)).map(([a, b]) => {
    // Thin drawn lines inside the gap (window glazing) vs. an empty gap (door, open side).
    // Sample straight across the wall at a few points: glazing lines run along the wall, so they cross these samples.
    let lined = 0;
    for (const share of [0.3, 0.5, 0.7]) {
      const along = Math.round(a + (b - a) * share);
      let ink = 0;
      for (let step = Math.round(thickness * 0.15); step <= Math.round(thickness * 0.85); step += 1) {
        const across = Math.round(face + outward * step);
        const value = vertical ? pixels.luminance[along * pixels.width + across] : pixels.luminance[across * pixels.width + along];
        if (value !== undefined && value < LINE_INK) ink += 1;
      }
      if (ink >= 2) lined += 1;
    }
    const lined2 = lined >= 2;
    const width = (b - a) * scale;
    // Doors are at most ~1.2 m; anything wider between rooms is an open passage.
    const kind: "door" | "window" | "passage" = exterior ? (lined2 ? "window" : width > 1.2 ? "passage" : "door") : width > 1.2 ? "passage" : "door";
    const mid = (a + b) / 2;
    const rectPx: PxRect = vertical
      ? { x0: line - thickness / 2, x1: line + thickness / 2, y0: a, y1: b }
      : { x0: a, x1: b, y0: line - thickness / 2, y1: line + thickness / 2 };
    return { kind, mid, width, rect: rectPx };
  });
}

/**
 * Wall pixels only: dark pixels whose dark run is at least `minimum` long both across and down, i.e. solid wall mass.
 * Lines (furniture outlines, arrows, text strokes) are long one way but thin the other, so they drop out.
 */
function thickWalls(pixels: Pixels, minimum: number): Uint8Array {
  const { width, height, luminance } = pixels;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    let start = -1;
    for (let x = 0; x <= width; x += 1) {
      const dark = x < width && luminance[y * width + x]! < WALL_DARK;
      if (dark && start < 0) start = x;
      if (!dark && start >= 0) {
        if (x - start >= minimum) for (let i = start; i < x; i += 1) mask[y * width + i] = 1;
        start = -1;
      }
    }
  }
  for (let x = 0; x < width; x += 1) {
    let start = -1;
    for (let y = 0; y <= height; y += 1) {
      const dark = y < height && luminance[y * width + x]! < WALL_DARK;
      if (dark && start < 0) start = y;
      if (!dark && start >= 0) {
        if (y - start >= minimum) for (let i = start; i < y; i += 1) if (mask[i * width + x] === 1) mask[i * width + x] = 2;
        start = -1;
      }
    }
  }
  for (let i = 0; i < mask.length; i += 1) mask[i] = mask[i] === 2 ? 1 : 0;
  return mask;
}

/**
 * A room's interior from its walls: rays from the middle of the AI's rough box out to each side, stopping at the first
 * wall pixel. Rays through a door or window go further, so each side takes the nearest value most rays agree on.
 * A side with no wall near the AI's edge (rooms open to each other) keeps the AI's edge.
 */
function roomFromWalls(mask: Uint8Array, pixels: Pixels, rough: PxRect, others: PxRect[], wallPx: number): { rough: PxRect; rect: PxRect; open: Record<"x0" | "x1" | "y0" | "y1", boolean> } {
  const { width, height } = pixels;
  // The AI's box can be well off, so rays may go a long way past it, but never into space the AI gave another room:
  // a wall found only there belongs to that room (this one is open on that side).
  const reachX = Math.max(width * 0.06, (rough.x1 - rough.x0) * 0.8);
  const reachY = Math.max(height * 0.06, (rough.y1 - rough.y0) * 0.8);
  const inside = (r: PxRect, x: number, y: number, margin: number) => x > r.x0 + margin && x < r.x1 - margin && y > r.y0 + margin && y < r.y1 - margin;
  const claimed = (x: number, y: number) => !inside(rough, x, y, 0) && others.some((other) => inside(other, x, y, Math.max(4, wallPx * 2)));
  const cx = (rough.x0 + rough.x1) / 2;
  const cy = (rough.y0 + rough.y1) / 2;
  const side = (vertical: boolean, outward: 1 | -1) => {
    // vertical = the side is a vertical wall (west/east), rays run along x.
    const [from, to] = vertical ? [rough.y0, rough.y1] : [rough.x0, rough.x1];
    const start = vertical ? cx : cy;
    const edge = vertical ? (outward < 0 ? rough.x0 : rough.x1) : (outward < 0 ? rough.y0 : rough.y1);
    const reach = vertical ? reachX : reachY;
    const limit = edge + outward * reach;
    const hits: number[] = [];
    const rayOf: number[] = [];
    const rays = 41;
    // Thin-line ink each escaping ray crossed (window glazing drawn inside a wall).
    const escapedInk: number[][] = [];
    let run = 0, longest = 0;
    for (let k = 0; k < rays; k += 1) {
      const along = Math.round(from + ((to - from) * (k + 0.5)) / rays);
      let escaped = false;
      const ink: number[] = [];
      for (let at = Math.round(start); outward > 0 ? at <= limit : at >= limit; at += outward) {
        const x = vertical ? at : along;
        const y = vertical ? along : at;
        if (x < 0 || y < 0 || x >= width || y >= height) break;
        if (claimed(x, y)) { escaped = true; break; }
        if (mask[y * width + x]) { hits.push(outward > 0 ? at : at + 1); rayOf.push(k); break; }
        if (pixels.luminance[y * width + x]! < LINE_INK && ink.length < 64) ink.push(at);
      }
      if (escaped) escapedInk.push(ink);
      run = escaped ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    // Nearest wall a fifth of the rays agree on; failing that, a few aligned hits near the AI's edge (walls full of
    // windows only have short solid pieces; dark blobs inside the room, like lamps, are far from the edge).
    const order = hits.map((_, index) => index).sort((a, b) => (hits[a]! - hits[b]!) * outward);
    const span = vertical ? rough.x1 - rough.x0 : rough.y1 - rough.y0;
    const cluster = (enough: (count: number, hit: number, spread: number) => boolean) => {
      for (const index of order) {
        const hit = hits[index]!;
        const near = order.filter((other) => Math.abs(hits[other]! - hit) <= 2);
        const raysHit = near.map((other) => rayOf[other]!);
        if (enough(near.length, hit, Math.max(...raysHit) - Math.min(...raysHit))) return median(near.map((other) => hits[other]!));
      }
      return null;
    };
    // Sparse hits only count when spread along the side like wall pieces between windows (a lamp or other dark blob
    // is local).
    const wall = cluster((count) => count >= rays * 0.2) ?? cluster((count, hit, spread) => count >= 3 && spread >= rays * 0.3 && (hit - edge) * outward > -span * 0.15);
    // Open to another room's space along a stretch wider than any door (doors are well under 8 wall thicknesses),
    // unless the rays that got through crossed glazing on the wall line: then it is a wall of windows.
    if (longest * ((to - from) / rays) > wallPx * 8) {
      if (wall === null) return null;
      const glazed = escapedInk.filter((ink) => ink.some((at) => Math.abs(at - (wall + outward * wallPx / 2)) <= wallPx)).length;
      if (glazed < escapedInk.length * 0.6) return null;
    }
    return wall;
  };
  const x0 = side(true, -1), x1 = side(true, 1), y0 = side(false, -1), y1 = side(false, 1);
  return {
    rough,
    rect: { x0: x0 ?? rough.x0, x1: x1 ?? rough.x1, y0: y0 ?? rough.y0, y1: y1 ?? rough.y1 },
    open: { x0: x0 === null, x1: x1 === null, y0: y0 === null, y1: y1 === null },
  };
}

/** Rooms open to each other (no wall between, e.g. dining and living) meet at a shared line instead of overlapping or leaving a gap. */
function meetOpenSides(found: { rough: PxRect; rect: PxRect; open: Record<"x0" | "x1" | "y0" | "y1", boolean> }[], gap: number) {
  const pairs = [["x1", "x0", true], ["x0", "x1", true], ["y1", "y0", false], ["y0", "y1", false]] as const;
  for (const room of found) {
    for (const [mine, theirs, vertical] of pairs) {
      if (!room.open[mine]) continue;
      const forward = mine === "x1" || mine === "y1" ? 1 : -1;
      const overlaps = (other: PxRect) => vertical
        ? Math.min(room.rect.y1, other.y1) - Math.max(room.rect.y0, other.y0) > (room.rect.y1 - room.rect.y0) * 0.3
        : Math.min(room.rect.x1, other.x1) - Math.max(room.rect.x0, other.x0) > (room.rect.x1 - room.rect.x0) * 0.3;
      const centre = vertical ? (room.rect.x0 + room.rect.x1) / 2 : (room.rect.y0 + room.rect.y1) / 2;
      const neighbour = found
        // Only spaces the AI drew right next to this one: an unlabelled hall between them stays a gap.
        .filter((other) => other !== room && overlaps(other.rect) && (other.rect[theirs] - centre) * forward > 0 && Math.abs(other.rough[theirs] - room.rough[mine]) <= gap)
        .sort((a, b) => Math.abs(a.rect[theirs] - room.rect[mine]) - Math.abs(b.rect[theirs] - room.rect[mine]))[0];
      if (!neighbour) continue;
      const line = neighbour.open[theirs] ? (room.rect[mine] + neighbour.rect[theirs]) / 2 : neighbour.rect[theirs];
      room.rect[mine] = line;
      if (neighbour.open[theirs]) { neighbour.rect[theirs] = line; neighbour.open[theirs] = false; }
      room.open[mine] = false;
    }
  }
  // No two rooms may share floor: where they still overlap, the larger one gives way at the smaller one's face.
  const rects = found.map((entry) => entry.rect);
  const area = (r: PxRect) => (r.x1 - r.x0) * (r.y1 - r.y0);
  for (let pass = 0; pass < 3; pass += 1) {
    for (const big of rects) {
      for (const small of rects) {
        if (big === small || area(big) < area(small)) continue;
        const ox = Math.min(big.x1, small.x1) - Math.max(big.x0, small.x0);
        const oy = Math.min(big.y1, small.y1) - Math.max(big.y0, small.y0);
        if (ox <= 1 || oy <= 1) continue;
        const cuts = [
          { cost: big.x1 - small.x0, apply: () => { big.x1 = small.x0; } }, { cost: small.x1 - big.x0, apply: () => { big.x0 = small.x1; } },
          { cost: big.y1 - small.y0, apply: () => { big.y1 = small.y0; } }, { cost: small.y1 - big.y0, apply: () => { big.y0 = small.y1; } },
        ].filter((cut) => cut.cost > 0).sort((p, q) => p.cost - q.cost);
        cuts[0]?.apply();
      }
    }
  }
  return rects;
}

export async function measureHouse(imageDataUrl: string, extraction: AiHouseExtraction, height = 2.8): Promise<MeasuredHousePlan> {
  const pixels = await loadPixels(imageDataUrl);
  const notes: string[] = [];
  const mask = thickWalls(pixels, Math.max(5, Math.round(Math.min(pixels.width, pixels.height) / 150)));
  // Wall thickness in pixels: the typical short dark run of the wall mass.
  const runs: number[] = [];
  for (let y = 0; y < pixels.height; y += 4) {
    let start = -1;
    for (let x = 0; x <= pixels.width; x += 1) {
      const on = x < pixels.width && mask[y * pixels.width + x] === 1;
      if (on && start < 0) start = x;
      if (!on && start >= 0) { if (x - start <= pixels.width / 20) runs.push(x - start); start = -1; }
    }
  }
  const wallPx = median(runs) || pixels.width / 100;
  const rough = extraction.rooms.map((room) => toRect(room.box, pixels));
  const rects = meetOpenSides(rough.map((rect, index) => roomFromWalls(mask, pixels, rect, rough.filter((_, other) => other !== index), wallPx)), Math.max(pixels.width, pixels.height) * 0.05);
  const thickness = median(rects.flatMap((rect) => wallThickness(pixels, rect))) || Math.max(4, pixels.width / 120);

  // Building outline: the extent of the wall mass (rows/columns that are substantially wall), so porches, steps and
  // dimension lines outside the walls don't count.
  const profile = (vertical: boolean) => {
    const [count, span] = vertical ? [pixels.width, pixels.height] : [pixels.height, pixels.width];
    const sums = new Array<number>(count).fill(0);
    for (let y = 0; y < pixels.height; y += 1) for (let x = 0; x < pixels.width; x += 1) if (mask[y * pixels.width + x]) sums[vertical ? x : y]! += 1;
    const strong = sums.map((sum) => sum >= span * 0.15);
    return [strong.indexOf(true), strong.lastIndexOf(true) + 1] as const;
  };
  const [ox0, ox1] = profile(true);
  const [oy0, oy1] = profile(false);
  // Photos and low-contrast scans may not show enough solid wall mass; then the outline is the measured rooms plus
  // one wall thickness all round.
  const union = { x0: Math.min(...rects.map((r) => r.x0)), y0: Math.min(...rects.map((r) => r.y0)), x1: Math.max(...rects.map((r) => r.x1)), y1: Math.max(...rects.map((r) => r.y1)) };
  const fromMass: PxRect = { x0: ox0, x1: ox1, y0: oy0, y1: oy1 };
  const covers = ox0 >= 0 && oy0 >= 0 && fromMass.x0 <= union.x0 + wallPx && fromMass.x1 >= union.x1 - wallPx && fromMass.y0 <= union.y0 + wallPx && fromMass.y1 >= union.y1 - wallPx
    && fromMass.x1 - fromMass.x0 <= (union.x1 - union.x0) * 1.3 && fromMass.y1 - fromMass.y0 <= (union.y1 - union.y0) * 1.3;
  const outer: PxRect = covers ? fromMass : { x0: union.x0 - wallPx, x1: union.x1 + wallPx, y0: union.y0 - wallPx, y1: union.y1 + wallPx };

  // Scale: overall dimension lines first (longest baseline), else the median of every room's written size.
  const labelled = extraction.rooms.map((room, index) => {
    const size = room.label ? parseSizeLabel(room.label.replace(/\s*m\s*$/i, "")) : null;
    if (!size) return null;
    const rect = rects[index]!;
    const [a, b] = size;
    const px = [rect.x1 - rect.x0, rect.y1 - rect.y0] as const;
    // Labels are usually width × depth; take the order that fits the drawn proportions.
    const straight = Math.abs(Math.log((a / px[0]) / (b / px[1])));
    const swapped = Math.abs(Math.log((b / px[0]) / (a / px[1])));
    return straight <= swapped ? { index, w: a, d: b, sx: a / px[0], sz: b / px[1] } : { index, w: b, d: a, sx: b / px[0], sz: a / px[1] };
  });
  const fromLabels = labelled.filter((entry) => entry !== null);
  const overallWidth = extraction.overall.find((entry) => entry.axis === "width")?.meters;
  const overallDepth = extraction.overall.find((entry) => entry.axis === "depth")?.meters;
  const labelSx = median(fromLabels.map((entry) => entry.sx));
  const labelSz = median(fromLabels.map((entry) => entry.sz));
  // The overall dimensions win unless they disagree wildly with the room labels (a misread number or outline).
  const agrees = (overall: number, label: number) => !Number.isFinite(label) || Math.abs(Math.log(overall / label)) < 0.35;
  const overallSx = overallWidth ? overallWidth / (outer.x1 - outer.x0) : NaN;
  const overallSz = overallDepth ? overallDepth / (outer.y1 - outer.y0) : NaN;
  let sx = Number.isFinite(overallSx) && agrees(overallSx, labelSx) ? overallSx : labelSx;
  let sz = Number.isFinite(overallSz) && agrees(overallSz, labelSz) ? overallSz : labelSz;
  if (!Number.isFinite(sx) && Number.isFinite(sz)) sx = sz;
  if (!Number.isFinite(sz) && Number.isFinite(sx)) sz = sx;
  if (!Number.isFinite(sx)) {
    sx = sz = 10 / (outer.x1 - outer.x0);
    notes.push("No dimension is written on the plan: proportions are exact, the overall scale is a guess (10 m wide). Set the real width to rescale.");
  }
  notes.push(`Scale ${(sx * 100).toFixed(3)} × ${(sz * 100).toFixed(3)} cm/px from ${overallWidth || overallDepth ? "the overall dimensions" : "the room labels"}; walls ${(thickness * sx * 100).toFixed(0)} cm.`);

  // No room can be bigger than the building (or than the editor allows).
  const buildingWidth = Math.min(60, Math.max(1, round((outer.x1 - outer.x0) * sx)));
  const buildingDepth = Math.min(60, Math.max(1, round((outer.y1 - outer.y0) * sz)));
  const ox = (outer.x0 + outer.x1) / 2;
  const oy = (outer.y0 + outer.y1) / 2;
  const overlay: PlanOverlay = { imageWidth: pixels.width, imageHeight: pixels.height, room: outer, rooms: rects, walls: [], objects: [], openings: [], scale: { x: sx, z: sz } };
  const checks: RoomCheck[] = [];
  const rooms: MeasuredHouse["rooms"] = extraction.rooms.map((source, index) => {
    const rect = rects[index]!;
    const cx = (rect.x0 + rect.x1) / 2;
    const cy = (rect.y0 + rect.y1) / 2;
    const width = round((rect.x1 - rect.x0) * sx);
    const depth = round((rect.y1 - rect.y0) * sz);
    const label = labelled[index];
    checks.push({ name: source.name, label: source.label, written: label ? [label.w, label.d] : null, measured: [width, depth], error: label ? round(Math.max(Math.abs(label.w - width), Math.abs(label.d - depth))) : null });

    const openings: MeasuredHouse["rooms"][number]["openings"] = [];
    for (const side of ["north", "south", "west", "east"] as const) {
      const horizontal = side === "north" || side === "south";
      for (const found of openingsOnSide(pixels, rect, side, thickness, outer, horizontal ? sx : sz)) {
        // An unglazed gap in an outside wall is only a door for rooms people enter from outside; elsewhere it is a
        // window drawn without glazing lines.
        const entry = /living|lounge|hall|foyer|entr|lobby|porch|veranda|balcony|terrace|garden|patio/i.test(source.name);
        const opening = found.kind === "door" && Math.abs((side === "north" ? rect.y0 : side === "south" ? rect.y1 : side === "west" ? rect.x0 : rect.x1) - (side === "north" ? outer.y0 : side === "south" ? outer.y1 : side === "west" ? outer.x0 : outer.x1)) <= thickness * 1.6 + 4 && !entry
          ? { ...found, kind: "window" as const }
          : found;
        overlay.openings.push({ rect: opening.rect, kind: opening.kind === "window" ? "window" : "door" });
        openings.push({ kind: opening.kind, wall: side, offset: round(horizontal ? (opening.mid - cx) * sx : (opening.mid - cy) * sz), width: round(opening.width) });
      }
    }

    const boxes = source.objects.map((object) => {
      const box = wrapInk(pixels, toRect(object.box, pixels), rect, 0.02);
      return { x0: Math.max(rect.x0, box.x0), y0: Math.max(rect.y0, box.y0), x1: Math.min(rect.x1, box.x1), y1: Math.min(rect.y1, box.y1) };
    });
    // Pieces drawn touching (a bed and its nightstands) get wrapped together; the smaller piece is the reliable one,
    // so the larger gives way along the axis that needs the smaller cut.
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = 0; j < boxes.length; j += 1) {
        const big = boxes[i]!, small = boxes[j]!;
        const area = (r: PxRect) => (r.x1 - r.x0) * (r.y1 - r.y0);
        if (i === j || area(big) <= area(small)) continue;
        const ox = Math.min(big.x1, small.x1) - Math.max(big.x0, small.x0);
        const oy = Math.min(big.y1, small.y1) - Math.max(big.y0, small.y0);
        if (ox <= 0 || oy <= 0) continue;
        const cut = (low: number, high: number, smallLow: number, smallHigh: number) =>
          smallLow - low < high - smallHigh ? { low: smallHigh, high } : { low, high: smallLow };
        if (ox < oy && ox < (big.x1 - big.x0) * 0.5) { const next = cut(big.x0, big.x1, small.x0, small.x1); big.x0 = next.low; big.x1 = next.high; }
        else if (oy < (big.y1 - big.y0) * 0.5) { const next = cut(big.y0, big.y1, small.y0, small.y1); big.y0 = next.low; big.y1 = next.high; }
      }
    }
    const objects = source.objects.map((object, objectIndex) => {
      const clipped = boxes[objectIndex]!;
      overlay.objects.push({ rect: clipped, label: object.name || object.catalogItemId });
      const worldWidth = Math.max(0.1, round((clipped.x1 - clipped.x0) * sx));
      const worldDepth = Math.max(0.1, round((clipped.y1 - clipped.y0) * sz));
      const yaw = facing(clipped, rect, [], pixels) ?? ((Math.round(object.yawDegrees / 90) * 90) % 360 + 360) % 360;
      const turned = yaw === 90 || yaw === 270;
      return {
        catalogItemId: object.catalogItemId, name: object.name, yawDegrees: yaw,
        x: round(((clipped.x0 + clipped.x1) / 2 - cx) * sx), z: round(((clipped.y0 + clipped.y1) / 2 - cy) * sz),
        width: turned ? worldDepth : worldWidth, depth: turned ? worldWidth : worldDepth,
      };
    });

    return {
      name: source.name, x: round((cx - ox) * sx), z: round((cy - oy) * sz), width: Math.min(buildingWidth, Math.max(0.3, width)), depth: Math.min(buildingDepth, Math.max(0.3, depth)),
      wallThickness: Math.min(0.6, Math.max(0.05, round(thickness * sx))), openings: openings.slice(0, 24), objects: objects.slice(0, 24),
    };
  });
  return { house: { name: extraction.name || "Floor plan", height, rooms }, overlay, checks, notes };
}
