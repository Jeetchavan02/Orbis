# Reality Builder — Claude context

Hackathon: GDG On Campus FR.CRCE, Bit N Build. Problem statement #3: "Reality Builder: Collaborative 3D Design & Spatial Intelligence".

Browser-based collaborative 3D interior-design editor with a spatial-intelligence engine. The demo is a bedroom, but the engine must work for any room or furniture type. It should look and feel like a polished, professional product.

## Hard rules

- **Never run git commands of any kind** (status, diff, log, add, commit, push, pull, init). The user manages git manually. Never add AI attribution anywhere.
- Work only inside this workspace. `../rea/` is a separate third-party tool, not part of the product.
- Do not introduce: Next.js, Redux, physics engines, CRDTs, Docker, GraphQL, microservices, or a database (persistence is JSON or local files).
- No fake functionality: no hardcoded metrics, fake collaboration, decorative controls that don't work, or claims that tests passed without running them.
- API keys stay on the server, never in frontend code.
- Preserve working code. Don't rewrite things unnecessarily.

## Stack and layout

- `web/`: React, Vite, TypeScript, Tailwind 3, Three.js, React Three Fiber, Drei, Zustand
- `server/`: Node, Express, `ws` (authoritative collaboration server)
- `packages/shared/`: Zod schemas, scene/action/protocol types (these are authoritative)
- `packages/spatial-engine/`: pure TypeScript geometry, validation, recovery, optimization (RBush, SAT, grid A*)
- `fixtures/`: demo scenes. `docs/`: architecture notes.

Node >= 22.12 (the user runs 22.23.4 via nvm). npm workspaces.

## Commands (run from `apps/`)

- `npm install`
- `npm run dev`: API on :3001, web on :5173
- `npm run typecheck`
- `npm test` (vitest)
- `npm run build`

## Conventions

- Y-up, floor is the XZ plane, units are meters.
- Object position is the bottom-center of its bounding box. Room position is the footprint center at floor level.
- Local +Z is the object's front. Yaw is stored in degrees in JSON and converted to radians only for Three.js and geometry math.
- Mesh data is stored in local space. Colliders are derived from geometry plus the transform, never stored separately.
- Every object has a stable ID and a `version` (for collaboration conflict checks).

## Action pipeline (core architecture)

Every scene mutation is a typed action in `packages/shared`. That includes add, delete, move, rotate, resize, duplicate, room changes, vertex edits, extrude, material, lighting, constraints, and recovery-apply. Each action must provide:
schema validation → deterministic apply → inverse action → undo/redo → persistence → collaboration sync.
The viewport, inspector, AI, recovery, and mesh editing all go through it; nothing bypasses it. Undo uses an inverse-action command stack, never full-scene snapshots.
Spatial validation is advisory. Reject an action only if it is malformed, references a missing entity, breaks an explicit restriction, or is stale (its base version doesn't match).

## Mandatory requirements (from the problem statement)

1. 3D editor: room setup, asset library, select, move, rotate, resize, duplicate, delete, inspector, orbit/pan/zoom
2. Mesh editing: vertex move and face extrude on real geometry, plus GLB/GLTF import. Bounds, colliders, and validation update after every edit.
3. Spatial validation: collisions, boundary, clearance, blocked pathways. Each issue includes rule ID, severity, object IDs, an explanation, measurement vs. threshold, and highlight data.
4. Collaboration: WebSocket, per-object versions, stale-edit rejection, conflict UI (keep mine / take theirs), presence, reconnect. Never silently overwrite. Test with two browser sessions.
5. Layout recovery: generate candidate fixes, revalidate each one, show only valid ones, preview, then apply as an action
6. 500+ objects: RBush broad phase, real performance overlay (FPS, validation ms, broad/narrow/naive pair counts)
7. Save/restore the full scene (room, objects, meshes, materials, constraints, rules, environment, lights) plus undo/redo

Optional, only after the core is stable: Day/Evening/Night lighting with real fixtures (high demo value), AI assistant (server-side, structured tool calls, max 3 retries), layout scoring/optimization, Vastu rule packs, SunCalc sunlight, image-to-room.

UX reference: familiar editor layout (Planner 5D, SketchUp, Figma style). Top bar, left asset library, central viewport, right inspector, bottom status bar. Use these products as inspiration only and copy no branding.

## Implementation phases

0 Audit · 1 Editor foundation · 2 Spatial engine · 3 Recovery and mesh editing · 4 Actions, history, persistence · 5 Collaboration · 6 Performance · 7 Lighting · 8 Optional intelligence · 9 Polish and demo

## Current status (2026-10-31) — MVP complete for all 7 mandatory requirements

Verified in the browser (two tabs) and by `npm test` (35 tests), `npm run typecheck`, `npm run build`. Architecture: `docs/architecture.md`. Demo script: `README.md`.

### Checklist
**Req 1 — Editor** [x] library (search, click/drag-drop, free-spot placement) · [x] select/move/rotate/resize gizmos · [x] duplicate/delete · [x] inspector (transform, size, colour, constraints, lights) · [x] room size, surfaces, doors/windows · [x] orbit/pan/zoom, frame (F), reset (H) · [x] context menu, quick bar, shortcuts · [x] designed bedroom demo (validates clean)
**Req 2 — Mesh** [x] convert to editable mesh · [x] vertex move (coincident verts move together) · [x] face extrusion (real verts/tris, outward walls) · [x] GLB/GLTF import → canonical mesh · [x] bounds/colliders/validation/undo update · [ ] multi-vertex selection
**Req 3 — Validation** [x] RBush broad phase + SAT · [x] boundaries (+ceiling) · [x] front clearance (binary-searched free depth) · [x] door swing · [x] pathways (flood fill, blocker analysis, A* routes) · [x] structured issues + highlights + rules panel
**Req 4 — Collaboration** [x] authoritative server, per-entity versions, base captured at edit start · [x] stale rejection + Keep mine/Take theirs · [x] presence + live selection tags · [x] auto-reconnect · [x] offline edits persisted per tab and reconciled explicitly
**Req 5 — Recovery** [x] causal-priority search, prefilter + full revalidation, no new issues allowed, locked objects respected, 3 strategies, ghost preview, one-step batch apply
**Req 6 — Performance** [x] 500/1000-object stress scenes · [x] worker validation · [x] live overlay (measured: FPS, draw calls, validation ms, naive/broad/narrow pairs) · [x] low-detail rendering >150 objects · [x] memoized items · [x] BVH raycast for big meshes. Measured: 500 objects → 60 FPS, 17 broad-phase pairs of 124,750, ~10–50 ms validation in worker.
**Req 7 — History/persistence** [x] inverse-action stack for every action type · [x] autosave + save to `server/data/scenes` · [x] export/open JSON (schema-validated) · [x] restore verified across server restart
**Lighting (Phase 7)** [x] Day/Evening/Night presets (sky, sun, shadows, stars) · [x] per-fixture point/spot lights, on/off, intensity, colour temperature, persisted/undoable
**Optional (Phase 8)** [ ] AI assistant (needs an API key in server `.env`) · [ ] layout score/optimizer · [ ] Vastu packs · [ ] SunCalc sunlight · [ ] image-to-room

### Known limitations / next
- Single room per scene in the UI (engine supports many rooms).
- Imported GLB keeps geometry only (one material colour).
- Evening lighting could be tuned further; FPS in the Claude preview pane is throttled for the screenshotted tab — measure in a normal browser.
- Next: Phase 8 optional intelligence, then Phase 9 polish.

### Architecture notes
- `applySceneAction(scene, action)` → `{ scene, inverse }`: pure, never mutates, throws `SceneActionError`. Spatial validity is never checked there.
- UI mutates only via `useWorkspaceStore().dispatch(action, { base })`. Online clients are non-optimistic (apply on server echo).
- Mesh is authoritative for bounds (create/update derive `dimensions`). Mesh edits re-anchor bottom-center and shift position so the geometry stays in place.
- Server reads `API_PORT` (default 3001), not `PORT`. Browser preview config: `../.claude/launch.json`.

## Decisions log

- Recovery accepts partial improvements but never candidates that introduce new issues; complete fixes rank first.
- Offline edits are stored in `sessionStorage` (per tab) so a reload while offline cannot lose them.
- UX research notes from Planner 5D (observed, not copied): `docs/ux-research-planner5d.md`.
- REA (Reverse Engineer Anything) analyzes native binaries, so it doesn't help study web apps like Planner 5D. For UX research, inspect the reference site in the built-in browser instead and record only what was directly observed.
