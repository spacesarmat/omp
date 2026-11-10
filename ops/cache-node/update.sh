#!/usr/bin/env bash
# Обновляет файлы узла из этого каталога и пересобирает контейнеры. Конфиг с токеном не затирает.
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Запустите от root: sudo ./update.sh" >&2
  exit 1
fi

SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="/opt/omp-cache-node"
CONF="/etc/omp-cache-node/config.env"

if [[ ! -f "${CONF}" ]]; then
  echo "Сначала выполните install.sh" >&2
  exit 1
fi

install -d -m 755 "${DEST}"
tar -C "${SRC}" --exclude .env -cf - . | tar -C "${DEST}" -xf -
ln -sfn "${CONF}" "${DEST}/.env"
docker compose -f "${DEST}/docker-compose.yml" --env-file "${CONF}" up -d --build
echo "Узел обновлен."
