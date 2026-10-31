import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SceneSchema, type ServerMessage } from "@reality-builder/shared";
import { SceneSession } from "./sessions.js";

const bedroom = SceneSchema.parse(JSON.parse(readFileSync(resolve(process.cwd(), "fixtures/bedroom-scene.json"), "utf8")));

function client(session: SceneSession, name: string) {
  const inbox: ServerMessage[] = [];
  const handle = { send: (message: ServerMessage) => inbox.push(message) };
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
});
