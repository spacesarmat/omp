# On-demand DHT peer counts. Build from ops/vps:
#   docker compose --profile dht build dht-peers
FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

ENV NODE_ENV=production
ENV DHT_HTTP_PORT=8788
ENV NODE_OPTIONS=--max-old-space-size=96

USER node
EXPOSE 8788

CMD ["node", "src/main.mjs"]
