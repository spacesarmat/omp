# OMP billing panel — build from repo root:
#   docker build -f ops/vps/Dockerfile -t ghcr.io/spacesarmat/omp-billing ops/billing
FROM node:24-bookworm-slim

WORKDIR /app

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
