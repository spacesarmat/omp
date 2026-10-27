# OMP VPS stack

Docker Compose on a single VPS: **Caddy** (TLS) → **billing**, **Jackett**, **JacRed**, **TorrServer**, plus **FlareSolverr** (localhost only). **docker-proxy** (`omp-docker-proxy`, `tecnativa/docker-socket-proxy`) gives billing a read-only Docker API for the panel's «Мониторинг» tab: `CONTAINERS=1`, `POST=0`, the socket mounted `:ro`, internal network `dockerapi` (billing and the proxy only), nothing published. Billing reads container state, restarts and memory through it and cannot start, stop or restart anything. See `ops/billing/README.md` (Мониторинг). On the host, [`jackett-monitor/`](jackett-monitor/README.md) tests Jackett indexers every 30 minutes and disables ones that keep failing, and [`jacred-config-sync/`](jacred-config-sync/) copies the running JacRed config back to the host every minute.

Hostnames (Cloudflare A → VPS IP, orange cloud):

| Host | Upstream |
|------|----------|
| `omp-player.online` | static `site/` (landing); unknown paths are a real 404 with `site/404.html` |
| `www.omp-player.online` | 301 to `https://omp-player.online{uri}` (path and query kept) |
| `billing.omp-player.online` | `billing:8787` |
| `jackett.omp-player.online` | `jackett:9117` (+ basic auth) |
| `jacred.omp-player.online` | `jacred:9117` (+ basic auth) |

Cloudflare DNS: A `@` and `www` → VPS IP, proxied (same as billing). SSL/TLS **Full (strict)**. Cloudflare Tunnel is not used.

Caddy allows TLS 1.2 and 1.3 only (automatic certificates are unchanged) and adds the same response headers on every host: `Strict-Transport-Security: max-age=15552000; includeSubDomains` (no preload), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (except the landing, see Yandex.Metrika below), `Referrer-Policy: strict-origin-when-cross-origin`, and removes `Server`. Apply a Caddyfile change with `caddy reload` (the file is bind-mounted). HEAD/OPTIONS behaviour is in the billing image, so that container needs a new image before a restart picks it up.

JacRed syncs from `https://sync.jacred.stream` (`syncapi`). `jacred/init.yaml` sets `syncsport: false`, `syncspidr: false`, and `timeSync: 120`. Spidr is off because it pulled torrents far beyond the 16 `synctrackers`. That list is a 16-tracker subset of the jacred-fdb defaults ([`Data/init.yaml`](https://github.com/immisterio/jacred-fdb/blob/main/Data/init.yaml); the image is `ghcr.io/jacred-fdb/jacred`), trimmed for a 2 GB VPS. FileDB change logging stays on (`logFdb: true`) and is capped at `logFdbRetentionDays: 1`, `logFdbMaxSizeMb: 500`, and `logFdbMaxFiles: 3`, after the log grew to 11 GB in an hour. `tracks` is `false`, so JacRed does not ffprobe TorrServer at `http://torrserver:8090`; that saves RAM. `apikey` and `devkey` stay `change-me` in git. Watch memory after sync starts and trim `synctrackers` if the box is still tight.

**Where JacRed really reads its config.** JacRed reads `/app/init.yaml` inside the container, not the bind-mounted `/app/config/init.yaml`. On every start the image entrypoint copies `/app/config/init.yaml` (the host file `/opt/omp-vps/jacred/init.yaml`) over `/app/init.yaml`, so the host file is the pinned config and wins after a restart or recreate. JacRed hot-reloads `/app/init.yaml` about 10 s after it changes. On the NUC the host file is a full copy of the running config (since 2026-10-22), including `globalproxy`, which sends `sync.jacred.stream` through `http://warp:1080` because the direct path from the NUC stalls (git keeps only the template).
- Saving in the JacRed admin UI writes `/app/init.yaml` only. A save keeps `globalproxy` (the editor round-trips the whole config, tested) and applies at once. [`jacred-config-sync/`](jacred-config-sync/) copies it back to the host file every minute (systemd timer `jacred-config-sync.timer`), so the save also survives a restart or recreate. Each run reads `/app/init.yaml` with `docker exec` and skips (one journal line) when `omp-jacred` is not running, the read fails, the file is empty, is not valid YAML (PyYAML when the host has it), has no `syncapi`, or has no `globalproxy` entry for `sync.jacred.stream` through `http://warp:1080`. When the file differs from the host copy, the script saves the host file to `/var/backups/jacred-config/init.yaml.<UTC time>` (root only, newest 20 kept) and writes the new content in place, then compares it. In place, not by rename, because the host file is a single-file bind mount and a rename would leave the container on the old inode. It never restarts a container and never prints the config (it holds `apikey`/`devkey`). An identical file logs nothing. Logs: `journalctl -u jacred-config-sync`. Install or update from that directory with `sudo ./install.sh`; `deploy.sh` does not copy it.
- Because of that timer the running config is the source of truth: a hand edit of the host file alone is reverted within a minute (the previous version stays in the backup dir). Change the config in the container instead (admin UI, or edit a copy and write it with `docker exec -i omp-jacred sh -c 'cat > /app/init.yaml'` after checking the copy is not empty); the timer then pins it. To pause the copy-back: `sudo systemctl stop jacred-config-sync.timer`.
- A bind mount straight onto `/app/init.yaml` does not work: the entrypoint's `install` cannot replace a mount point (the container would not start), and the admin UI saves by rename, which fails with "resource busy".

JacRed text search normalizes the query (lower case, letters and digits only) and opens that exact FileDB key. If the key has any torrents, JacRed does not scan keys that merely contain the word. `matrix` is a different key from `thematrix` and from `матрица`, so a Latin query can come back with only the releases named exactly that word, while `Война миров` hits the Russian title key and returns the whole bucket. Billing does not send `cat`, `year`, or `limit` (JacRed pages only when `limit` is present; its caps document a default of 100, and the code does not apply that default). When a Latin query comes back with fewer than 8 items, billing searches once more without the last two letters (`matrix` → `matr`), which misses the exact key and lets the substring scan run. There is no `init.yaml` key for that exact-key stop. JacRed's `maxreadfile` (code default 200; this file does not set it) only caps how many buckets a substring scan opens. It is not what cut `matrix` to a handful, so this template does not raise it.

JacRed on a 2 GB VPS needs swap. `/etc/fstab` mounts a 2 GB `/swapfile`. `/etc/sysctl.d/99-omp-swap.conf` sets `vm.swappiness=10`.

FlareSolverr solves Cloudflare challenges for Jackett and JacRed indexers. The host publish is `127.0.0.1:8191` only. Jackett's manual settings live in the Jackett UI (under `data/jackett/`, not in git): **FlareSolverrUrl** `http://flaresolverr:8191/` with timeout `55000`, and an HTTP proxy at `warp:1080`. The Jackett admin password is only on the server, in `/root/jackett-admin-password.txt` (owner root, mode `600`). Do not commit that file.

These Jackett indexers were disabled by moving their definitions to `data/jackett/Jackett/Indexers-disabled/`: `newstudio`, `opensharing`, `pctorrent`, `torrent-pirat`, `torrentby`, `xxxtor`. Restore one by moving it back into `data/jackett/Jackett/Indexers/` and restarting Jackett (`docker compose restart jackett`).

[`jackett-monitor/`](jackett-monitor/README.md) is already installed on the VPS as a systemd timer (`:07` and `:37`). It reads the Jackett admin password and the Telegram token from files on the server. Neither value is in git. `deploy.sh` does not copy this directory; update the VPS copy with `sudo ./install.sh` from `jackett-monitor/`.

`warp` (`caomingjun/warp`) provides an HTTP proxy on `:1080` so the billing bot can reach `api.telegram.org` when the VPS IP is blocked. Jackett uses that same proxy.

`BILLING_ACTIVATE_IP_MAX` (20), `BILLING_ACTIVATE_CODE_MAX` (10) and `BILLING_ACTIVATE_WINDOW_SEC` (600) rate-limit `POST /v1/activate` per client IP (`CF-Connecting-IP`) and per code; `0` turns a limit off. `BILLING_LINK_CLEAR_REQUIRE_TOKEN=1` makes `/v1/link/clear` refuse calls without a subscription token (off by default: apps before PR-5 send only the device id; turning it on is a later step in [`ops/billing/README.md`](../billing/README.md), «Позже: `BILLING_LINK_CLEAR_REQUIRE_TOKEN=1`»). Defaults are in `docker-compose.yml`, so `.env` needs no change. Details: [`ops/billing/README.md`](../billing/README.md).

`BILLING_TOKEN_SECRET` (in `.env`, 64 hex characters from `openssl rand -hex 32`, root-only file) signs the 24-hour device access tokens; when it is empty or shorter than 32 characters, billing uses a random key stored in the database (`kv.token_secret`). The other secrets are in `.env` too: `BILLING_BOT_TOKEN`, `BILLING_YOOMONEY_SECRET`, `BILLING_SMTP_PASS`, `BILLING_JACKETT_API_KEY`, `BILLING_JACRED_API_KEY`, `BILLING_INDEXER_PASS`; the admin panel shows them read-only, and the move from the database is in [`ops/billing/README.md`](../billing/README.md#секреты---только-в-env). Changing it only makes current access tokens fail once: phones get a new one with their refresh token, nothing is unbound. `BILLING_LEGACY_TOKENS` (default `1`) keeps the old long-lived device tokens working; `0` refuses them (401 `legacy_disabled`) and refuses activation without `tokens: "pair"`, while `/v1/token/upgrade` keeps working. `GET /health` answers `{"ok":true,"botPollEnabled":true,"botPollOkAgoSec":12,"monitorScheduled":true,"monitorAgoSec":300,"monitorIntervalMin":15}`: seconds since the last successful `getUpdates` (`null` before the first one or with polling off) and since the last full «Мониторинг» run (`null` before the first), no secrets. The external watchdog `.github/workflows/billing-watchdog.yml` reads it every 15 minutes from GitHub Actions and tells Telegram once when billing stops answering, the bot stops polling or the monitor stops running, and once when it is fine again (secrets `TELEGRAM_BOT_TOKEN`, `WATCHDOG_TELEGRAM_CHAT_ID`). Details: [`ops/billing/README.md`](../billing/README.md).

`BILLING_BOT_POLL` chooses whether this process calls Telegram `getUpdates`. The default is `1` (poll). The live VPS container must be the only poller. Set `BILLING_BOT_POLL=0` on every other copy (a dev checkout, the NAS compose, an old container) and restart it. Two pollers split updates: the extra process answers `/start admin_<token>` with «Ссылка для входа устарела» for tokens it does not have. A 409 `terminated by other getUpdates request` is written to the billing log at most once a minute. If admin Telegram notices are on, admins get one message an hour. The panel tab **Сервисы** shows the last successful `getUpdates` and whether that 409 was seen in the last 15 minutes. Admin login links last 10 minutes. `0`, `false`, `off`, and `no` turn polling off. Any other value, including an empty one, leaves it on. Subscription reminders in Telegram (3 days before, the day before, the expiry day and once when the grace period ends, Moscow time) are sent by the same polling instance only, so `BILLING_BOT_POLL=0` on a copy also keeps it from sending reminders. The grace period after expiry is the panel setting «Льготный период, дней» (default 3); no `.env` change is needed.

## Home NUC (production)

Since 2026-10-19 the stack runs on the home NUC (`192.168.1.211`, `/opt/omp-vps`) instead of the VPS:

```bash
docker compose -f docker-compose.yml -f docker-compose.nuc.yml up -d
```

- `docker-compose.nuc.yml`: Caddy serves plain HTTP on `:80` with `Caddyfile.nuc` (TLS ends at Cloudflare); billing keeps `BILLING_BOT_POLL=1` (the NUC is the only `getUpdates` poller, the VPS `omp-billing` stays stopped).
- `postgres` (`omp-postgres`, Postgres 17) is the billing database for the move off SQLite: internal network `pg` only (billing and postgres), no published port, data in `data/postgres`, password `BILLING_PG_PASSWORD` in `.env` (required: compose refuses to start without it; generate on the server, never print). Billing runs on it since the cutover on 2026-10-19 17:13 MSK (`BILLING_STORE` default `postgres` in `docker-compose.nuc.yml`; `data/billing/billing.db` is no longer written and stays as the pre-cutover copy), and dumps the database into `/opt/omp-backups/pg` (root, 600) on the schedule set in the panel. Start, cutover, rollback and restore: [`docs/billing/postgres-cutover.md`](../../docs/billing/postgres-cutover.md). Do not run `docker compose config` without `-q` there: it prints the password.
- `warp-tunnel` is a separate WARP used only by the `cloudflared` connectors: the home ISP breaks Cloudflare Tunnel edge connections. Host traffic and Jackett/JacRed (via `warp`) are not routed through it.
- `cloudflared` runs tunnel `omp-nuc` (omp-player.online, www, billing, jackett, jacred -> `http://nuc-caddy:80`); `cloudflared-home-nas` is a replica connector for tunnel `home-nas` (music.omp-player.online -> NAS `192.168.1.191:8880`). Ingress is managed in Cloudflare.
- Tokens live only in `tunnel.env` and `tunnel-home-nas.env` (root, mode 600, see `tunnel.env.example`); they are git-ignored.

## Yandex.Metrika on the landing

`site/index.html` and `site/en/index.html` carry counter 113673968 (inline script in `<head>`, noscript pixel at the start of `<body>`). The landing CSP in `Caddyfile` and `Caddyfile.nuc` allows that inline script by its `sha256` and allows `mc.yandex.ru`, `mc.yandex.com`, and `yastatic.net` (scripts, hits, pixels, Webvisor frames). Any edit to the inline script needs a new hash in both Caddyfiles; `test/metrika.test.ts` fails until they match. Billing, Jackett, and JacRed have no counter. The landing sends no `X-Frame-Options` (it cannot list hosts); its CSP `frame-ancestors` allows `self` and the Metrika interface hosts from Yandex's CSP guide, so click and link maps can frame it. The other hosts keep `X-Frame-Options DENY`.

On the NUC Caddy reads `Caddyfile.nuc`, which `deploy.sh` does not publish. Copy it over the existing file in place (`cp`, not `mv` or `rsync`, so the single-file bind mount keeps the same inode), reload Caddy, then copy `site/`.

## Landing SEO

Both pages carry a title and description, `meta keywords`, `canonical`, hreflang ru/en/x-default, Open Graph and Twitter tags with `assets/og-image.jpg` (1200×630, the hero scene), and one JSON-LD `SoftwareApplication` block. JSON-LD is a data block, so CSP `script-src` does not apply and the Metrika hash is unchanged. `site/robots.txt` points at `site/sitemap.xml`; update `lastmod` there when page copy changes. `test/seo.test.ts` checks the tags, the image size, the JSON-LD and the sitemap. They ship with `site/`, so no Caddy change is needed.

## Emergency admin login

The billing panel signs in through Telegram only. `POST /admin/login` rejects a password. `BILLING_ADMIN_PASSWORD`, if it is still set in `.env`, is unused - leave `.env` as it is.

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

On the NUC the script needs no extra settings. When `docker-compose.nuc.yml` sits next to `docker-compose.yml`, every `docker compose` call gets `-f docker-compose.yml -f docker-compose.nuc.yml`, and the health checks use `http` on port `80` (Caddy there serves plain HTTP with `Caddyfile.nuc`; TLS ends at Cloudflare). The host has no node, so `node --check` runs in a throwaway container: `docker run --rm --network none` with the source mounted read-only, in the current billing image (or `OMP_NODE_IMAGE`, default `node:24-bookworm-slim`, when that image is missing). Overrides: `OMP_COMPOSE_FILES` (colon-separated names in `OMP_VPS_ROOT`), `OMP_HEALTH_SCHEME`/`OMP_HEALTH_PORT`, `OMP_NODE_CHECK=auto|host|docker`. Run it as root (`sudo`), because `.env` is root-only. `deploy.sh` still does not publish `Caddyfile.nuc`.

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
