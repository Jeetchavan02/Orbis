/**
 * Persistence backends. The server talks to three small interfaces and never to the disk or AWS directly:
 *
 *  - BlobStore     large documents and files: scene JSON, thumbnails, uploaded images/models, PDF reports
 *  - ProjectIndex  per-project records: owner key hash, owner account, link access, list summary
 *  - AccountStore  users and password-reset tokens
 *
 * RB_STORAGE=local (default) keeps the original layout in RB_DATA_DIR, so existing data and dev setups are unchanged.
 * RB_STORAGE=aws uses S3 (RB_S3_BUCKET) for blobs and DynamoDB (RB_DDB_PREFIX + -projects/-users/-resets) for records.
 * Credentials come from the EC2 instance role; nothing AWS-related ever reaches the browser.
 *
 * Blob keys use the S3 layout ("projects/<id>/scene.json"); the local store maps them back onto the old paths.
 */
import { createReadStream, existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Readable } from "node:stream";

export type LinkAccess = "edit" | "view";

export type ProjectMeta = {
  id: string;
  ownerKeyHash?: string;
  ownerUserId?: string;
  linkAccess?: LinkAccess;
  /** List summary, refreshed on every save so the dashboard doesn't have to read whole scenes. */
  name?: string;
  roomType?: string;
  objects?: number;
  floors?: number;
  updatedAt?: string;
  thumbnailAt?: number;
};

export type StoredUser = {
  id: string;
  name: string;
  email: string;
  passwordHash: string | null;
  googleId?: string;
  color: string;
  tokenVersion: number;
  createdAt: string;
  recent: string[];
};
export type ResetToken = { tokenHash: string; userId: string; expires: number };
export type AccountData = { users: StoredUser[]; resets: ResetToken[] };

export interface BlobStore {
  get(key: string): Promise<Buffer | null>;
  put(key: string, body: Buffer | string, contentType: string, metadata?: Record<string, string>): Promise<void>;
  delete(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  /** Last-modified time, or null when missing. */
  stat(key: string): Promise<Date | null>;
  open(key: string): Promise<{ body: Readable; length?: number } | null>;
  /** Short-lived direct download link (S3 presigned GET); null when the server should stream the file itself. */
  downloadUrl(key: string, filename: string, contentType: string): Promise<string | null>;
}

export interface ProjectIndex {
  get(id: string): Promise<ProjectMeta | null>;
  /** Merges the given fields; `null` removes a field. Creates the record if needed. */
  update(id: string, patch: { [K in keyof ProjectMeta]?: ProjectMeta[K] | null }): Promise<void>;
  remove(id: string): Promise<void>;
  /** Every project id (only used outside public mode). */
  ids(): Promise<string[]>;
  ownedBy(userId: string): Promise<string[]>;
}

export interface AccountStore {
  load(): Promise<AccountData>;
  /** Persists the whole account state; implementations write only what changed. */
  save(data: AccountData): Promise<void>;
}

export interface JobQueue {
  /** Hands work to the background worker; returns false when no queue is configured (caller does it inline). */
  send(job: { type: "delete-project"; projectId: string }): Promise<boolean>;
}

export type Storage = { kind: "local" | "aws"; blobs: BlobStore; projects: ProjectIndex; accounts: AccountStore; jobs: JobQueue; describe: string };

export const sceneKey = (id: string) => `projects/${id}/scene.json`;
export const thumbnailKey = (id: string) => `projects/${id}/thumbnail.jpg`;
export const reportKey = (id: string, file: string) => `projects/${id}/reports/${file}`;
export const assetKey = (file: string) => `assets/${file}`;

// ---------------------------------------------------------------- local (data directory) ----------

async function writeAtomic(path: string, body: Buffer | string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path + ".tmp", body);
  await rename(path + ".tmp", path);
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

class LocalBlobs implements BlobStore {
  constructor(private readonly root: string) {}

  /** Keeps the original data-dir layout (scenes/<id>.json, thumbnails/<id>.jpg) so existing projects load as-is. */
  path(key: string) {
    const scene = /^projects\/([^/]+)\/scene\.json$/.exec(key);
    if (scene) return resolve(this.root, "scenes", scene[1] + ".json");
    const thumb = /^projects\/([^/]+)\/thumbnail\.jpg$/.exec(key);
    if (thumb) return resolve(this.root, "thumbnails", thumb[1] + ".jpg");
    return resolve(this.root, key);
  }
  async get(key: string) {
    return readFile(this.path(key)).catch(() => null);
  }
  async put(key: string, body: Buffer | string) {
    await writeAtomic(this.path(key), body);
  }
  async delete(key: string) {
    await unlink(this.path(key)).catch(() => undefined);
  }
  async deletePrefix(prefix: string) {
    const id = /^projects\/([^/]+)\/$/.exec(prefix)?.[1];
    if (id) {
      await this.delete(sceneKey(id));
      await this.delete(thumbnailKey(id));
    }
    await rm(resolve(this.root, prefix), { recursive: true, force: true });
  }
  async copy(from: string, to: string) {
    if (!existsSync(this.path(from))) return;
    await mkdir(dirname(this.path(to)), { recursive: true });
    await copyFile(this.path(from), this.path(to));
  }
  async stat(key: string) {
    return stat(this.path(key)).then((info) => info.mtime, () => null);
  }
  async open(key: string) {
    const info = await stat(this.path(key)).catch(() => null);
    return info?.isFile() ? { body: createReadStream(this.path(key)), length: info.size } : null;
  }
  async downloadUrl() {
    return null;
  }
}

/** The three original JSON maps (owners.json, project-owners.json, link-access.json), kept for compatibility. */
class LocalProjects implements ProjectIndex {
  private maps: { keys: Record<string, string>; users: Record<string, string>; access: Record<string, LinkAccess> } | null = null;
  private writing = Promise.resolve();
  constructor(private readonly root: string) {}

  private file(name: "keys" | "users" | "access") {
    return resolve(this.root, { keys: "owners.json", users: "project-owners.json", access: "link-access.json" }[name]);
  }
  private async load() {
    this.maps ??= {
      keys: await readJson(this.file("keys"), {}),
      users: await readJson(this.file("users"), {}),
      access: await readJson(this.file("access"), {}),
    };
    return this.maps;
  }
  async get(id: string) {
    const maps = await this.load();
    const meta: ProjectMeta = { id };
    if (maps.keys[id]) meta.ownerKeyHash = maps.keys[id];
    if (maps.users[id]) meta.ownerUserId = maps.users[id];
    if (maps.access[id]) meta.linkAccess = maps.access[id];
    return meta;
  }
  async update(id: string, patch: Parameters<ProjectIndex["update"]>[1]) {
    const maps = await this.load();
    const touched = new Set<"keys" | "users" | "access">();
    const set = <T extends string>(map: Record<string, T>, name: "keys" | "users" | "access", value: T | null | undefined) => {
      if (value === undefined) return;
      if (value === null) delete map[id];
      else map[id] = value;
      touched.add(name);
    };
    set(maps.keys, "keys", patch.ownerKeyHash);
    set(maps.users, "users", patch.ownerUserId);
    // "edit" is the default and is not stored, as before.
    if (patch.linkAccess !== undefined) set(maps.access, "access", patch.linkAccess === "view" ? "view" : null);
    await this.flush(touched);
  }
  async remove(id: string) {
    await this.update(id, { ownerKeyHash: null, ownerUserId: null, linkAccess: null });
  }
  private flush(names: Set<"keys" | "users" | "access">) {
    this.writing = this.writing.then(async () => {
      for (const name of names) await writeAtomic(this.file(name), JSON.stringify(this.maps![name], null, 2));
    });
    return this.writing;
  }
  async ids() {
    const files = await readdir(resolve(this.root, "scenes")).catch(() => [] as string[]);
    return files.filter((file) => file.endsWith(".json")).map((file) => file.replace(/\.json$/, ""));
  }
  async ownedBy(userId: string) {
    return Object.entries((await this.load()).users).filter(([, owner]) => owner === userId).map(([id]) => id);
  }
}

class LocalAccounts implements AccountStore {
  private writing = Promise.resolve();
  constructor(private readonly root: string) {}
  async load() {
    const parsed = await readJson<Partial<AccountData>>(resolve(this.root, "users.json"), {});
    return { users: (parsed.users ?? []).map((user) => ({ ...user, recent: user.recent ?? [] })), resets: parsed.resets ?? [] };
  }
  save(data: AccountData) {
    // Serialized; each write replaces the whole (small) file atomically.
    this.writing = this.writing.then(() => writeAtomic(resolve(this.root, "users.json"), JSON.stringify(data, null, 2)));
    return this.writing;
  }
}

export function localStorage(root: string): Storage {
  return {
    kind: "local",
    blobs: new LocalBlobs(root),
    projects: new LocalProjects(root),
    accounts: new LocalAccounts(root),
    jobs: { send: async () => false },
    describe: "data in " + root,
  };
}

// ---------------------------------------------------------------- AWS (S3 + DynamoDB + SQS) ----------

export type AwsConfig = { bucket: string; tablePrefix: string; queueUrl?: string; region?: string; endpoint?: string };

export async function awsStorage(config: AwsConfig): Promise<Storage> {
  // Loaded only in AWS mode so local development never needs the SDK configured.
  const s3sdk = await import("@aws-sdk/client-s3");
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
  const { DynamoDBClient } = await import("@aws-sdk/client-dynamodb");
  const ddbLib = await import("@aws-sdk/lib-dynamodb");
  const common = { region: config.region, ...(config.endpoint ? { endpoint: config.endpoint } : {}) };
  const s3 = new s3sdk.S3Client({ ...common, forcePathStyle: !!config.endpoint });
  const ddb = ddbLib.DynamoDBDocumentClient.from(new DynamoDBClient(common), { marshallOptions: { removeUndefinedValues: true } });
  const tables = { projects: config.tablePrefix + "-projects", users: config.tablePrefix + "-users", resets: config.tablePrefix + "-resets" };
  const Bucket = config.bucket;
  const missing = (error: unknown) => ["NoSuchKey", "NotFound"].includes((error as { name?: string }).name ?? "");

  const blobs: BlobStore = {
    async get(key) {
      try {
        const result = await s3.send(new s3sdk.GetObjectCommand({ Bucket, Key: key }));
        return Buffer.from(await result.Body!.transformToByteArray());
      } catch (error) {
        if (missing(error)) return null;
        throw error;
      }
    },
    async put(key, body, contentType, metadata) {
      await s3.send(new s3sdk.PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType, Metadata: metadata }));
    },
    async delete(key) {
      await s3.send(new s3sdk.DeleteObjectCommand({ Bucket, Key: key }));
    },
    async deletePrefix(prefix) {
      let token: string | undefined;
      do {
        const page = await s3.send(new s3sdk.ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken: token }));
        const keys = (page.Contents ?? []).map((item) => ({ Key: item.Key! }));
        if (keys.length) await s3.send(new s3sdk.DeleteObjectsCommand({ Bucket, Delete: { Objects: keys, Quiet: true } }));
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
    },
    async copy(from, to) {
      try {
        await s3.send(new s3sdk.CopyObjectCommand({ Bucket, Key: to, CopySource: `${Bucket}/${encodeURIComponent(from)}` }));
      } catch (error) {
        if (!missing(error) && (error as { name?: string }).name !== "NoSuchKey") throw error;
      }
    },
    async stat(key) {
      try {
        return (await s3.send(new s3sdk.HeadObjectCommand({ Bucket, Key: key }))).LastModified ?? new Date();
      } catch (error) {
        if (missing(error)) return null;
        throw error;
      }
    },
    async open(key) {
      try {
        const result = await s3.send(new s3sdk.GetObjectCommand({ Bucket, Key: key }));
        return { body: result.Body as Readable, length: result.ContentLength };
      } catch (error) {
        if (missing(error)) return null;
        throw error;
      }
    },
    async downloadUrl(key, filename, contentType) {
      const command = new s3sdk.GetObjectCommand({ Bucket, Key: key, ResponseContentType: contentType, ResponseContentDisposition: `attachment; filename="${filename.replace(/"/g, "")}"` });
      return getSignedUrl(s3, command, { expiresIn: 15 * 60 });
    },
  };

  const projects: ProjectIndex = {
    async get(id) {
      return ((await ddb.send(new ddbLib.GetCommand({ TableName: tables.projects, Key: { id } }))).Item as ProjectMeta | undefined) ?? null;
    },
    async update(id, patch) {
      const sets: string[] = [];
      const removes: string[] = [];
      const names: Record<string, string> = {};
      const values: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(patch)) {
        if (value === undefined || field === "id") continue;
        names["#" + field] = field;
        if (value === null) removes.push("#" + field);
        else {
          sets.push(`#${field} = :${field}`);
          values[":" + field] = value;
        }
      }
      if (!sets.length && !removes.length) return;
      await ddb.send(new ddbLib.UpdateCommand({
        TableName: tables.projects,
        Key: { id },
        UpdateExpression: [sets.length ? "SET " + sets.join(", ") : "", removes.length ? "REMOVE " + removes.join(", ") : ""].join(" ").trim(),
        ExpressionAttributeNames: names,
        ...(Object.keys(values).length ? { ExpressionAttributeValues: values } : {}),
      }));
    },
    async remove(id) {
      await ddb.send(new ddbLib.DeleteCommand({ TableName: tables.projects, Key: { id } }));
    },
    async ids() {
      const ids: string[] = [];
      let start: Record<string, unknown> | undefined;
      do {
        const page = await ddb.send(new ddbLib.ScanCommand({ TableName: tables.projects, ProjectionExpression: "id, updatedAt", ExclusiveStartKey: start }));
        for (const item of page.Items ?? []) if (item.updatedAt) ids.push(String(item.id));
        start = page.LastEvaluatedKey;
      } while (start);
      return ids;
    },
    async ownedBy(userId) {
      const ids: string[] = [];
      let start: Record<string, unknown> | undefined;
      do {
        const page = await ddb.send(new ddbLib.QueryCommand({
          TableName: tables.projects, IndexName: "byOwner", KeyConditionExpression: "ownerUserId = :user",
          ExpressionAttributeValues: { ":user": userId }, ProjectionExpression: "id", ExclusiveStartKey: start,
        }));
        for (const item of page.Items ?? []) ids.push(String(item.id));
        start = page.LastEvaluatedKey;
      } while (start);
      return ids;
    },
  };

  // Users are few and read on every request, so the server keeps them in memory (it is the only writer) and
  // writes back just the items whose JSON changed since the last save.
  const written = { users: new Map<string, string>(), resets: new Map<string, string>() };
  const scanAll = async (TableName: string) => {
    const items: Record<string, unknown>[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const page = await ddb.send(new ddbLib.ScanCommand({ TableName, ExclusiveStartKey: start }));
      items.push(...(page.Items ?? []));
      start = page.LastEvaluatedKey;
    } while (start);
    return items;
  };
  let writing = Promise.resolve();
  const accounts: AccountStore = {
    async load() {
      const users = (await scanAll(tables.users)).map((item) => ({ ...(item as StoredUser), recent: (item as StoredUser).recent ?? [] }));
      const resets = (await scanAll(tables.resets)) as ResetToken[];
      for (const user of users) written.users.set(user.id, JSON.stringify(user));
      for (const reset of resets) written.resets.set(reset.tokenHash, JSON.stringify(reset));
      return { users, resets };
    },
    save(data) {
      const sync = async <T>(table: string, key: string, items: T[], idOf: (item: T) => string, seen: Map<string, string>, extra?: (item: T) => Record<string, unknown>) => {
        const current = new Set<string>();
        for (const item of items) {
          const id = idOf(item);
          current.add(id);
          const json = JSON.stringify(item);
          if (seen.get(id) === json) continue;
          await ddb.send(new ddbLib.PutCommand({ TableName: table, Item: { ...(item as Record<string, unknown>), ...extra?.(item) } }));
          seen.set(id, json);
        }
        for (const id of [...seen.keys()]) {
          if (current.has(id)) continue;
          await ddb.send(new ddbLib.DeleteCommand({ TableName: table, Key: { [key]: id } }));
          seen.delete(id);
        }
      };
      writing = writing.then(async () => {
        await sync(tables.users, "id", data.users, (user) => user.id, written.users);
        // `ttl` (seconds) lets DynamoDB expire stale reset tokens on its own.
        await sync(tables.resets, "tokenHash", data.resets, (reset) => reset.tokenHash, written.resets, (reset) => ({ ttl: Math.ceil(reset.expires / 1000) + 86400 }));
      });
      return writing;
    },
  };

  let jobs: JobQueue = { send: async () => false };
  if (config.queueUrl) {
    const { SQSClient, SendMessageCommand } = await import("@aws-sdk/client-sqs");
    const sqs = new SQSClient(common);
    jobs = {
      async send(job) {
        await sqs.send(new SendMessageCommand({ QueueUrl: config.queueUrl, MessageBody: JSON.stringify(job) }));
        return true;
      },
    };
  }

  return { kind: "aws", blobs, projects, accounts, jobs, describe: `s3://${Bucket} + DynamoDB ${config.tablePrefix}-*${config.queueUrl ? " + SQS" : ""}` };
}

/** Picks the backend from the environment. */
export async function createStorage(dataRoot: string): Promise<Storage> {
  if ((process.env.RB_STORAGE ?? "local") !== "aws") return localStorage(dataRoot);
  const bucket = process.env.RB_S3_BUCKET?.trim();
  if (!bucket) throw new Error("RB_STORAGE=aws needs RB_S3_BUCKET.");
  return awsStorage({
    bucket,
    tablePrefix: process.env.RB_DDB_PREFIX?.trim() || "orbis",
    queueUrl: process.env.RB_JOBS_QUEUE_URL?.trim() || undefined,
    region: process.env.AWS_REGION,
    endpoint: process.env.RB_AWS_ENDPOINT?.trim() || undefined,
  });
}
