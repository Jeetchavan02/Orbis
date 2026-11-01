import type { FurnitureObject, Room, Scene } from "@reality-builder/shared";
import { viewportBridge, type RenderViewSpec } from "./perf";

/**
 * Multi-view design report. Every image is rendered from the live Three.js scene with a dedicated camera
 * (see `viewportBridge.renderView`); the PDF is assembled in the browser with jsPDF. Reads the scene only.
 */

const RENDER_WIDTH = 2400;
const RENDER_HEIGHT = 1600;
const ASPECT = RENDER_WIDTH / RENDER_HEIGHT;
const BACKGROUND = "#f7f7f9";
const DEG = Math.PI / 180;

type Vec3 = [number, number, number];

export type DesignView = { id: string; title: string; caption: string; spec: RenderViewSpec };
export type RenderedView = DesignView & { image: string };
export type ExportProgress = { step: "render" | "assemble"; done: number; total: number; label: string };

/** Room-local direction (x right, z towards the south/front wall) rotated into world space by the room's yaw. */
function toWorld(room: Room, [x, y, z]: Vec3): Vec3 {
  const yaw = room.yawDegrees * DEG;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return [x * cos + z * sin, y, -x * sin + z * cos];
}

const add = (a: Vec3, b: Vec3, scale = 1): Vec3 => [a[0] + b[0] * scale, a[1] + b[1] * scale, a[2] + b[2] * scale];
const normalize = ([x, y, z]: Vec3): Vec3 => {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
};

/** Orthographic half-extents that fit a span with a margin at the render aspect ratio. */
function fit(spanWidth: number, spanHeight: number, margin = 1.12) {
  const halfWidth = Math.max(spanWidth / 2, (spanHeight / 2) * ASPECT) * margin;
  return { halfWidth, halfHeight: halfWidth / ASPECT };
}

export function designViews(room: Room): DesignView[] {
  const { width, depth, height, wallThickness: t } = room.dimensions;
  const floor: Vec3 = [room.position.x, room.position.y, room.position.z];
  const middle: Vec3 = [floor[0], floor[1] + height / 2, floor[2]];
  const outerWidth = width + 2 * t;
  const outerDepth = depth + 2 * t;
  const far = 60;

  // Perspective framing: fit the room's bounding sphere in the vertical field of view.
  const fov = 35;
  const radius = Math.hypot(outerWidth, outerDepth, height) / 2;
  const distance = (radius / Math.sin((fov / 2) * DEG)) * 1.02;
  const perspective = (id: string, title: string, caption: string, direction: Vec3, lift = 0.35): DesignView => {
    const target: Vec3 = [floor[0], floor[1] + height * lift, floor[2]];
    return { id, title, caption, spec: { kind: "perspective", fov, position: add(target, toWorld(room, normalize(direction)), distance), target, walls: "cutaway", background: BACKGROUND } };
  };
  const elevation = (id: string, title: string, caption: string, direction: Vec3, span: number): DesignView => ({
    id,
    title,
    caption,
    spec: { kind: "ortho", ...fit(span, height), position: add(middle, toWorld(room, direction), far), target: middle, walls: "remove", background: BACKGROUND },
  });

  // Eye-level view from inside the front-left corner towards the opposite corner.
  const eye: Vec3 = add(floor, toWorld(room, [-width / 2 + 0.35, 1.6, depth / 2 - 0.35]));
  const across: Vec3 = add(floor, toWorld(room, [width / 2 - 0.5, 0.9, -depth / 2 + 0.5]));

  return [
    perspective("birdseye", "Bird's-eye view", "Elevated perspective of the complete room. Walls facing the camera are cut away.", [1, 1.15, 1.25]),
    {
      id: "plan",
      title: "Top view · Floor plan",
      caption: `Orthographic view looking straight down. Room ${width.toFixed(2)} × ${depth.toFixed(2)} m, north at the top.`,
      spec: {
        kind: "ortho",
        ...fit(outerWidth + 1.4, outerDepth + 1.4),
        position: add(floor, [0, far, 0]),
        target: floor,
        up: toWorld(room, [0, 0, -1]),
        walls: "remove",
        background: BACKGROUND,
      },
    },
    elevation("front", "Front elevation", `Straight-on orthographic view from the front (south) side. Width ${width.toFixed(2)} m, height ${height.toFixed(2)} m.`, [0, 0, 1], outerWidth),
    elevation("back", "Back elevation", `Straight-on orthographic view from the back (north) side. Width ${width.toFixed(2)} m, height ${height.toFixed(2)} m.`, [0, 0, -1], outerWidth),
    elevation("left", "Left elevation", `Straight-on orthographic view from the left (west) side. Depth ${depth.toFixed(2)} m, height ${height.toFixed(2)} m.`, [-1, 0, 0], outerDepth),
    elevation("right", "Right elevation", `Straight-on orthographic view from the right (east) side. Depth ${depth.toFixed(2)} m, height ${height.toFixed(2)} m.`, [1, 0, 0], outerDepth),
    perspective("corner-left", "Perspective · front left", "Elevated perspective from the front-left corner.", [-1, 0.8, 1.1]),
    perspective("corner-back", "Perspective · back right", "Elevated perspective from the back-right corner.", [1.1, 0.8, -1]),
    {
      id: "eye",
      title: "Interior view · eye level",
      caption: "Perspective from 1.6 m eye height in the front-left corner, looking across the room.",
      spec: { kind: "perspective", fov: 62, position: eye, target: across, walls: "cutaway", background: BACKGROUND },
    },
  ];
}

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Renders every view one by one, yielding between views so the progress UI can update. */
export async function renderDesignViews(room: Room, onProgress: (progress: ExportProgress) => void): Promise<RenderedView[]> {
  const views = designViews(room);
  const rendered: RenderedView[] = [];
  for (const [index, view] of views.entries()) {
    onProgress({ step: "render", done: index, total: views.length, label: view.title });
    await frame();
    const render = viewportBridge.renderView;
    if (!render) throw new Error("The 3D viewport isn't ready. Open the project in the editor and try again.");
    const image = render(view.spec, RENDER_WIDTH, RENDER_HEIGHT);
    if (!image.startsWith("data:image/jpeg")) throw new Error("This browser couldn't read back the 3D render (WebGL readback failed).");
    rendered.push({ ...view, image });
  }
  onProgress({ step: "render", done: views.length, total: views.length, label: "All views rendered" });
  return rendered;
}

async function logoDataUrl(): Promise<string | null> {
  try {
    const image = new Image();
    image.src = "/orbis-logo.png";
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext("2d")!.drawImage(image, 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

export function pdfFilename(scene: Scene) {
  const name = scene.name.trim().replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "Project";
  return `Orbis_${name}_Design.pdf`;
}

const INK: [number, number, number] = [28, 27, 38];
const MUTED: [number, number, number] = [112, 110, 128];
const ACCENT: [number, number, number] = [106, 61, 232];
const RULE: [number, number, number] = [226, 224, 236];

const size = (item: FurnitureObject) => `${item.dimensions.width.toFixed(2)} × ${item.dimensions.depth.toFixed(2)} × ${item.dimensions.height.toFixed(2)}`;

/** Assembles the landscape A4 report: cover, one page per view, then a furniture schedule. */
export async function buildDesignPdf(scene: Scene, room: Room, views: RenderedView[], link: string, onProgress: (progress: ExportProgress) => void): Promise<Blob> {
  onProgress({ step: "assemble", done: 0, total: 1, label: "Laying out pages" });
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 14;
  const logo = await logoDataUrl();
  const date = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  const items = scene.furniture.filter((item) => item.roomId === room.id);
  doc.setProperties({ title: `${scene.name} · Design report`, subject: "Orbis design report", creator: "Orbis" });

  const brand = (x: number, y: number, markSize: number) => {
    if (logo) doc.addImage(logo, "PNG", x, y, markSize, markSize);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(markSize * 1.6);
    doc.setTextColor(...INK);
    doc.text("Orbis", x + (logo ? markSize + 2.5 : 0), y + markSize * 0.74);
  };
  const imageBox = (image: string, x: number, y: number, maxWidth: number, maxHeight: number) => {
    const width = Math.min(maxWidth, maxHeight * ASPECT);
    const height = width / ASPECT;
    const left = x + (maxWidth - width) / 2;
    doc.addImage(image, "JPEG", left, y, width, height, undefined, "FAST");
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.3);
    doc.roundedRect(left, y, width, height, 1.5, 1.5, "S");
    return height;
  };

  // ---- Cover
  doc.setFillColor(...ACCENT);
  doc.rect(0, 0, W, 3, "F");
  brand(M, 12, 9);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text("DESIGN REPORT", W - M, 18, { align: "right" });
  const coverImageWidth = 168;
  const coverImageTop = 34;
  imageBox(views[0]!.image, W - M - coverImageWidth, coverImageTop, coverImageWidth, 150);
  const textWidth = W - 3 * M - coverImageWidth;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(26);
  doc.setTextColor(...INK);
  const titleLines = doc.splitTextToSize(scene.name, textWidth) as string[];
  doc.text(titleLines, M, 52);
  let cursor = 52 + titleLines.length * 10;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(...MUTED);
  doc.text(date, M, cursor);
  cursor += 14;
  const facts: [string, string][] = [
    ["Room", room.name],
    ["Floor area", `${(room.dimensions.width * room.dimensions.depth).toFixed(1)} m²`],
    ["Dimensions", `${room.dimensions.width.toFixed(2)} × ${room.dimensions.depth.toFixed(2)} m, ${room.dimensions.height.toFixed(2)} m high`],
    ["Objects", String(items.length)],
    ["Views", String(views.length)],
  ];
  for (const [label, value] of facts) {
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(label.toUpperCase(), M, cursor);
    doc.setFontSize(11);
    doc.setTextColor(...INK);
    doc.text(doc.splitTextToSize(value, textWidth) as string[], M, cursor + 5);
    cursor += 13;
  }
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text("OPEN THE LIVE PROJECT", M, H - 30);
  doc.setFontSize(9);
  doc.setTextColor(...ACCENT);
  doc.textWithLink(doc.splitTextToSize(link, textWidth)[0] as string, M, H - 25, { url: link });

  // ---- View pages
  const pageHeader = (title: string, caption: string) => {
    brand(M, 9, 5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    doc.text(scene.name, W - M, 13, { align: "right" });
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.3);
    doc.line(M, 18, W - M, 18);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(...INK);
    doc.text(title, M, 28);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...MUTED);
    doc.text(caption, M, 34);
  };
  for (const view of views) {
    doc.addPage("a4", "landscape");
    pageHeader(view.title, view.caption);
    imageBox(view.image, M, 40, W - 2 * M, H - 40 - 16);
  }

  // ---- Furniture schedule
  const columns = [{ label: "#", x: M, width: 10 }, { label: "Object", x: M + 10, width: 92 }, { label: "Category", x: M + 102, width: 40 }, { label: "Size W × D × H (m)", x: M + 142, width: 50 }, { label: "Position x, z (m)", x: M + 192, width: 40 }, { label: "Rotation", x: M + 232, width: 30 }];
  let row = 0;
  const startSchedule = (continued: boolean) => {
    doc.addPage("a4", "landscape");
    pageHeader(continued ? "Furniture schedule (continued)" : "Furniture schedule", `${items.length} objects in ${room.name}. Positions are relative to the scene origin.`);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    for (const column of columns) doc.text(column.label.toUpperCase(), column.x, 46);
    doc.setDrawColor(...RULE);
    doc.line(M, 48.5, W - M, 48.5);
    return 54;
  };
  let y = startSchedule(false);
  doc.setFontSize(9);
  if (items.length === 0) {
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...MUTED);
    doc.text("This room has no objects yet.", M, y);
  }
  for (const item of items) {
    if (y > H - 20) y = startSchedule(true);
    row += 1;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    const cells = [String(row), item.name, item.category, size(item), `${item.position.x.toFixed(2)}, ${item.position.z.toFixed(2)}`, `${Math.round(item.yawDegrees)}°`];
    cells.forEach((cell, index) => doc.text((doc.splitTextToSize(cell, columns[index]!.width - 3) as string[])[0]!, columns[index]!.x, y));
    doc.setDrawColor(240, 239, 245);
    doc.line(M, y + 2.5, W - M, y + 2.5);
    y += 7;
  }

  // ---- Footers (page numbers known only now)
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(`${scene.name} · ${date}`, M, H - 7);
    doc.text(`Page ${page} of ${pages}`, W - M, H - 7, { align: "right" });
  }
  onProgress({ step: "assemble", done: 1, total: 1, label: "Done" });
  return doc.output("blob");
}
