/**
 * Copies existing local data (RB_DATA_DIR, default server/data) into S3 + DynamoDB. Read-only on the source,
 * idempotent (safe to run again; it overwrites the cloud copy with the local one), and prints what it did.
 *
 *   RB_S3_BUCKET=<bucket> AWS_REGION=<region> npm run aws:migrate
 *   ... -- --dry-run          list what would be copied
 *   ... -- --create-tables    create the DynamoDB tables + bucket first (LocalStack testing only; on AWS the
 *                             CloudFormation stack creates them)
 *
 * Set RB_AWS_ENDPOINT=http://localhost:4566 to target LocalStack.
 */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SceneSchema } from "@reality-builder/shared";
import { assetKey, awsStorage, localStorage, sceneKey, thumbnailKey } from "../src/storage.js";

const here = dirname(fileURLToPath(import.meta.url));
const source = process.env.RB_DATA_DIR ? resolve(process.env.RB_DATA_DIR) : resolve(here, "../data");
const bucket = process.env.RB_S3_BUCKET;
const prefix = process.env.RB_DDB_PREFIX || "orbis";
const endpoint = process.env.RB_AWS_ENDPOINT || undefined;
const dryRun = process.argv.includes("--dry-run");
if (!bucket) throw new Error("Set RB_S3_BUCKET (the DataBucketName output of the stack).");
if (!existsSync(source)) throw new Error("No data directory at " + source);

if (process.argv.includes("--create-tables")) await createTables();

const local = localStorage(source);
const cloud = await awsStorage({ bucket, tablePrefix: prefix, region: process.env.AWS_REGION, endpoint });
const log = (line: string) => console.log((dryRun ? "[dry run] " : "") + line);
let copied = { projects: 0, thumbnails: 0, assets: 0, users: 0, skipped: 0 };

for (const id of await local.projects.ids()) {
  const bytes = await local.blobs.get(sceneKey(id));
  const parsed = bytes ? SceneSchema.safeParse(JSON.parse(bytes.toString("utf8"))) : null;
  if (!parsed?.success) {
    log(`skip ${id}: scene is unreadable or fails the schema`);
    copied.skipped += 1;
    continue;
  }
  const scene = parsed.data;
  const meta = await local.projects.get(id);
  const modified = (await local.blobs.stat(sceneKey(id)))!.toISOString();
  const thumb = await local.blobs.get(thumbnailKey(id));
  log(`project ${id} "${scene.name}" (${scene.furniture.length} objects)${thumb ? " + thumbnail" : ""}`);
  if (dryRun) continue;
  await cloud.blobs.put(sceneKey(id), bytes!, "application/json");
  await cloud.projects.update(id, {
    ownerKeyHash: meta?.ownerKeyHash, ownerUserId: meta?.ownerUserId, linkAccess: meta?.linkAccess,
    name: scene.name, roomType: scene.roomType ?? (scene.rooms.length > 1 ? "apartment" : "bedroom"),
    objects: scene.furniture.length, floors: scene.rooms.length, updatedAt: modified,
    thumbnailAt: thumb ? (await local.blobs.stat(thumbnailKey(id)))!.getTime() : undefined,
  });
  if (thumb) {
    await cloud.blobs.put(thumbnailKey(id), thumb, "image/jpeg");
    copied.thumbnails += 1;
  }
  copied.projects += 1;
}

const assetDir = resolve(source, "assets");
for (const file of existsSync(assetDir) ? await readdir(assetDir) : []) {
  if (!/^[a-z0-9-]{8,64}\.(png|jpg|webp|glb)$/.test(file)) continue;
  log(`asset ${file}`);
  if (dryRun) continue;
  const ext = file.split(".").pop()!;
  await cloud.blobs.put(assetKey(file), await readFile(resolve(assetDir, file)), ext === "glb" ? "model/gltf-binary" : ext === "jpg" ? "image/jpeg" : "image/" + ext);
  copied.assets += 1;
}

const accounts = await local.accounts.load();
log(`${accounts.users.length} user account(s), ${accounts.resets.length} pending reset token(s)`);
if (!dryRun) {
  await cloud.accounts.load(); // so save() knows what is already there
  await cloud.accounts.save(accounts);
  copied.users = accounts.users.length;
}

if (existsSync(resolve(source, "session.key")) && !dryRun) {
  console.log("\nsession.key found: to keep everyone signed in, store it as the ORBIS_SESSION_SECRET parameter:");
  console.log("  npm run aws:secret -- ORBIS_SESSION_SECRET --from-file server/data/session.key");
}
console.log(dryRun ? "\nDry run finished; nothing was written." : `\nDone: ${copied.projects} projects, ${copied.thumbnails} thumbnails, ${copied.assets} assets, ${copied.users} users${copied.skipped ? `, ${copied.skipped} skipped` : ""}. Local data was not changed.`);

/** LocalStack only: mirrors the tables and bucket that infra/aws/orbis.yaml creates. */
async function createTables() {
  const { DynamoDBClient, CreateTableCommand, UpdateTimeToLiveCommand } = await import("@aws-sdk/client-dynamodb");
  const { S3Client, CreateBucketCommand } = await import("@aws-sdk/client-s3");
  const common = { region: process.env.AWS_REGION, ...(endpoint ? { endpoint } : {}) };
  const ddb = new DynamoDBClient(common);
  const ignoreExists = (error: { name?: string }) => {
    if (!["ResourceInUseException", "BucketAlreadyOwnedByYou", "BucketAlreadyExists"].includes(error.name ?? "")) throw error;
  };
  const S = "S" as const;
  await ddb.send(new CreateTableCommand({
    TableName: `${prefix}-projects`, BillingMode: "PAY_PER_REQUEST",
    AttributeDefinitions: [{ AttributeName: "id", AttributeType: S }, { AttributeName: "ownerUserId", AttributeType: S }, { AttributeName: "updatedAt", AttributeType: S }],
    KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
    GlobalSecondaryIndexes: [{ IndexName: "byOwner", KeySchema: [{ AttributeName: "ownerUserId", KeyType: "HASH" }, { AttributeName: "updatedAt", KeyType: "RANGE" }], Projection: { ProjectionType: "KEYS_ONLY" } }],
  })).catch(ignoreExists);
  await ddb.send(new CreateTableCommand({
    TableName: `${prefix}-users`, BillingMode: "PAY_PER_REQUEST",
    AttributeDefinitions: [{ AttributeName: "id", AttributeType: S }, { AttributeName: "email", AttributeType: S }],
    KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
    GlobalSecondaryIndexes: [{ IndexName: "byEmail", KeySchema: [{ AttributeName: "email", KeyType: "HASH" }], Projection: { ProjectionType: "KEYS_ONLY" } }],
  })).catch(ignoreExists);
  await ddb.send(new CreateTableCommand({
    TableName: `${prefix}-resets`, BillingMode: "PAY_PER_REQUEST",
    AttributeDefinitions: [{ AttributeName: "tokenHash", AttributeType: S }], KeySchema: [{ AttributeName: "tokenHash", KeyType: "HASH" }],
  })).catch(ignoreExists);
  await ddb.send(new UpdateTimeToLiveCommand({ TableName: `${prefix}-resets`, TimeToLiveSpecification: { AttributeName: "ttl", Enabled: true } })).catch(() => undefined);
  await new S3Client({ ...common, forcePathStyle: true }).send(new CreateBucketCommand({ Bucket: bucket })).catch(ignoreExists);
  console.log("Tables and bucket ready.");
}
