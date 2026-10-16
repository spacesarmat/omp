import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const IMAGE = 'ghcr.io/spacesarmat/omp-billing:local';
const SEED_ID = `sha256:${'b'.repeat(64)}`;
const SECRET = 'INDEXER_HASH=$2a$14$SECRETVALUEKEEPTHESEBYTES';

const DOCKER = `#!/usr/bin/env bash
set -euo pipefail
log="\${DEPLOY_TEST_DOCKER_LOG:?}"
state="\${DEPLOY_TEST_DOCKER_STATE:?}"
mkdir -p "$state"
printf '%s\\n' "$*" >> "$log"

idfile() {
  local enc
  enc="\$(printf '%s' "$1" | base64 -w0 | tr '/+' '__')"
  printf '%s/%s' "$state" "$enc"
}

seed() {
  local name="\${DEPLOY_TEST_SEED_IMAGE:-}"
  local id="\${DEPLOY_TEST_SEED_ID:-}"
  local f
  [[ -n "$name" && -n "$id" ]] || return 0
  f="\$(idfile "$name")"
  if [[ ! -f "$f" ]]; then
    printf '%s' "$id" > "$f"
  fi
}
seed

cmd="\${1:-}"
if [[ \$# -gt 0 ]]; then
  shift
fi

case "$cmd" in
  info) exit 0 ;;
  compose)
    if [[ "\${1:-}" == version ]]; then
      printf 'Docker Compose version v2\\n'
      exit 0
    fi
    if [[ "$*" == *reload* && "\${DEPLOY_TEST_DOCKER_RELOAD_FAIL:-}" == 1 ]]; then
      printf 'reload failed\\n' >&2
      exit 1
    fi
    exit 0
    ;;
  image)
    sub="\${1:-}"
    if [[ \$# -gt 0 ]]; then shift; fi
    [[ "$sub" == inspect ]] || { printf 'unexpected image %s\\n' "$sub" >&2; exit 1; }
    format=""
    name=""
    while [[ \$# -gt 0 ]]; do
      case "$1" in
        --format) format="\${2:-}"; shift 2 ;;
        *) name="$1"; shift ;;
      esac
    done
    f="\$(idfile "$name")"
    if [[ ! -f "$f" ]]; then
      printf 'no such image %s\\n' "$name" >&2
      exit 1
    fi
    if [[ -n "$format" ]]; then
      cat "$f"
      printf '\\n'
    fi
    exit 0
    ;;
  tag)
    cp "\$(idfile "\${1:?}")" "\$(idfile "\${2:?}")"
    exit 0
    ;;
  build)
    if [[ "\${DEPLOY_TEST_DOCKER_BUILD_FAIL:-}" == 1 ]]; then
      printf 'build failed\\n' >&2
      exit 1
    fi
    tag=""
    while [[ \$# -gt 0 ]]; do
      case "$1" in
        -t|--tag) tag="\${2:-}"; shift 2 ;;
        *) shift ;;
      esac
    done
    [[ -n "$tag" ]] || { printf 'build without tag\\n' >&2; exit 1; }
    count="$state/build-count"
    n=0
    [[ -f "$count" ]] && n="\$(cat "$count")"
    n=\$((n + 1))
    printf '%s' "$n" > "$count"
    printf 'sha256:%064x' "$n" > "\$(idfile "$tag")"
    exit 0
    ;;
  *)
    printf 'unexpected docker command: %s\\n' "$cmd" >&2
    exit 1
    ;;
esac
`;

const CURL = `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "\${DEPLOY_TEST_CURL_LOG:?}"
out=""
dump=""
method="GET"
url=""
write_out=0
while [[ \$# -gt 0 ]]; do
  case "$1" in
    --output|-o) out="\${2:-}"; shift 2 ;;
    --dump-header|-D) dump="\${2:-}"; shift 2 ;;
    --request|-X) method="\${2:-}"; shift 2 ;;
    --write-out|-w) write_out=1; shift 2 ;;
    --header|-H|--retry|--retry-delay|--max-time|--connect-timeout|--resolve|--max-redirs)
      shift 2 ;;
    --fail|--silent|--show-error|--location|--http1.1) shift ;;
    http://*|https://*) url="$1"; shift ;;
    *) shift ;;
  esac
done
if [[ "$url" == *"/tarball/"* ]]; then
  [[ -n "$out" ]] || exit 1
  cp "\${DEPLOY_TEST_TARBALL:?}" "$out"
  exit 0
fi
if [[ "\${DEPLOY_TEST_HEALTH_FAIL:-}" == 1 ]]; then
  [[ -n "$dump" ]] && printf 'HTTP/1.1 500\\r\\nContent-Type: text/plain\\r\\n\\r\\n' > "$dump"
  [[ -n "$out" ]] && printf 'nope' > "$out"
  [[ "$write_out" -eq 1 ]] && printf '500'
  exit 0
fi
status=200
body='{"ok":true}'
allow=""
case "$method" in
  OPTIONS)
    status=204
    body=""
    allow=\$'Allow: GET, HEAD, POST, OPTIONS\\r\\n'
    ;;
  HEAD)
    status=200
    body=""
    ;;
  *)
    if [[ "$url" == *"/admin"* ]]; then
      body='<html>admin</html>'
    elif [[ "$url" != *"/health"* ]]; then
      body='<html>landing</html>'
    fi
    ;;
esac
if [[ -n "$dump" ]]; then
  printf 'HTTP/1.1 %s\\r\\nStrict-Transport-Security: max-age=15552000; includeSubDomains\\r\\nX-Content-Type-Options: nosniff\\r\\nX-Frame-Options: DENY\\r\\nReferrer-Policy: strict-origin-when-cross-origin\\r\\n%sContent-Type: text/plain\\r\\n\\r\\n' "$status" "$allow" > "$dump"
fi
if [[ -n "$out" ]]; then
  printf '%s' "$body" > "$out"
fi
if [[ "$write_out" -eq 1 ]]; then
  printf '%s' "$status"
fi
`;

const NODE = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "\${DEPLOY_TEST_NODE_LOG:?}"
if [[ "\${DEPLOY_TEST_NODE_FAIL:-}" == 1 ]]; then
  exit 1
fi
if [[ -n "\${DEPLOY_TEST_NODE_FAIL_ON:-}" && "$*" == *"\${DEPLOY_TEST_NODE_FAIL_ON}"* ]]; then
  exit 1
fi
exit 0
`;

type Run = { status: number; stdout: string; stderr: string };
type World = {
  parent: string;
  root: string;
  env: NodeJS.ProcessEnv;
  dockerLog: string;
  curlLog: string;
  nodeLog: string;
};

function writeExe(file: string, body: string) {
  writeFileSync(file, body);
  chmodSync(file, 0o755);
}

function text(value: string | Buffer | undefined): string {
  if (value == null) return '';
  return Buffer.isBuffer(value) ? value.toString('utf8') : value;
}

function release(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    'ops/vps/Caddyfile': 'old caddy\n',
    'ops/vps/site/index.html': 'old landing\n',
    'ops/vps/Dockerfile': 'FROM old\n',
    'ops/billing/package.json': '{"name":"omp-billing"}\n',
    'ops/billing/src/server.mjs': 'export const version = 1;\n',
    'ops/billing/start.sh': '#!/bin/sh\nexit 0\n',
    'ops/billing/public/index.html': '<html>admin</html>\n',
    'ops/billing/.env': 'SECRET=from-git\n',
    'README.md': 'not deployed\n',
    ...overrides,
  };
}

function vpsPath(rel: string): string | null {
  if (rel.startsWith('ops/vps/site/')) return `site/${rel.slice('ops/vps/site/'.length)}`;
  if (rel === 'ops/vps/Caddyfile') return 'Caddyfile';
  if (rel === 'ops/vps/Dockerfile') return 'Dockerfile.billing';
  if (rel.startsWith('ops/billing/')) return `billing-src/${rel.slice('ops/billing/'.length)}`;
  return null;
}

function makeArchive(dir: string, files: Record<string, string>): string {
  const src = path.join(dir, 'archive-src');
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(src, 'omp-src', rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  const archive = path.join(dir, 'src.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', src, 'omp-src']);
  return archive;
}

function envFile(): string {
  return `TZ=Europe/Moscow\n${SECRET}\nBILLING_IMAGE='${IMAGE}'\n`;
}

function protectedNow(root: string): Record<string, string> {
  return {
    env: readFileSync(path.join(root, '.env'), 'utf8'),
    db: readFileSync(path.join(root, 'data/billing/billing.db'), 'utf8'),
    compose: readFileSync(path.join(root, 'docker-compose.yml'), 'utf8'),
    jacred: readFileSync(path.join(root, 'jacred/init.yaml'), 'utf8'),
    billingEnv: readFileSync(path.join(root, 'billing-src/.env'), 'utf8'),
    localDb: readFileSync(path.join(root, 'billing-src/data/local.db'), 'utf8'),
  };
}

function world(files: Record<string, string>, extra: Record<string, string> = {}): World {
  const parent = path.join(tmpdir(), `omp-deploy-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const root = path.join(parent, 'vps');
  const bin = path.join(parent, 'bin');
  mkdirSync(bin, { recursive: true });
  writeExe(path.join(bin, 'docker'), DOCKER);
  writeExe(path.join(bin, 'curl'), CURL);
  writeExe(path.join(bin, 'node'), NODE);
  mkdirSync(path.join(root, 'data/billing'), { recursive: true });
  mkdirSync(path.join(root, 'jacred'), { recursive: true });
  for (const [rel, content] of Object.entries(release())) {
    const dest = vpsPath(rel);
    if (!dest || dest === 'billing-src/.env') continue;
    const full = path.join(root, dest);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  writeFileSync(path.join(root, '.env'), envFile());
  writeFileSync(path.join(root, 'billing-src/.env'), 'SECRET=keep\n');
  mkdirSync(path.join(root, 'billing-src/data'), { recursive: true });
  writeFileSync(path.join(root, 'billing-src/data/local.db'), 'local-db\n');
  writeFileSync(path.join(root, 'data/billing/billing.db'), 'sqlite-bytes-do-not-touch');
  writeFileSync(path.join(root, 'docker-compose.yml'), 'name: omp-vps\n');
  writeFileSync(path.join(root, 'jacred/init.yaml'), 'apikey: keep\n');
  const dockerLog = path.join(parent, 'docker.log');
  const curlLog = path.join(parent, 'curl.log');
  const nodeLog = path.join(parent, 'node.log');
  const state = path.join(parent, 'docker-state');
  writeFileSync(dockerLog, '');
  writeFileSync(curlLog, '');
  writeFileSync(nodeLog, '');
  const archive = makeArchive(parent, files);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    OMP_VPS_ROOT: root,
    OMP_BACKUP_PREFIX: path.join(parent, 'omp-vps-backup'),
    OMP_BILLING_IMAGE: IMAGE,
    OMP_HEALTH_ATTEMPTS: '1',
    OMP_HEALTH_SLEEP: '0',
    OMP_REPO: 'spacesarmat/omp',
    DEPLOY_TEST_TARBALL: archive,
    DEPLOY_TEST_DOCKER_LOG: dockerLog,
    DEPLOY_TEST_DOCKER_STATE: state,
    DEPLOY_TEST_CURL_LOG: curlLog,
    DEPLOY_TEST_NODE_LOG: nodeLog,
    DEPLOY_TEST_SEED_IMAGE: IMAGE,
    DEPLOY_TEST_SEED_ID: SEED_ID,
    ...extra,
  };
  return { parent, root, env, dockerLog, curlLog, nodeLog };
}

function runDeploy(env: NodeJS.ProcessEnv, args: string[]): Run {
  const result = spawnSync('bash', [path.resolve('ops/vps/deploy.sh'), ...args], {
    env,
    encoding: 'utf8',
  });
  return { status: result.status ?? 1, stdout: text(result.stdout), stderr: text(result.stderr) };
}

function log(file: string): string {
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

function linesStarting(file: string, command: string): string[] {
  return log(file)
    .split('\n')
    .filter((line) => line === command || line.startsWith(`${command} `));
}

function backupFrom(stdout: string): string {
  const found = [...stdout.matchAll(/^deploy: backup=(.+)$/gm)].map((match) => match[1]);
  expect(found.length).toBeGreaterThan(0);
  return found[found.length - 1];
}

function imageId(env: NodeJS.ProcessEnv, name = IMAGE): string {
  return execFileSync('docker', ['image', 'inspect', '--format', '{{.Id}}', name], {
    env,
    encoding: 'utf8',
  }).trim();
}

describe('ops/vps deploy', () => {
  it('is shellcheck clean', () => {
    execFileSync('shellcheck', ['ops/vps/deploy.sh', 'ops/vps/ssh-deploy.sh'], { stdio: 'inherit' });
  });

  it('documents the manual workflow secrets', () => {
    const workflow = readFileSync('.github/workflows/vps-deploy.yml', 'utf8');
    const readme = readFileSync('ops/vps/README.md', 'utf8');
    expect(workflow).toContain('workflow_dispatch');
    expect(workflow).not.toContain('push:');
    expect(workflow).toContain('VPS_HOST');
    expect(workflow).toContain('VPS_SSH_KEY');
    expect(workflow).toContain('ops/vps/ssh-deploy.sh');
    expect(readme).toContain('deploy.sh');
    expect(readme).toContain('--dry-run');
    expect(readme).toContain('--rollback');
    expect(readme).toContain('VPS_HOST');
    expect(readme).toContain('VPS_SSH_KEY');
    expect(readme).toContain('does not run on push');
  });

  it('syncs only the four paths, restarts billing, and reloads caddy', () => {
    const files = release({
      'ops/vps/Caddyfile': 'new caddy\n',
      'ops/vps/site/index.html': 'new landing\n',
      'ops/vps/Dockerfile': 'FROM new\n',
      'ops/billing/src/server.mjs': 'export const version = 2;\n',
    });
    const box = world(files);
    writeFileSync(path.join(box.root, 'site/extra.html'), 'keep\n');
    const before = protectedNow(box.root);
    const result = runDeploy(box.env, ['main']);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(readFileSync(path.join(box.root, 'Caddyfile'), 'utf8')).toBe('new caddy\n');
    expect(readFileSync(path.join(box.root, 'site/index.html'), 'utf8')).toBe('new landing\n');
    expect(existsSync(path.join(box.root, 'site/extra.html'))).toBe(false);
    expect(readFileSync(path.join(box.root, 'Dockerfile.billing'), 'utf8')).toBe('FROM new\n');
    expect(readFileSync(path.join(box.root, 'billing-src/src/server.mjs'), 'utf8')).toBe('export const version = 2;\n');
    expect(existsSync(path.join(box.root, 'README.md'))).toBe(false);
    expect(protectedNow(box.root)).toEqual(before);
    const backup = backupFrom(result.stdout);
    expect(backup).toMatch(/omp-vps-backup-main-[0-9]{8}T[0-9]+Z$/);
    expect(readFileSync(path.join(backup, 'Caddyfile'), 'utf8')).toBe('old caddy\n');
    expect(readFileSync(path.join(backup, 'site/extra.html'), 'utf8')).toBe('keep\n');
    expect(readFileSync(path.join(backup, 'backup.manifest'), 'utf8')).toContain('had_billing_src=1');
    expect(existsSync(path.join(backup, '.env'))).toBe(false);
    expect(existsSync(path.join(backup, 'data'))).toBe(false);
    const docker = log(box.dockerLog);
    expect(linesStarting(box.dockerLog, 'build')).toHaveLength(1);
    expect(docker).toContain('up -d billing');
    expect(docker).toContain('caddy reload');
    expect(docker).not.toContain('compose down');
    expect(docker).not.toContain(SECRET);
    for (const line of linesStarting(box.dockerLog, 'compose')) {
      if (line.includes(' up ')) expect(line).toContain('up -d billing');
    }
    expect(log(box.curlLog)).toContain('https://api.github.com/repos/spacesarmat/omp/tarball/main');
    expect(log(box.curlLog)).toContain('--request HEAD');
    expect(log(box.curlLog)).toContain('--request OPTIONS');
    expect(log(box.curlLog)).toContain('https://billing.omp-player.online/health');
    expect(log(box.curlLog)).toContain('https://billing.omp-player.online/admin');
    expect(log(box.curlLog)).toContain('https://omp-player.online/');
    expect(log(box.nodeLog)).toContain('billing-src/src/server.mjs');
    expect(imageId(box.env)).not.toBe(SEED_ID);
    expect(result.stdout).not.toContain('SECRET');
    expect(result.stderr).not.toContain('SECRET');
  });

  it('does not rebuild or reload when nothing changed', () => {
    const box = world(release());
    const before = protectedNow(box.root);
    const result = runDeploy(box.env, ['main']);
    expect(result.status, result.stderr).toBe(0);
    expect(linesStarting(box.dockerLog, 'build')).toHaveLength(0);
    expect(log(box.dockerLog)).not.toContain('up -d');
    expect(log(box.dockerLog)).not.toContain('caddy reload');
    expect(linesStarting(box.dockerLog, 'tag')).toHaveLength(1);
    expect(protectedNow(box.root)).toEqual(before);
    expect(imageId(box.env)).toBe(SEED_ID);
  });

  it('reloads caddy without rebuilding when only the Caddyfile changes', () => {
    const box = world(release({ 'ops/vps/Caddyfile': 'new caddy\n' }));
    const result = runDeploy(box.env, ['main']);
    expect(result.status, result.stderr).toBe(0);
    expect(linesStarting(box.dockerLog, 'build')).toHaveLength(0);
    expect(log(box.dockerLog)).not.toContain('up -d');
    expect(log(box.dockerLog)).toContain('caddy reload');
  });

  it('rebuilds billing without reloading caddy when only billing changes', () => {
    const box = world(release({ 'ops/billing/src/server.mjs': 'export const version = 2;\n' }));
    const result = runDeploy(box.env, ['main']);
    expect(result.status, result.stderr).toBe(0);
    expect(linesStarting(box.dockerLog, 'build')).toHaveLength(1);
    expect(log(box.dockerLog)).toContain('up -d billing');
    expect(log(box.dockerLog)).not.toContain('caddy reload');
  });

  it('updates the bind-mounted site without a service restart', () => {
    const box = world(release({ 'ops/vps/site/index.html': 'new landing\n' }));
    const result = runDeploy(box.env, ['main']);
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(path.join(box.root, 'site/index.html'), 'utf8')).toBe('new landing\n');
    expect(linesStarting(box.dockerLog, 'build')).toHaveLength(0);
    expect(log(box.dockerLog)).not.toContain('up -d');
    expect(log(box.dockerLog)).not.toContain('caddy reload');
    expect(log(box.curlLog)).toContain('https://omp-player.online/');
  });

  it('dry-run prints the plan and does not change the VPS', () => {
    const files = release({ 'ops/vps/Caddyfile': 'new caddy\n' });
    const box = world(files);
    const beforeTree = readFileSync(path.join(box.root, 'Caddyfile'), 'utf8');
    const before = protectedNow(box.root);
    const result = runDeploy(box.env, ['--dry-run', 'main']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('dry-run complete');
    expect(result.stdout).toContain('would back up');
    expect(result.stdout).toContain('would reload caddy');
    expect(readFileSync(path.join(box.root, 'Caddyfile'), 'utf8')).toBe(beforeTree);
    expect(protectedNow(box.root)).toEqual(before);
    expect(linesStarting(box.dockerLog, 'build')).toHaveLength(0);
    expect(linesStarting(box.dockerLog, 'tag')).toHaveLength(0);
    expect(log(box.dockerLog)).not.toContain('up -d');
    expect(log(box.dockerLog)).not.toContain('caddy reload');
    expect(readdirSync(box.parent).filter((name) => name.startsWith('omp-vps-backup-'))).toEqual([]);
    expect(result.stdout).toContain('omp-vps-backup-main-');
  });

  it('rolls back files and the image when health checks fail', () => {
    const files = release({
      'ops/vps/Caddyfile': 'new caddy\n',
      'ops/vps/site/index.html': 'new landing\n',
      'ops/billing/src/server.mjs': 'export const version = 2;\n',
    });
    const box = world(files, { DEPLOY_TEST_HEALTH_FAIL: '1' });
    writeFileSync(path.join(box.root, 'site/extra.html'), 'keep\n');
    const before = protectedNow(box.root);
    const result = runDeploy(box.env, ['main']);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain('rolling back');
    expect(readFileSync(path.join(box.root, 'Caddyfile'), 'utf8')).toBe('old caddy\n');
    expect(readFileSync(path.join(box.root, 'site/index.html'), 'utf8')).toBe('old landing\n');
    expect(readFileSync(path.join(box.root, 'site/extra.html'), 'utf8')).toBe('keep\n');
    expect(readFileSync(path.join(box.root, 'billing-src/src/server.mjs'), 'utf8')).toBe('export const version = 1;\n');
    expect(protectedNow(box.root)).toEqual(before);
    expect(imageId(box.env)).toBe(SEED_ID);
    expect(linesStarting(box.dockerLog, 'build').length).toBeGreaterThan(0);
    expect(log(box.dockerLog)).toContain('up -d billing');
  });

  it('rolls back a sync when node --check fails before the image is rebuilt', () => {
    const box = world(release({ 'ops/billing/src/server.mjs': 'export const version = 2;\n' }), {
      DEPLOY_TEST_NODE_FAIL_ON: 'billing-src',
    });
    const before = protectedNow(box.root);
    const result = runDeploy(box.env, ['main']);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain('node --check failed');
    expect(readFileSync(path.join(box.root, 'billing-src/src/server.mjs'), 'utf8')).toBe('export const version = 1;\n');
    expect(protectedNow(box.root)).toEqual(before);
    expect(linesStarting(box.dockerLog, 'build')).toHaveLength(0);
    expect(imageId(box.env)).toBe(SEED_ID);
  });

  it('restores the previous files when the image build fails', () => {
    const box = world(release({ 'ops/billing/src/server.mjs': 'export const version = 2;\n' }), {
      DEPLOY_TEST_DOCKER_BUILD_FAIL: '1',
    });
    const before = protectedNow(box.root);
    const result = runDeploy(box.env, ['main']);
    expect(result.status).not.toBe(0);
    expect(readFileSync(path.join(box.root, 'billing-src/src/server.mjs'), 'utf8')).toBe('export const version = 1;\n');
    expect(protectedNow(box.root)).toEqual(before);
    expect(imageId(box.env)).toBe(SEED_ID);
  });

  it('restores a backup with --rollback', () => {
    const files = release({
      'ops/vps/Caddyfile': 'new caddy\n',
      'ops/vps/site/index.html': 'new landing\n',
      'ops/billing/src/server.mjs': 'export const version = 2;\n',
    });
    const box = world(files);
    writeFileSync(path.join(box.root, 'site/extra.html'), 'keep\n');
    const deployed = runDeploy(box.env, ['v1.2.3']);
    expect(deployed.status, deployed.stderr).toBe(0);
    const backup = backupFrom(deployed.stdout);
    expect(backup).toContain('omp-vps-backup-v1.2.3-');
    expect(imageId(box.env)).not.toBe(SEED_ID);
    const preview = runDeploy(box.env, ['--dry-run', '--rollback', backup]);
    expect(preview.status, preview.stderr).toBe(0);
    expect(preview.stdout).toContain('dry-run complete');
    expect(readFileSync(path.join(box.root, 'Caddyfile'), 'utf8')).toBe('new caddy\n');
    const rolled = runDeploy(box.env, ['--rollback', backup]);
    expect(rolled.status, `${rolled.stdout}\n${rolled.stderr}`).toBe(0);
    expect(readFileSync(path.join(box.root, 'Caddyfile'), 'utf8')).toBe('old caddy\n');
    expect(readFileSync(path.join(box.root, 'site/extra.html'), 'utf8')).toBe('keep\n');
    expect(readFileSync(path.join(box.root, 'billing-src/src/server.mjs'), 'utf8')).toBe('export const version = 1;\n');
    expect(imageId(box.env)).toBe(SEED_ID);
    expect(readFileSync(path.join(box.root, '.env'), 'utf8')).toBe(envFile());
  });

  it('refuses a symlink on a managed path and leaves .env alone', () => {
    const box = world(release());
    const env = readFileSync(path.join(box.root, '.env'), 'utf8');
    execFileSync('rm', ['-f', path.join(box.root, 'Caddyfile')]);
    execFileSync('ln', ['-s', path.join(box.root, '.env'), path.join(box.root, 'Caddyfile')]);
    const result = runDeploy(box.env, ['main']);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('symlink');
    expect(readFileSync(path.join(box.root, '.env'), 'utf8')).toBe(env);
    expect(log(box.curlLog)).not.toContain('/tarball/');
  });

  it('stops before download when BILLING_IMAGE does not match .env', () => {
    const box = world(release(), { OMP_BILLING_IMAGE: 'ghcr.io/spacesarmat/omp-billing:other' });
    const before = readFileSync(path.join(box.root, '.env'), 'utf8');
    const result = runDeploy(box.env, ['main']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('BILLING_IMAGE');
    expect(readFileSync(path.join(box.root, '.env'), 'utf8')).toBe(before);
    expect(log(box.curlLog)).not.toContain('/tarball/');
  });

  it('rejects an unsafe git ref before downloading', () => {
    const box = world(release());
    const result = runDeploy(box.env, ['main;touch']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('invalid git ref');
    expect(log(box.curlLog)).toBe('');
  });

  it('rejects a tarball that escapes its directory', () => {
    const box = world(release());
    const pwn = path.join(box.parent, 'pwned');
    const archive = path.join(box.parent, 'bad.tar.gz');
    execFileSync('python3', [
      '-c',
      `import tarfile, io
tar = tarfile.open(${JSON.stringify(archive)}, 'w:gz')
info = tarfile.TarInfo(${JSON.stringify(pwn)})
payload = b'nope'
info.size = len(payload)
tar.addfile(info, io.BytesIO(payload))
info2 = tarfile.TarInfo('omp-src/../escaped')
info2.size = 4
tar.addfile(info2, io.BytesIO(b'evil'))
tar.close()
`,
    ]);
    box.env.DEPLOY_TEST_TARBALL = archive;
    const before = protectedNow(box.root);
    const result = runDeploy(box.env, ['main']);
    expect(result.status).not.toBe(0);
    expect(existsSync(pwn)).toBe(false);
    expect(existsSync(path.join(box.parent, 'escaped'))).toBe(false);
    expect(protectedNow(box.root)).toEqual(before);
    expect(readFileSync(path.join(box.root, 'Caddyfile'), 'utf8')).toBe('old caddy\n');
  });

  it('does not put the GitHub token on the curl command line', () => {
    const box = world(release(), { GITHUB_TOKEN: 'super-secret-token' });
    const result = runDeploy(box.env, ['--dry-run', 'main']);
    expect(result.status, result.stderr).toBe(0);
    expect(log(box.curlLog)).not.toContain('super-secret-token');
    expect(result.stdout).not.toContain('super-secret-token');
    expect(result.stderr).not.toContain('super-secret-token');
    expect(log(box.curlLog)).toContain('--header');
  });
});

describe('ops/vps ssh deploy', () => {
  const SSH = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "\${DEPLOY_TEST_SSH_LOG:?}"
if [[ "$*" == *mktemp* ]]; then
  printf '%s\\n' /tmp/omp-deploy.testdir
fi
exit 0
`;
  const SCP = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "\${DEPLOY_TEST_SCP_LOG:?}"
exit 0
`;

  function runSsh(env: NodeJS.ProcessEnv): Run {
    const result = spawnSync('bash', [path.resolve('ops/vps/ssh-deploy.sh')], { env, encoding: 'utf8' });
    return { status: result.status ?? 1, stdout: text(result.stdout), stderr: text(result.stderr) };
  }

  it('stops when the VPS secrets are missing', () => {
    const result = runSsh({ ...process.env, VPS_HOST: '', VPS_SSH_KEY: '', REF: 'main' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('VPS_HOST');
    expect(result.stderr).toContain('VPS_SSH_KEY');
  });

  it('runs deploy.sh over SSH without placing the token on the command line', () => {
    const parent = path.join(tmpdir(), `omp-ssh-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const bin = path.join(parent, 'bin');
    mkdirSync(bin, { recursive: true });
    writeExe(path.join(bin, 'ssh'), SSH);
    writeExe(path.join(bin, 'scp'), SCP);
    const sshLog = path.join(parent, 'ssh.log');
    const scpLog = path.join(parent, 'scp.log');
    writeFileSync(sshLog, '');
    writeFileSync(scpLog, '');
    const result = runSsh({
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      VPS_HOST: '203.0.113.10',
      VPS_SSH_KEY: 'SECRETKEYMATERIAL',
      REF: 'feat/billing',
      DRY_RUN: 'true',
      GH_TOKEN: 'super-secret-token',
      DEPLOY_TEST_SSH_LOG: sshLog,
      DEPLOY_TEST_SCP_LOG: scpLog,
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const ssh = log(sshLog);
    const scp = log(scpLog);
    expect(ssh).toContain('root@203.0.113.10');
    expect(ssh).toContain('/tmp/omp-deploy.testdir/deploy.sh');
    expect(ssh).toContain('--dry-run');
    expect(ssh).toContain('feat/billing');
    expect(ssh).not.toContain('super-secret-token');
    expect(ssh).not.toContain('SECRETKEYMATERIAL');
    expect(scp).toContain('deploy.sh');
    expect(scp).toContain('/token');
    expect(scp).not.toContain('super-secret-token');
    expect(scp).not.toContain('SECRETKEYMATERIAL');
  });
});
