#!/usr/bin/env bash
# Publish landing, Caddyfile, and billing source onto the VPS compose directory.
# Reads only the BILLING_IMAGE line from .env. Never writes .env or data/.
set -euo pipefail

ROOT="${OMP_VPS_ROOT:-/opt/omp-vps}"
REPO="${OMP_REPO:-spacesarmat/omp}"
IMAGE="${OMP_BILLING_IMAGE:-ghcr.io/spacesarmat/omp-billing:local}"
BILLING_HOST="${OMP_BILLING_HOST:-billing.omp-player.online}"
LANDING_HOST="${OMP_LANDING_HOST:-omp-player.online}"
HEALTH_IP="${OMP_HEALTH_IP:-127.0.0.1}"
HEALTH_SCHEME="${OMP_HEALTH_SCHEME:-https}"
HEALTH_PORT="${OMP_HEALTH_PORT:-443}"
HEALTH_MAX_TIME="${OMP_HEALTH_MAX_TIME:-20}"
HEALTH_ATTEMPTS="${OMP_HEALTH_ATTEMPTS:-15}"
HEALTH_SLEEP="${OMP_HEALTH_SLEEP:-2}"
BILLING_CONTAINER="${OMP_BILLING_CONTAINER:-omp-billing}"
BACKUP_PREFIX="${OMP_BACKUP_PREFIX:-/opt/omp-vps-backup}"

DRY_RUN=0
REF=""
ROLLBACK=""
WORK=""
BACKUP_DIR=""
ROLLBACK_ARMED=0
IN_ROLLBACK=0
FAILURES=""
CADDY_CHANGED=0
SITE_CHANGED=0
BILLING_CHANGED=0
DOCKERFILE_CHANGED=0
IMAGE_ID=""
BACKUP_TAG=""
REF_DIR=""
REF_TAG=""
STAMP=""
MANIFEST_IMAGE_TAG=""
MANIFEST_IMAGE_ID=""
MANIFEST_HAD_CADDYFILE=""
MANIFEST_HAD_SITE=""
MANIFEST_HAD_BILLING=""
MANIFEST_HAD_DOCKERFILE=""

BILLING_EXCLUDES=(
  node_modules
  .env
  '*.env'
  data
  '*.db'
  '*.db-wal'
  '*.db-shm'
  .git
)

usage() {
  cat <<'EOF'
Usage: deploy.sh [--dry-run] <git-ref>
       deploy.sh [--dry-run] --rollback <backup-dir>

Download a git ref of the omp repo and publish onto the VPS compose
directory (not a checkout):

  ops/vps/Caddyfile    -> $OMP_VPS_ROOT/Caddyfile
  ops/vps/site/        -> $OMP_VPS_ROOT/site/
  ops/vps/Dockerfile   -> $OMP_VPS_ROOT/Dockerfile.billing
  ops/billing/         -> $OMP_VPS_ROOT/billing-src/

The current image is tagged and those four paths are copied to
/opt/omp-vps-backup-<ref>-<utc> before anything is replaced. node --check
runs on billing *.mjs. The local billing image is rebuilt and only the
billing service is recreated when billing source or Dockerfile.billing
changed. A Caddyfile change reloads Caddy. A site-only change is served
from the bind mount. Health checks cover /health GET, HEAD, and OPTIONS,
/admin, the landing page, and the security headers. A failure after the
backup restores it.

--dry-run downloads the ref and prints the plan. It does not back up,
sync, build, reload, or roll back.
--rollback restores a backup directory created by this script.

.env must already set BILLING_IMAGE to the tag this script builds
(default ghcr.io/spacesarmat/omp-billing:local). .env and data/ are never
written. A private repo needs GITHUB_TOKEN or GH_TOKEN for the download.

Environment:
  OMP_VPS_ROOT OMP_REPO OMP_BILLING_IMAGE OMP_BACKUP_PREFIX
  OMP_BILLING_HOST OMP_LANDING_HOST OMP_HEALTH_IP
  OMP_HEALTH_SCHEME OMP_HEALTH_PORT OMP_HEALTH_MAX_TIME
  OMP_HEALTH_ATTEMPTS OMP_HEALTH_SLEEP OMP_BILLING_CONTAINER
  OMP_LOCK_FILE
EOF
}

log() {
  printf 'deploy: %s\n' "$*"
}

die() {
  printf 'deploy: %s\n' "$*" >&2
  exit 1
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -n | --dry-run)
        DRY_RUN=1
        ;;
      --rollback)
        [[ $# -ge 2 ]] || die "--rollback needs a backup directory"
        ROLLBACK="$2"
        shift
        ;;
      -h | --help)
        usage
        exit 0
        ;;
      --)
        shift
        break
        ;;
      -*)
        die "unknown option: $1"
        ;;
      *)
        [[ -z "$REF" ]] || die "unexpected argument: $1"
        REF="$1"
        ;;
    esac
    shift
  done
  while [[ $# -gt 0 ]]; do
    [[ -z "$REF" ]] || die "unexpected argument: $1"
    REF="$1"
    shift
  done
  if [[ -n "$ROLLBACK" && -n "$REF" ]]; then
    die "pass a git ref or --rollback, not both"
  fi
  if [[ -z "$ROLLBACK" && -z "$REF" ]]; then
    usage >&2
    die "missing git ref"
  fi
}

valid_flag() {
  [[ "$1" == 0 || "$1" == 1 ]]
}

safe_rm_work() {
  [[ -n "$WORK" && -d "$WORK" ]] || return 0
  case "$WORK" in
    / | /opt | /opt/* | "$ROOT" | "$ROOT"/*) return 0 ;;
  esac
  if [[ -f "$WORK/.deploy-work" ]]; then
    rm -rf -- "$WORK"
  fi
}

on_exit() {
  # Capture $? in the same command as local. A separate assignment sees local's status.
  # shellcheck disable=SC2155
  local status=$?
  set +e
  if [[ "$status" -ne 0 && "$ROLLBACK_ARMED" -eq 1 && "$IN_ROLLBACK" -eq 0 ]]; then
    IN_ROLLBACK=1
    ROLLBACK_ARMED=0
    log "deploy failed; rolling back ${BACKUP_DIR}"
    if ! restore_backup "$BACKUP_DIR"; then
      log "rollback failed"
    else
      log "restored ${BACKUP_DIR}"
      if ! health_checks; then
        log "health checks still failing after rollback"
      fi
    fi
  fi
  safe_rm_work
  exit "$status"
}

assert_absolute_path() {
  local label="$1"
  local value="$2"
  [[ "$value" == /* ]] || die "${label} must be absolute"
  [[ "$value" != *..* ]] || die "${label} must not contain .."
  [[ "$value" != *$'\n'* ]] || die "${label} must not contain a newline"
}

sanitize_ref() {
  local ref="$1"
  [[ "$ref" =~ ^[A-Za-z0-9._/-]+$ ]] || return 1
  [[ "$ref" != *..* ]] || return 1
  [[ "$ref" != /* && "$ref" != */ && "$ref" != -* ]] || return 1
  printf '%s' "${ref//\//-}"
}

check_config() {
  [[ "$ROOT" == /* ]] || die "OMP_VPS_ROOT must be absolute"
  [[ "$ROOT" != "/" ]] || die "refusing OMP_VPS_ROOT=/"
  [[ "$ROOT" != *..* ]] || die "OMP_VPS_ROOT must not contain .."
  assert_absolute_path "backup prefix" "$BACKUP_PREFIX"
  [[ "$REPO" =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]] || die "bad OMP_REPO"
  [[ "$IMAGE" == *:* && "$IMAGE" != *@* ]] || die "billing image must be name:tag"
  [[ "$IMAGE" =~ ^[A-Za-z0-9._:/-]+$ ]] || die "bad billing image"
  [[ "$BILLING_HOST" =~ ^[A-Za-z0-9.-]+$ ]] || die "bad OMP_BILLING_HOST"
  [[ "$LANDING_HOST" =~ ^[A-Za-z0-9.-]+$ ]] || die "bad OMP_LANDING_HOST"
  [[ "$HEALTH_IP" =~ ^[A-Za-z0-9.:-]+$ ]] || die "bad OMP_HEALTH_IP"
  [[ "$HEALTH_SCHEME" == http || "$HEALTH_SCHEME" == https ]] || die "bad OMP_HEALTH_SCHEME"
  [[ "$HEALTH_PORT" =~ ^[0-9]+$ ]] || die "bad OMP_HEALTH_PORT"
  ((HEALTH_PORT >= 1 && HEALTH_PORT <= 65535)) || die "bad OMP_HEALTH_PORT"
  [[ "$HEALTH_MAX_TIME" =~ ^[1-9][0-9]*$ ]] || die "bad OMP_HEALTH_MAX_TIME"
  [[ "$HEALTH_ATTEMPTS" =~ ^[1-9][0-9]*$ ]] || die "bad OMP_HEALTH_ATTEMPTS"
  [[ "$HEALTH_SLEEP" =~ ^[0-9]+$ ]] || die "bad OMP_HEALTH_SLEEP"
  [[ "$BILLING_CONTAINER" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || die "bad OMP_BILLING_CONTAINER"
  if [[ -n "$REF" ]]; then
    REF_DIR="$(sanitize_ref "$REF")" || die "invalid git ref: ${REF}"
    if ((${#REF_DIR} > 80)); then
      REF_DIR="${REF_DIR:0:80}"
    fi
    REF_TAG="${REF_DIR,,}"
    if ((${#REF_TAG} > 40)); then
      REF_TAG="${REF_TAG:0:40}"
    fi
    [[ "$REF_TAG" =~ ^[a-z0-9._-]+$ ]] || die "ref cannot be used as an image tag"
  fi
  if [[ -n "$ROLLBACK" ]]; then
    assert_absolute_path "backup" "$ROLLBACK"
    [[ -d "$ROLLBACK" ]] || die "backup not found: ${ROLLBACK}"
    [[ -f "$ROLLBACK/backup.manifest" ]] || die "not a deploy backup: ${ROLLBACK}"
  fi
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

prepare_root() {
  [[ -d "$ROOT" ]] || die "missing ${ROOT}"
  ROOT="$(cd "$ROOT" && pwd -P)"
  [[ -f "$ROOT/docker-compose.yml" ]] || die "missing ${ROOT}/docker-compose.yml"
  [[ -f "$ROOT/.env" && ! -d "$ROOT/.env" ]] || die "missing ${ROOT}/.env"
  local found
  found="$(read_billing_image)"
  if [[ "$found" != "$IMAGE" ]]; then
    die ".env BILLING_IMAGE is '${found}'; this script builds '${IMAGE}' and will not change .env"
  fi
  assert_managed_not_symlinks
  local lock
  lock="${OMP_LOCK_FILE:-${ROOT}.deploy.lock}"
  assert_absolute_path "lock file" "$lock"
  exec 9>"$lock"
  if ! flock -n 9; then
    die "another deploy holds ${lock}"
  fi
}

read_billing_image() {
  local line value dq sq
  value=""
  dq='^"(.*)"$'
  sq="^'(.*)'\$"
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    case "$line" in
      '' | \#*) continue ;;
      BILLING_IMAGE=*) value="${line#BILLING_IMAGE=}" ;;
    esac
  done <"$ROOT/.env"
  if [[ "$value" =~ $dq ]]; then
    value="${BASH_REMATCH[1]}"
  elif [[ "$value" =~ $sq ]]; then
    value="${BASH_REMATCH[1]}"
  fi
  printf '%s' "$value"
}

assert_managed_not_symlinks() {
  local path
  for path in "$ROOT/Caddyfile" "$ROOT/Dockerfile.billing" "$ROOT/site" "$ROOT/billing-src"; do
    if [[ -L "$path" ]]; then
      die "refusing to follow symlink: ${path}"
    fi
  done
}

prepare_work() {
  WORK="$(mktemp -d)"
  trap on_exit EXIT
  if [[ "$WORK" == "/" || "$WORK" == "$ROOT" || "$WORK" == "$ROOT"/* || "$ROOT" == "$WORK"/* ]]; then
    die "refusing temp dir ${WORK}"
  fi
  touch "$WORK/.deploy-work"
}

require_tools() {
  local cmd
  for cmd in curl tar rsync diff cmp awk flock node docker; do
    need_cmd "$cmd"
  done
  docker compose version >/dev/null 2>&1 || die "docker compose is not available"
  if ! docker info >/dev/null 2>&1; then
    die "docker daemon is not reachable"
  fi
}

files_differ() {
  local a="$1"
  local b="$2"
  if [[ ! -e "$a" && ! -e "$b" ]]; then
    return 1
  fi
  if [[ ! -e "$a" || ! -e "$b" ]]; then
    return 0
  fi
  if cmp -s "$a" "$b"; then
    return 1
  fi
  return 0
}

billing_diff() {
  local a="$1"
  local b="$2"
  local -a args
  local pattern
  args=(-rq)
  for pattern in "${BILLING_EXCLUDES[@]}"; do
    args+=(--exclude "$pattern")
  done
  diff "${args[@]}" "$a" "$b"
}

dirs_differ() {
  local a="$1"
  local b="$2"
  local kind="$3"
  local status
  if [[ ! -d "$a" && ! -d "$b" ]]; then
    return 1
  fi
  if [[ ! -d "$a" || ! -d "$b" ]]; then
    return 0
  fi
  status=0
  if [[ "$kind" == "billing" ]]; then
    billing_diff "$a" "$b" >/dev/null 2>&1 || status=$?
  else
    diff -rq "$a" "$b" >/dev/null 2>&1 || status=$?
  fi
  if [[ "$status" -eq 0 ]]; then
    return 1
  fi
  return 0
}

download_tarball() {
  local dest="$1"
  local url token header_file status
  url="https://api.github.com/repos/${REPO}/tarball/${REF}"
  token="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
  header_file=""
  status=0
  local -a args
  args=(
    --fail
    --silent
    --show-error
    --location
    --retry 3
    --retry-delay 2
    --output "$dest"
  )
  if [[ -n "$token" ]]; then
    header_file="$(mktemp)"
    chmod 600 "$header_file"
    printf 'Authorization: Bearer %s\nAccept: application/vnd.github+json\n' "$token" >"$header_file"
    args+=(--header "@${header_file}")
  fi
  unset GITHUB_TOKEN GH_TOKEN token
  log "downloading ${url}"
  curl "${args[@]}" "$url" || status=$?
  if [[ -n "$header_file" ]]; then
    rm -f -- "$header_file"
  fi
  if [[ "$status" -ne 0 ]]; then
    die "tarball download failed (set GITHUB_TOKEN if the repo is private)"
  fi
}

assert_tar_safe() {
  local tarball="$1"
  local entry part list err
  local -a parts
  list="$WORK/tar-list"
  err="$WORK/tar-err"
  # C locale so "Removing leading" is the warning GNU tar prints for '/' and '..'.
  if ! LC_ALL=C tar -tzf "$tarball" >"$list" 2>"$err"; then
    die "tarball listing failed"
  fi
  if grep -q 'Removing leading' "$err"; then
    die "tarball contains a path that escapes the archive"
  fi
  while IFS= read -r entry; do
    [[ -n "$entry" ]] || continue
    [[ "$entry" != /* ]] || die "tarball has an absolute path: ${entry}"
    IFS='/' read -r -a parts <<<"$entry"
    for part in "${parts[@]}"; do
      [[ "$part" != ".." ]] || die "tarball has a parent segment: ${entry}"
    done
  done <"$list"
}

extract_tree() {
  local tarball="$1"
  local dest="$2"
  local -a tops
  mkdir -p -- "$dest"
  tar -xzf "$tarball" -C "$dest" --no-same-owner || return 1
  shopt -s nullglob
  tops=("$dest"/*/)
  shopt -u nullglob
  if [[ "${#tops[@]}" -ne 1 ]]; then
    printf 'deploy: expected one top-level directory in the tarball, found %s\n' "${#tops[@]}" >&2
    return 1
  fi
  printf '%s' "${tops[0]%/}"
}

require_regular_file() {
  [[ -f "$1" && ! -L "$1" ]] || die "archive is missing ${1#"$2"/}"
}

require_real_dir() {
  [[ -d "$1" && ! -L "$1" ]] || die "archive is missing ${1#"$2"/}"
}

validate_tree() {
  local tree="$1"
  require_regular_file "$tree/ops/vps/Caddyfile" "$tree"
  require_real_dir "$tree/ops/vps/site" "$tree"
  require_regular_file "$tree/ops/vps/Dockerfile" "$tree"
  require_regular_file "$tree/ops/billing/package.json" "$tree"
  require_regular_file "$tree/ops/billing/src/server.mjs" "$tree"
  require_regular_file "$tree/ops/billing/start.sh" "$tree"
  require_real_dir "$tree/ops/billing/public" "$tree"
}

node_check() {
  local dir="$1"
  local file count
  count=0
  while IFS= read -r -d '' file; do
    count=$((count + 1))
    if ! node --check "$file"; then
      log "node --check failed: ${file}"
      return 1
    fi
  done < <(find "$dir" -type f -name '*.mjs' -not -path '*/node_modules/*' -print0)
  if [[ "$count" -eq 0 ]]; then
    log "no .mjs files under ${dir}"
    return 1
  fi
  log "node --check passed for ${count} files"
  return 0
}

detect_changes() {
  local tree="$1"
  CADDY_CHANGED=0
  SITE_CHANGED=0
  BILLING_CHANGED=0
  DOCKERFILE_CHANGED=0
  if files_differ "$tree/ops/vps/Caddyfile" "$ROOT/Caddyfile"; then
    CADDY_CHANGED=1
  fi
  if dirs_differ "$tree/ops/vps/site" "$ROOT/site" site; then
    SITE_CHANGED=1
  fi
  if dirs_differ "$tree/ops/billing" "$ROOT/billing-src" billing; then
    BILLING_CHANGED=1
  fi
  if files_differ "$tree/ops/vps/Dockerfile" "$ROOT/Dockerfile.billing"; then
    DOCKERFILE_CHANGED=1
  fi
  log "changes caddyfile=${CADDY_CHANGED} site=${SITE_CHANGED} billing=${BILLING_CHANGED} dockerfile=${DOCKERFILE_CHANGED}"
}

rsync_dir() {
  local src="$1"
  local dest="$2"
  local kind="$3"
  local delete_flag="$4"
  local pattern
  local -a args
  if [[ -L "$dest" ]]; then
    die "refusing to follow symlink: ${dest}"
  fi
  mkdir -p -- "$dest"
  # Checksum, not size+mtime: a same-length edit can share a timestamp with the file it replaces.
  args=(-a --checksum)
  if [[ "$delete_flag" == "delete" ]]; then
    args+=(--delete)
  fi
  if [[ "$kind" == "billing" ]]; then
    for pattern in "${BILLING_EXCLUDES[@]}"; do
      args+=(--exclude "$pattern")
    done
  fi
  rsync "${args[@]}" "${src}/" "${dest}/"
}

install_file() {
  local src="$1"
  local dest="$2"
  [[ -f "$src" && ! -L "$src" ]] || die "refusing to copy ${src}"
  if [[ -L "$dest" ]]; then
    die "refusing to follow symlink: ${dest}"
  fi
  cp -f -- "$src" "$dest"
}

sync_release() {
  local tree="$1"
  assert_managed_not_symlinks
  rsync_dir "$tree/ops/vps/site" "$ROOT/site" site delete || return 1
  rsync_dir "$tree/ops/billing" "$ROOT/billing-src" billing delete || return 1
  install_file "$tree/ops/vps/Caddyfile" "$ROOT/Caddyfile" || return 1
  install_file "$tree/ops/vps/Dockerfile" "$ROOT/Dockerfile.billing" || return 1
}

capture_image_id() {
  local raw
  IMAGE_ID=""
  if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    return 0
  fi
  raw="$(docker image inspect --format '{{.Id}}' "$IMAGE")"
  raw="${raw,,}"
  raw="${raw//$'\r'/}"
  raw="${raw//$'\n'/}"
  [[ "$raw" =~ ^sha256:[a-f0-9]{64}$ ]] || die "unexpected image id for ${IMAGE}"
  IMAGE_ID="$raw"
}

tag_current_image() {
  local repo_name tag_part
  repo_name="${IMAGE%:*}"
  BACKUP_TAG="${repo_name}:backup-${REF_TAG}-${STAMP}"
  tag_part="${BACKUP_TAG#*:}"
  ((${#tag_part} <= 128)) || die "backup image tag is too long"
  capture_image_id
  if [[ -z "$IMAGE_ID" ]]; then
    BACKUP_TAG=""
    log "no current image ${IMAGE} to tag"
    return 0
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "would tag ${IMAGE} (${IMAGE_ID}) as ${BACKUP_TAG}"
    return 0
  fi
  docker tag "$IMAGE" "$BACKUP_TAG" || return 1
  log "tagged ${IMAGE} as ${BACKUP_TAG}"
}

write_manifest() {
  local dest="$1"
  local had_caddyfile had_site had_billing had_dockerfile
  had_caddyfile=0
  had_site=0
  had_billing=0
  had_dockerfile=0
  [[ -f "$ROOT/Caddyfile" ]] && had_caddyfile=1
  [[ -d "$ROOT/site" ]] && had_site=1
  [[ -d "$ROOT/billing-src" ]] && had_billing=1
  [[ -f "$ROOT/Dockerfile.billing" ]] && had_dockerfile=1
  {
    printf 'version=1\n'
    printf 'ref=%s\n' "$REF"
    printf 'created=%s\n' "$STAMP"
    printf 'image=%s\n' "$IMAGE"
    printf 'image_tag=%s\n' "$BACKUP_TAG"
    printf 'image_id=%s\n' "$IMAGE_ID"
    printf 'had_caddyfile=%s\n' "$had_caddyfile"
    printf 'had_site=%s\n' "$had_site"
    printf 'had_billing_src=%s\n' "$had_billing"
    printf 'had_dockerfile=%s\n' "$had_dockerfile"
  } >"$dest/backup.manifest"
}

remove_partial_backup() {
  case "$BACKUP_DIR" in
    "${BACKUP_PREFIX}-"*) ;;
    *) return 0 ;;
  esac
  [[ -n "$BACKUP_DIR" && "$BACKUP_DIR" != "/" && "$BACKUP_DIR" != "$ROOT" ]] || return 0
  rm -rf -- "$BACKUP_DIR"
}

backup_live() {
  local parent
  parent="$(dirname "$BACKUP_DIR")"
  [[ -d "$parent" ]] || die "backup parent does not exist: ${parent}"
  case "$BACKUP_DIR" in
    "$ROOT" | "$ROOT"/*) die "backup path must not be inside ${ROOT}" ;;
  esac
  [[ ! -e "$BACKUP_DIR" ]] || die "backup path already exists: ${BACKUP_DIR}"
  [[ ! -L "$BACKUP_DIR" ]] || die "backup path is a symlink: ${BACKUP_DIR}"
  mkdir -- "$BACKUP_DIR" || return 1
  if [[ -f "$ROOT/Caddyfile" ]]; then
    install_file "$ROOT/Caddyfile" "$BACKUP_DIR/Caddyfile" || {
      remove_partial_backup
      return 1
    }
  fi
  if [[ -d "$ROOT/site" ]]; then
    rsync_dir "$ROOT/site" "$BACKUP_DIR/site" site keep || {
      remove_partial_backup
      return 1
    }
  fi
  if [[ -d "$ROOT/billing-src" ]]; then
    rsync_dir "$ROOT/billing-src" "$BACKUP_DIR/billing-src" billing keep || {
      remove_partial_backup
      return 1
    }
  fi
  if [[ -f "$ROOT/Dockerfile.billing" ]]; then
    install_file "$ROOT/Dockerfile.billing" "$BACKUP_DIR/Dockerfile.billing" || {
      remove_partial_backup
      return 1
    }
  fi
  write_manifest "$BACKUP_DIR" || {
    remove_partial_backup
    return 1
  }
  log "backup=${BACKUP_DIR}"
}

compose() {
  env -u BILLING_IMAGE docker compose --project-directory "$ROOT" "$@"
}

caddy_reload() {
  compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile
}

apply_restarts() {
  if [[ "$BILLING_CHANGED" -eq 1 || "$DOCKERFILE_CHANGED" -eq 1 ]]; then
    log "building ${IMAGE}"
    docker build -f "$ROOT/Dockerfile.billing" -t "$IMAGE" "$ROOT/billing-src" || return 1
    log "restarting billing"
    compose up -d billing || return 1
  else
    log "billing unchanged"
  fi
  if [[ "$CADDY_CHANGED" -eq 1 ]]; then
    log "reloading caddy"
    caddy_reload || return 1
  else
    log "Caddyfile unchanged"
  fi
  if [[ "$SITE_CHANGED" -eq 1 ]]; then
    log "site updated from the bind mount"
  fi
  return 0
}

print_restart_plan() {
  if [[ "$BILLING_CHANGED" -eq 1 || "$DOCKERFILE_CHANGED" -eq 1 ]]; then
    log "would build ${IMAGE} and docker compose up -d billing"
  else
    log "would not rebuild billing"
  fi
  if [[ "$CADDY_CHANGED" -eq 1 ]]; then
    log "would reload caddy"
  else
    log "would not reload caddy"
  fi
  if [[ "$SITE_CHANGED" -eq 1 ]]; then
    log "would update site files only"
  fi
  log "would check GET/HEAD/OPTIONS ${BILLING_HOST}/health, GET /admin, GET ${LANDING_HOST}/, and security headers"
}

header_value() {
  local file="$1"
  local name="$2"
  awk -v name="$name" '
    BEGIN { IGNORECASE = 1 }
    {
      line = $0
      sub(/\r$/, "", line)
      header = line
      sub(/:.*/, "", header)
      if (tolower(header) == tolower(name)) {
        sub(/^[^:]+:[[:space:]]*/, "", line)
        sub(/[[:space:]]+$/, "", line)
        print line
        exit
      }
    }
  ' "$file"
}

note_fail() {
  FAILURES="${FAILURES}$1"$'\n'
  log "health: $1"
}

# The landing has no X-Frame-Options: its CSP frame-ancestors lets the
# Yandex.Metrika click map frame it. Every other host must send DENY.
check_security_headers() {
  local file="$1"
  local label="$2"
  local frame="${3:-deny}"
  local got
  got="$(header_value "$file" "Strict-Transport-Security")"
  if [[ "$got" != "max-age=15552000; includeSubDomains" ]]; then
    note_fail "${label} Strict-Transport-Security is '${got}'"
  fi
  got="$(header_value "$file" "X-Content-Type-Options")"
  if [[ "$got" != "nosniff" ]]; then
    note_fail "${label} X-Content-Type-Options is '${got}'"
  fi
  got="$(header_value "$file" "X-Frame-Options")"
  if [[ "$frame" == landing ]]; then
    if [[ -n "$got" ]]; then
      note_fail "${label} X-Frame-Options is '${got}', want none"
    fi
    got="$(header_value "$file" "Content-Security-Policy")"
    if [[ "$got" != *"frame-ancestors 'self' https://metrika.yandex.ru "* ]]; then
      note_fail "${label} Content-Security-Policy has no Metrika frame-ancestors"
    fi
  elif [[ "$got" != "DENY" ]]; then
    note_fail "${label} X-Frame-Options is '${got}'"
  fi
  got="$(header_value "$file" "Referrer-Policy")"
  if [[ "$got" != "strict-origin-when-cross-origin" ]]; then
    note_fail "${label} Referrer-Policy is '${got}'"
  fi
  got="$(header_value "$file" "Server")"
  if [[ -n "$got" ]]; then
    note_fail "${label} has a Server header"
  fi
}

service_url() {
  local host="$1"
  local path="$2"
  if [[ ("$HEALTH_SCHEME" == https && "$HEALTH_PORT" == 443) || ("$HEALTH_SCHEME" == http && "$HEALTH_PORT" == 80) ]]; then
    printf '%s://%s%s' "$HEALTH_SCHEME" "$host" "$path"
  else
    printf '%s://%s:%s%s' "$HEALTH_SCHEME" "$host" "$HEALTH_PORT" "$path"
  fi
}

check_request() {
  local method="$1"
  local url="$2"
  local expect="$3"
  local kind="$4"
  local hdr body code host allow allow_lc
  local -a method_args
  hdr="$WORK/headers"
  body="$WORK/body"
  : >"$hdr"
  : >"$body"
  host="${url#*://}"
  host="${host%%/*}"
  host="${host%%:*}"
  # --request HEAD still reads Content-Length bytes. Billing sends that
  # length and no body, so curl waits until --max-time and the deploy rolls back.
  # --head (CURLOPT_NOBODY) stops after the headers.
  if [[ "$method" == "HEAD" ]]; then
    method_args=(--head)
  else
    method_args=(--request "$method")
  fi
  if ! code="$(
    curl \
      --silent \
      --show-error \
      --http1.1 \
      --max-time "$HEALTH_MAX_TIME" \
      --connect-timeout 5 \
      --max-redirs 0 \
      "${method_args[@]}" \
      --dump-header "$hdr" \
      --output "$body" \
      --write-out '%{http_code}' \
      --resolve "${host}:${HEALTH_PORT}:${HEALTH_IP}" \
      "$url"
  )"; then
    note_fail "${method} ${url} failed to connect"
    return 0
  fi
  if [[ "$code" != "$expect" ]]; then
    note_fail "${method} ${url} status ${code} (want ${expect})"
  fi
  # curl --head copies the header block into --output. That is not an entity body.
  if [[ "$method" == "HEAD" && -s "$body" ]] && ! cmp -s "$hdr" "$body"; then
    note_fail "${method} ${url} returned a body"
  fi
  if [[ "$method" == "HEAD" ]]; then
    : >"$body"
  fi
  if [[ "$kind" == "health" ]] && ! grep -q '"ok"[[:space:]]*:[[:space:]]*true' "$body"; then
    note_fail "${method} ${url} body is not {\"ok\":true}"
  fi
  if [[ "$method" == "GET" && "$kind" == "page" && ! -s "$body" ]]; then
    note_fail "${method} ${url} body is empty"
  fi
  if [[ "$method" == "OPTIONS" && -s "$body" ]]; then
    note_fail "${method} ${url} returned a body"
  fi
  if [[ "$method" == "OPTIONS" ]]; then
    allow="$(header_value "$hdr" "Allow")"
    allow_lc="${allow,,}"
    if [[ "$allow_lc" != *get* || "$allow_lc" != *head* || "$allow_lc" != *options* ]]; then
      note_fail "${method} ${url} Allow is '${allow}'"
    fi
  fi
  if [[ "$host" == "$LANDING_HOST" ]]; then
    check_security_headers "$hdr" "${method} ${url}" landing
  else
    check_security_headers "$hdr" "${method} ${url}"
  fi
}

health_once() {
  local billing landing
  FAILURES=""
  billing="$(service_url "$BILLING_HOST" "")"
  landing="$(service_url "$LANDING_HOST" "")"
  check_request GET "${billing}/health" 200 health
  check_request HEAD "${billing}/health" 200 none
  check_request OPTIONS "${billing}/health" 204 none
  check_request GET "${billing}/admin" 200 page
  check_request GET "${landing}/" 200 page
  [[ -z "$FAILURES" ]]
}

health_checks() {
  local attempt
  for ((attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt++)); do
    if health_once; then
      log "health checks passed"
      return 0
    fi
    log "health checks failed (${attempt}/${HEALTH_ATTEMPTS})"
    if ((attempt < HEALTH_ATTEMPTS)); then
      sleep "$HEALTH_SLEEP"
    fi
  done
  return 1
}

read_manifest() {
  local file="$1"
  local line key value
  MANIFEST_IMAGE_TAG=""
  MANIFEST_IMAGE_ID=""
  MANIFEST_HAD_CADDYFILE=""
  MANIFEST_HAD_SITE=""
  MANIFEST_HAD_BILLING=""
  MANIFEST_HAD_DOCKERFILE=""
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[a-z0-9_]+= ]] || continue
    key="${line%%=*}"
    value="${line#*=}"
    case "$key" in
      image_tag) MANIFEST_IMAGE_TAG="$value" ;;
      image_id) MANIFEST_IMAGE_ID="$value" ;;
      had_caddyfile) MANIFEST_HAD_CADDYFILE="$value" ;;
      had_site) MANIFEST_HAD_SITE="$value" ;;
      had_billing_src) MANIFEST_HAD_BILLING="$value" ;;
      had_dockerfile) MANIFEST_HAD_DOCKERFILE="$value" ;;
      version | created | image | ref) ;;
      *) log "ignoring manifest key ${key}" ;;
    esac
  done <"$file"
  valid_flag "$MANIFEST_HAD_CADDYFILE" || die "bad manifest had_caddyfile"
  valid_flag "$MANIFEST_HAD_SITE" || die "bad manifest had_site"
  valid_flag "$MANIFEST_HAD_BILLING" || die "bad manifest had_billing_src"
  valid_flag "$MANIFEST_HAD_DOCKERFILE" || die "bad manifest had_dockerfile"
  if [[ -n "$MANIFEST_IMAGE_TAG" && ! "$MANIFEST_IMAGE_TAG" =~ ^[A-Za-z0-9._:/-]+$ ]]; then
    die "bad manifest image tag"
  fi
  if [[ -n "$MANIFEST_IMAGE_ID" ]]; then
    MANIFEST_IMAGE_ID="${MANIFEST_IMAGE_ID,,}"
    [[ "$MANIFEST_IMAGE_ID" =~ ^sha256:[a-f0-9]{64}$ ]] || die "bad manifest image id"
  fi
}

remove_managed_file() {
  local dest="$1"
  case "$dest" in
    "$ROOT/Caddyfile" | "$ROOT/Dockerfile.billing") ;;
    *) die "refusing to remove ${dest}" ;;
  esac
  [[ ! -L "$dest" ]] || die "refusing to follow symlink: ${dest}"
  if [[ -e "$dest" ]]; then
    rm -f -- "$dest"
  fi
}

remove_managed_dir() {
  local dest="$1"
  case "$dest" in
    "$ROOT/site" | "$ROOT/billing-src") ;;
    *) die "refusing to remove ${dest}" ;;
  esac
  [[ ! -L "$dest" ]] || die "refusing to follow symlink: ${dest}"
  if [[ -e "$dest" ]]; then
    rm -rf -- "$dest"
  fi
}

restore_one_file() {
  local backup="$1"
  local name="$2"
  local had="$3"
  local src="${backup}/${name}"
  local dest="${ROOT}/${name}"
  if [[ "$had" != 1 ]]; then
    if [[ "$DRY_RUN" -eq 1 ]]; then
      log "would remove ${dest}"
    else
      remove_managed_file "$dest"
    fi
    return 0
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "would restore ${dest}"
    return 0
  fi
  install_file "$src" "$dest" || return 1
}

restore_one_dir() {
  local backup="$1"
  local name="$2"
  local had="$3"
  local kind="$4"
  local src="${backup}/${name}"
  local dest="${ROOT}/${name}"
  if [[ "$had" != 1 ]]; then
    if [[ "$DRY_RUN" -eq 1 ]]; then
      log "would remove ${dest}"
    else
      remove_managed_dir "$dest"
    fi
    return 0
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "would restore ${dest}"
    return 0
  fi
  rsync_dir "$src" "$dest" "$kind" delete || return 1
}

assert_billing_container() {
  local expected="$1"
  local raw
  [[ "$expected" =~ ^sha256:[a-f0-9]{64}$ ]] || {
    log "billing container check has no image id"
    return 1
  }
  raw="$(docker inspect --format '{{.Image}}' "$BILLING_CONTAINER")" || {
    log "billing container ${BILLING_CONTAINER} is not running"
    return 1
  }
  raw="${raw,,}"
  raw="${raw//$'\r'/}"
  raw="${raw//$'\n'/}"
  if [[ "$raw" != "$expected" ]]; then
    log "billing container image is ${raw} (want ${expected})"
    return 1
  fi
  log "billing container ${BILLING_CONTAINER} is ${raw}"
}

restore_image() {
  local current_id expected
  # An empty id and tag still rebuilds from the restored Dockerfile and source.
  capture_image_id || return 1
  current_id="$IMAGE_ID"
  expected="$MANIFEST_IMAGE_ID"
  if [[ -n "$expected" && "$current_id" == "$expected" ]]; then
    log "billing image already matches the backup"
  elif [[ -n "$MANIFEST_IMAGE_TAG" ]] && docker image inspect "$MANIFEST_IMAGE_TAG" >/dev/null 2>&1; then
    if [[ "$DRY_RUN" -eq 1 ]]; then
      log "would tag ${MANIFEST_IMAGE_TAG} as ${IMAGE}"
    else
      docker tag "$MANIFEST_IMAGE_TAG" "$IMAGE" || return 1
      capture_image_id || return 1
      expected="$IMAGE_ID"
      if [[ -n "$MANIFEST_IMAGE_ID" && "$expected" != "$MANIFEST_IMAGE_ID" ]]; then
        log "tagged image ${expected} does not match backup ${MANIFEST_IMAGE_ID}"
        return 1
      fi
    fi
  elif [[ -f "$ROOT/Dockerfile.billing" && -d "$ROOT/billing-src" ]]; then
    if [[ "$DRY_RUN" -eq 1 ]]; then
      log "would rebuild ${IMAGE} from the restored billing source"
    else
      log "backup image tag missing; rebuilding restored billing source"
      docker build -f "$ROOT/Dockerfile.billing" -t "$IMAGE" "$ROOT/billing-src" || return 1
      capture_image_id || return 1
      expected="$IMAGE_ID"
    fi
  else
    log "no backup image to restore"
    return 1
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "would docker compose up -d billing and check the container image"
    return 0
  fi
  # A matching tag does not mean the container is running that image.
  # Retrying --rollback must start billing again.
  log "restarting billing"
  compose up -d billing || return 1
  assert_billing_container "$expected" || return 1
  return 0
}

restore_backup() {
  local backup="$1"
  local caddy_diff docker_diff reload_failed image_failed
  [[ -d "$backup" ]] || die "backup not found: ${backup}"
  [[ -f "$backup/backup.manifest" ]] || die "not a deploy backup: ${backup}"
  read_manifest "$backup/backup.manifest"
  assert_managed_not_symlinks
  caddy_diff=0
  docker_diff=0
  reload_failed=0
  image_failed=0
  if [[ "$MANIFEST_HAD_CADDYFILE" == 1 ]]; then
    if files_differ "$backup/Caddyfile" "$ROOT/Caddyfile"; then
      caddy_diff=1
    fi
  elif [[ -e "$ROOT/Caddyfile" ]]; then
    caddy_diff=1
  fi
  if [[ "$MANIFEST_HAD_DOCKERFILE" == 1 ]]; then
    if files_differ "$backup/Dockerfile.billing" "$ROOT/Dockerfile.billing"; then
      docker_diff=1
    fi
  elif [[ -e "$ROOT/Dockerfile.billing" ]]; then
    docker_diff=1
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "would roll back from ${backup}"
  else
    log "rolling back from ${backup}"
  fi
  restore_one_file "$backup" Caddyfile "$MANIFEST_HAD_CADDYFILE" || return 1
  restore_one_file "$backup" Dockerfile.billing "$MANIFEST_HAD_DOCKERFILE" || return 1
  restore_one_dir "$backup" site "$MANIFEST_HAD_SITE" site || return 1
  restore_one_dir "$backup" billing-src "$MANIFEST_HAD_BILLING" billing || return 1
  # A failed Caddy reload must not skip the billing restore. Both finish
  # before health checks, and either failure is still a failed rollback.
  if [[ "$caddy_diff" -eq 1 ]]; then
    if [[ "$DRY_RUN" -eq 1 ]]; then
      log "would reload caddy"
    else
      log "reloading restored Caddyfile"
      if ! caddy_reload; then
        log "restored Caddyfile reload failed"
        reload_failed=1
      fi
    fi
  fi
  if [[ "$docker_diff" -eq 1 || "$MANIFEST_IMAGE_ID" != "" || "$MANIFEST_IMAGE_TAG" != "" ]]; then
    if ! restore_image; then
      log "billing image restore failed"
      image_failed=1
    fi
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then
    return 0
  fi
  if [[ "$reload_failed" -eq 1 || "$image_failed" -eq 1 ]]; then
    return 1
  fi
  health_checks || return 1
  return 0
}

deploy_ref() {
  local tarball tree
  STAMP="$(date -u +%Y%m%dT%H%M%S%NZ)"
  if [[ "$STAMP" == *%N* ]]; then
    STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
  fi
  BACKUP_DIR="${BACKUP_PREFIX}-${REF_DIR}-${STAMP}"
  tarball="$WORK/src.tar.gz"
  download_tarball "$tarball"
  assert_tar_safe "$tarball"
  tree="$(extract_tree "$tarball" "$WORK/src")" || die "failed to unpack the tarball"
  validate_tree "$tree"
  detect_changes "$tree"
  node_check "$tree/ops/billing" || die "node --check failed"
  tag_current_image || die "failed to tag the current image"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "would back up to ${BACKUP_DIR}"
    print_restart_plan
    log "dry-run complete"
    return 0
  fi
  backup_live || die "backup failed"
  ROLLBACK_ARMED=1
  sync_release "$tree" || die "sync failed"
  node_check "$ROOT/billing-src" || die "node --check failed after sync"
  apply_restarts || die "restart failed"
  health_checks || die "health checks failed"
  ROLLBACK_ARMED=0
  log "deployed ${REF}"
  log "backup=${BACKUP_DIR}"
}

main() {
  parse_args "$@"
  check_config
  require_tools
  prepare_root
  prepare_work
  if [[ -n "$ROLLBACK" ]]; then
    restore_backup "$ROLLBACK" || die "rollback failed"
    if [[ "$DRY_RUN" -eq 1 ]]; then
      log "dry-run complete"
      exit 0
    fi
    health_checks || die "health checks failed after rollback"
    log "rollback complete ${ROLLBACK}"
    exit 0
  fi
  deploy_ref
}

main "$@"
