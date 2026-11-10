#!/usr/bin/env bash
# Открывает SSH и порт агента, затем включает ufw. Без этого скрипта файрвол не меняется.
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Запустите от root: sudo ./firewall.sh" >&2
  exit 1
fi

if ! command -v ufw >/dev/null 2>&1; then
  apt-get update
  apt-get install -y ufw
fi

CONF="/etc/omp-cache-node/config.env"
publish="127.0.0.1:8090"
if [[ -f "${CONF}" ]]; then
  line=""
  while IFS= read -r line || [[ -n "${line}" ]]; do
    case "${line}" in
      CACHE_PUBLISH=*) publish="${line#CACHE_PUBLISH=}" ;;
    esac
  done < "${CONF}"
  if [[ -z "${publish}" ]]; then
    publish="127.0.0.1:8090"
  fi
fi
port="${publish##*:}"
if [[ ! "${port}" =~ ^[0-9]+$ ]]; then
  echo "Не понял порт в CACHE_PUBLISH" >&2
  exit 1
fi

ufw allow OpenSSH
ufw allow "${port}/tcp"
ufw --force enable
ufw status
echo "Открыты SSH и TCP ${port}. Остальные входящие ufw закрывает."
