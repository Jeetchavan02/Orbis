# Reality Builder — architecture

## Packages

| Path | Role |
| --- | --- |
| `packages/shared` | Zod schemas (scene, room/openings, furniture, mesh, lights, rules, environment, validation issues), the **action pipeline** (`actions.ts`), mesh operations (`mesh.ts`), collaboration protocol (`protocol.ts`). Authoritative contracts used by web, server and engine. |
| `packages/spatial-engine` | Pure TypeScript. `geometry.ts` (footprints, convex hull, SAT, distances), `validate.ts` (all rules), `pathways.ts` (walk grid, flood fill, A*), `recovery.ts` (candidate search + revalidation). |
| `server` | Express + `ws`. `sessions.ts` is the authoritative per-scene session (version checks, broadcast, presence); `index.ts` wires sockets, JSON persistence (`server/data/scenes/<id>.json`, atomic write, 1.5 s autosave) and REST (`GET /api/health`, `GET /api/scenes/:id`). |
| `web` | React + R3F. `store/workspace.ts` is the single mutation entry point; `workers/spatial.worker.ts` runs validation/recovery off the main thread; `components/viewport/*` render from canonical state; `components/panels/*` are the UI. |
| `fixtures` | `bedroom-scene.json` (default demo, validates clean), `studio-scene.json` (contract test). |

## Data flow

```
UI gesture ──► store.dispatch(action, {base}) ──online──► server: schema → base-version check → apply → version++ → broadcast "applied"
                    │                                                     └─ stale/invalid → "rejected" (conflicts) ──► conflict dialog
                    └─offline──► applySceneAction locally (kept in sessionStorage until reconciled)
"applied" ──► every client applies the same action in server order ──► scene object changes
scene change ──► spatial worker: validateScene ──► issues + stats ──► highlights, issue list, perf overlay
```

* Clients are **not optimistic**: they apply actions when the server echoes them, so all clients apply the same sequence.
* `base` versions are captured when an edit *starts* (gizmo mouse-down, field focus), so an edit that raced another user's change is rejected instead of overwriting it.
* Undo/redo send the stored inverse/forward with the versions recorded after the last application; if someone changed the object since, the server rejects it as a conflict.

## Action pipeline

`applySceneAction(scene, action) → { scene, inverse }` is pure and deterministic. Action types: `room.create/update/delete`, `furniture.create/update/delete`, `scene.update` (name, rules, environment), and `batch` (atomic, undoes as one step — used by recovery). Every update captures exactly the prior values of the patched keys, so inverses are minimal. `null` in a patch clears optional fields (mesh, light, constraints, color) so inverses can restore "unset". Mesh is authoritative for bounds; resizing a mesh object scales its vertices. History stores `{forward, inverse, versions}` — never scene snapshots.

## Spatial engine

* **Colliders** are derived every run from geometry + transform: oriented box footprint, or the convex hull of projected mesh vertices.
* **Broad phase:** RBush bulk-loaded with footprint AABBs; one query per object. **Narrow phase:** vertical-range filter, then SAT on the footprints (penetration depth reported).
* **Boundaries:** footprint vertices in room-local frame vs. interior; also ceiling height.
* **Front clearance:** zone in front of the object (local +Z) of the required depth; the available depth is found by binary search against obstacles and walls. Requirement = per-object constraint or the category default in scene rules.
* **Doors:** swing square inside each door must be clear.
* **Pathways:** walkability grid (walker radius = min passage / 2, ≤ 40k cells), 4-connected flood fill from door cells; an object is reachable if any cell of its access zone is reached. For unreachable objects, the nearest 8 obstacles are tested by removal to name the blockers. A* (8-connected, octile) produces walking routes for display.
* Floor coverings (≤ 3 cm or flagged) never collide; objects above 1.2 m never obstruct walking.
* **Recovery:** issues are processed in causal order (door → collision → boundary → clearance → pathway). For the chosen object, poses are searched in rings of increasing distance (0.1 m grid, optional 90° rotations); a cheap prefilter (room bounds, SAT vs. nearby obstacles via RBush, door swings, target zones) runs before full revalidation. A pose is accepted only if it resolves the targeted issue, introduces no new issue, and lowers the weighted cost. Each finished candidate is revalidated again with full blocker analysis; only improvements without new issues are shown. Locked objects never move. Three strategies (minimal nudge / rotate & reposition / move the larger piece) give distinct options.

## Rendering & performance

* Each furniture item is a memoized component; unchanged objects keep identity across actions, so React re-renders only what changed.
* > 150 objects: single-box low-detail models, no shadows. Imported/edited meshes with > 500 triangles get a three-mesh-bvh bounds tree for raycasting.
* Walls facing the camera lower themselves (cutaway) in `useFrame` without React re-renders.
* Perf overlay values are measured: FPS/frame time/draw calls from the render loop (`lib/perf.ts`), validation stats from the worker.

## Lighting

Environment presets (day/evening/night) set sky, sun direction/colour/intensity, hemisphere light and exposure; night adds stars. Light fixtures are furniture with a `light` field and render real `PointLight`/`SpotLight`s (no shadow maps, for performance) scaled by `environment.artificialLightScale` and a per-mode factor. Lights are edited through the normal action pipeline, so they persist, sync and undo.
