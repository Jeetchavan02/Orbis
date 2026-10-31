import { spawn } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const children = [];

function runNpm(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(npmCommand, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error("npm exited after " + signal));
      } else if (code !== 0) {
        reject(new Error("npm exited with code " + code));
      } else {
        resolve();
      }
    });
  });
}

let stopping = false;

function stopChildren(signal = "SIGTERM", exitCode = 0) {
  stopping = true;
  if (exitCode !== 0) process.exitCode = exitCode;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

process.on("SIGINT", () => stopChildren("SIGINT"));
process.on("SIGTERM", () => stopChildren("SIGTERM"));

try {
  console.log("Preparing shared workspace packages…");
  await runNpm(["run", "build:packages"]);

  for (const workspace of ["@reality-builder/server", "@reality-builder/web"]) {
    const child = spawn(
      npmCommand,
      ["run", "dev", "--workspace", workspace],
      {
        stdio: "inherit",
        shell: process.platform === "win32",
      },
    );
    children.push(child);
    child.once("exit", (code, signal) => {
      if (!stopping) {
        console.error(workspace + " exited unexpectedly.");
        stopChildren(signal ?? "SIGTERM", code && code !== 0 ? code : 1);
      }
    });
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
  stopChildren();
}
