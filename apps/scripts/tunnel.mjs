// Public link for remote collaborators via a Cloudflare quick tunnel:
//   npm run tunnel        (with `npm run dev` or `npm run dev:share` already running)
// Points at 127.0.0.1, not "localhost": on macOS localhost can resolve to IPv6 (::1), where Vite isn't listening.
import net from "node:net";
import { spawn } from "node:child_process";

const target = "http://127.0.0.1:5173";
const listening = await new Promise((resolve) => {
  const socket = net.connect(5173, "127.0.0.1", () => { socket.end(); resolve(true); });
  socket.once("error", () => resolve(false));
});
if (!listening) {
  console.error("Nothing is running on 127.0.0.1:5173. Start the app first: npm run dev");
  process.exit(1);
}

const child = spawn("cloudflared", ["tunnel", "--url", target, "--no-autoupdate"], { stdio: ["ignore", "pipe", "pipe"] });
child.once("error", () => {
  console.error("cloudflared is not installed. Install it with: brew install cloudflared");
  process.exit(1);
});
let url = null;
const onData = async (chunk) => {
  const text = chunk.toString();
  url ??= text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0] ?? null;
  if (url && text.includes("Registered tunnel connection")) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const status = await fetch(url + "/api/projects").then((response) => response.status).catch(() => "unreachable");
    console.log(`\n  Share this link:  ${url}\n  Self-check: API ${status}${status === 200 ? " — working" : " — new links can take ~30 s to resolve, try again shortly"}\n  Keep this terminal open. Ctrl+C stops sharing.\n`);
  }
};
child.stdout.on("data", onData);
child.stderr.on("data", onData);
process.on("SIGINT", () => child.kill("SIGINT"));
child.on("exit", (code) => process.exit(code ?? 0));
