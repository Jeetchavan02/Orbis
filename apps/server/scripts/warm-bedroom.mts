// Warms up the demo bedroom (palette, curtains, wall art, pendant) and validates it:
//   npx tsx server/scripts/warm-bedroom.mts
import { readFileSync, writeFileSync } from "node:fs";
import { SceneSchema } from "@reality-builder/shared";
import { validateScene } from "@reality-builder/spatial-engine";
import { catalog } from "../../web/src/data/catalog.ts";

const url = new URL("../../fixtures/bedroom-scene.json", import.meta.url);
const scene = SceneSchema.parse(JSON.parse(readFileSync(url, "utf8")));
const find = (pattern: RegExp) => catalog.find((item) => pattern.test(item.name)) ?? (() => { throw new Error(String(pattern)); })();
const room = scene.rooms[0]!;
room.floorColor = "#b88a5e";
room.wallColor = "#ece2da";
const recolor: Record<string, string> = { "Queen bed": "#cdb8c4", "Wool rug": "#e3d6c6", Wardrobe: "#e8e0d6", "Desk chair": "#a98a9c" };
for (const item of scene.furniture) if (recolor[item.name]) item.color = recolor[item.name];
scene.furniture = scene.furniture.filter((item) => item.name !== "Ceiling light" && !item.id.startsWith("warm-"));
const add = (id: string, pattern: RegExp, x: number, y: number, z: number, yaw: number, name: string) => {
  const entry = find(pattern);
  scene.furniture.push({ id: "warm-" + id, roomId: room.id, name, category: entry.category, catalogItemId: entry.id, position: { x, y, z }, yawDegrees: yaw, dimensions: entry.dimensions, color: entry.color, version: 1, ...(entry.light ? { light: entry.light } : {}), ...(entry.constraints ? { constraints: entry.constraints } : {}) });
};
const half = room.dimensions.depth / 2;
add("curtains-n", /^Curtains 1\.4 m — Mauve/, -1.6, 0, -half + 0.06, 0, "Curtains");
add("curtains-e", /^Curtains 2\.0 m — Linen/, room.dimensions.width / 2 - 0.06, 0, -0.9, 270, "Curtains");
add("art", /^Abstract canvas, large/, 0, 1.35, -half + 0.02, 0, "Wall art");
add("pendant", /^Dome pendant — Brass/, 0, find(/^Dome pendant — Brass/).elevation ?? 1.85, 0.3, 0, "Pendant");
const issues = validateScene(scene).issues;
console.log(`${scene.furniture.length} objects, ${issues.length} issues`);
for (const issue of issues) console.log("  ", issue.severity, issue.message);
writeFileSync(url, JSON.stringify(SceneSchema.parse(scene), null, 2));
