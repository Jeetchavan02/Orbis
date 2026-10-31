# Reality Builder

Collaborative, browser-based 3D room design with a computational spatial-intelligence engine.
GDG On Campus FR.CRCE — Bit N Build, problem statement 3.

## Run it

Requires Node.js ≥ 22.12 and npm ≥ 10.

```bash
npm install
npm run dev
```

Open http://127.0.0.1:5173. The API/collaboration server runs on 127.0.0.1:3001 (override with `API_PORT`). Scenes are saved to `server/data/scenes/<id>.json`; open `?scene=<id>` for a separate shared scene.

| Command | What it does |
| --- | --- |
| `npm test` | 35 unit tests: action pipeline & inverses, mesh ops, every spatial rule, 500-object broad phase, recovery, collaboration conflicts |
| `npm run typecheck` | Builds shared packages, type-checks server and web |
| `npm run build` | Production build of packages, server and web |

## Features

* **Editor:** library with search, click-to-place or drag-and-drop; select, move / rotate / resize gizmos (W/E/R, snapping), duplicate, delete, right-click menu, inspector for transform, size, colour, constraints and lights; room size, surfaces, doors and windows.
* **Mesh editing:** convert any object to an editable mesh, move vertices (V) and extrude faces (G); import GLB/GLTF as a real collidable, editable mesh. Bounds, colliders and validation update on every edit.
* **Spatial validation:** collisions (RBush + SAT), room boundaries, front clearances, door swings and blocked walking paths (grid flood fill, A* routes). Every issue has a rule id, severity, objects, explanation, measurement vs. threshold, and viewport highlight.
* **Layout recovery:** searched candidates, each fully revalidated; preview as ghosts; apply as one undoable action.
* **Collaboration:** authoritative WebSocket server, per-object versions, stale-edit rejection with a Keep mine / Take theirs dialog, presence with live selections, automatic reconnection, explicit reconciliation of offline edits.
* **Performance:** 500 and 1,000-object stress scenes; validation in a Web Worker; live overlay of FPS, draw calls, validation time, naive vs. broad-phase vs. narrow-phase pairs.
* **History & persistence:** inverse-action undo/redo for every edit type; autosave + explicit save; export/open scene JSON (schema-validated).
* **Environments:** Day / Evening / Night with sky, sun, shadows and real per-fixture lights.

## Demo script (≈4 minutes)

1. The app opens on the **Sunlit bedroom**; status bar shows *Layout valid*.
2. Select the **Queen bed**, set X to `-1.1` → errors appear, objects outline red/amber, clearance zones are drawn on the floor. Open **Issues** to read the explanations.
3. **Suggest fixes** → hover candidates to preview ghosts → **Apply**. ⌘Z undoes it, ⇧⌘Z redoes it.
4. Select the **Dresser** → *Convert to editable mesh* → **Face** mode, click a face, **Extrude** → width/bounds update and validation reacts. Library → *Import GLB/GLTF* for your own model.
5. Open a **second browser window** on the same URL. Note the presence avatars and live selection tags. In window B click into the bed's X field; in window A move the bed; commit in B → **Edit conflict** dialog, nothing overwritten.
6. Toggle **Day / Evening / Night**; select the floor lamp and switch it off or change its temperature.
7. Menu ▾ → **Load 500-object stress test**; the performance overlay (P) shows FPS, validation time and pair counts. Menu ▾ → **Reset to demo bedroom** to return.

Shortcuts: Q/W/E/R tools · V/G mesh modes · ⌘Z / ⇧⌘Z · ⌘D duplicate · Del delete · F frame · H reset view · [ ] rotate 15° · P perf · ⌘S save · Esc exit/deselect.

More detail: [docs/architecture.md](docs/architecture.md).
