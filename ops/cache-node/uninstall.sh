#!/usr/bin/env bash
# Останавливает узел. --purge удаляет тома, конфиг и /opt/omp-cache-node.
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Запустите от root: sudo ./uninstall.sh" >&2
  exit 1
fi

DEST="/opt/omp-cache-node"
CONF="/etc/omp-cache-node/config.env"
if [[ -f "${DEST}/docker-compose.yml" ]]; then
  if [[ -f "${CONF}" ]]; then
    docker compose -f "${DEST}/docker-compose.yml" --env-file "${CONF}" down
  else
    docker compose -f "${DEST}/docker-compose.yml" down
  fi
fi

if [[ "${1:-}" == "--purge" ]]; then
  if [[ -f "${DEST}/docker-compose.yml" ]]; then
    if [[ -f "${CONF}" ]]; then
      docker compose -f "${DEST}/docker-compose.yml" --env-file "${CONF}" down -v
    else
      docker compose -f "${DEST}/docker-compose.yml" down -v
    fi
  fi
  rm -rf /etc/omp-cache-node "${DEST}"
  echo "Узел удален вместе с данными."
else
  echo "Контейнеры остановлены. Данные и ${CONF} на месте. Для удаления: uninstall.sh --purge"
fi
