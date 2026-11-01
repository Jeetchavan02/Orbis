// End-to-end collaboration check against a running server, using two independent clients.
//   npm run smoke:collab                                   (local server on http://127.0.0.1:3001)
//   npm run smoke:collab -- https://your-app.up.railway.app
// Creates a throwaway project, runs the share-link flow over real HTTP + WebSockets, then deletes it.
const base = (process.argv[2] ?? "http://127.0.0.1:3001").replace(/\/$/, "");
const wsBase = base.replace(/^http/, "ws");
let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures += 1;
};

let cookie = "";
async function api(path, init = {}) {
  const response = await fetch(base + path, { ...init, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(init.headers ?? {}) } });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: response.status, body };
}

/** A collaborator: one WebSocket with an inbox and helpers to wait for messages. */
function join(projectId, name) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${wsBase}/ws?scene=${encodeURIComponent(projectId)}`);
    const inbox = [];
    const waiters = [];
    const peer = {
      name, socket, inbox, seq: -1, scene: null, closeCode: null,
      send: (message) => socket.send(JSON.stringify(message)),
      next(predicate, timeout = 8000) {
        const found = inbox.find(predicate);
        if (found) { inbox.splice(inbox.indexOf(found), 1); return Promise.resolve(found); }
        return new Promise((done, fail) => {
          const timer = setTimeout(() => fail(new Error(`${name}: timed out waiting for a message`)), timeout);
          waiters.push({ predicate, done: (message) => { clearTimeout(timer); done(message); } });
        });
      },
    };
    socket.addEventListener("open", () => peer.send({ type: "hello", sceneId: projectId, clientId: name.toLowerCase() + "-" + Date.now(), name, color: "#3b82d9" }));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type === "welcome" || message.type === "applied" || message.type === "scene-replaced") peer.seq = message.seq;
      if (message.type === "welcome" || message.type === "scene-replaced") peer.scene = message.scene;
      const waiter = waiters.find((entry) => entry.predicate(message));
      if (waiter) { waiters.splice(waiters.indexOf(waiter), 1); waiter.done(message); } else inbox.push(message);
      if (message.type === "welcome") resolve(peer);
    });
    socket.addEventListener("close", (event) => { peer.closeCode = event.code; reject(new Error(`${name}: closed (${event.code} ${event.reason})`)); });
    socket.addEventListener("error", () => reject(new Error(`${name}: could not connect to ${wsBase}/ws`)));
  });
}

const closeCodeFor = (projectId) => new Promise((resolve) => {
  const socket = new WebSocket(`${wsBase}/ws?scene=${encodeURIComponent(projectId)}`);
  socket.addEventListener("close", (event) => resolve(event.code));
  socket.addEventListener("open", () => setTimeout(() => { socket.close(); }, 1500));
});

try {
  const health = await api("/api/health");
  check(health.status === 200, `server reachable at ${base}`);

  const signup = await api("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Smoke Tester", email: `smoke-${Date.now()}@example.com`, password: "smoke-test-password" }) });
  check(signup.status === 201 && cookie.startsWith("orbis_session="), "owner signs up and gets a session");
  const me = await api("/api/auth/me");
  check(me.body?.user?.name === "Smoke Tester", "session is recognised by the server");

  const created = await api("/api/projects", { method: "POST", body: JSON.stringify({ name: "Collab smoke test", template: "bedroom" }) });
  check(created.status === 201 && created.body.id, "signed-in owner creates a project");
  const { id } = created.body;

  const page = await fetch(`${base}/project/${id}`);
  const html = await page.text();
  check(page.ok && html.includes('id="root"'), "share link /project/<id> serves the app (production build only)");

  const alice = await join(id, "Alice");
  const bob = await join(id, "Bob");
  check(JSON.stringify(alice.scene) === JSON.stringify(bob.scene) && alice.seq === bob.seq, "both collaborators receive the same initial scene");

  // Alice adds an object.
  const template = alice.scene.furniture[0];
  const newId = "smoke-" + Date.now();
  alice.send({ type: "action", requestId: "a1", label: "Add object", baseVersions: {}, action: { type: "furniture.create", furniture: { ...template, id: newId, name: "Smoke chair", version: 1 } } });
  const added = await bob.next((message) => message.type === "applied" && message.requestId === "a1");
  check(added.clientName === "Alice", "Bob sees Alice's new object");
  await alice.next((message) => message.type === "applied" && message.requestId === "a1");

  // Bob moves it.
  bob.send({ type: "action", requestId: "b1", label: "Move object", baseVersions: { [newId]: 1 }, action: { type: "furniture.update", furnitureId: newId, patch: { position: { x: 0.5 } } } });
  const moved = await alice.next((message) => message.type === "applied" && message.requestId === "b1");
  check(moved.action.patch.position.x === 0.5, "Alice sees Bob's move");
  await bob.next((message) => message.type === "applied" && message.requestId === "b1");

  // Both edit the same object at once from version 2: exactly one wins, the other is told why.
  alice.send({ type: "action", requestId: "a2", label: "Recolor", baseVersions: { [newId]: 2 }, action: { type: "furniture.update", furnitureId: newId, patch: { color: "#aa3333" } } });
  bob.send({ type: "action", requestId: "b2", label: "Rotate", baseVersions: { [newId]: 2 }, action: { type: "furniture.update", furnitureId: newId, patch: { yawDegrees: 90 } } });
  const outcomes = await Promise.all([
    alice.next((message) => (message.type === "applied" || message.type === "rejected") && message.requestId === "a2"),
    bob.next((message) => (message.type === "applied" || message.type === "rejected") && message.requestId === "b2"),
  ]);
  const kinds = outcomes.map((message) => message.type).sort();
  check(kinds[0] === "applied" && kinds[1] === "rejected", "simultaneous edits: one applied, one rejected as stale (no silent overwrite)");
  const loser = outcomes.find((message) => message.type === "rejected");
  check(loser?.reason === "stale" && loser.conflicts?.[0]?.entityId === newId, "the rejected collaborator gets conflict details");

  // A stale whole-scene replacement is refused.
  await new Promise((resolve) => setTimeout(resolve, 300));
  bob.send({ type: "load-scene", requestId: "b-load", baseSeq: 0, scene: { ...bob.scene, furniture: [] } });
  const refused = await bob.next((message) => message.type === "load-rejected" && message.requestId === "b-load");
  check(Boolean(refused), "a stale load-scene is refused instead of wiping newer work");

  // Bob drops off and comes back: he gets the latest authoritative scene.
  bob.socket.close();
  await new Promise((resolve) => setTimeout(resolve, 300));
  const bobAgain = await join(id, "Bob");
  const restored = bobAgain.scene.furniture.find((item) => item.id === newId);
  check(restored?.position.x === 0.5 && bobAgain.seq === alice.seq, "rejoin restores the latest scene");
  check(bobAgain.scene.furniture.length === alice.scene.furniture.length + 1, "nothing lost or duplicated after rejoin");

  const listed = await api("/api/projects");
  check(listed.body.projects?.some((project) => project.id === id && project.owned), "the project is on the owner's dashboard");

  // Clean up: only the owner can delete.
  const ownerCookie = cookie;
  cookie = "";
  const denied = await api(`/api/projects/${id}`, { method: "DELETE" });
  cookie = ownerCookie;
  check(denied.status === 403, "a guest can't delete someone else's project (public mode)");
  const deleting = alice.next((message) => message.type === "project-deleted").catch(() => null);
  const deleted = await api(`/api/projects/${id}`, { method: "DELETE" });
  check(deleted.status === 200, "owner deletes the project");
  check(Boolean(await deleting), "connected collaborators are told the project was deleted");
  check((await closeCodeFor(id)) === 4004, "a link to a deleted project shows 'not found' (public mode)");
} catch (error) {
  failures += 1;
  console.log("FAIL  " + error.message);
}

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll collaboration checks passed.");
process.exit(failures ? 1 : 0);
