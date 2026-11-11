#!/usr/bin/env bash
# Установка узла кэша на чистый Ubuntu. Не трогает сервер OMP и deploy.sh.
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Запустите от root: sudo ./install.sh" >&2
  exit 1
fi

SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="/opt/omp-cache-node"
CONF_DIR="/etc/omp-cache-node"
CONF="${CONF_DIR}/config.env"

if ! command -v docker >/dev/null 2>&1; then
  apt-get update
  apt-get install -y docker.io
fi
if ! docker compose version >/dev/null 2>&1; then
  apt-get update
  apt-get install -y docker-compose-v2 || true
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Нужен docker compose v2" >&2
  exit 1
fi

install -d -m 755 "${DEST}"
tar -C "${SRC}" --exclude .env -cf - . | tar -C "${DEST}" -xf -
install -d -m 700 "${CONF_DIR}"
if [[ ! -f "${CONF}" ]]; then
  install -m 600 "${SRC}/config.env.example" "${CONF}"
fi
ln -sfn "${CONF}" "${DEST}/.env"

# Read only the two required keys. The file is not sourced, so a value cannot run as shell.
conf_get() {
  local key="$1" file="$2" line val
  val=""
  while IFS= read -r line || [[ -n "${line}" ]]; do
    case "${line}" in
      "${key}="*) val="${line#"${key}"=}" ;;
    esac
  done < "${file}"
  printf '%s' "${val}"
}

billing_url="$(conf_get BILLING_URL "${CONF}")"
node_token="$(conf_get NODE_TOKEN "${CONF}")"
if [[ -z "${billing_url}" || -z "${node_token}" ]]; then
  echo "Заполните BILLING_URL и NODE_TOKEN в ${CONF} и запустите install.sh снова." >&2
  exit 2
fi
unset node_token

if [[ "${1:-}" == "--firewall" ]]; then
  "${DEST}/firewall.sh"
fi

docker compose -f "${DEST}/docker-compose.yml" --env-file "${CONF}" up -d --build
publish="$(conf_get CACHE_PUBLISH "${CONF}")"
if [[ -z "${publish}" ]]; then
  publish="127.0.0.1:8090"
fi
port="${publish##*:}"
echo "Готово. Проверка: curl -fsS http://127.0.0.1:${port}/health"
