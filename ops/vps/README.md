# OMP VPS stack

Docker Compose on a single VPS: **Caddy** (TLS) → **billing**, **Jackett**, **JacRed**, **TorrServer**.

Hostnames (Cloudflare A → VPS IP, orange cloud):

| Host | Upstream |
|------|----------|
| `omp-player.online` / `www` | static `site/` (landing) |
| `billing.omp-player.online` | `billing:8787` |
| `jackett.omp-player.online` | `jackett:9117` (+ basic auth) |
| `jacred.omp-player.online` | `jacred:9117` (+ basic auth) |

Cloudflare DNS: A `@` and `www` → VPS IP, proxied (same as billing). SSL/TLS **Full (strict)**. Cloudflare Tunnel is not used.

Caddy allows TLS 1.2 and 1.3 only (automatic certificates are unchanged) and adds the same response headers on every host: `Strict-Transport-Security: max-age=15552000; includeSubDomains` (no preload), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, and removes `Server`. Apply a Caddyfile change with `caddy reload` (the file is bind-mounted). HEAD/OPTIONS behaviour is in the billing image, so that container needs a new image before a restart picks it up.

JacRed talks to TorrServer at `http://torrserver:8090` (`tracks` / ffprobe).

`warp` (`caomingjun/warp`) provides an HTTP proxy on `:1080` so the billing bot can reach `api.telegram.org` when the VPS IP is blocked.

## Update billing from git

CI builds `ops/billing` and pushes `ghcr.io/spacesarmat/omp-billing:latest` (workflow `billing-image.yml`). Use that only when `.env` points `BILLING_IMAGE` at the GHCR tag:

```bash
cd /opt/omp-vps
docker compose pull billing
docker compose up -d billing
```

`/opt/omp-vps` is not a git checkout. Landing, Caddyfile, and the locally built billing image are updated with `deploy.sh` (below). `docker-compose.yml` and `jacred/init.yaml` are not part of that script; copy those by hand when they change, and do not overwrite `.env` or `data/`.

`up -d` recreates a service whose image, environment, ports, or mounts changed. That includes Caddy: `caddy reload` only rereads the Caddyfile inside the container that is already running, so a new `INDEXER_HASH`, image, port, or volume stays on the old container until `up -d`. Use reload only for a Caddyfile-only edit (the file is bind-mounted):

```bash
docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile
```

## Deploy landing and local billing

`deploy.sh` runs on the VPS (or over SSH) and publishes four paths from a git ref:

| Repo | On the VPS |
|------|------------|
| `ops/vps/Caddyfile` | `/opt/omp-vps/Caddyfile` |
| `ops/vps/site/` | `/opt/omp-vps/site/` (Caddy `/srv/site`) |
| `ops/vps/Dockerfile` | `/opt/omp-vps/Dockerfile.billing` |
| `ops/billing/` | `/opt/omp-vps/billing-src/` |

It downloads the ref, copies those paths to `/opt/omp-vps-backup-<ref>-<utc>`, and tags the current `ghcr.io/spacesarmat/omp-billing:local` image before replacing anything. A `/` in the ref becomes `-`. `node --check` runs on billing `*.mjs`. The image is rebuilt and `docker compose up -d billing` runs only when billing source or `Dockerfile.billing` changed. A Caddyfile change reloads Caddy. A site-only change is served from the bind mount. Health checks hit Caddy on `127.0.0.1` with the public names: `GET`/`HEAD`/`OPTIONS /health`, `GET /admin`, landing `GET /` is 200, and each response has the security headers and no `Server`. HEAD uses `curl --head`, because billing answers with `Content-Length` and no body. Any failure after the backup restores that backup and the previous image. `--rollback` restores the files, reloads Caddy, and restores the billing image before health checks. A failed Caddy reload still restores the billing image, then the rollback exits non-zero. It always runs `docker compose up -d billing`, then checks that container `omp-billing` is running that image. A backup with no image id still rebuilds from the restored `Dockerfile.billing` and `billing-src`. A second `--rollback` of the same backup restarts billing again.

`.env` must already contain `BILLING_IMAGE=ghcr.io/spacesarmat/omp-billing:local`. The script reads that line and refuses to continue if it does not match the tag it builds. It never writes `.env` or `data/`, and backups do not include them.

```bash
bash ops/vps/deploy.sh --dry-run main
bash ops/vps/deploy.sh main
bash ops/vps/deploy.sh --rollback /opt/omp-vps-backup-main-20261016T120000123456789Z
```

The deploy prints `backup=` with the directory it created. Copy that path into `--rollback`.

Dry-run downloads the ref and prints the plan. It does not back up, sync, build, or reload. From a checkout, the same script can be fed over SSH (`bash -s` does not use stdin for anything else):

```bash
ssh root@vps 'bash -s -- --dry-run main' < ops/vps/deploy.sh
```

Needs bash 4.4+, curl, rsync, GNU diff, flock, node, and Docker Compose v2. A private repo needs `GITHUB_TOKEN` or `GH_TOKEN` for the archive download.

### GitHub Actions

`.github/workflows/vps-deploy.yml` is manual (`workflow_dispatch`). It does not run on push. Inputs are `ref` (branch, tag, or SHA) and optional `dry_run`. Add these repository secrets yourself; nothing in the repo creates them, and the job stops with a short message when either is missing:

| Secret | Value |
|--------|--------|
| `VPS_HOST` | Hostname or `user@host`. User defaults to `root`. Port is 22. |
| `VPS_SSH_KEY` | Private key in the VPS `authorized_keys`. No passphrase. |

The job checks out the workflow's own revision (`github.sha`, the branch selected as "Use workflow from") and passes `ref` only as the release to download. An older tag still deploys with these scripts. It copies `deploy.sh` over SSH and runs it. It forwards the Actions `GITHUB_TOKEN` only so the VPS can download a private tarball, then deletes that file during the session. The first connection accepts the host key (`StrictHostKeyChecking=accept-new`).

## First install

1. Install Docker Engine + Compose plugin.
2. Copy this directory to `/opt/omp-vps` (or clone the monorepo and `cd ops/vps`).
3. `cp .env.example .env` and set a unique `INDEXER_HASH` (required; compose will not start without it).
4. Put the existing SQLite DB at `data/billing/billing.db` (do not start with an empty DB if you already have subscriptions).
5. `mkdir -p data/{billing,jackett,jacred,torrserver/{config,torrents}} && chown -R 1000:1000 data/jackett data/jacred data/torrserver`
6. Edit `jacred/init.yaml`: set `apikey` / `devkey`.
8. `docker compose up -d`
9. Copy the Jackett API key from `data/jackett/.../ServerConfig.json` into the billing admin **Сервисы** tab (never into the APK or git). JacRed key → same tab. Keep real `INDEXER_*` only in VPS `.env` (gitignored). Phones use `/v1/search` / `/v1/torrent` only.
10. Cloudflare DNS: A `billing` / `jackett` / `jacred` → VPS IP, proxied. SSL/TLS mode **Full (strict)**. Do not publish these names on a Cloudflare Tunnel.
11. UFW: allow `22`, `80`, `443` only.

## Local image build (without GHCR)

```bash
docker build -f ops/vps/Dockerfile -t ghcr.io/spacesarmat/omp-billing:local ops/billing
# in ops/vps/.env: BILLING_IMAGE=ghcr.io/spacesarmat/omp-billing:local
```

On the VPS, `deploy.sh` runs that build from `Dockerfile.billing` with context `billing-src`.
