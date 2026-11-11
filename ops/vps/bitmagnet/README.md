# Test bitmagnet

Optional Torznab index next to Jackett and JacRed. It is off in OMP until an admin sets the URL and turns the switch on. This compose file is not started by `deploy.sh`, does not join the `omp` network, and does not mount billing data, the stack `.env`, or Caddy.

## Resources

Upstream asks for about 300 MB RAM for bitmagnet and at least 1 GB RAM for Postgres. This file caps bitmagnet at 512 MB and Postgres at 1 GB, with 256 MB of Postgres shared memory. An API-only database (the DHT crawler is off) stays small, a few hundred MB. Upstream's own guide is about 80 GB of disk per 10 million torrents once the crawler runs. Do not add `--keys=dht_crawler` without that disk budget.

## Start

From this directory, on the NUC, by hand:

```
cp bitmagnet.env.example .env
# edit BITMAGNET_PG_PASSWORD
docker compose --env-file .env up -d
```

Torznab is `http://127.0.0.1:3333/torznab`. Nothing is added to Caddy. To reach it from another machine on the home LAN, set `BITMAGNET_BIND` to the NUC LAN address and recreate the bitmagnet service. Do not bind `0.0.0.0` and do not publish port 3334 or Postgres.

`127.0.0.1:3333` is only the NUC itself. The billing container cannot open that address. Set `BITMAGNET_BIND` to an address billing can route to, and put the same host in the admin URL. For the docker bridge that is often `BITMAGNET_BIND=172.17.0.1` and `http://172.17.0.1:3333`. A home LAN test uses the NUC LAN address for both. Do not point billing at `172.17.0.1` while the port is still bound to `127.0.0.1`. The switch stays off until that URL is saved. Seed and leech counts from the feed go through the same `/v1/seed-check`. Rows with the same infohash are merged. An optional API key is `BILLING_BITMAGNET_API_KEY` in the billing `.env` (empty when bitmagnet has no key).

## Rollback

```
docker compose --env-file .env down
```

The Postgres volume stays. `docker compose --env-file .env down -v` deletes the test database. Neither command stops omp-billing, omp-postgres, or Caddy.
