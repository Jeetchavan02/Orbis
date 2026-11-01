// One-command AWS deploy (needs the AWS CLI signed in: `aws configure`, or `aws sso login`).
//   npm run aws:deploy                     free-tier layout (t3.micro, no load balancer, no NAT), region ap-south-1
//   npm run aws:deploy -- --no-build       reuse .release/orbis.tgz
//   npm run aws:deploy -- --cloudfront     CloudFront instead of Caddy + <ip>.sslip.io (account must be verified)
//   npm run aws:deploy -- --standard       ALB + private subnet + t4g.small + NAT gateway (≈US$80/month)
//   npm run aws:deploy -- --standard --no-nat
//   AWS_REGION=... STACK=...               other region / stack name (defaults: ap-south-1, "orbis")
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const stack = process.env.STACK ?? "orbis";
const args = process.argv.slice(2);
const region = process.env.AWS_REGION || "ap-south-1";
const mode = args.includes("--standard") ? "standard" : "free";

function cli(command, { json = false, allowFail = false, quiet = false } = {}) {
  const result = spawnSync("aws", [...command, ...(region && command[0] !== "configure" ? ["--region", region] : []), ...(json ? ["--output", "json"] : [])], { encoding: "utf8", stdio: ["ignore", "pipe", quiet ? "pipe" : "inherit"] });
  if (result.error) fail("The AWS CLI is not installed (https://aws.amazon.com/cli/).");
  if (result.status !== 0) {
    if (allowFail) return json ? null : "";
    fail(`aws ${command.slice(0, 2).join(" ")} failed.${quiet ? "\n" + result.stderr : ""}`);
  }
  return json ? JSON.parse(result.stdout || "null") : result.stdout;
}
function fail(message) {
  console.error("\n✗ " + message);
  process.exit(1);
}
const step = (message) => console.log("\n▸ " + message);

step("Checking AWS access");
const identity = cli(["sts", "get-caller-identity"], { json: true, quiet: true, allowFail: true });
if (!identity) fail("AWS credentials are missing or invalid. Run `aws configure` (or `aws sso login`) and try again.");
console.log(`  account ${identity.Account} · ${identity.Arn} · ${region} · ${mode} mode`);

// The secret header CloudFront sends to the load balancer. Generated once and kept locally (git-ignored).
const stateFile = resolve(root, "infra/aws/.deploy-state.json");
const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : {};
state.originSecret ??= randomBytes(24).toString("hex");
writeFileSync(stateFile, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });

const prefixList = cli(["ec2", "describe-managed-prefix-lists", "--filters", "Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing"], { json: true }).PrefixLists?.[0]?.PrefixListId;
if (!prefixList) fail("Could not find the CloudFront origin-facing prefix list in " + region + ".");

let status = cli(["cloudformation", "describe-stacks", "--stack-name", stack], { json: true, allowFail: true, quiet: true })?.Stacks?.[0]?.StackStatus;
if (status === "ROLLBACK_COMPLETE") {
  // A first create that failed leaves an empty stack that can't be updated; it holds no data (nothing retained).
  step(`Removing the failed first attempt of "${stack}"`);
  cli(["cloudformation", "delete-stack", "--stack-name", stack]);
  cli(["cloudformation", "wait", "stack-delete-complete", "--stack-name", stack]);
  status = undefined;
}
const existed = !!status;

if (!args.includes("--no-build") || !existsSync(resolve(root, ".release/orbis.tgz"))) {
  step("Building the release bundle");
  if (spawnSync(process.execPath, [resolve(root, "scripts/aws/build-release.mjs")], { cwd: root, stdio: "inherit" }).status !== 0) fail("Build failed.");
}

step(`${existed ? "Updating" : "Creating"} CloudFormation stack "${stack}" (first run takes ~5–10 minutes)`);
const deploy = spawnSync("aws", ["cloudformation", "deploy", "--region", region, "--stack-name", stack, "--template-file", resolve(root, "infra/aws/orbis.yaml"),
  "--capabilities", "CAPABILITY_IAM", "--no-fail-on-empty-changeset", "--parameter-overrides",
  `CloudFrontPrefixListId=${prefixList}`, `OriginSecret=${state.originSecret}`, `Mode=${mode}`, `UseCloudFront=${args.includes("--cloudfront") ? "true" : "false"}`, `EnableNat=${args.includes("--no-nat") ? "false" : "true"}`], { stdio: "inherit" });
if (deploy.status !== 0) fail(`Stack deploy failed. See the Events tab of "${stack}" in the CloudFormation console.`);

const outputs = Object.fromEntries((cli(["cloudformation", "describe-stacks", "--stack-name", stack], { json: true }).Stacks[0].Outputs ?? []).map((o) => [o.OutputKey, o.OutputValue]));
const bucket = outputs.DataBucketName;

step(`Uploading the release to s3://${bucket}/_releases/`);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
cli(["s3", "cp", resolve(root, ".release/orbis.tgz"), `s3://${bucket}/_releases/archive/${stamp}.tgz`, "--only-show-errors"]);
cli(["s3", "cp", `s3://${bucket}/_releases/archive/${stamp}.tgz`, `s3://${bucket}/_releases/latest.tgz`, "--only-show-errors"]);

if (existed) {
  step("Rolling out to the running instance (SSM Run Command)");
  const instances = cli(["autoscaling", "describe-auto-scaling-groups", "--auto-scaling-group-names", outputs.AutoScalingGroupName], { json: true })
    .AutoScalingGroups[0].Instances.filter((i) => i.LifecycleState === "InService").map((i) => i.InstanceId);
  const sent = instances.length && cli(["ssm", "send-command", "--document-name", "AWS-RunShellScript", "--instance-ids", ...instances, "--parameters", "commands=/opt/orbis/update.sh", "--comment", "orbis deploy " + stamp], { json: true, allowFail: true, quiet: true });
  if (sent) {
    const commandId = sent.Command.CommandId;
    for (let i = 0; i < 60; i += 1) {
      const status = cli(["ssm", "list-command-invocations", "--command-id", commandId], { json: true }).CommandInvocations.map((c) => c.Status);
      if (status.length && status.every((s) => !["Pending", "InProgress", "Delayed"].includes(s))) {
        if (!status.every((s) => s === "Success")) fail("Rollout command failed: " + status.join(", ") + ". Check /var/log/orbis/app.log via Session Manager.");
        break;
      }
      await new Promise((done) => setTimeout(done, 5000));
    }
  } else {
    // No NAT (SSM unreachable) or no instance yet: replace the instance; the new one boots the latest release.
    console.log("  SSM not reachable; starting an instance refresh instead (≈5 minutes of downtime with one instance).");
    cli(["autoscaling", "start-instance-refresh", "--auto-scaling-group-name", outputs.AutoScalingGroupName, "--preferences", "MinHealthyPercentage=0"], { allowFail: true });
  }
}

step(`Waiting for ${outputs.AppUrl}/api/health`);
for (let i = 0; ; i += 1) {
  const ok = await fetch(outputs.AppUrl + "/api/health").then((r) => r.ok, () => false);
  if (ok) break;
  if (i > 120) fail("The app did not become healthy within 20 minutes. See the troubleshooting section in docs/aws-deployment.md.");
  await new Promise((done) => setTimeout(done, 10_000));
}
console.log(`\n✓ Orbis is live: ${outputs.AppUrl}\n  Data bucket: ${bucket}\n  Check it:    npm run smoke:collab -- ${outputs.AppUrl}`);
