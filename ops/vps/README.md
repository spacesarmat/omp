# OMP VPS stack

Docker Compose on a single VPS: **Caddy** (TLS) → **billing**, **Jackett**, **JacRed**, **TorrServer**, plus **FlareSolverr** (localhost only). On the host, [`jackett-monitor/`](jackett-monitor/README.md) tests Jackett indexers every 30 minutes and disables ones that keep failing.

Hostnames (Cloudflare A → VPS IP, orange cloud):

| Host | Upstream |
|------|----------|
| `omp-player.online` / `www` | static `site/` (landing) |
| `billing.omp-player.online` | `billing:8787` |
| `jackett.omp-player.online` | `jackett:9117` (+ basic auth) |
| `jacred.omp-player.online` | `jacred:9117` (+ basic auth) |

Cloudflare DNS: A `@` and `www` → VPS IP, proxied (same as billing). SSL/TLS **Full (strict)**. Cloudflare Tunnel is not used.

Caddy allows TLS 1.2 and 1.3 only (automatic certificates are unchanged) and adds the same response headers on every host: `Strict-Transport-Security: max-age=15552000; includeSubDomains` (no preload), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, and removes `Server`. Apply a Caddyfile change with `caddy reload` (the file is bind-mounted). HEAD/OPTIONS behaviour is in the billing image, so that container needs a new image before a restart picks it up.

JacRed syncs from `https://sync.jacred.stream` (`syncapi`). `jacred/init.yaml` sets `syncsport: false`, `syncspidr: false`, and `timeSync: 120`. Spidr is off because it pulled torrents far beyond the 16 `synctrackers`. That list is a 16-tracker subset of the jacred-fdb defaults ([`Data/init.yaml`](https://github.com/immisterio/jacred-fdb/blob/main/Data/init.yaml); the image is `ghcr.io/jacred-fdb/jacred`), trimmed for a 2 GB VPS. FileDB change logging stays on (`logFdb: true`) and is capped at `logFdbRetentionDays: 1`, `logFdbMaxSizeMb: 500`, and `logFdbMaxFiles: 3`, after the log grew to 11 GB in an hour. `tracks` is `false`, so JacRed does not ffprobe TorrServer at `http://torrserver:8090`; that saves RAM. `apikey` and `devkey` stay `change-me` in git. Watch memory after sync starts and trim `synctrackers` if the box is still tight.

JacRed text search normalizes the query (lower case, letters and digits only) and opens that exact FileDB key. If the key has any torrents, JacRed does not scan keys that merely contain the word. `matrix` is a different key from `thematrix` and from `матрица`, so a Latin query can come back with only the releases named exactly that word, while `Война миров` hits the Russian title key and returns the whole bucket. Billing does not send `cat`, `year`, or `limit` (JacRed pages only when `limit` is present; its caps document a default of 100, and the code does not apply that default). When a Latin query comes back with fewer than 8 items, billing searches once more without the last two letters (`matrix` → `matr`), which misses the exact key and lets the substring scan run. There is no `init.yaml` key for that exact-key stop. JacRed's `maxreadfile` (code default 200; this file does not set it) only caps how many buckets a substring scan opens. It is not what cut `matrix` to a handful, so this template does not raise it.

JacRed on a 2 GB VPS needs swap. `/etc/fstab` mounts a 2 GB `/swapfile`. `/etc/sysctl.d/99-omp-swap.conf` sets `vm.swappiness=10`.

FlareSolverr solves Cloudflare challenges for Jackett and JacRed indexers. The host publish is `127.0.0.1:8191` only. Jackett's manual settings live in the Jackett UI (under `data/jackett/`, not in git): **FlareSolverrUrl** `http://flaresolverr:8191/` with timeout `55000`, and an HTTP proxy at `warp:1080`. The Jackett admin password is only on the server, in `/root/jackett-admin-password.txt` (owner root, mode `600`). Do not commit that file.

These Jackett indexers were disabled by moving their definitions to `data/jackett/Jackett/Indexers-disabled/`: `newstudio`, `opensharing`, `pctorrent`, `torrent-pirat`, `torrentby`, `xxxtor`. Restore one by moving it back into `data/jackett/Jackett/Indexers/` and restarting Jackett (`docker compose restart jackett`).

[`jackett-monitor/`](jackett-monitor/README.md) is already installed on the VPS as a systemd timer (`:07` and `:37`). It reads the Jackett admin password and the Telegram token from files on the server. Neither value is in git. `deploy.sh` does not copy this directory; update the VPS copy with `sudo ./install.sh` from `jackett-monitor/`.

`warp` (`caomingjun/warp`) provides an HTTP proxy on `:1080` so the billing bot can reach `api.telegram.org` when the VPS IP is blocked. Jackett uses that same proxy.

`BILLING_BOT_POLL` chooses whether this process calls Telegram `getUpdates`. The default is `1` (poll). The live VPS container must be the only poller. Set `BILLING_BOT_POLL=0` on every other copy (a dev checkout, the NAS compose, an old container) and restart it. Two pollers split updates: the extra process answers `/start admin_<token>` with «Ссылка для входа устарела» for tokens it does not have. A 409 `terminated by other getUpdates request` is written to the billing log at most once a minute. If admin Telegram notices are on, admins get one message an hour. The panel tab **Сервисы** shows the last successful `getUpdates` and whether that 409 was seen in the last 15 minutes. Admin login links last 10 minutes. `0`, `false`, `off`, and `no` turn polling off. Any other value, including an empty one, leaves it on.

## Emergency admin login

The billing panel signs in through Telegram only. `POST /admin/login` rejects a password. `BILLING_ADMIN_PASSWORD`, if it is still set in `.env`, is unused — leave `.env` as it is.

If Telegram is down, mint a one-time link from the VPS shell. It lives 10 minutes, works once, and is written to the admin journal as actor `cli`. The command prints the URL on stdout and does not write the token into the container log or the database (only a hash is stored).

```bash
docker exec omp-billing node src/adminLoginLink.mjs
```

Open that URL in a browser. The public host comes from the panel setting «Публичный адрес», or from `BILLING_PUBLIC_ORIGIN` when the setting is empty.

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
6. Edit `jacred/init.yaml` on the VPS: set `apikey` / `devkey`. Leave them as `change-me` in git. `tracks` is already `false`.
8. `docker compose up -d`
9. Copy the Jackett API key from `data/jackett/.../ServerConfig.json` into the billing admin **Сервисы** tab (never into the APK or git). JacRed key → same tab. In Jackett set **FlareSolverrUrl** to `http://flaresolverr:8191/` with timeout `55000`, and the proxy to HTTP `warp:1080`. The admin password stays in `/root/jackett-admin-password.txt` (root, `600`). Keep real `INDEXER_*` only in VPS `.env` (gitignored). Phones use `/v1/search` / `/v1/torrent` only.
10. Cloudflare DNS: A `billing` / `jackett` / `jacred` → VPS IP, proxied. SSL/TLS mode **Full (strict)**. Do not publish these names on a Cloudflare Tunnel.
11. UFW: allow `22`, `80`, `443` only. Leave FlareSolverr bound to `127.0.0.1:8191`.

## Local image build (without GHCR)

```bash
docker build -f ops/vps/Dockerfile -t ghcr.io/spacesarmat/omp-billing:local ops/billing
# in ops/vps/.env: BILLING_IMAGE=ghcr.io/spacesarmat/omp-billing:local
```

On the VPS, billing is built from `/opt/omp-vps/billing-src` with `/opt/omp-vps/Dockerfile.billing` (the copy of `ops/vps/Dockerfile`) as `ghcr.io/spacesarmat/omp-billing:local`. `deploy.sh` runs that build. The billing service sets `BILLING_JACKETT_INDEXER_TIMEOUT_MS=12000` (one indexer) and `BILLING_JACKETT_SEARCH_DEADLINE_MS=18000` (the whole search). Those match the defaults in `ops/billing/src/jackett.mjs`.
