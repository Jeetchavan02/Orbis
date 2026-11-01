# Collaboration: how it works and how to demo it

Verified on 2026-11-01 with two browser sessions on the same scene (`localhost:5173` and `127.0.0.1:5173`) and with two scripted WebSocket clients.

## How it works

```
 Device A browser ─┐                          ┌─ server/src/sessions.ts (one SceneSession per scene)
                   ├── WebSocket /ws?scene=ID ┤   • holds the only authoritative copy of the scene
 Device B browser ─┘   (proxied by Vite)      │   • checks each edit's baseVersions against current versions
                                              │   • match    → apply, version+1, broadcast "applied" to everyone
                                              │   • mismatch → "rejected" to the sender only, with who changed it
                                              └─ autosaves to server/data/scenes/<id>.json
```

- Every object has a `version` number. When you start an edit (start dragging, or focus an inspector field), the client records the version it saw. That's the edit's *base*.
- Clients are **not optimistic**: your own edit appears only when the server sends it back. So both screens always show the server's state.
- Stale edit, meaning someone else changed the object after your base: the server rejects it and the **Edit conflict** dialog opens. It names the person, the old and new versions, and their current values. You choose **Take theirs** (drop your change) or **Keep mine** (re-apply your change on top of the new version). Nothing is silently overwritten.
- Presence: avatars in the top bar, a name label on the object each person has selected, and live cursors.
- Reconnect: retries with backoff. Edits made while offline are kept per tab, and the **Offline** dialog lets you choose to upload them or use the server's version.

Code: `server/src/sessions.ts` (server), `web/src/lib/collab.ts` (socket client), `web/src/store/workspace.ts` (message handling), `web/src/components/panels/Overlays.tsx` (Share, Conflict and Offline dialogs), `packages/shared/src/protocol.ts` (message schemas).

## What Device A (the host) does

From the `apps/` folder, with `cloudflared` installed (`brew install cloudflared`, once):
```bash
npm run share
```
Wait for `Orbis is live: https://<random>.trycloudflare.com`. Open a project on that link, click **Share**, and send the `/project/<id>` link. It works for anyone on any network (Wi-Fi, campus, mobile data). Keep the terminal open and the Mac awake. Each run gives a new address. Details are in the README under *Share from your own computer*.

For a quick test on one machine, `npm run dev` and two browser windows on the same project link also work.

## Demo script (about 2 minutes)

1. **Join:** open the same scene on A and B. Both top bars show two avatars.
2. **Live sync:** on B, select the bed and press ⌘D. The object count in A's status bar goes 5 → 6, and the copy appears on A.
3. **Presence:** A sees B's name on the object B has selected.
4. **Validation follows remote edits:** the overlapping copy turns red on both screens and the Issues badge shows the collision.
5. **Conflict:** on A, select the copy and click into Position X in the inspector, then type `0.8` but don't press Enter. On B, press ← to nudge the same copy. Back on A, press Enter. The **Edit conflict** dialog opens: "Queen bed copy was changed by *B's name* after you started editing… was **not** applied", showing "You edited version 1; it is now version 2". Click **Take theirs** or **Keep mine**.
6. **Clean up:** on B, press Delete. Both screens go back to 5 objects.

## Verified results

| Check | Result |
|---|---|
| Presence | Both tabs showed 2 avatars, and A showed B's name label on B's selected object |
| Sync | Duplicating on B changed A's count from 5 to 6 objects, and deleting on B brought it back to 5 |
| Simultaneous edits over WebSocket | Two clients sent edits from version 2 at once: the first was applied, the second was rejected with "Queen bed was changed by Probe-A after you started editing." |
| Conflict dialog in the UI | Appeared exactly as described in step 5 |
| LAN link (`http://<ip>:5173`) | **Was a blank page.** `crypto.randomUUID` only exists on https/localhost. Fixed with a fallback (`randomId()` in `web/src/lib/collab.ts`). Typecheck and the 51 tests pass, but loading it from a real second device is still untested |
