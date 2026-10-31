# Reality Builder

Reality Builder is a browser-based collaborative 3D room-design and spatial-intelligence prototype. This Phase 1 foundation provides a 3D blockout preview, scene selection, shared contracts, an API health route, and a WebSocket scaffold. Editing, saving, validation, and collaboration are not implemented yet.

## Requirements

- Node.js 22.12 or newer
- npm 10 or newer

The workspace was initialized with npm workspaces. No database is used.

## Install

From the repository root, run `npm install`.

## Develop

Run `npm run dev` to build the shared packages, start the API at `http://127.0.0.1:3001`, and start the web app at `http://127.0.0.1:5173`.

The web app loads a deterministic sample scene. Click an object in the list or viewport to inspect it. Drag to orbit, scroll to zoom, right-drag to pan, and use Reset view to restore the camera. Property values are read-only. The API badge reports the result of the live health request.

The backend can also be run separately with `npm run build:packages` followed by `npm run dev:server`. Run the web app in another terminal with `npm run dev:web`.

## Checks

- `npm run typecheck` — build shared package declarations, then type-check the backend and frontend.
- `npm test` — run shared-contract and spatial-engine scaffold smoke tests.
- `npm run build` — build shared packages, backend, and production frontend.

## Workspace layout

- `apps/web` — React, Vite, Tailwind, Zustand, React Three Fiber, and Drei.
- `apps/server` — Node.js, Express, and WebSocket server scaffold.
- `packages/shared` — Zod contracts and shared TypeScript types.
- `packages/spatial-engine` — pure TypeScript spatial-engine API boundary.
- `fixtures` — deterministic test and preview scenes.
- `docs/architecture.md` — conventions, boundaries, and implemented scope.

## Current scope

The fixture uses meters, Y-up, an XZ floor plane, bottom-center furniture anchors, yaw in degrees, and local +Z as object front. Furniture is shown using proxy geometry. Room editing, furniture transforms, asset import, undo/redo, persistence, constraint validation, layout recovery, mesh editing, and collaboration remain for later phases. The spatial engine reports its scaffold status; it does not claim that any layout has been validated.
