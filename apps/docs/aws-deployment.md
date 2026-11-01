# Orbis on AWS

Status: **implemented and tested against LocalStack, not yet deployed to a real AWS account** (the AWS CLI on the dev machine had no valid credentials). Everything below that needs your account is listed under [Manual steps](#12-manual-steps).

## Free-tier mode (the default)

`npm run aws:deploy` uses **Mode=free** in region **ap-south-1** (Mumbai). Only free-tier resources are created:

```
Browser ──HTTPS/WSS──▶ CloudFront ──HTTP :8080 + secret header──▶ EC2 t3.micro (Elastic IP, public subnet)
                                                                     │ S3 + DynamoDB gateway endpoints
                                                                     ▼
                                     S3 · DynamoDB · SQS → Lambda · CloudWatch Logs
```

* **No load balancer and no NAT gateway.** The instance has its own Elastic IP, so CloudFront always reaches the same address, and the AI features still work without a NAT.
* **Restricted access.** The security group admits port 8080 from CloudFront's address list only, and the server rejects any request without this distribution's secret `X-Orbis-Origin` header (`RB_ORIGIN_SECRET`).
* **Self-healing.**
  * If the app crashes, systemd restarts it.
  * If the instance fails its EC2 status check, the Auto Scaling group replaces it. The replacement picks up the same Elastic IP.
* **Free-tier limits:**
  * EC2: 750 h of t3.micro and 30 GB of EBS (16 GB used).
  * Public IPv4: 750 h.
  * DynamoDB: 25 GB.
  * S3: 5 GB.
  * Lambda, SQS and CloudFront: always-free allowances.
  * DynamoDB point-in-time recovery is off in this mode because it isn't free.
* **Accounts created after 15 July 2025** use AWS's credit-based Free plan instead: the same resources draw from your sign-up credits ($100–200) rather than billing a card.

The rest of this document describes **standard mode** (`npm run aws:deploy -- --standard`): ALB + private subnet + t4g.small + NAT. Everything else (storage, tables, bucket layout, scripts, secrets, migration) is identical in both modes.

## 1. Architecture (standard mode)

```
Browser ──HTTPS/WSS──▶ CloudFront (dxxxx.cloudfront.net, free TLS)
                          │ edge cache: /assets/* (build), /models/*, /api/assets/* (immutable uploads)
                          │ everything else (API, /ws, pages, cookies) passes through uncached
                          ▼ HTTP + secret X-Orbis-Origin header
            ┌──────────── VPC 10.20.0.0/16 ─────────────────────────────────────┐
            │ public subnets (2 AZ)   ALB :80 — SG allows only CloudFront's     │
            │                         prefix list; listener 403s without header │
            │                             ▼ :8080                               │
            │ private subnets (2 AZ)  EC2 t4g.small in an Auto Scaling group of 1│
            │                         (Node 22, systemd, no SSH, SSM only)       │
            │       │ S3 gateway endpoint      │ DynamoDB gateway endpoint       │
            │       │ (free)                   │ (free)          NAT gateway ──▶ Gemini, Google, SSM
            └───────┼──────────────────────────┼────────────────────────────────┘
                    ▼                          ▼
        S3 data bucket (private,     DynamoDB: orbis-projects, orbis-users,
        versioned, SSE, TLS-only)    orbis-resets (on-demand, PITR)
                    ▲
        Lambda orbis-worker ◀── SQS orbis-jobs (+ DLQ)  ◀── server queues cleanup jobs
```

Why this shape:

* **One instance.** The collaboration server is authoritative and holds live sessions in memory, so it must be a single process. The Auto Scaling group (min = max = 1) replaces it if the ALB health check fails. All durable state is in S3 and DynamoDB, so a replacement instance starts with everything.
* **CloudFront in front of the ALB** gives HTTPS and WSS on a `*.cloudfront.net` address without a domain or ACM certificate. CloudFront passes WebSocket upgrades through.
* **The EC2 instance is in a private subnet.** S3 and DynamoDB traffic goes through gateway endpoints, which cost nothing. The NAT gateway is used only for the Gemini API, Google sign-in checks and SSM. It is optional (`--no-nat`).
* **Uploads still go through the server** (not presigned PUTs) so the existing type, size and GLB-header validation runs before anything is stored. Downloads of PDF reports use **presigned S3 GET URLs** (15 min). Images and models are streamed from the same origin so WebGL textures stay untainted, which the PDF export needs.
* **Lambda + SQS only where it helps.** Deleting a project removes its record and scene at once. Its remaining files (thumbnail, PDF reports) are removed by the worker. PDF generation stays in the browser because it renders the live WebGL scene, so a Lambda can't do it.

## 2. What changed in the app

| File | Change |
| --- | --- |
| `server/src/storage.ts` (new) | `BlobStore` / `ProjectIndex` / `AccountStore` / `JobQueue` interfaces with two backends: **local** (the original data-dir layout, unchanged files) and **aws** (S3 + DynamoDB + SQS, AWS SDK loaded only in AWS mode). |
| `server/src/index.ts` | All file I/O goes through `storage`. Scene saves also write a list summary into DynamoDB. A failed save now **retries every 5 s** instead of dropping edits. A storage outage on load is no longer treated as "new project" (that would have overwritten it with the demo scene). WebSocket open waits for the async project lookup. New: `POST/GET /api/projects/:id/reports` (PDF stored with the project, presigned download). `RB_TRUST_PROXY`. |
| `server/src/auth.ts` | Uses `AccountStore`. Secure cookies are detected behind CloudFront (`CloudFront-Forwarded-Proto`). `ORBIS_SESSION_SECRET=hex:<key>` reuses the data dir's `session.key`, so migrated users stay signed in. |
| `web/src/components/panels/ExportPdfDialog.tsx` | **Copy PDF link**: stores the PDF with the project and copies a download link. When a link exists, Share on WhatsApp includes it. |
| `web/src/lib/assets.ts` | Uploads tag the asset with its project id (S3 object metadata). |
| `infra/aws/orbis.yaml` (new) | CloudFormation for everything in the diagram. |
| `scripts/aws/*.mjs`, `server/scripts/migrate-to-aws.ts` (new) | Release bundle, deploy, secrets, migration, LocalStack test. |

Unchanged: scene schema, typed actions, undo/redo, versions and conflict handling, presence, reconnect, link access rules, the PDF generator, and local development (`npm run dev` still uses `server/data`).

## 3. DynamoDB

All three tables use on-demand capacity. Point-in-time recovery is on for projects and users.

**`orbis-projects`**: PK `id` (the `/project/<id>` id).

| Attribute | Meaning |
| --- | --- |
| `ownerKeyHash` | SHA-256 of the owner key returned at creation (delete / link-access rights for guests) |
| `ownerUserId` | account that created it |
| `linkAccess` | `"view"` or `"edit"` |
| `name`, `roomType`, `objects`, `floors`, `updatedAt` | dashboard summary, refreshed on every save |
| `thumbnailAt` | thumbnail version (cache-busting) |

GSI `byOwner` (`ownerUserId`, `updatedAt`), keys only: "my projects".

**`orbis-users`**: PK `id`. The item is the user record (name, email, scrypt hash, googleId, colour, tokenVersion, recent project ids). GSI `byEmail`.

**`orbis-resets`**: PK `tokenHash`, `userId`, `expires`. A TTL attribute `ttl` lets DynamoDB delete expired tokens.

Access patterns: open project → `GetItem`. Dashboard → `Query byOwner` plus `GetItem` for recently opened projects. Save → `UpdateItem`. Delete → `DeleteItem`. Users are loaded once with `Scan` and kept in memory; the server is the only writer and writes back only the items that changed.

**Collaboration state.** Per-entity versions live inside the scene document. They are authoritative in the server's memory while a session is open and are persisted with every autosave (1.5 s debounce).

**400 KB limit.** No scene, geometry or file is ever stored in DynamoDB. Scenes are S3 objects; DynamoDB holds only references and metadata.

## 4. S3 layout (one private bucket)

```
projects/<id>/scene.json              scene document (every save is a new version; old versions kept 30 days)
projects/<id>/thumbnail.jpg           dashboard thumbnail
projects/<id>/reports/<name>-<rand>.pdf   design PDFs (download = 15-minute presigned URL)
assets/<kind>-<random>.<png|jpg|webp|glb> floor-plan images, photo cutouts, imported GLB models (x-amz-meta-project = owner project)
_releases/latest.tgz, _releases/archive/  application bundles (archive expires after 60 days)
```

Security settings:

* All public access is blocked, objects are always owned by the bucket owner, and SSE-S3 encryption is on.
* The bucket policy denies any request that isn't over TLS.
* Only the instance role can read or write `projects/*` and `assets/*`, and it can only read `_releases/*`.
* The Lambda worker can only list `projects/*` and delete objects under it.

Asset and report names are random. Like project links themselves, possession of the link is the permission. That matches the existing open-link model.

## 5. Network and security

* **VPC and subnets:** VPC `10.20.0.0/16`. Public subnets `10.20.0.0/24` and `10.20.1.0/24`; private subnets `10.20.10.0/24` and `10.20.11.0/24`, each pair spread over two AZs.
* **Public route table:** sends `0.0.0.0/0` to the internet gateway.
* **Private route table:** routes S3 and DynamoDB through the gateway endpoints, and `0.0.0.0/0` through the NAT gateway when enabled.
* **ALB security group:** only TCP 80 from the CloudFront origin-facing prefix list. The listener also requires the secret `X-Orbis-Origin` header, otherwise it returns 403.
* **App security group:** only TCP 8080 from the ALB security group. Port 22 is closed; use Session Manager for shell access.
* **Instance:** IMDSv2 is required and the EBS volume is encrypted.
* **IAM:**
  * The instance role's S3, DynamoDB and SQS permissions are limited to the resources above. It can also read SSM parameters under `/orbis` and write to the `/orbis/app` log group, and it has `AmazonSSMManagedInstanceCore`.
  * The Lambda role can only consume the queue, delete under `projects/*` and write its own logs.
  * No access keys exist anywhere; everything uses roles.
* **Secrets:** `GEMINI_API_KEY`, `ORBIS_SESSION_SECRET` and `GOOGLE_CLIENT_ID` are SSM SecureString parameters, read by the instance at rollout into a root-only env file. They are never in the repo or the browser bundle.

## 6. Deploying

Prerequisites: AWS CLI v2 signed in to your account (`aws configure` or `aws sso login`), with a region set (e.g. `ap-south-1`), and Node 22.

```bash
npm run aws:deploy
```

The script:

1. Checks your credentials.
2. Looks up the CloudFront prefix list and generates the origin secret (kept in the git-ignored `infra/aws/.deploy-state.json`).
3. Builds the release: one bundled `server/dist/index.js` plus `web/dist` and `fixtures`, so no npm install is needed on the server.
4. Creates or updates the stack. The first run takes about 10 minutes.
5. Uploads the bundle and rolls it out (SSM Run Command on updates).
6. Waits until `https://<id>.cloudfront.net/api/health` answers.

Then add the secrets and move the data:

```bash
npm run aws:secret -- GEMINI_API_KEY
npm run aws:secret -- ORBIS_SESSION_SECRET --from-file server/data/session.key
RB_S3_BUCKET=<DataBucketName output> AWS_REGION=<region> npm run aws:migrate -- --dry-run
RB_S3_BUCKET=<DataBucketName output> AWS_REGION=<region> npm run aws:migrate
npm run aws:deploy -- --no-build
npm run smoke:collab -- https://<id>.cloudfront.net
```

* **Secrets:** the GEMINI_API_KEY prompt hides your input. Storing `session.key` as ORBIS_SESSION_SECRET keeps existing logins valid.
* **Migration:** the dry run lists what will be copied. The real run copies scenes, thumbnails, assets, owner keys, link access and accounts. It is read-only on `server/data` and safe to re-run.
* **Redeploy with `--no-build`:** picks up the new secrets.
* **Smoke test:** 18 collaboration checks on the live URL.

**Update the app later:** `npm run aws:deploy`, which rebuilds and rolls out. A restart takes a few seconds; clients reconnect on their own.

**Restart without deploying:** in Session Manager, run `sudo systemctl restart orbis`.

**Roll back:** copy an older `_releases/archive/<stamp>.tgz` over `_releases/latest.tgz`, then run `sudo /opt/orbis/update.sh`.

**Without NAT (`--no-nat`):** saves about US$35 a month, but AI, Google sign-in and SSM rollouts are unavailable. Updates then replace the instance (about 5 minutes of downtime).

**Tear down:** `aws cloudformation delete-stack --stack-name orbis`. The bucket and the projects and users tables are **retained** on purpose; delete them by hand when you no longer need the data.

## 7. Environment variables

| Variable | Where | Meaning |
| --- | --- | --- |
| `RB_STORAGE` | `/etc/orbis.env` | `aws` on EC2; `local` (default) everywhere else |
| `RB_S3_BUCKET` | `/etc/orbis.env` | data bucket |
| `RB_DDB_PREFIX` | `/etc/orbis.env` | table prefix, default `orbis` → `orbis-projects`, `orbis-users`, `orbis-resets` |
| `RB_JOBS_QUEUE_URL` | `/etc/orbis.env` | SQS queue; without it, cleanup runs inline |
| `AWS_REGION` | `/etc/orbis.env` | region |
| `RB_PUBLIC_URL` | `/etc/orbis.env` | CloudFront URL, used by Share, WhatsApp and PDF links |
| `RB_TRUST_PROXY` | `/etc/orbis.env` | `2` (CloudFront + ALB), so login rate limits see the real client IP |
| `RB_DATA_DIR` | `/etc/orbis.env` | `/var/lib/orbis` (only a fallback session key would live here) |
| `PORT`, `HOST`, `NODE_ENV` | `/etc/orbis.env` | `8080`, `0.0.0.0`, `production` |
| `GEMINI_API_KEY`, `GEMINI_MODEL`, `ORBIS_SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `ORBIS_SHOW_RESET_LINKS` | SSM `/orbis/*` → `/etc/orbis.secrets.env` | secrets and options |
| `RB_AWS_ENDPOINT` | testing only | point the SDK at LocalStack |

## 8. Tests that were run

| Check | Result |
| --- | --- |
| `npm test` (unit: actions, engine, sessions, auth, AI) | 74 / 74 pass |
| `npm run typecheck` | clean |
| `cfn-lint infra/aws/orbis.yaml`; `bash -n` on the EC2 user data and `update.sh` | clean |
| Release bundle runs standalone (no node_modules), serves app + `/api/health` | pass |
| `npm run aws:migrate` of the real `server/data` into LocalStack | 35 projects, 6 assets, 6 users copied; source untouched |
| `npm run smoke:collab` against the server on S3 + DynamoDB + SQS (LocalStack) | 18 / 18 pass: signup, create, two-client sync, stale-edit rejection + conflict details, stale load refused, rejoin restores latest, dashboard, owner-only delete, deleted-project notice, 404 after delete |
| `npm run aws:test-local` | 22 / 22 pass: DynamoDB record contents, scene in S3, rename, link access, thumbnail, asset round-trip, PDF upload, presigned download as an attachment, non-PDF rejected, **restart restores the scene, dashboard, thumbnail, assets and view-only access**, delete removes the record, SQS job queued, **the Lambda code from the template removes the leftover files**, 404 afterwards |
| Browser: migrated project opened from S3, PDF exported (9 views), **Copy PDF link** stored it in S3 and returned a working presigned redirect | pass |

Not yet verified (needs your AWS account): the stack deployment itself, CloudFront WebSocket pass-through, SSM rollouts, CloudWatch log shipping, and two devices on the real URL.

## 9. Estimated cost (ap-south-1, on-demand, approximate)

| Resource | Runs continuously? | ≈ US$/month |
| --- | --- | --- |
| NAT gateway (+ data processing at ~$0.045/GB) | **yes** | 33–40 |
| Application Load Balancer | **yes** | 18–20 |
| Public IPv4 addresses (ALB ×2, NAT ×1) | **yes** | 11 |
| EC2 t4g.small + 16 GB gp3 | **yes** | 12–15 |
| CloudFront | per use | 0 (free tier: 1 TB, 10 M requests) |
| DynamoDB on-demand + PITR, S3, SQS, Lambda, CloudWatch Logs | per use | < 2 at demo traffic |
| **Total** | | **≈ $75–90 per month (≈ $2.5–3 a day)**; about $40–50 with `--no-nat` |
| **Free mode (default)** | | **$0 within the free tier**: t3.micro, 16 GB gp3 and one public IPv4 fit the 750-hour / 30 GB allowances; everything else is per-use. After the free tier: ≈ $12 per month |

The first four rows bill every hour the stack exists. For a hackathon, deploy a day or two before the demo and delete the stack afterwards. Check AWS Free Tier credits on a new account; t4g.small has had a free trial allowance.

## 10. Troubleshooting

* **The app doesn't come up after the first deploy.** The instance waits up to 20 minutes for `_releases/latest.tgz`; `deploy.mjs` uploads it after the stack finishes. Check the bootstrap: Session Manager → `sudo tail -100 /var/log/cloud-init-output.log`.
* **You get 502 or 504 from CloudFront.** The target is unhealthy. Check EC2 → Target groups → health, then `sudo systemctl status orbis` and `sudo tail -100 /var/log/orbis/app.log` (also in CloudWatch under `/orbis/app`).
* **The ALB address returns 403.** This is expected: only CloudFront (with the secret header) is allowed through.
* **AI says unavailable.** Check that `/orbis/GEMINI_API_KEY` exists and that the NAT is enabled, then run `npm run aws:deploy -- --no-build`.
* **"Saving failed on the server; retrying…"** S3 or DynamoDB is unreachable or permission was denied. Edits stay in memory and are retried every 5 s. Check the app log for the AWS error.
* **Cleanup jobs are piling up.** Look at the `orbis-jobs-dlq` queue and `/aws/lambda/orbis-worker` logs.

## 11. Limits and next steps

* One app instance by design. Scaling out would need a shared session layer (e.g. routing each project to one instance), which a demo doesn't need.
* Uploads go through the server (40 MB JSON limit, 20 MB GLB) for validation. Presigned direct uploads would remove that hop, but the server would need to check files after the upload.
* A custom domain needs an ACM certificate in **us-east-1** plus `Aliases` and `ViewerCertificate` on the distribution. It isn't templated yet.

## 12. Manual steps

0. ap-south-1 is enabled by default; nothing to opt into.
1. In IAM, create a deploy user or SSO role. For a hackathon, `AdministratorAccess` is simplest; at minimum it needs CloudFormation, EC2, ELB, AutoScaling, IAM, S3, DynamoDB, SQS, Lambda, CloudFront, Logs and SSM. Then run `aws configure` on your machine yourself; never paste keys into chat or code.
2. Pick the region, e.g. `aws configure set region ap-south-1`.
3. Run `npm run aws:deploy`.
4. Store the secrets with `npm run aws:secret -- ...` (section 6).
5. Run `npm run aws:migrate` (section 6), then `npm run aws:deploy -- --no-build`.
6. Open the `AppUrl` output and run `npm run smoke:collab -- <AppUrl>`.
7. Optional: set an AWS Budgets alert (e.g. $25) in the Billing console.
8. When finished, delete the stack, then the retained bucket and tables if you don't need the data.
