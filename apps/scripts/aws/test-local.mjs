// End-to-end check of the AWS storage backend against LocalStack (local S3 + DynamoDB + SQS), no AWS account needed.
//   docker run -d --rm --name orbis-localstack -p 4566:4566 -e SERVICES=s3,dynamodb,sqs localstack/localstack:3.8
//   npm run aws:test-local
// It creates the tables/bucket/queue, starts the server with RB_STORAGE=aws, and checks: project save/load across a
// server restart, DynamoDB records, asset upload/download through S3, thumbnails, PDF reports with presigned links,
// link access, and project deletion through SQS + the Lambda worker code taken from infra/aws/orbis.yaml.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(resolve(root, "server/package.json"));
const endpoint = process.env.RB_AWS_ENDPOINT ?? "http://localhost:4566";
const env = { ...process.env, AWS_ACCESS_KEY_ID: "test", AWS_SECRET_ACCESS_KEY: "test", AWS_REGION: "us-east-1", RB_AWS_ENDPOINT: endpoint, RB_S3_BUCKET: "orbis-it-" + Date.now(), RB_DDB_PREFIX: "orbisit" + Date.now() };
const port = 8897;
const base = `http://127.0.0.1:${port}`;
let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? " — " + detail : ""}`);
  if (!ok) failures += 1;
};

const { S3Client, ListObjectsV2Command, HeadObjectCommand } = require("@aws-sdk/client-s3");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand } = require("@aws-sdk/lib-dynamodb");
const { SQSClient, CreateQueueCommand, ReceiveMessageCommand } = require("@aws-sdk/client-sqs");
const aws = { region: "us-east-1", endpoint, credentials: { accessKeyId: "test", secretAccessKey: "test" } };
const s3 = new S3Client({ ...aws, forcePathStyle: true });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient(aws));
const sqs = new SQSClient(aws);

if (!(await fetch(endpoint + "/_localstack/health").then((r) => r.ok, () => false))) {
  console.error("LocalStack is not running on " + endpoint + " (see the header of this file).");
  process.exit(1);
}
const setup = spawnSync(process.execPath, ["--import", "tsx/esm", "server/scripts/migrate-to-aws.ts", "--create-tables", "--dry-run"], { cwd: root, env: { ...env, RB_DATA_DIR: mkdtempSync(join(tmpdir(), "orbis-empty-")) }, encoding: "utf8" });
check(setup.status === 0, "tables and bucket created", setup.stderr);
const queueUrl = (await sqs.send(new CreateQueueCommand({ QueueName: env.RB_DDB_PREFIX + "-jobs" }))).QueueUrl;
env.RB_JOBS_QUEUE_URL = queueUrl;

const dataDir = mkdtempSync(join(tmpdir(), "orbis-aws-"));
let server;
async function start() {
  server = spawn(process.execPath, ["--import", "tsx/esm", "server/src/index.ts"], { cwd: root, env: { ...env, NODE_ENV: "production", RB_STORAGE: "aws", PORT: String(port), HOST: "127.0.0.1", RB_DATA_DIR: dataDir, RB_PUBLIC: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  server.stderr.on("data", (chunk) => process.env.DEBUG && process.stderr.write(chunk));
  for (let i = 0; i < 60; i += 1) {
    if (await fetch(base + "/api/health").then((r) => r.ok, () => false)) return;
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error("server did not start");
}
const stop = () => new Promise((done) => { server.once("exit", done); server.kill("SIGTERM"); });

await start();
// Account + project
const signup = await fetch(base + "/api/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Cloud Tester", email: `cloud-${Date.now()}@example.com`, password: "correct horse 1" }) });
const cookie = signup.headers.get("set-cookie")?.split(";")[0] ?? "";
check(signup.status === 201 && !!cookie, "sign up stores the account in DynamoDB", String(signup.status));
const headers = { "content-type": "application/json", cookie };
const created = await fetch(base + "/api/projects", { method: "POST", headers, body: JSON.stringify({ name: "Cloud Test Room", template: "bedroom" }) }).then((r) => r.json());
const id = created.id;
check(!!id && !!created.ownerKey, "project created", JSON.stringify(created));

const record = (await ddb.send(new GetCommand({ TableName: env.RB_DDB_PREFIX + "-projects", Key: { id } }))).Item;
check(record?.name === "Cloud Test Room" && !!record.ownerKeyHash && !!record.ownerUserId && record.objects > 0, "DynamoDB project record has owner, key hash and summary", JSON.stringify(record));
check(!!(await s3.send(new HeadObjectCommand({ Bucket: env.RB_S3_BUCKET, Key: `projects/${id}/scene.json` })).catch(() => null)), "scene document stored in S3 at projects/<id>/scene.json");

// Rename, link access, thumbnail, asset, PDF
check((await fetch(`${base}/api/projects/${id}`, { method: "PATCH", headers, body: JSON.stringify({ name: "Renamed in the cloud" }) })).ok, "rename saved");
check((await fetch(`${base}/api/projects/${id}/access`, { method: "PUT", headers: { ...headers, "x-owner-key": created.ownerKey }, body: JSON.stringify({ linkAccess: "view" }) })).ok, "link access set to view");
const jpeg = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==", "base64");
check((await fetch(`${base}/api/projects/${id}/thumbnail`, { method: "PUT", headers, body: JSON.stringify({ dataUrl: "data:image/jpeg;base64," + jpeg.toString("base64") }) })).ok, "thumbnail uploaded");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const asset = await fetch(base + "/api/assets", { method: "POST", headers, body: JSON.stringify({ dataUrl: "data:image/png;base64," + png.toString("base64"), kind: "plan", projectId: id }) }).then((r) => r.json());
const assetBack = await fetch(base + asset.url);
check(assetBack.ok && Buffer.from(await assetBack.arrayBuffer()).equals(png) && assetBack.headers.get("content-type") === "image/png", "asset round-trips through S3 with the right type", asset.url);
const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const report = await fetch(`${base}/api/projects/${id}/reports?name=Orbis_Test_Design.pdf`, { method: "POST", headers: { "content-type": "application/pdf", cookie }, body: pdf }).then((r) => r.json());
const redirect = await fetch(base + report.url, { redirect: "manual" });
const presigned = redirect.headers.get("location") ?? "";
check(redirect.status === 302 && presigned.includes("X-Amz-Signature"), "PDF link redirects to a presigned S3 URL", `${redirect.status} ${presigned.slice(0, 80)}`);
const download = await fetch(presigned);
check(download.ok && Buffer.from(await download.arrayBuffer()).equals(pdf) && /attachment; filename="Orbis_Test_Design.pdf"/.test(download.headers.get("content-disposition") ?? ""), "presigned link downloads the PDF as an attachment");
check((await fetch(base + "/api/projects/x/reports", { method: "POST", headers: { "content-type": "application/pdf" }, body: "not a pdf" })).status === 400, "non-PDF report upload is rejected");

// Restart: everything comes back from S3/DynamoDB, nothing from the instance disk.
await stop();
await start();
const after = await fetch(`${base}/api/scenes/${id}`).then((r) => r.json());
check(after.scene?.name === "Renamed in the cloud", "scene restored after a server restart", after.scene?.name);
const list = await fetch(`${base}/api/projects`, { headers }).then((r) => r.json());
const listed = list.projects?.find((p) => p.id === id);
check(listed?.name === "Renamed in the cloud" && listed.owned && !!listed.thumbnail, "dashboard lists it from DynamoDB with its thumbnail", JSON.stringify(listed));
const viewSocket = await new Promise((done) => {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?scene=${id}`);
  socket.onopen = () => socket.send(JSON.stringify({ type: "hello", sceneId: id, clientId: "guest-" + Date.now(), name: "Guest", color: "#3b82d9" }));
  socket.onmessage = (event) => { const message = JSON.parse(event.data); if (message.type === "access") { done(message); socket.close(); } };
  setTimeout(() => done(null), 5000);
});
check(viewSocket?.linkAccess === "view" && viewSocket.canEdit === false, "view-only link access survives the restart", JSON.stringify(viewSocket));
check((await fetch(base + asset.url)).ok, "uploaded asset still available after restart");

// Delete → SQS job → Lambda worker (code from the CloudFormation template) removes the project's files.
check((await fetch(`${base}/api/projects/${id}`, { method: "DELETE", headers: { ...headers, "x-owner-key": created.ownerKey } })).ok, "project deleted");
check(!(await ddb.send(new GetCommand({ TableName: env.RB_DDB_PREFIX + "-projects", Key: { id } }))).Item, "DynamoDB record removed");
const received = await sqs.send(new ReceiveMessageCommand({ QueueUrl: queueUrl, WaitTimeSeconds: 2, MaxNumberOfMessages: 10 }));
const job = (received.Messages ?? []).find((message) => JSON.parse(message.Body).projectId === id);
check(!!job, "cleanup job queued on SQS");
const template = readFileSync(resolve(root, "infra/aws/orbis.yaml"), "utf8");
const code = /ZipFile: \|\n([\s\S]*?)\n\s*# WORKER-END/.exec(template)[1].split("\n").map((line) => line.replace(/^ {10}/, "")).join("\n");
const workerFile = join(dataDir, "worker.cjs");
writeFileSync(workerFile, code.replace('require("@aws-sdk/client-s3")', JSON.stringify(require.resolve("@aws-sdk/client-s3")).replace(/^/, "require(") + ")"));
process.env.AWS_ENDPOINT_URL = endpoint;
Object.assign(process.env, { AWS_ACCESS_KEY_ID: "test", AWS_SECRET_ACCESS_KEY: "test", AWS_REGION: "us-east-1", BUCKET: env.RB_S3_BUCKET });
const worker = createRequire(workerFile)(workerFile);
const result = await worker.handler({ Records: job ? [{ messageId: job.MessageId, body: job.Body }] : [] });
const left = await s3.send(new ListObjectsV2Command({ Bucket: env.RB_S3_BUCKET, Prefix: `projects/${id}/` }));
check(result.batchItemFailures.length === 0 && !(left.Contents ?? []).length, "Lambda worker removed thumbnail and reports from S3", JSON.stringify(left.Contents?.map((item) => item.Key)));
check((await fetch(`${base}/api/scenes/${id}`)).status === 404, "deleted project link answers 404");

await stop();
console.log(failures ? `\n${failures} check(s) failed.` : "\nAll AWS storage checks passed.");
process.exit(failures ? 1 : 0);
