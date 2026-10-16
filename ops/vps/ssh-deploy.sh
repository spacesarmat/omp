#!/usr/bin/env bash
# Copy deploy.sh to the VPS and run it. Used by the manual Deploy VPS workflow.
# Required environment (repository secrets; this script does not create them):
#   VPS_HOST     hostname or user@host (user defaults to root, port 22)
#   VPS_SSH_KEY  private key authorized on the VPS
#   REF          git ref to deploy
# Optional:
#   DRY_RUN=true  pass --dry-run
#   GH_TOKEN      forwarded only for the archive download, then removed
set -euo pipefail

die() {
  printf 'ssh-deploy: %s\n' "$*" >&2
  exit 1
}

require_secrets() {
  local missing
  missing=0
  if [[ -z "${VPS_HOST:-}" ]]; then
    printf 'Secret VPS_HOST is not set.\n' >&2
    missing=1
  fi
  if [[ -z "${VPS_SSH_KEY:-}" ]]; then
    printf 'Secret VPS_SSH_KEY is not set.\n' >&2
    missing=1
  fi
  if [[ "$missing" -ne 0 ]]; then
    printf 'Add VPS_HOST and VPS_SSH_KEY under repository Actions secrets, then re-run.\n' >&2
    exit 1
  fi
  if [[ -z "${REF:-}" ]]; then
    die "REF is required"
  fi
  [[ "$REF" =~ ^[A-Za-z0-9._/-]+$ ]] || die "invalid git ref"
  [[ "$REF" != *..* && "$REF" != /* && "$REF" != -* && "$REF" != */ ]] || die "invalid git ref"
}

target_from_host() {
  local host="$1"
  if [[ "$host" == *@* ]]; then
    printf '%s' "$host"
  else
    printf 'root@%s' "$host"
  fi
}

# Globals so the EXIT trap can still see them after main returns.
WORKDIR=""
REMOTE_DIR=""
TARGET=""
SSH_OPTS=()

cleanup() {
  # shellcheck disable=SC2155
  local status=$?
  set +e
  if [[ -n "$REMOTE_DIR" ]]; then
    local quoted_remote
    quoted_remote="$(printf '%q' "$REMOTE_DIR")"
    # The path is expanded here on purpose; the remote shell only sees the quoted value.
    # shellcheck disable=SC2029
    ssh "${SSH_OPTS[@]}" "$TARGET" "rm -rf ${quoted_remote}" || true
  fi
  if [[ -n "$WORKDIR" && -f "$WORKDIR/.ssh-deploy-work" && "$WORKDIR" != "/" ]]; then
    rm -rf -- "$WORKDIR"
  fi
  exit "$status"
}

main() {
  local script_dir deploy_script qdir qref dry remote
  require_secrets
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  deploy_script="${script_dir}/deploy.sh"
  [[ -f "$deploy_script" ]] || die "missing ${deploy_script}"
  TARGET="$(target_from_host "$VPS_HOST")"
  [[ "$TARGET" =~ ^[A-Za-z0-9._-]+@[A-Za-z0-9._:-]+$ ]] || die "VPS_HOST must be a hostname or user@host"

  umask 077
  WORKDIR="$(mktemp -d)"
  REMOTE_DIR=""
  touch "$WORKDIR/.ssh-deploy-work"
  printf '%s\n' "$VPS_SSH_KEY" >"$WORKDIR/key"
  chmod 600 "$WORKDIR/key"
  printf '%s\n' "${GH_TOKEN:-}" >"$WORKDIR/token"
  chmod 600 "$WORKDIR/token"
  trap cleanup EXIT

  SSH_OPTS=(
    -i "$WORKDIR/key"
    -o IdentitiesOnly=yes
    -o BatchMode=yes
    -o StrictHostKeyChecking=accept-new
    -o "UserKnownHostsFile=${WORKDIR}/known_hosts"
    -o ConnectTimeout=20
  )

  REMOTE_DIR="$(ssh "${SSH_OPTS[@]}" "$TARGET" 'umask 077 && mktemp -d /tmp/omp-deploy.XXXXXX')"
  [[ "$REMOTE_DIR" =~ ^/tmp/omp-deploy\.[A-Za-z0-9]+$ ]] || die "unexpected remote directory"

  scp "${SSH_OPTS[@]}" "$deploy_script" "${TARGET}:${REMOTE_DIR}/deploy.sh"
  scp "${SSH_OPTS[@]}" "$WORKDIR/token" "${TARGET}:${REMOTE_DIR}/token"

  qdir="$(printf '%q' "$REMOTE_DIR")"
  qref="$(printf '%q' "$REF")"
  dry=""
  if [[ "${DRY_RUN:-}" == "true" ]]; then
    dry=" --dry-run"
  fi
  remote="set -euo pipefail"
  remote+="; chmod 700 ${qdir}/deploy.sh"
  remote+="; token=\$(cat ${qdir}/token)"
  remote+="; rm -f ${qdir}/token"
  remote+="; export GITHUB_TOKEN=\"\$token\""
  remote+="; unset token"
  remote+="; set +e"
  remote+="; ${qdir}/deploy.sh${dry} ${qref}"
  remote+="; status=\$?"
  remote+="; rm -rf ${qdir}"
  remote+="; exit \$status"
  # shellcheck disable=SC2029 # remote is a script assembled locally; the token is not in it
  ssh "${SSH_OPTS[@]}" "$TARGET" "$remote"
}

main "$@"
