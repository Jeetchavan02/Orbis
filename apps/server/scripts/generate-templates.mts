// Regenerates fixtures/templates/*.json from the web catalogue and validates each layout:
//   npx tsx server/scripts/generate-templates.mts
import { mkdirSync, writeFileSync } from "node:fs";
import { SceneSchema, type FurnitureObject } from "@reality-builder/shared";
import { validateScene } from "@reality-builder/spatial-engine";
import { catalog, type CatalogItem } from "../../web/src/data/catalog.ts";

const find = (pattern: RegExp) => {
  const entry = catalog.find((item) => pattern.test(item.name));
  if (!entry) throw new Error("No catalogue entry matches " + pattern);
  return entry;
};

type Place = [entry: CatalogItem, x: number, z: number, yaw?: number, name?: string];

function room(id: string, name: string, roomType: string, width: number, depth: number, openings: object[], items: Place[], colors: { floor: string; wall: string }) {
  let n = 0;
  const furniture: FurnitureObject[] = items.map(([entry, x, z, yaw = 0, label]) => ({
    id: `${id}-${++n}`, roomId: `${id}-room`, name: label ?? entry.name.split(" — ")[0]!, category: entry.category, catalogItemId: entry.id,
    position: { x, y: entry.elevation ?? 0, z }, yawDegrees: yaw, dimensions: entry.dimensions, color: entry.color, version: 1,
    ...(entry.light ? { light: entry.light } : {}), ...(entry.constraints ? { constraints: entry.constraints } : {}),
  }));
  return SceneSchema.parse({
    schemaVersion: 1, id: `template-${id}`, name, coordinateSystem: "y-up-xz-meters", roomType,
    rooms: [{
      id: `${id}-room`, name, position: { x: 0, y: 0, z: 0 }, yawDegrees: 0, floorColor: colors.floor, wallColor: colors.wall,
      dimensions: { width, depth, height: 2.7, wallThickness: 0.14 },
      openings: openings.map((opening, index) => ({ id: `${id}-opening-${index}`, sillHeight: 0, height: 2.05, hinge: "left", swing: "in", ...opening })),
    }],
    furniture,
  });
}
const window = (wall: string, offset: number, width: number) => ({ kind: "window", wall, offset, width, height: 1.3, sillHeight: 0.9 });
const door = (wall: string, offset: number, hinge = "left") => ({ kind: "door", wall, offset, width: 0.9, hinge });

const templates = {
  living: room("living", "Minimal living room", "living", 5.2, 4.4, [door("south", 1.8, "right"), window("north", 0.3, 1.8), window("west", -1.4, 1.0)], [
    [find(/^Border rug 2\.0 × 3\.0 m — Ivory/), -0.4, 0],
    [find(/^Modern three-seater — Oatmeal/), -2.14, 0, 90, "Sofa"],
    [find(/^Rectangular coffee table — Oak/), -0.85, 0, 90, "Coffee table"],
    [find(/^Low TV unit — Walnut/), 2.39, 0, 270, "TV unit"],
    [find(/^55" TV/), 2.45, 0, 270],
    [find(/^Club armchair — Sage/), 0.6, -1.775, 0, "Armchair"],
    [find(/^Club armchair — Sage/), 0.6, 1.775, 180, "Armchair"],
    [find(/^Drum floor lamp — Linen/), -2.35, -1.85, 0, "Floor lamp"],
    [find(/^Round side table — Oak/), -2.3, 1.5, 0, "Side table"],
    [find(/^Large Fiddle-leaf fig in ceramic pot/), 2.28, -1.8, 0, "Fiddle-leaf fig"],
    [find(/^Tall bookcase — Oak/), -1.0, -2.05, 0, "Bookcase"],
    [find(/^Abstract canvas, large/), -2.58, 0, 90, "Wall art"],
    [find(/^Flush ceiling light — White/), 0, 0, 0, "Ceiling light"],
  ], { floor: "#c9a77f", wall: "#efe9e2" }),
  dining: room("dining", "Contemporary dining room", "dining", 4.8, 4.0, [door("south", -1.6), window("north", 0.9, 1.6)], [
    [find(/^Border rug 2\.0 × 3\.0 m — Slate/), 0, 0, 90, "Rug"],
    [find(/^Tapered-leg dining table 6-seat — Walnut/), 0, 0, 0, "Dining table"],
    ...[-0.6, 0, 0.6].flatMap((x): Place[] => [[find(/^Upholstered dining chair — Oak/), x, -0.75, 0, "Dining chair"], [find(/^Upholstered dining chair — Oak/), x, 0.75, 180, "Dining chair"]]),
    [find(/^Modern dresser — Walnut/), 2.16, 0, 270, "Sideboard"],
    [find(/^Dome pendant — Brass/), 0, 0, 0, "Pendant"],
    [find(/^Medium Leafy bush in terracotta pot/), -2.05, -1.65, 0, "Plant"],
    [find(/^Landscape print, large/), -0.6, -1.98, 0, "Wall art"],
  ], { floor: "#b8946c", wall: "#ece6dc" }),
  kitchen: room("kitchen", "Modern kitchen", "kitchen", 4.4, 3.8, [door("south", 1.6), window("east", -0.6, 1.0)], [
    [find(/^Base cabinets 2\.4 m — Sage/), -0.8, -1.6, 0, "Base cabinets"],
    [find(/^Fridge — Stainless/), 1.0, -1.55, 0, "Fridge"],
    [find(/^Range cooker — Stainless/), 1.85, -1.59, 0, "Range cooker"],
    [find(/^Kitchen island — White/), 0, 0.4, 0, "Kitchen island"],
    [find(/^Round bar stool — Oak/), -1.15, 0.4, 90, "Bar stool"],
    [find(/^Round bar stool — Oak/), 1.15, 0.4, 270, "Bar stool"],
    [find(/^Globe pendant — Brass/), -0.45, 0.4, 0, "Pendant"],
    [find(/^Globe pendant — Brass/), 0.45, 0.4, 0, "Pendant"],
  ], { floor: "#d6cfc4", wall: "#f1eee8" }),
  office: room("office", "Home office", "office", 4.0, 3.6, [door("south", -1.2), window("north", 0, 1.4), window("east", 0.4, 1.0)], [
    [find(/^Border rug 1\.6 × 2\.3 m — Slate/), 0, 0.2, 90, "Rug"],
    [find(/^Pedestal desk — Oak/), 0, -1.45, 0, "Desk"],
    [find(/^Ergonomic office chair — Black/), 0, -0.75, 180, "Office chair"],
    [find(/^24" monitor/), 0, -1.6, 0, "Monitor"],
    [find(/^Arm desk lamp — Brass/), 0.5, -1.6, 0, "Desk lamp"],
    [find(/^Wide bookcase — Walnut/), -1.825, 0.5, 90, "Bookcase"],
    [find(/^Club armchair — Navy/), 1.5, 1.325, 180, "Reading chair"],
    [find(/^Drum floor lamp — Black/), 0.85, 1.55, 0, "Floor lamp"],
    [find(/^Medium Snake plant in ceramic pot/), 1.7, -1.55, 0, "Plant"],
    [find(/^Flush ceiling light — White/), 0, 0, 0, "Ceiling light"],
  ], { floor: "#c4a07a", wall: "#eceae6" }),
};

mkdirSync(new URL("../../fixtures/templates/", import.meta.url), { recursive: true });
for (const [key, scene] of Object.entries(templates)) {
  // Desk accessories stand on the desk: lift them to its top.
  for (const item of scene.furniture) {
    const entry = catalog.find((candidate) => candidate.id === item.catalogItemId);
    if (entry?.family === "monitor" || entry?.family === "desk-lamp" || entry?.family === "tv") item.position.y = entry.family === "tv" ? 0.5 : 0.75;
  }
  const issues = validateScene(scene).issues;
  console.log(`${key}: ${scene.furniture.length} objects, ${issues.length} issues`);
  for (const issue of issues) console.log("   ", issue.severity, issue.message);
  writeFileSync(new URL(`../../fixtures/templates/${key}.json`, import.meta.url), JSON.stringify(scene, null, 2));
}
