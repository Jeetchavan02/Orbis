import { SceneSchema, type FurnitureObject, type Scene } from "@reality-builder/shared";
import { catalog } from "../data/catalog";

/**
 * Builds a large showroom with `count` furniture pieces laid out in aisles, for performance testing.
 * Deterministic (seeded) so measurements are comparable between runs. Every object is a normal scene object.
 */
export function createStressScene(count = 500): Scene {
  const pool = catalog.filter((item) => !item.light && item.category !== "decor" && item.id !== "box");
  const columns = Math.ceil(Math.sqrt(count * 1.4));
  const cell = 1.9;
  const width = columns * cell + 2;
  const rows = Math.ceil(count / columns);
  const depth = rows * cell + 2;
  let seed = 1337;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const furniture: FurnitureObject[] = [];
  for (let index = 0; index < count; index += 1) {
    const entry = pool[index % pool.length]!;
    const column = index % columns;
    const row = Math.floor(index / columns);
    furniture.push({
      id: "stress-" + index,
      roomId: "room-showroom",
      name: entry.name + " " + (index + 1),
      category: entry.category,
      catalogItemId: entry.id,
      position: {
        x: -width / 2 + 1 + column * cell + cell / 2 + (random() - 0.5) * 0.6,
        y: 0,
        z: -depth / 2 + 1 + row * cell + cell / 2 + (random() - 0.5) * 0.6,
      },
      yawDegrees: [0, 90, 180, 270][Math.floor(random() * 4)]!,
      dimensions: entry.dimensions,
      color: entry.color,
      constraints: entry.constraints,
      version: 1,
    });
  }
  return SceneSchema.parse({
    schemaVersion: 1,
    id: "scene-stress-" + count,
    name: `Showroom stress test (${count} objects)`,
    coordinateSystem: "y-up-xz-meters",
    rooms: [{
      id: "room-showroom", name: "Showroom", position: { x: 0, y: 0, z: 0 }, yawDegrees: 0,
      dimensions: { width, depth, height: 3.2, wallThickness: 0.2 },
      openings: [{ id: "door-showroom", kind: "door", wall: "south", offset: 0, width: 1.6, height: 2.2, sillHeight: 0 }],
      floorColor: "#cfc6b8", wallColor: "#eeece6",
    }],
    furniture,
    environment: { mode: "day", artificialLightScale: 1, shadows: false },
  });
}
