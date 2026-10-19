# OMP billing panel — build from repo root:
#   docker build -f ops/vps/Dockerfile -t ghcr.io/spacesarmat/omp-billing ops/billing
FROM node:24-bookworm-slim

WORKDIR /app

# pg_dump 17 for the Postgres backups (src/pgBackup.mjs); Debian's own client is 15, so it comes from PGDG.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  && . /etc/os-release \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $VERSION_CODENAME-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-17 \
  && apt-get purge -y curl && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/* \
  && pg_dump --version

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public
COPY start.sh ./start.sh
RUN chmod +x start.sh

ENV NODE_ENV=production
ENV PORT=8787
ENV BILLING_HOST=0.0.0.0
ENV BILLING_DATA=/data/billing.db
# 1 polls Telegram getUpdates. Set 0 on any second billing process.
ENV BILLING_BOT_POLL=1

EXPOSE 8787

CMD ["node", "src/server.mjs"]
