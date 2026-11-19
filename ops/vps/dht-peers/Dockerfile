# On-demand DHT peer counts. Build from ops/vps:
#   docker compose --profile dht build dht-peers
FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
# Same NUC egress TLS 1.3 stall as the billing image: scope TLS 1.2 and retries to this step.
RUN NODE_OPTIONS=--tls-max-v1.2 npm ci --omit=dev --fetch-retries=5 --fetch-retry-maxtimeout=120000 && npm cache clean --force

COPY src ./src

ENV NODE_ENV=production
ENV DHT_HTTP_PORT=8788
ENV NODE_OPTIONS=--max-old-space-size=96

# Writable mount point for the persistent routing table. A named volume inherits this ownership,
# so the non-root node user can save the table (a root-owned bind mount would block writes).
RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 8788

CMD ["node", "src/main.mjs"]
