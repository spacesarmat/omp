# bitmagnet

Permanent DHT index next to Jackett and JacRed on the NUC (Andy, 17.11.2026). It is also an optional Torznab source: it is off in OMP until an admin sets the URL and turns the switch on. This compose file is not started by `deploy.sh`, does not join the `omp` network, and does not mount billing data, the stack `.env`, or Caddy. The project name `omp-bitmagnet-test` is historical; the stack stays.

## DHT crawler

The crawler runs (`--keys=dht_crawler`) and publishes the swarm port 3334 tcp+udp, per official bitmagnet docs. It crawls DHT for infohashes and stores real seeders/leechers per source (`DHT`), about 1 million torrents after a week. The NUC is LAN-only: do not forward 3334 or 3333 on the router and do not publish them through Caddy or Cloudflare. Web/Torznab/GraphQL (3333) stay on `BITMAGNET_BIND` only (LAN or loopback, never `0.0.0.0`).

Counts are read over GraphQL: `POST http://<bind>:3333/graphql`, `torrentContent.search(input:{infoHashes:[...]})` -> `items[].torrent.seeders/leechers/updatedAt` (the `torrent_contents` aggregate can be null). There is no on-demand re-scrape: `reprocess` only re-runs classification, so counts age with the crawler cycle (days for rare hashes).

## Resources

Upstream asks for about 300 MB RAM for bitmagnet and at least 1 GB RAM for Postgres. This file caps bitmagnet at 512 MB and Postgres at 1 GB, with 256 MB of Postgres shared memory. Measured on the NUC 17.11.2026: the Postgres volume is about 8 GB per 1 million torrents; upstream's guide is about 80 GB of disk per 10 million torrents. The NUC has ~840 GB free - watch the volume before the index grows past a few million.

## Start

From this directory, on the NUC, by hand:

```
cp bitmagnet.env.example .env
# edit BITMAGNET_PG_PASSWORD
docker compose --env-file .env up -d
```

`TMDB_API_KEY` in `.env` is optional (metadata classification); empty is fine. Torznab is `http://<bind>:3333/torznab`. Nothing is added to Caddy. To reach it from another machine on the home LAN, set `BITMAGNET_BIND` to the NUC LAN address and recreate the bitmagnet service. Do not bind `0.0.0.0` on 3333 and do not publish Postgres.

`127.0.0.1:3333` is only the NUC itself. The billing container cannot open that address. Set `BITMAGNET_BIND` to an address billing can route to, and put the same host in the admin URL. For the docker bridge that is often `BITMAGNET_BIND=172.17.0.1` and `http://172.17.0.1:3333`. A home LAN setup uses the NUC LAN address for both. Do not point billing at `172.17.0.1` while the port is still bound to `127.0.0.1`. The switch stays off until that URL is saved. Seed and leech counts from the feed go through the same `/v1/seed-check`. Rows with the same infohash are merged. An optional API key is `BILLING_BITMAGNET_API_KEY` in the billing `.env` (empty when bitmagnet has no key).

## Rollback

```
docker compose --env-file .env down
```

The Postgres volume stays. `docker compose --env-file .env down -v` deletes the index database. Neither command stops omp-billing, omp-postgres, or Caddy.
