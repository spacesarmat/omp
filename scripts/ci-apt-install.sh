#!/usr/bin/env bash
# Install apt packages for CI without recommended extras and without a man-db rebuild.
# Debs land in $APT_CACHE_DIR (default: $GITHUB_WORKSPACE/.apt-cache) so actions/cache
# can restore them. The directory name must end in /.apt-cache.
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: ci-apt-install.sh <package>..." >&2
  exit 2
fi

cache="${APT_CACHE_DIR:-${GITHUB_WORKSPACE:-$PWD}/.apt-cache}"
case "$cache" in
  */.apt-cache) ;;
  *)
    printf 'refusing apt cache dir: %s\n' "$cache" >&2
    exit 2
    ;;
esac

# The trigger checks this file. GitHub images often already have it off.
# A runner that still rebuilds the database stalls the job for minutes.
# noninteractive keeps debconf off a tty, which would hang the step.
if dpkg -s man-db >/dev/null 2>&1; then
  echo 'set man-db/auto-update false' | sudo DEBIAN_FRONTEND=noninteractive debconf-communicate
  sudo DEBIAN_FRONTEND=noninteractive dpkg-reconfigure -f noninteractive man-db
  sudo rm -f /var/lib/man-db/auto-update
fi

mkdir -p "$cache"
rm -rf "$cache/partial"
mkdir -p "$cache/partial"

# A stuck resolver retries every mirror and every package for minutes
# (run 43059450092: "Temporary failure resolving" every 20s). Cap that.
acquire=(
  -o Acquire::Retries=2
  -o Acquire::http::Timeout=15
  -o Acquire::https::Timeout=15
)
sudo apt-get "${acquire[@]}" update
sudo apt-get \
  "${acquire[@]}" \
  -o "Dir::Cache::archives=${cache}/" \
  install -y --no-install-recommends \
  "$@"

sudo rm -rf "$cache/partial" "$cache/lock"
sudo chown -R "$(id -u):$(id -g)" "$cache"
