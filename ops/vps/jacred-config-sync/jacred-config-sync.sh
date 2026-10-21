#!/usr/bin/env bash
# Copy JacRed's running config (/app/init.yaml in omp-jacred) back to the host file that the
# container's entrypoint copies over it on every start, so a save in the JacRed admin UI survives
# a restart or recreate. Run by jacred-config-sync.timer every minute (as root).
#
# Skips (exit 0, one log line) when the container is not running, the file cannot be read, is empty,
# is not valid YAML, or lacks the globalproxy entry for sync.jacred.stream through WARP.
# Writes the host file in place (same inode): it is a single-file bind mount into omp-jacred, and a
# rename would leave the container on the old file. The new content is validated in a temp file first,
# and the previous host file is kept in the backup dir (last KEEP copies).
# Never restarts anything, never prints the config (it holds API keys).
set -euo pipefail
umask 077

CONTAINER="${JACRED_SYNC_CONTAINER:-omp-jacred}"
SRC="${JACRED_SYNC_SRC:-/app/init.yaml}"
HOST_FILE="${JACRED_SYNC_HOST_FILE:-/opt/omp-vps/jacred/init.yaml}"
BACKUP_DIR="${JACRED_SYNC_BACKUP_DIR:-/var/backups/jacred-config}"
KEEP="${JACRED_SYNC_KEEP:-20}"
WARP="${JACRED_SYNC_WARP:-http://warp:1080}"
LOCK="${JACRED_SYNC_LOCK:-/run/jacred-config-sync.lock}"
# auto: python3 with PyYAML when present, otherwise structural checks only; python: require PyYAML.
YAML_CHECK="${JACRED_SYNC_YAML_CHECK:-auto}"

log() { printf 'jacred-config-sync: %s\n' "$*"; }

if ! [[ "$KEEP" =~ ^[0-9]+$ ]] || ((KEEP < 1)); then
  log "bad JACRED_SYNC_KEEP"
  exit 2
fi
[[ -f "$HOST_FILE" ]] || { log "host file missing: ${HOST_FILE}"; exit 2; }

exec 9>"$LOCK"
flock -n 9 || { log "skip: another run holds the lock"; exit 0; }

tmp="$(mktemp "${TMPDIR:-/tmp}/jacred-config-sync.XXXXXX")"
trap 'rm -f "$tmp"' EXIT

running="$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null || true)"
if [[ "$running" != "true" ]]; then
  log "skip: ${CONTAINER} is not running"
  exit 0
fi
if ! docker exec "$CONTAINER" cat "$SRC" >"$tmp" 2>/dev/null; then
  log "skip: cannot read ${SRC} from ${CONTAINER}"
  exit 0
fi
if [[ ! -s "$tmp" ]]; then
  log "skip: ${SRC} is empty"
  exit 0
fi

# Structural checks: a JacRed config, and a globalproxy entry that sends sync.jacred.stream through WARP.
if ! grep -q '^syncapi:' "$tmp"; then
  log "skip: ${SRC} has no syncapi (not a JacRed config?)"
  exit 0
fi
# the globalproxy block runs until the next top-level key
if ! awk -v warp="$WARP" '
  /^globalproxy:/ { inblock = 1; next }
  inblock && /^[^ #-]/ { inblock = 0 }
  inblock && index($0, "sync") && index($0, "jacred") { pat = 1 }
  inblock && index($0, warp) { hit = 1 }
  END { exit !(pat && hit) }
' "$tmp"; then
  log "skip: ${SRC} has no globalproxy entry for sync.jacred.stream through ${WARP}"
  exit 0
fi

yaml_ok() {
  python3 -c 'import sys, yaml
d = yaml.safe_load(open(sys.argv[1]))
assert isinstance(d, dict) and d.get("syncapi")
assert any("jacred" in str(p.get("pattern", "")) for p in (d.get("globalproxy") or []))' "$1" 2>/dev/null
}
case "$YAML_CHECK" in
  python | auto)
    if python3 -c 'import yaml' 2>/dev/null; then
      if ! yaml_ok "$tmp"; then
        log "skip: ${SRC} is not valid YAML or lacks syncapi/globalproxy"
        exit 0
      fi
    elif [[ "$YAML_CHECK" == python ]]; then
      log "skip: python3 PyYAML not available"
      exit 0
    fi
    ;;
  none) ;;
  *) log "bad JACRED_SYNC_YAML_CHECK"; exit 2 ;;
esac

if cmp -s "$tmp" "$HOST_FILE"; then
  exit 0 # in sync: no log line every minute
fi

install -d -m 700 "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="${BACKUP_DIR}/init.yaml.${stamp}"
cp -p "$HOST_FILE" "$backup"
chmod 600 "$backup"
# Write in place (keeps the inode of the bind mount), then verify.
cat "$tmp" >"$HOST_FILE"
if ! cmp -s "$tmp" "$HOST_FILE"; then
  cat "$backup" >"$HOST_FILE"
  log "error: host file did not verify after the write; restored ${backup}"
  exit 1
fi
# keep the newest KEEP backups
mapfile -t old < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'init.yaml.*' -printf '%f\n' | sort -r | tail -n +"$((KEEP + 1))")
for f in "${old[@]}"; do rm -f -- "${BACKUP_DIR}/${f}"; done
log "updated ${HOST_FILE} from ${CONTAINER}:${SRC} ($(wc -c <"$HOST_FILE") bytes); previous copy ${backup}"
