import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SceneSchema, type ServerMessage } from "@reality-builder/shared";
import { SceneSession, type ClientHandle } from "./sessions.js";

const bedroom = SceneSchema.parse(JSON.parse(readFileSync(resolve(process.cwd(), "fixtures/bedroom-scene.json"), "utf8")));

function client(session: SceneSession, name: string) {
  const inbox: ServerMessage[] = [];
  const handle: ClientHandle = { send: (message: ServerMessage) => inbox.push(message) };
  session.connect(handle);
  session.handle(handle, { type: "hello", sceneId: "t", clientId: name.toLowerCase(), name, color: "#123456" });
  return { handle, inbox, last: () => inbox[inbox.length - 1]! };
}

const moveBed = (x: number, base: number, requestId: string) => ({
  type: "action",
  requestId,
  label: "Move object",
  action: { type: "furniture.update", furnitureId: "obj-bed", patch: { position: { x } } },
  baseVersions: { "obj-bed": base },
});

describe("authoritative collaboration session", () => {
  it("applies a fresh edit, bumps the version, and broadcasts it to both clients", () => {
    const session = new SceneSession(bedroom);
    const alice = client(session, "Alice");
    const bob = client(session, "Bob");
    session.handle(alice.handle, moveBed(0.3, 1, "a1"));
    expect(session.scene.furniture.find((item) => item.id === "obj-bed")!.version).toBe(2);
    for (const peer of [alice, bob]) {
      const applied = peer.inbox.find((message) => message.type === "applied");
      expect(applied).toMatchObject({ requestId: "a1", clientName: "Alice", seq: 1 });
    }
  });

  it("rejects a stale concurrent edit with conflict details instead of overwriting", () => {
    const session = new SceneSession(bedroom);
    const alice = client(session, "Alice");
    const bob = client(session, "Bob");
    session.handle(alice.handle, moveBed(0.3, 1, "a1"));
    session.handle(bob.handle, moveBed(-0.3, 1, "b1")); // Bob still thinks the bed is at version 1.
    const rejected = bob.last();
    expect(rejected.type).toBe("rejected");
    if (rejected.type !== "rejected") return;
    expect(rejected.reason).toBe("stale");
    expect(rejected.message).toContain("changed by Alice");
    expect(rejected.conflicts[0]).toMatchObject({ entityId: "obj-bed", baseVersion: 1, currentVersion: 2 });
    expect(session.scene.furniture.find((item) => item.id === "obj-bed")!.position.x).toBe(0.3);
    // "Keep mine": resubmitting against the current version succeeds.
    session.handle(bob.handle, moveBed(-0.3, 2, "b2"));
    expect(session.scene.furniture.find((item) => item.id === "obj-bed")!.position.x).toBe(-0.3);
  });

  it("allows concurrent edits to different objects", () => {
    const session = new SceneSession(bedroom);
    const alice = client(session, "Alice");
    const bob = client(session, "Bob");
    session.handle(alice.handle, moveBed(0.3, 1, "a1"));
    session.handle(bob.handle, {
      type: "action", requestId: "b1", label: "Move object",
      action: { type: "furniture.update", furnitureId: "obj-plant", patch: { position: { x: 1.9 } } },
      baseVersions: { "obj-plant": 1 },
    });
    expect(bob.last()).toMatchObject({ type: "applied", requestId: "b1" });
  });

  it("reports edits to deleted objects as conflicts and rejects malformed actions", () => {
    const session = new SceneSession(bedroom);
    const alice = client(session, "Alice");
    const bob = client(session, "Bob");
    session.handle(alice.handle, {
      type: "action", requestId: "a1", label: "Delete", action: { type: "furniture.delete", furnitureId: "obj-bed" }, baseVersions: { "obj-bed": 1 },
    });
    session.handle(bob.handle, moveBed(0.5, 1, "b1"));
    expect(bob.last()).toMatchObject({ type: "rejected", reason: "stale" });
    session.handle(bob.handle, {
      type: "action", requestId: "b2", label: "Bad", action: { type: "furniture.update", furnitureId: "obj-plant", patch: { dimensions: { width: -1 } } },
      baseVersions: { "obj-plant": 1 },
    });
    expect(bob.last()).toMatchObject({ type: "rejected", reason: "invalid" });
  });

  it("tracks presence for connected peers", () => {
    const session = new SceneSession(bedroom);
    const alice = client(session, "Alice");
    client(session, "Bob");
    session.handle(alice.handle, { type: "presence", selectedId: "obj-bed" });
    expect(session.peers.find((peer) => peer.name === "Alice")!.selectedId).toBe("obj-bed");
    session.disconnect(alice.handle);
    expect(session.peers.map((peer) => peer.name)).toEqual(["Bob"]);
  });

  it("replaces a stale connection when the same tab reconnects", () => {
    const session = new SceneSession(bedroom);
    client(session, "Alice");
    client(session, "Alice");
    expect(session.peers.filter((peer) => peer.clientId === "alice")).toHaveLength(1);
  });
});

describe("whole-scene replacement (load-scene)", () => {
  const load = (scene: unknown, baseSeq: number, requestId = "load-1") => ({ type: "load-scene", requestId, baseSeq, scene });
  const movedCopy = (x: number) => ({ ...bedroom, furniture: bedroom.furniture.map((item) => (item.id === "obj-bed" ? { ...item, position: { ...item.position, x } } : item)) });

  it("applies a replacement made against the current scene and broadcasts it to everyone", () => {
    const session = new SceneSession(bedroom);
    const alice = client(session, "Alice");
    const bob = client(session, "Bob");
    session.handle(alice.handle, load(movedCopy(0.9), 0));
    expect(session.seq).toBe(1);
    expect(session.scene.furniture.find((item) => item.id === "obj-bed")!.position.x).toBe(0.9);
    for (const peer of [alice, bob]) expect(peer.last()).toMatchObject({ type: "scene-replaced", seq: 1, by: "Alice" });
  });

  it("refuses a stale replacement instead of overwriting newer edits", () => {
    const session = new SceneSession(bedroom);
    const alice = client(session, "Alice");
    const bob = client(session, "Bob");
    session.handle(alice.handle, moveBed(0.3, 1, "a1")); // seq 1
    session.handle(bob.handle, load(movedCopy(-1.2), 0, "b-load")); // Bob last synced at seq 0
    expect(bob.last()).toMatchObject({ type: "load-rejected", requestId: "b-load", seq: 1 });
    const rejected = bob.last();
    if (rejected.type === "load-rejected") expect(rejected.message).toContain("Alice");
    expect(session.seq).toBe(1);
    expect(session.scene.furniture.find((item) => item.id === "obj-bed")!.position.x).toBe(0.3);
    expect(alice.inbox.some((message) => message.type === "scene-replaced")).toBe(false);
  });

  it("gives replaced entities newer versions so an edit in flight against the old scene is rejected", () => {
    const session = new SceneSession(bedroom);
    const alice = client(session, "Alice");
    const bob = client(session, "Bob");
    // The imported file carries version 1 for the bed, same as the live scene.
    session.handle(alice.handle, load(movedCopy(0.9), 0));
    expect(session.scene.furniture.find((item) => item.id === "obj-bed")!.version).toBeGreaterThan(1);
    session.handle(bob.handle, moveBed(-0.5, 1, "b1")); // Bob's edit was based on the old scene.
    expect(bob.last()).toMatchObject({ type: "rejected", reason: "stale" });
    expect(session.scene.furniture.find((item) => item.id === "obj-bed")!.position.x).toBe(0.9);
  });

  it("keeps the project's id even if the imported file came from another project", () => {
    const session = new SceneSession({ ...bedroom, id: "project-a" });
    const alice = client(session, "Alice");
    session.handle(alice.handle, load({ ...bedroom, id: "some-other-project" }, 0));
    expect(session.scene.id).toBe("project-a");
  });

  it("rejects a malformed load-scene without touching the scene", () => {
    const session = new SceneSession(bedroom);
    const alice = client(session, "Alice");
    session.handle(alice.handle, { type: "load-scene", requestId: "x", scene: bedroom }); // no baseSeq
    expect(alice.last().type).toBe("error");
    expect(session.seq).toBe(0);
  });
});

describe("open-link joining", () => {
  it("a guest who joins later receives the current scene and sequence, then edits normally", () => {
    const session = new SceneSession(bedroom);
    const owner = client(session, "Owner");
    session.handle(owner.handle, moveBed(0.4, 1, "o1"));
    const guest = client(session, "Guest");
    const welcome = guest.inbox.find((message) => message.type === "welcome");
    expect(welcome).toMatchObject({ seq: 1 });
    if (welcome?.type !== "welcome") return;
    const bed = welcome.scene.furniture.find((item) => item.id === "obj-bed")!;
    expect(bed.position.x).toBe(0.4);
    session.handle(guest.handle, moveBed(-0.4, bed.version, "g1"));
    expect(owner.last()).toMatchObject({ type: "applied", requestId: "g1", clientName: "Guest", seq: 2 });
  });

  it("closeAll tells every client the project is gone and disconnects them", () => {
    const session = new SceneSession(bedroom);
    let closed = 0;
    const inbox: ServerMessage[] = [];
    for (const name of ["A", "B"]) {
      const handle = { send: (message: ServerMessage) => inbox.push(message), close: () => (closed += 1) };
      session.connect(handle);
      session.handle(handle, { type: "hello", sceneId: "t", clientId: name, name, color: "#123456" });
    }
    session.closeAll({ type: "project-deleted" });
    expect(closed).toBe(2);
    expect(inbox.filter((message) => message.type === "project-deleted")).toHaveLength(2);
    expect(session.size).toBe(0);
  });
});

describe("share link access (Can edit / Can view)", () => {
  it("tells each client what it may do when it joins", () => {
    const session = new SceneSession(bedroom);
    const guest = client(session, "Guest");
    expect(guest.inbox.find((message) => message.type === "access")).toEqual({ type: "access", linkAccess: "edit", canEdit: true, owner: false });
  });

  it("rejects edits from view-only guests but lets the owner edit, and nothing changes for the guest", () => {
    const session = new SceneSession(bedroom);
    const owner = client(session, "Owner");
    owner.handle.owner = true;
    const guest = client(session, "Guest");
    session.setLinkAccess("view");
    expect(guest.last()).toEqual({ type: "access", linkAccess: "view", canEdit: false, owner: false });
    expect(owner.last()).toEqual({ type: "access", linkAccess: "view", canEdit: true, owner: true });

    session.handle(guest.handle, moveBed(0.3, 1, "g1"));
    expect(guest.last()).toMatchObject({ type: "rejected", requestId: "g1", reason: "invalid" });
    expect(session.seq).toBe(0);

    session.handle(guest.handle, { type: "load-scene", requestId: "g2", baseSeq: 0, scene: bedroom });
    expect(guest.last()).toMatchObject({ type: "load-rejected", requestId: "g2" });

    session.handle(owner.handle, moveBed(0.3, 1, "o1"));
    expect(session.seq).toBe(1);
    expect(guest.last()).toMatchObject({ type: "applied", requestId: "o1" }); // viewers still see edits live
  });

  it("restores editing for everyone when the link goes back to Can edit", () => {
    const session = new SceneSession(bedroom);
    const guest = client(session, "Guest");
    session.setLinkAccess("view");
    session.setLinkAccess("edit");
    session.handle(guest.handle, moveBed(0.3, 1, "g1"));
    expect(guest.last()).toMatchObject({ type: "applied", requestId: "g1" });
  });
});
