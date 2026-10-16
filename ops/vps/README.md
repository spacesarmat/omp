# OMP VPS stack

Docker Compose on a single VPS: **Caddy** (TLS) → **billing**, **Jackett**, **JacRed**, **TorrServer**, plus **FlareSolverr** (localhost only).

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

FlareSolverr solves Cloudflare challenges for Jackett and JacRed indexers. The host publish is `127.0.0.1:8191` only. Jackett's **FlareSolverr API URL** = `http://flaresolverr:8191`.

`warp` (`caomingjun/warp`) provides an HTTP proxy on `:1080` so the billing bot can reach `api.telegram.org` when the VPS IP is blocked.

## Update billing from git

CI builds `ops/billing` and pushes `ghcr.io/spacesarmat/omp-billing:latest` (workflow `billing-image.yml`).

On the VPS:

```bash
cd /opt/omp-vps
docker compose pull billing
docker compose up -d billing
```

To refresh compose / Caddy / JacRed config from the repo:

```bash
cd /opt/omp-vps
git pull   # or rsync ops/vps from the monorepo
docker compose pull && docker compose up -d
```

`up -d` recreates a service whose image, environment, ports, or mounts changed. That includes Caddy: `caddy reload` only rereads the Caddyfile inside the container that is already running, so a new `INDEXER_HASH`, image, port, or volume stays on the old container until `up -d`. Use reload only for a Caddyfile-only edit (the file is bind-mounted):

```bash
docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
```

## First install

1. Install Docker Engine + Compose plugin.
2. Copy this directory to `/opt/omp-vps` (or clone the monorepo and `cd ops/vps`).
3. `cp .env.example .env` and set a unique `INDEXER_HASH` (required; compose will not start without it).
4. Put the existing SQLite DB at `data/billing/billing.db` (do not start with an empty DB if you already have subscriptions).
5. `mkdir -p data/{billing,jackett,jacred,torrserver/{config,torrents}} && chown -R 1000:1000 data/jackett data/jacred data/torrserver`
6. Edit `jacred/init.yaml`: set `apikey` / `devkey`.
8. `docker compose up -d`
9. Copy the Jackett API key from `data/jackett/.../ServerConfig.json` into the billing admin **Сервисы** tab (never into the APK or git). JacRed key → same tab. In Jackett set **FlareSolverr API URL** to `http://flaresolverr:8191`. Keep real `INDEXER_*` only in VPS `.env` (gitignored). Phones use `/v1/search` / `/v1/torrent` only.
10. Cloudflare DNS: A `billing` / `jackett` / `jacred` → VPS IP, proxied. SSL/TLS mode **Full (strict)**. Do not publish these names on a Cloudflare Tunnel.
11. UFW: allow `22`, `80`, `443` only. Leave FlareSolverr bound to `127.0.0.1:8191`.

## Local image build (without GHCR)

```bash
docker build -f ops/vps/Dockerfile -t ghcr.io/spacesarmat/omp-billing:local ops/billing
# in ops/vps/.env: BILLING_IMAGE=ghcr.io/spacesarmat/omp-billing:local
```
