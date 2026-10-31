# Phase 1 architecture

## Workspace map

- `apps/web` — React/Vite interface, Zustand workspace selection state, and React Three Fiber viewport.
- `apps/server` — Express health endpoint and a WebSocket connection scaffold.
- `packages/shared` — Zod schemas and inferred scene/action/violation types.
- `packages/spatial-engine` — pure TypeScript package boundary; currently reports its scaffold state and does not validate scenes.
- `fixtures` — deterministic sample scene used by the interface and contract test.

## Scene conventions

Scene coordinates and dimensions are meters. World up is +Y and the floor plane is XZ. Room positions anchor the center of the footprint at floor elevation. Furniture positions anchor the bottom-center of each object's bounding box. Yaw is serialized in degrees around +Y; local +Z is the object's front. These are schema conventions, not editor capabilities yet.

The sample scene is read-only. The viewport supports selection and camera orbit, zoom, pan, and reset. Object transforms, 2D editing, persistence, and spatial checks are not implemented in Phase 1.

## Data and validation boundaries

The shared package defines the initial scene, room, furniture, scene-action, validation-violation, and API health contracts. Zod parsing validates data shape. It does not validate spatial correctness. The spatial engine currently has no geometry or constraint implementation, and its status API explicitly reports that.

The API health route is `GET /api/health`. The WebSocket endpoint at `/ws` sends a scaffold handshake only; it is not a collaboration protocol. No database or persistence layer is present.
