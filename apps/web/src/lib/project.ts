/**
 * Project routing and the projects this browser knows about.
 *
 * Share links look like /project/<id>. Older /?scene=<id> links keep working.
 * Anyone with the link can open and edit the project (open-link collaboration). The homepage only lists projects
 * this browser created or opened, so a public server never shows strangers each other's work.
 */
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const KNOWN_KEY = "rb.projects";
const OWNER_KEY = "rb.owner-keys";

export function currentProjectId(): string | null {
  const match = /^\/project\/([^/]+)\/?$/.exec(location.pathname);
  const id = match ? decodeURIComponent(match[1]!) : new URLSearchParams(location.search).get("scene");
  return id && ID_PATTERN.test(id) ? id : null;
}

export const projectPath = (id: string) => `/project/${encodeURIComponent(id)}`;
export const projectUrl = (id: string) => location.origin + projectPath(id);

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked (private mode): the project still works, it just won't be listed on this browser's homepage.
  }
}

/** Ids of projects created or opened in this browser, most recent first. */
export function knownProjects(): string[] {
  const ids = read<unknown>(KNOWN_KEY, []);
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string" && ID_PATTERN.test(id)) : [];
}

export function rememberProject(id: string, ownerKey?: string) {
  write(KNOWN_KEY, [id, ...knownProjects().filter((known) => known !== id)].slice(0, 200));
  if (ownerKey) write(OWNER_KEY, { ...read<Record<string, string>>(OWNER_KEY, {}), [id]: ownerKey });
}

export function forgetProject(id: string) {
  write(KNOWN_KEY, knownProjects().filter((known) => known !== id));
  const keys = read<Record<string, string>>(OWNER_KEY, {});
  delete keys[id];
  write(OWNER_KEY, keys);
}

/** Secret returned when this browser created the project; required by the server to delete it. */
export function ownerKeyFor(id: string): string | null {
  return read<Record<string, string>>(OWNER_KEY, {})[id] ?? null;
}

export function openProject(id: string, ownerKey?: string) {
  rememberProject(id, ownerKey);
  location.assign(projectPath(id));
}
