// Builds the deployable bundle for EC2: .release/orbis.tgz
//   server/dist/index.js  the whole server (Express, ws, AWS SDK, shared packages) bundled into one file, so the
//                         instance needs no npm install and no internet access to start
//   web/dist, fixtures    served/read relative to the bundle, same layout as the repo
//   npm run aws:release            (runs `npm run build` first)
//   npm run aws:release -- --no-build
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = resolve(root, ".release");
const stage = resolve(out, "stage");
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", ...options });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

if (!process.argv.includes("--no-build")) run("npm", ["run", "build"]);

rmSync(out, { recursive: true, force: true });
mkdirSync(resolve(stage, "server/dist"), { recursive: true });
await build({
  entryPoints: [resolve(root, "server/src/index.ts")],
  outfile: resolve(stage, "server/dist/index.js"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  // CommonJS dependencies (express) call require(); give the ESM bundle one.
  banner: { js: "import { createRequire as __orbisRequire } from 'node:module'; const require = __orbisRequire(import.meta.url);" },
  // Optional native speedups of ws; it falls back to JavaScript without them.
  external: ["bufferutil", "utf-8-validate"],
  logLevel: "warning",
});
cpSync(resolve(root, "web/dist"), resolve(stage, "web/dist"), { recursive: true });
cpSync(resolve(root, "fixtures"), resolve(stage, "fixtures"), { recursive: true });
writeFileSync(resolve(stage, "server/package.json"), JSON.stringify({ type: "module", private: true }) + "\n");
writeFileSync(resolve(stage, "RELEASE"), new Date().toISOString() + "\n");
run("tar", ["-czf", resolve(out, "orbis.tgz"), "-C", stage, "."]);
console.log("Release bundle: " + resolve(out, "orbis.tgz"));
