// Public share link from this computer, reachable from any network:
//   npm run share            (builds, starts the production server, opens a Cloudflare quick tunnel)
//   npm run share -- --no-build   (reuse the last build)
// One production process serves the web app, API and collaboration WebSocket on SHARE_PORT (default 8787),
// so the tunnel needs a single target. Projects are stored in server/data (or RB_DATA_DIR) as in development.
// Ctrl+C stops both the server and the tunnel.
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.SHARE_PORT ?? 8787);
const target = `http://127.0.0.1:${port}`;
const dataDir = process.env.RB_DATA_DIR ?? resolve(root, "server/data");
// The server reads this so Share, WhatsApp and PDF links use the public address even when opened via 127.0.0.1.
const publicUrlFile = resolve(dataDir, "public-url.txt");
const children = [];

const stop = (code = 0) => {
  rmSync(publicUrlFile, { force: true });
  for (const child of children) child.kill("SIGINT");
  setTimeout(() => process.exit(code), 500);
};
rmSync(publicUrlFile, { force: true }); // a previous run that was killed may have left its dead address
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

const portInUse = () => new Promise((done) => {
  const socket = net.connect(port, "127.0.0.1", () => { socket.end(); done(true); });
  socket.once("error", () => done(false));
});

if (spawnSync("cloudflared", ["--version"], { stdio: "ignore" }).error) {
  console.error("cloudflared is not installed. Install it with: brew install cloudflared");
  process.exit(1);
}
if (await portInUse()) {
  console.error(`Port ${port} is already in use (another share running?). Stop it, or set SHARE_PORT.`);
  process.exit(1);
}

if (!process.argv.includes("--no-build")) {
  console.log("Building the production app…");
  if (spawnSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" }).status !== 0) process.exit(1);
}

// Production mode, but bound to loopback only: the tunnel is the one way in from outside.
// API_PORT wins over PORT in the server, so set it explicitly.
const server = spawn(process.execPath, ["scripts/start.mjs"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "production", API_PORT: String(port), HOST: "127.0.0.1", RB_DATA_DIR: dataDir },
});
children.push(server);
server.on("exit", (code) => { console.error(`Server stopped (exit ${code}).`); stop(code ?? 1); });

const deadline = Date.now() + 30_000;
while (!(await fetch(target + "/api/health").then((response) => response.ok).catch(() => false))) {
  if (Date.now() > deadline) { console.error("Server did not become healthy within 30 s."); stop(1); }
  await new Promise((done) => setTimeout(done, 300));
}

const tunnel = spawn("cloudflared", ["tunnel", "--url", target, "--no-autoupdate"], { stdio: ["ignore", "pipe", "pipe"] });
children.push(tunnel);
tunnel.on("exit", (code) => { console.error(`Tunnel stopped (exit ${code}).`); stop(code ?? 1); });

let url = null;
let printed = false;
const onData = async (chunk) => {
  const text = chunk.toString();
  url ??= text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0] ?? null;
  if (!url || printed || !text.includes("Registered tunnel connection")) return;
  printed = true;
  // New quick-tunnel hostnames take a few seconds to resolve everywhere.
  let status = "unreachable";
  for (let attempt = 0; attempt < 15 && status !== 200; attempt += 1) {
    await new Promise((done) => setTimeout(done, 2000));
    status = await fetch(url + "/api/health").then((response) => response.status).catch(() => "unreachable");
  }
  writeFileSync(publicUrlFile, url + "\n");
  console.log(`\n  Orbis is live:   ${url}\n  On this computer: ${target}\n  Self-check: ${status === 200 ? "working from the internet" : `API ${status}, the link may need another minute`}\n  Open a project and click Share to copy its link. Keep this terminal open; Ctrl+C stops sharing.\n`);
};
tunnel.stdout.on("data", onData);
tunnel.stderr.on("data", onData);
