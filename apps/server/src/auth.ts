/**
 * Accounts for Orbis: email + password (scrypt), optional Google sign-in, signed session cookies.
 *
 * Storage is a JSON file in the data directory (the project rule is "no database"; the hosted volume keeps it).
 * Sessions are stateless HMAC-signed cookies, so they survive server restarts. Each user has a `tokenVersion`;
 * bumping it (password reset) invalidates every existing session for that user.
 */
import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual, randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { Request, Response, Router } from "express";
import express from "express";
import { z } from "zod";

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export type User = {
  id: string;
  name: string;
  email: string;
  passwordHash: string | null;
  googleId?: string;
  color: string;
  tokenVersion: number;
  createdAt: string;
  /** Projects this user opened (most recent first), so shared projects show up on their dashboard. */
  recent: string[];
};
export type PublicUser = Pick<User, "id" | "name" | "email" | "color"> & { hasPassword: boolean; google: boolean };

type Store = { users: User[]; resets: { tokenHash: string; userId: string; expires: number }[] };

const COOKIE = "orbis_session";
const LONG_SESSION_S = 60 * 60 * 24 * 30;
const COLORS = ["#6a3de8", "#d9603b", "#3b82d9", "#2f9e6e", "#c2417a", "#c79a1e", "#8a5cd6"];

export const EmailSchema = z.string().trim().toLowerCase().email("Enter a valid email address.").max(160);
export const PasswordSchema = z.string().min(8, "Use at least 8 characters.").max(200);
const SignupSchema = z.object({ name: z.string().trim().min(1, "Enter your name.").max(60), email: EmailSchema, password: PasswordSchema });
const LoginSchema = z.object({ email: EmailSchema, password: z.string().min(1, "Enter your password."), remember: z.boolean().optional() });
const ForgotSchema = z.object({ email: EmailSchema });
const ResetSchema = z.object({ token: z.string().min(20), password: PasswordSchema });
const GoogleSchema = z.object({ credential: z.string().min(20) });

export function publicUser(user: User): PublicUser {
  return { id: user.id, name: user.name, email: user.email, color: user.color, hasPassword: !!user.passwordHash, google: !!user.googleId };
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | null) {
  if (!stored) return false;
  const [kind, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scrypt(password, Buffer.from(salt, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

export class Accounts {
  private store: Store | null = null;
  private writing: Promise<void> = Promise.resolve();
  private secret: Buffer | null = null;
  private attempts = new Map<string, { count: number; until: number }>();

  constructor(private readonly dataRoot: string, private readonly options: { production: boolean; googleClientId: string | null; showResetLinks: boolean }) {}

  private get file() {
    return resolve(this.dataRoot, "users.json");
  }

  private async load(): Promise<Store> {
    if (this.store) return this.store;
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as Partial<Store>;
      this.store = { users: (parsed.users ?? []).map((user) => ({ ...user, recent: user.recent ?? [] })), resets: parsed.resets ?? [] };
    } catch {
      this.store = { users: [], resets: [] };
    }
    return this.store;
  }

  private save() {
    // Serialize writes; each one writes the whole (small) file atomically.
    this.writing = this.writing.then(async () => {
      await mkdir(this.dataRoot, { recursive: true });
      await writeFile(this.file + ".tmp", JSON.stringify(this.store, null, 2));
      await rename(this.file + ".tmp", this.file);
    }).catch((error) => console.error("Could not save accounts", error));
    return this.writing;
  }

  /** Session signing key: ORBIS_SESSION_SECRET, or a random key generated once and kept in the data dir. */
  private async key() {
    if (this.secret) return this.secret;
    if (process.env.ORBIS_SESSION_SECRET) return (this.secret = Buffer.from(process.env.ORBIS_SESSION_SECRET));
    const path = resolve(this.dataRoot, "session.key");
    try {
      this.secret = Buffer.from(await readFile(path, "utf8"), "hex");
    } catch {
      this.secret = randomBytes(32);
      await mkdir(this.dataRoot, { recursive: true });
      await writeFile(path, this.secret.toString("hex"), { mode: 0o600 });
    }
    return this.secret;
  }

  private async sign(user: User, maxAgeS: number) {
    const payload = `${user.id}.${user.tokenVersion}.${Math.floor(Date.now() / 1000) + maxAgeS}`;
    const mac = createHmac("sha256", await this.key()).update(payload).digest("base64url");
    return `${Buffer.from(payload).toString("base64url")}.${mac}`;
  }

  /** The signed-in user for a request (cookie header), or null. Used by REST routes and the WebSocket upgrade. */
  async userFromCookie(cookieHeader: string | undefined): Promise<User | null> {
    const raw = cookieHeader?.split(/;\s*/).find((part) => part.startsWith(COOKIE + "="))?.slice(COOKIE.length + 1);
    if (!raw) return null;
    const [body, mac] = decodeURIComponent(raw).split(".");
    if (!body || !mac) return null;
    const payload = Buffer.from(body, "base64url").toString();
    const expected = createHmac("sha256", await this.key()).update(payload).digest();
    const given = Buffer.from(mac, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const [id, version, expires] = payload.split(".");
    if (!id || Number(expires) * 1000 < Date.now()) return null;
    const user = (await this.load()).users.find((entry) => entry.id === id);
    return user && String(user.tokenVersion) === version ? user : null;
  }

  async userFor(request: Request) {
    return this.userFromCookie(request.headers.cookie);
  }

  private async startSession(request: Request, response: Response, user: User, remember = true) {
    const maxAge = remember ? LONG_SESSION_S : 60 * 60 * 12;
    const secure = request.secure ? "; Secure" : "";
    response.setHeader("Set-Cookie", `${COOKIE}=${encodeURIComponent(await this.sign(user, maxAge))}; Path=/; HttpOnly; SameSite=Lax${secure}${remember ? `; Max-Age=${maxAge}` : ""}`);
  }

  /** Records that a signed-in user opened a project (for "shared with me" on their dashboard). */
  async touchProject(user: User, projectId: string) {
    if (user.recent[0] === projectId) return;
    user.recent = [projectId, ...user.recent.filter((id) => id !== projectId)].slice(0, 100);
    await this.save();
  }

  async forgetProject(projectId: string) {
    const store = await this.load();
    let changed = false;
    for (const user of store.users) {
      if (user.recent.includes(projectId)) {
        user.recent = user.recent.filter((id) => id !== projectId);
        changed = true;
      }
    }
    if (changed) await this.save();
  }

  /** Simple brute-force brake: 8 failed logins per email+IP per 10 minutes. */
  private limited(key: string) {
    const entry = this.attempts.get(key);
    return !!entry && entry.count >= 8 && entry.until > Date.now();
  }
  private failed(key: string) {
    const entry = this.attempts.get(key);
    const fresh = !entry || entry.until < Date.now();
    this.attempts.set(key, { count: fresh ? 1 : entry!.count + 1, until: fresh ? Date.now() + 10 * 60_000 : entry!.until });
  }

  router(): Router {
    const router = express.Router();
    const fail = (response: Response, status: number, error: string, field?: string) => response.status(status).json({ error, field });
    const firstIssue = (error: z.ZodError) => ({ message: error.issues[0]?.message ?? "Invalid input.", field: String(error.issues[0]?.path[0] ?? "") || undefined });

    router.get("/config", (_request, response) => {
      response.json({ google: this.options.googleClientId, resetLinksVisible: this.options.showResetLinks });
    });

    router.get("/me", async (request, response) => {
      const user = await this.userFor(request);
      response.json({ user: user ? publicUser(user) : null });
    });

    router.post("/signup", async (request, response) => {
      const parsed = SignupSchema.safeParse(request.body);
      if (!parsed.success) { const issue = firstIssue(parsed.error); return fail(response, 400, issue.message, issue.field); }
      const store = await this.load();
      if (store.users.some((user) => user.email === parsed.data.email)) return fail(response, 409, "An account with this email already exists. Try logging in.", "email");
      const user: User = {
        id: "u_" + randomUUID().replace(/-/g, "").slice(0, 16),
        name: parsed.data.name,
        email: parsed.data.email,
        passwordHash: await hashPassword(parsed.data.password),
        color: COLORS[store.users.length % COLORS.length]!,
        tokenVersion: 1,
        createdAt: new Date().toISOString(),
        recent: [],
      };
      store.users.push(user);
      await this.save();
      await this.startSession(request, response, user, true);
      response.status(201).json({ user: publicUser(user) });
    });

    router.post("/login", async (request, response) => {
      const parsed = LoginSchema.safeParse(request.body);
      if (!parsed.success) { const issue = firstIssue(parsed.error); return fail(response, 400, issue.message, issue.field); }
      const key = parsed.data.email + "|" + request.ip;
      if (this.limited(key)) return fail(response, 429, "Too many attempts. Wait a few minutes and try again.");
      const user = (await this.load()).users.find((entry) => entry.email === parsed.data.email);
      if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
        this.failed(key);
        return fail(response, 401, user && !user.passwordHash ? "This account uses Google sign-in." : "Email or password is incorrect.");
      }
      this.attempts.delete(key);
      await this.startSession(request, response, user, parsed.data.remember ?? true);
      response.json({ user: publicUser(user) });
    });

    router.post("/logout", (request, response) => {
      response.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${request.secure ? "; Secure" : ""}`);
      response.json({ ok: true });
    });

    router.post("/profile", async (request, response) => {
      const user = await this.userFor(request);
      if (!user) return fail(response, 401, "Sign in first.");
      const parsed = z.object({ name: z.string().trim().min(1, "Enter your name.").max(60), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) }).safeParse(request.body);
      if (!parsed.success) { const issue = firstIssue(parsed.error); return fail(response, 400, issue.message, issue.field); }
      user.name = parsed.data.name;
      user.color = parsed.data.color;
      await this.save();
      response.json({ user: publicUser(user) });
    });

    router.post("/forgot", async (request, response) => {
      const parsed = ForgotSchema.safeParse(request.body);
      if (!parsed.success) { const issue = firstIssue(parsed.error); return fail(response, 400, issue.message, issue.field); }
      const store = await this.load();
      const user = store.users.find((entry) => entry.email === parsed.data.email);
      let resetUrl: string | undefined;
      if (user) {
        const token = randomBytes(32).toString("base64url");
        store.resets = store.resets.filter((entry) => entry.expires > Date.now() && entry.userId !== user.id);
        store.resets.push({ tokenHash: createHash("sha256").update(token).digest("hex"), userId: user.id, expires: Date.now() + 30 * 60_000 });
        await this.save();
        const origin = `${request.protocol}://${request.get("host")}`;
        resetUrl = `${origin}/reset-password?token=${token}`;
        // No email provider is configured: the link goes to the server log (and to the page in dev/demo mode).
        console.log(`[orbis] Password reset link for ${user.email}: ${resetUrl}`);
      }
      // Same answer whether or not the account exists, so emails can't be probed.
      response.json({ ok: true, ...(this.options.showResetLinks && resetUrl ? { resetUrl } : {}) });
    });

    router.post("/reset", async (request, response) => {
      const parsed = ResetSchema.safeParse(request.body);
      if (!parsed.success) { const issue = firstIssue(parsed.error); return fail(response, 400, issue.message, issue.field); }
      const store = await this.load();
      const hash = createHash("sha256").update(parsed.data.token).digest("hex");
      const entry = store.resets.find((reset) => reset.tokenHash === hash && reset.expires > Date.now());
      const user = entry && store.users.find((candidate) => candidate.id === entry.userId);
      if (!entry || !user) return fail(response, 400, "This reset link is invalid or has expired. Request a new one.");
      user.passwordHash = await hashPassword(parsed.data.password);
      user.tokenVersion += 1; // signs out every other session
      store.resets = store.resets.filter((reset) => reset !== entry);
      await this.save();
      await this.startSession(request, response, user, true);
      response.json({ user: publicUser(user) });
    });

    router.post("/google", async (request, response) => {
      const clientId = this.options.googleClientId;
      if (!clientId) return fail(response, 404, "Google sign-in is not configured.");
      const parsed = GoogleSchema.safeParse(request.body);
      if (!parsed.success) return fail(response, 400, "Missing Google credential.");
      // Google verifies the ID token's signature and expiry; we check it was issued for this app.
      const check = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(parsed.data.credential)).catch(() => null);
      const info = check?.ok ? ((await check.json()) as { aud?: string; sub?: string; email?: string; email_verified?: string; name?: string }) : null;
      if (!info || info.aud !== clientId || !info.sub || !info.email || info.email_verified !== "true") return fail(response, 401, "Google sign-in failed. Try again.");
      const store = await this.load();
      const email = info.email.toLowerCase();
      let user = store.users.find((entry) => entry.googleId === info.sub) ?? store.users.find((entry) => entry.email === email);
      if (user) {
        user.googleId = info.sub;
      } else {
        user = { id: "u_" + randomUUID().replace(/-/g, "").slice(0, 16), name: info.name ?? email.split("@")[0]!, email, passwordHash: null, googleId: info.sub, color: COLORS[store.users.length % COLORS.length]!, tokenVersion: 1, createdAt: new Date().toISOString(), recent: [] };
        store.users.push(user);
      }
      await this.save();
      await this.startSession(request, response, user, true);
      response.json({ user: publicUser(user) });
    });

    return router;
  }
}
