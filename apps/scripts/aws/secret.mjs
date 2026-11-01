// Stores a server secret in SSM Parameter Store (/orbis/<NAME>, SecureString). The EC2 instance reads /orbis/* on
// every rollout; nothing is written to the repo or the browser bundle.
//   npm run aws:secret -- GEMINI_API_KEY                 (asks for the value, input hidden)
//   npm run aws:secret -- ORBIS_SESSION_SECRET --from-file server/data/session.key   (keeps existing logins valid)
//   then: npm run aws:deploy -- --no-build               (rolls the new value out)
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [name, flag, file] = process.argv.slice(2);
const ALLOWED = ["GEMINI_API_KEY", "GEMINI_MODEL", "ORBIS_SESSION_SECRET", "GOOGLE_CLIENT_ID", "ORBIS_SHOW_RESET_LINKS"];
if (!ALLOWED.includes(name)) {
  console.error(`Usage: npm run aws:secret -- <${ALLOWED.join("|")}> [--from-file <path>]`);
  process.exit(1);
}

let value;
if (flag === "--from-file") {
  value = readFileSync(file, "utf8").trim();
  // The data dir's session.key is hex; the server reads "hex:<key>" as the same bytes.
  if (name === "ORBIS_SESSION_SECRET" && /^[0-9a-f]{64}$/i.test(value)) value = "hex:" + value;
} else {
  process.stdout.write(`${name}: `);
  value = await new Promise((done) => {
    let input = "";
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.on("data", (chunk) => {
      for (const char of chunk.toString()) {
        if (char === "\r" || char === "\n") { process.stdin.setRawMode?.(false); process.stdin.pause(); process.stdout.write("\n"); return done(input.trim()); }
        if (char === "\u0003") process.exit(130);
        input = char === "\u007f" ? input.slice(0, -1) : input + char;
      }
    });
  });
}
if (!value) {
  console.error("Empty value; nothing stored.");
  process.exit(1);
}
// Passed as file:// so the value never appears in the process list.
const dir = mkdtempSync(join(tmpdir(), "orbis-secret-"));
const path = join(dir, "value");
writeFileSync(path, value, { mode: 0o600 });
const result = spawnSync("aws", ["ssm", "put-parameter", "--name", "/orbis/" + name, "--type", "SecureString", "--overwrite", "--value", "file://" + path, "--region", process.env.AWS_REGION || "ap-south-1"], { stdio: ["ignore", "ignore", "inherit"] });
rmSync(dir, { recursive: true, force: true });
if (result.status !== 0) process.exit(1);
console.log(`Stored /orbis/${name}. Roll it out with: npm run aws:deploy -- --no-build`);
