import { saveDefaultProfile } from "./collab";

export type Me = { id: string; name: string; email: string; color: string; hasPassword: boolean; google: boolean };
export type AuthConfig = { google: string | null; resetLinksVisible: boolean };

/** Error from an auth endpoint; `field` names the input it belongs to, when there is one. */
export class AuthError extends Error {
  constructor(message: string, readonly field?: string, readonly status?: number) {
    super(message);
  }
}

export async function authFetch<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/api/auth/" + path, body === undefined ? { credentials: "same-origin" } : {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthError("Can't reach the Orbis server. Check your connection and try again.");
  }
  const payload = (await response.json().catch(() => ({}))) as { error?: string; field?: string };
  if (!response.ok) throw new AuthError(payload.error ?? `Request failed (${response.status}).`, payload.field, response.status);
  return payload as T;
}

let mePromise: Promise<Me | null> | null = null;
/** The signed-in user (cached for the page's lifetime). */
export function fetchMe(): Promise<Me | null> {
  mePromise ??= authFetch<{ user: Me | null }>("me").then((data) => data.user, () => null);
  return mePromise;
}

/** Collaborators see your account name and colour; no separate guest name needed. */
export function applyIdentity(user: Me) {
  saveDefaultProfile(user.name, user.color);
}

export async function logout() {
  await authFetch("logout", {}).catch(() => undefined);
  try {
    localStorage.removeItem("rb.profile");
    sessionStorage.removeItem("rb.identity");
  } catch {
    // ignore
  }
  location.assign("/login");
}

/** 0–4 with a label, for the signup strength meter. Length matters most. */
export function passwordStrength(password: string): { score: number; label: string } {
  if (!password) return { score: 0, label: "" };
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score += 1;
  else if (/\d|[^A-Za-z0-9]/.test(password) && password.length >= 10) score += 0.5;
  if (password.length < 8) score = Math.min(score, 1);
  const rounded = Math.max(1, Math.min(4, Math.round(score)));
  return { score: rounded, label: ["", "Weak", "Fair", "Good", "Strong"][rounded]! };
}

/** Where to go after signing in: ?next= when it is a same-site path, else the dashboard. */
export function nextPath() {
  const next = new URLSearchParams(location.search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}
