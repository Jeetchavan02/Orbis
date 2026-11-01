import { localStorage } from "./storage.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { Accounts, hashPassword, verifyPassword } from "./auth.js";

const dir = mkdtempSync(join(tmpdir(), "orbis-auth-"));
let server: Server;
let base = "";
const logs: string[] = [];

async function call(path: string, body?: unknown, cookie?: string) {
  const response = await fetch(base + "/api/auth/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, any>, cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "" };
}

beforeAll(async () => {
  const original = console.log;
  console.log = (...args: unknown[]) => { logs.push(args.join(" ")); };
  const app = express();
  app.use(express.json());
  app.use("/api/auth", new Accounts(dir, localStorage(dir).accounts, { production: false, googleClientId: null, showResetLinks: true }).router());
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  afterAll(() => { console.log = original; });
});
afterAll(() => {
  server?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("password hashing", () => {
  it("verifies the right password and rejects a wrong one", async () => {
    const stored = await hashPassword("correct horse");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(stored).not.toContain("correct horse");
    expect(await verifyPassword("correct horse", stored)).toBe(true);
    expect(await verifyPassword("wrong horse", stored)).toBe(false);
  });
});

describe("accounts", () => {
  let session = "";

  it("signs up, starts a session and recognises it", async () => {
    const signup = await call("signup", { name: "Meet", email: "Meet@Example.com", password: "orbit-2026" });
    expect(signup.status).toBe(201);
    expect(signup.body.user).toMatchObject({ name: "Meet", email: "meet@example.com" });
    expect(signup.cookie).toMatch(/^orbis_session=/);
    session = signup.cookie;
    expect((await call("me", undefined, session)).body.user?.email).toBe("meet@example.com");
    expect((await call("me")).body.user).toBeNull();
  });

  it("rejects duplicate emails, short passwords and bad emails with the field to fix", async () => {
    expect(await call("signup", { name: "X", email: "meet@example.com", password: "orbit-2026" })).toMatchObject({ status: 409, body: { field: "email" } });
    expect(await call("signup", { name: "X", email: "x@example.com", password: "short" })).toMatchObject({ status: 400, body: { field: "password" } });
    expect(await call("signup", { name: "X", email: "not-an-email", password: "orbit-2026" })).toMatchObject({ status: 400, body: { field: "email" } });
  });

  it("logs in with the right password only", async () => {
    expect((await call("login", { email: "meet@example.com", password: "nope-nope" })).status).toBe(401);
    const ok = await call("login", { email: "MEET@example.com", password: "orbit-2026" });
    expect(ok.status).toBe(200);
    expect(ok.cookie).toMatch(/^orbis_session=/);
  });

  it("rejects a tampered session cookie", async () => {
    const tampered = session.slice(0, -3) + (session.endsWith("A") ? "BBB" : "AAA");
    expect((await call("me", undefined, tampered)).body.user).toBeNull();
  });

  it("resets a password with a one-time link and signs out old sessions", async () => {
    const forgot = await call("forgot", { email: "meet@example.com" });
    expect(forgot.status).toBe(200);
    const token = new URL(forgot.body.resetUrl as string).searchParams.get("token")!;
    expect(logs.some((line) => line.includes("Password reset link"))).toBe(true);
    // Unknown emails get the same answer (no account probing) and no link.
    expect((await call("forgot", { email: "nobody@example.com" })).body).toEqual({ ok: true });
    const reset = await call("reset", { token, password: "new-orbit-2026" });
    expect(reset.status).toBe(200);
    expect((await call("me", undefined, session)).body.user).toBeNull(); // old session revoked
    expect((await call("reset", { token, password: "again-orbit-2026" })).status).toBe(400); // single use
    expect((await call("login", { email: "meet@example.com", password: "new-orbit-2026" })).status).toBe(200);
  });

  it("slows down repeated wrong passwords", async () => {
    let last = 0;
    for (let i = 0; i < 9; i += 1) last = (await call("login", { email: "meet@example.com", password: "wrong-" + i })).status;
    expect(last).toBe(429);
  });

  it("reports that Google sign-in is off without a client id", async () => {
    expect((await call("config")).body.google).toBeNull();
    expect((await call("google", { credential: "x".repeat(30) })).status).toBe(404);
  });
});
