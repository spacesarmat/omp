# OMP VPS stack

Docker Compose on a single VPS: **Caddy** (TLS) → **billing**, **Jackett**, **JacRed**, **TorrServer**.

Hostnames (Cloudflare A → VPS IP, orange cloud):

| Host | Upstream |
|------|----------|
| `billing.omp-player.online` | `billing:8787` |
| `jackett.omp-player.online` | `jackett:9117` (+ basic auth) |
| `jacred.omp-player.online` | `jacred:9117` (+ basic auth) |

JacRed talks to TorrServer at `http://torrserver:8090` (`tracks` / ffprobe).

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
docker compose pull
docker compose up -d
```

## First install

1. Install Docker Engine + Compose plugin.
2. Copy this directory to `/opt/omp-vps` (or clone the monorepo and `cd ops/vps`).
3. `cp .env.example .env` and set `INDEXER_HASH` if you rotate the password.
4. Put the existing SQLite DB at `data/billing/billing.db` (do not start with an empty DB if you already have subscriptions).
5. `mkdir -p data/{billing,jackett,jacred,torrserver/{config,torrents}} && chown -R 1000:1000 data/jackett data/jacred data/torrserver`
6. Edit `jacred/init.yaml`: set `apikey` / `devkey`.
8. `docker compose up -d`
9. Copy the Jackett API key from `data/jackett/.../ServerConfig.json` into the billing panel and `src/billing/indexers.ts`.
10. Cloudflare DNS: A `billing` / `jackett` / `jacred` → VPS IP, proxied. SSL/TLS mode **Full**. Disable the old Tunnel public hostnames for these names.
11. UFW: allow `22`, `80`, `443` only.

## Local image build (without GHCR)

```bash
docker build -f ops/vps/Dockerfile -t ghcr.io/spacesarmat/omp-billing:local ops/billing
# in ops/vps/.env: BILLING_IMAGE=ghcr.io/spacesarmat/omp-billing:local
```
