# Orbis

Formerly Reality Builder. 
Collaborative, browser-based 3D room design with a computational spatial-intelligence engine.
GDG On Campus FR.CRCE — Bit N Build, problem statement 3.

## Run it

Requires Node.js ≥ 22.12 and npm ≥ 10.

```bash
npm install
npm run dev
```

Open http://127.0.0.1:5173. The API/collaboration server runs on 127.0.0.1:3001 (override with `API_PORT`). Scenes are saved to `server/data/scenes/<id>.json`; projects open at `/project/<id>` (old `?scene=<id>` links still work). Local links only work on your computer; to collaborate over the internet, deploy (below).

| Command | What it does |
| --- | --- |
| `npm test` | 35 unit tests: action pipeline & inverses, mesh ops, every spatial rule, 500-object broad phase, recovery, collaboration conflicts |
| `npm run typecheck` | Builds shared packages, type-checks server and web |
| `npm run build` | Production build of packages, server and web |

## Share a project with anyone (deployed)

The production build is one Node process that serves the web app, the API and the collaboration WebSocket from the same address, so a share link like `https://<your-app>/project/<id>` works from any device or network. Anyone with the link can edit (no sign-up). The homepage only lists projects your browser created or opened, and only the creator can delete a project.

### Sharing, link access and the design PDF

* **Share** dialog: copy the `/project/<id>` link, or **Share on WhatsApp** (opens `wa.me` with a prefilled message and the link; you pick the contact or group).
* **Anyone with the link: Can edit / Can view** (Canva-style). Only the owner can change it: the signed-in account that created the project, or the browser that holds its owner key. The server enforces it, so view-only guests can't edit even from a modified client. The owner always keeps editing, changes apply immediately to people already connected, and the setting is stored in `RB_DATA_DIR/link-access.json`. Default: Can edit.
* **Export PDF** (top bar, or the ▾ menu → *Download design PDF*): renders 9 views from the live 3D scene (bird's-eye, floor plan, front/back/left/right elevations, two corner perspectives, eye-level interior) and builds a landscape A4 report in the browser: cover, one page per view, and a furniture schedule. You can preview, download (`Orbis_<Project>_Design.pdf`), share through the device share sheet where the browser supports file sharing, or send the project link on WhatsApp. Exporting reads the scene only. Scene JSON export/import is still available in the ▾ menu.

### Share from your own computer (Cloudflare tunnel, any network, no account)

```bash
brew install cloudflared   # once
npm run share              # build → production server on 127.0.0.1:8787 → public https link
```

It prints `Orbis is live: https://<random>.trycloudflare.com` once the link answers from the internet. Open a project and click **Share** to copy its `/project/<id>` link; it works on any network, including mobile data. Keep the terminal open and the computer awake; Ctrl+C stops the server and the tunnel together. Each run gets a new random address, so send the new link after a restart. Projects stay in `server/data`, same as in development. `npm run share -- --no-build` skips the build; `SHARE_PORT` changes the local port.

Check the public link: `npm run smoke:collab -- https://<random>.trycloudflare.com` (it leaves one `smoke-…@example.com` account behind).

### Deploy on Railway (recommended: always on, WebSockets, persistent volume)

1. Push this repo to GitHub. In Railway: **New Project → Deploy from GitHub repo**.
2. Service **Settings → Root Directory**: the folder that contains this README (`apps`).
   `railway.json` already sets the build (`npm ci --include=dev && npm run build`), start (`npm start`) and health check (`/api/health`).
3. Service **Variables**: `RB_DATA_DIR=/data` and, for the AI features, `GEMINI_API_KEY=...`.
4. **Add a Volume** to the service, mounted at `/data` (projects survive redeploys and restarts).
5. **Settings → Networking → Generate Domain**. Open it, create a room, click **Share**, send the link.
6. Verify from your laptop: `npm run smoke:collab -- https://<your-domain>` (two independent clients: join, sync, conflict, reconnect, delete).

Render and Fly.io also work (same build/start commands, `PORT` is read automatically). Render's free tier sleeps after inactivity and has no persistent disk, so projects reset and the first visit takes ~1 minute; avoid it for the demo.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | set by host | Port in production (`API_PORT` locally, default 3001) |
| `RB_DATA_DIR` | `server/data` | Where projects, thumbnails and owner keys are stored. Point it at the volume |
| `RB_PUBLIC` | `1` in production | Public mode: private project list, 404 for unknown links, owner-only delete |
| `HOST` | `0.0.0.0` in production | Bind address |
| `GEMINI_API_KEY` | none | Enables the AI features (server-side only) |
| `ORBIS_SESSION_SECRET` | auto | Signs login cookies. If unset, a random key is created once in `RB_DATA_DIR` (fine on a volume) |
| `GOOGLE_CLIENT_ID` | none | Shows "Continue with Google" on the login page (OAuth web client id; add your domain as an authorised origin) |
| `ORBIS_SHOW_RESET_LINKS` | `0` in production | No email service is wired up: reset links are printed in the server log. Set to `1` for a demo so the link also appears on the page |

Run the production build locally: `npm run build && npm start` → http://127.0.0.1:3001.

## Accounts

Sign up with name, email and password (scrypt-hashed, stored in `RB_DATA_DIR/users.json`; signed httpOnly session cookie, 30 days with "Keep me signed in"). The dashboard needs an account; shared `/project/<id>` links still work for guests, who just pick a display name. Projects you create, and projects you open from a link while signed in, appear on your dashboard; only the creator can delete.

## Features

* **Editor:** Planner 5D-style direct dragging (snap, magnetic walls, live collision ring), rotation ring, floating actions; multi-floor scenes with a floor switcher; library with search, click-to-place or drag-and-drop; select, move / rotate / resize gizmos (W/O/R, snapping), duplicate, delete, right-click menu, inspector for transform, size, colour, constraints and lights; room size, surfaces, doors and windows.
* **Mesh editing:** convert any object to an editable mesh, move vertices (V, Shift/⌘-click for several, Select all) and extrude faces (G); import GLB/GLTF as a real collidable, editable mesh. `.glb` imports keep their materials and textures.
* **Floor-plan underlay:** select the room → *Floor-plan underlay* → upload a plan image, then set opacity, width, position and rotation (or *Fit to room*). Saved, undoable and shared. Plans used with *Upload a plan* are attached as a hidden underlay. Bounds, colliders and validation update on every edit.
* **Spatial validation:** collisions (RBush + SAT), room boundaries, front clearances, door swings and blocked walking paths (grid flood fill, A* routes). Every issue has a rule id, severity, objects, explanation, measurement vs. threshold, and viewport highlight.
* **Layout recovery:** searched candidates, each fully revalidated; preview as ghosts; apply as one undoable action.
* **Collaboration:** open-link sharing (`/project/<id>`, no sign-up, name prompt on first visit), authoritative WebSocket server, per-object versions, stale-edit rejection with a Keep mine / Take theirs dialog, version-checked whole-scene replacement (imports and offline merges can't overwrite newer work), presence with live selections and join/leave notices, heartbeat, automatic reconnection with backoff, explicit reconciliation of offline edits.
* **Performance:** 500 and 1,000-object stress scenes; validation in a Web Worker; live overlay of FPS, draw calls, validation time, naive vs. broad-phase vs. narrow-phase pairs.
* **History & persistence:** inverse-action undo/redo for every edit type; autosave + explicit save; export/open scene JSON (schema-validated).
* **AI (Gemini):** natural-language edits validated by the spatial engine with up to 3 automatic corrections, applied as one undoable action; photo → approximate editable room. Set `GEMINI_API_KEY` in `apps/.env` (server-side only).
* **Insights:** layout score (0–100) with explained components and a validated hill-climb optimizer; optional Vastu guideline pack; SunCalc sunlight study with a floor heat map.
* **Environments:** Day / Evening / Night with sky, sun, shadows and real per-fixture lights.

## Demo script (≈4 minutes)

1. The app opens on the **Sunlit bedroom** (real CC0 furniture models); status bar shows *Layout valid*. Menu ▾ → **Load demo apartment** shows the 3-floor version — switch floors at the top.
2. Select the **Queen bed**, set X to `-1.1` → errors appear, objects outline red/amber, clearance zones are drawn on the floor. Open **Issues** to read the explanations.
3. **Suggest fixes** → hover candidates to preview ghosts → **Apply**. ⌘Z undoes it, ⇧⌘Z redoes it.
4. Select the **Dresser** → *Convert to editable mesh* → **Face** mode, click a face, **Extrude** → width/bounds update and validation reacts. Library → *Import GLB/GLTF* for your own model.
5. Click **Share → Copy link** and open it on a **second laptop or phone** (or a second browser window). Note the presence avatars and live selection tags. In window B click into the bed's X field; in window A move the bed; commit in B → **Edit conflict** dialog, nothing overwritten.
6. Toggle **Day / Evening / Night**; select the floor lamp and switch it off or change its temperature.
7. Menu ▾ → **Load 500-object stress test**; the performance overlay (P) shows FPS, validation time and pair counts. Menu ▾ → **Reset to demo bedroom** to return.

Shortcuts (press ? in the editor for the full list): A select · W move · O rotate · R scale · S square · C circle · L line/measure · T text label · E extrude (⇧E push in) · V/G vertices/faces · 1–7 views · ⌘Z / ⇧⌘Z · ⌘D duplicate · Del delete · F frame · H reset view · [ ] rotate 15° · P perf · ⌘S save · Esc exit/deselect.

More detail: [docs/architecture.md](docs/architecture.md).
