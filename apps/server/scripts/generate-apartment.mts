// Regenerates fixtures/apartment-scene.json and prints validation results: npx tsx server/scripts/generate-apartment.mts
import { writeFileSync } from "node:fs";
import { SceneSchema } from "@reality-builder/shared";
import { validateScene, scoreLayout } from "@reality-builder/spatial-engine";

const C: Record<string, [string, string, number, number, number, string, object?, object?]> = {
  sofa: ["Sofa", "seating", 2.1, 0.9, 0.82, "#b7a18a"],
  "coffee-table": ["Coffee table", "tables", 1.1, 0.6, 0.4, "#8a6248"],
  "tv-unit": ["TV unit", "storage", 1.8, 0.4, 0.5, "#5d5148", { frontClearance: 0.4 }],
  rug: ["Rug", "decor", 2.0, 1.4, 0.015, "#d9d1c3", { floorCovering: true }],
  armchair: ["Armchair", "seating", 0.85, 0.8, 0.85, "#7d8f7f"],
  "kitchen-counter": ["Kitchen counter", "storage", 2.4, 0.6, 0.9, "#e8e4dc", { frontClearance: 1.0 }],
  fridge: ["Refrigerator", "storage", 0.7, 0.7, 1.85, "#d9dcdf", { frontClearance: 0.9 }],
  "dining-table": ["Dining table", "tables", 1.6, 0.9, 0.75, "#8f6a4d"],
  "dining-chair": ["Dining chair", "seating", 0.45, 0.5, 0.9, "#6b5b4f", { frontClearance: 0 }],
  "floor-lamp": ["Floor lamp", "lighting", 0.35, 0.35, 1.6, "#d8c79a", undefined, { kind: "point", on: true, intensity: 8, color: "#ffcf91", height: 1.5 }],
  "ceiling-light": ["Ceiling light", "lighting", 0.5, 0.5, 0.1, "#f4f1ea", undefined, { kind: "point", on: true, intensity: 16, color: "#fff1dc", height: 0 }],
  "desk-lamp": ["Desk lamp", "lighting", 0.18, 0.18, 0.42, "#2f3532", undefined, { kind: "spot", on: true, intensity: 6, color: "#ffd9a8", height: 0.4 }],
  plant: ["Plant", "decor", 0.45, 0.45, 1.2, "#6f9a74"],
  "bed-queen": ["Queen bed", "beds", 1.6, 2.1, 1.0, "#d4d9df"],
  "bed-single": ["Guest bed", "beds", 0.95, 2.0, 0.9, "#cfd6cf"],
  nightstand: ["Nightstand", "storage", 0.5, 0.4, 0.55, "#9b7a5f", { frontClearance: 0.4 }],
  wardrobe: ["Wardrobe", "storage", 1.2, 0.6, 2.1, "#b9c1b9"],
  dresser: ["Dresser", "storage", 1.0, 0.45, 0.8, "#9b7a5f"],
  desk: ["Desk", "tables", 1.2, 0.6, 0.75, "#a07c60"],
  "desk-chair": ["Desk chair", "seating", 0.5, 0.5, 0.9, "#5f6f68", { frontClearance: 0 }],
  bookshelf: ["Bookshelf", "storage", 0.8, 0.3, 1.8, "#8a6a52", { frontClearance: 0.5 }],
};
const FLOOR_H = 3.0;
const furniture: object[] = [];
let n = 0;
function put(roomId: string, level: number, cat: string, x: number, z: number, yaw = 0, opts: { name?: string; elevation?: number } = {}) {
  const [name, category, width, depth, height, color, constraints, light] = C[cat]!;
  furniture.push({ id: `apt-${roomId.split("-")[1]}-${++n}`, roomId, name: opts.name ?? name, category, catalogItemId: cat,
    position: { x, y: level * FLOOR_H + (opts.elevation ?? 0), z }, yawDegrees: yaw, dimensions: { width, depth, height }, color,
    ...(constraints ? { constraints } : {}), ...(light ? { light } : {}) });
}
const room = (id: string, name: string, level: number, openings: object[], floorColor: string, wallColor: string) => ({
  id, name, position: { x: 0, y: level * FLOOR_H, z: 0 }, yawDegrees: 0,
  dimensions: { width: 7.0, depth: 5.6, height: 2.8, wallThickness: 0.16 }, floorColor, wallColor,
  openings: openings.map((o, i) => ({ id: `${id}-opening-${i}`, height: (o as { kind: string }).kind === "door" ? 2.05 : 1.4, sillHeight: (o as { kind: string }).kind === "door" ? 0 : 0.85, ...o })),
});
const stairDoor = { kind: "door", wall: "west", offset: 1.6, width: 0.9 };

// Ground floor — living, kitchen, dining
const g = "room-ground";
put(g, 0, "sofa", -1.4, -2.35, 0);
put(g, 0, "rug", -1.4, -0.9);
put(g, 0, "coffee-table", -1.4, -0.9);
put(g, 0, "tv-unit", -1.4, 2.6, 180);
put(g, 0, "armchair", -3.0, -0.9, 90, { name: "Reading chair" });
put(g, 0, "floor-lamp", -2.7, -2.4);
put(g, 0, "kitchen-counter", 3.2, -1.2, 270);
put(g, 0, "fridge", 3.15, 0.6, 270);
put(g, 0, "dining-table", 1.0, 1.6);
put(g, 0, "dining-chair", 0.6, 0.85, 0);
put(g, 0, "dining-chair", 1.4, 0.85, 0);
put(g, 0, "dining-chair", 0.6, 2.35, 180);
put(g, 0, "dining-chair", 1.4, 2.35, 180);
put(g, 0, "plant", 0.2, -2.5);
put(g, 0, "ceiling-light", -1.4, -0.9, 0, { elevation: 2.7 });
put(g, 0, "ceiling-light", 1.0, 1.6, 0, { elevation: 2.7, name: "Dining pendant" });

// First floor — master bedroom
const f = "room-first";
put(f, 1, "bed-queen", -0.8, -1.75);
put(f, 1, "rug", -0.8, 0.2);
put(f, 1, "nightstand", -1.9, -2.6, 0, { name: "Nightstand (left)" });
put(f, 1, "nightstand", 0.3, -2.6, 0, { name: "Nightstand (right)" });
put(f, 1, "wardrobe", -3.2, 0.4, 90);
put(f, 1, "dresser", -0.8, 2.575, 180);
put(f, 1, "desk", 3.2, -1.2, 270);
put(f, 1, "desk-chair", 2.55, -1.2, 90);
put(f, 1, "desk-lamp", 3.3, -1.5, 270, { elevation: 0.75 });
put(f, 1, "armchair", 2.5, 1.8, 180);
put(f, 1, "floor-lamp", 3.1, 2.4);
put(f, 1, "plant", 3.1, -2.5);
put(f, 1, "ceiling-light", -0.8, -0.5, 0, { elevation: 2.7 });

// Second floor — studio loft with guest bed
const s = "room-second";
put(s, 2, "bookshelf", -2.5, -2.65);
put(s, 2, "bookshelf", -1.6, -2.65);
put(s, 2, "desk", 3.2, 0, 270);
put(s, 2, "desk-chair", 2.55, 0, 90);
put(s, 2, "desk-lamp", 3.3, -0.35, 270, { elevation: 0.75 });
put(s, 2, "sofa", -1.0, 2.35, 180);
put(s, 2, "bed-single", -2.5, 0.0, 90);
put(s, 2, "armchair", 1.5, -2.4, 0);
put(s, 2, "floor-lamp", 2.3, -2.5);
put(s, 2, "rug", 0.6, 0.0);
put(s, 2, "plant", 3.1, 2.5);
put(s, 2, "ceiling-light", 0.4, 0, 0, { elevation: 2.7 });

const scene = SceneSchema.parse({
  schemaVersion: 1, id: "scene-apartment-001", name: "Three-storey apartment", coordinateSystem: "y-up-xz-meters",
  rooms: [
    room(g, "Ground floor · Living & kitchen", 0, [{ kind: "door", wall: "south", offset: 2.4, width: 0.95 }, stairDoor, { kind: "window", wall: "north", offset: -1.5, width: 1.8 }, { kind: "window", wall: "east", offset: -1.2, width: 1.2 }], "#bfa27f", "#f2efe8"),
    room(f, "First floor · Master bedroom", 1, [stairDoor, { kind: "window", wall: "north", offset: 1.5, width: 1.4 }, { kind: "window", wall: "east", offset: 0.8, width: 1.2 }, { kind: "window", wall: "south", offset: 2.0, width: 1.2 }], "#c8ab86", "#eef0ec"),
    room(s, "Second floor · Studio loft", 2, [stairDoor, { kind: "window", wall: "north", offset: 0.5, width: 2.0 }, { kind: "window", wall: "south", offset: 1.8, width: 1.4 }, { kind: "window", wall: "east", offset: -1.8, width: 1.0 }], "#b5a48f", "#f4f1ea"),
  ],
  furniture,
  environment: { mode: "day" },
});
const result = validateScene(scene);
for (const issue of result.issues) console.log(issue.severity, issue.message);
for (const r of scene.rooms) console.log(r.name, "score", scoreLayout(scene, result.issues, r.id).total);
console.log(scene.furniture.length, "objects,", result.issues.length, "issues");
writeFileSync(new URL("../../fixtures/apartment-scene.json", import.meta.url), JSON.stringify(scene, null, 2));
