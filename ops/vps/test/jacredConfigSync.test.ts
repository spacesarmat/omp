import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = 'ops/vps/jacred-config-sync';
const SCRIPT = path.resolve(DIR, 'jacred-config-sync.sh');
const SECRET = 'apikey: SECRET-do-not-print-123';

const FAKE_DOCKER = `#!/usr/bin/env bash
case "$1" in
  inspect) printf '%s\\n' "\${FAKE_RUNNING:-true}" ;;
  exec)
    [[ "\${FAKE_EXEC_FAIL:-}" == 1 ]] && exit 1
    cat "\${FAKE_SRC:?}" ;;
  *) echo "unexpected docker $*" >&2; exit 3 ;;
esac
`;

function config(extra = '', proxy = true): string {
  return [
    'listenport: 9117',
    SECRET,
    'syncapi: https://sync.jacred.stream',
    'timeSync: 120',
    extra,
    proxy ? 'globalproxy:\n- pattern: sync\\.jacred\\.stream\n  useAuth: false\n  list:\n  - http://warp:1080' : 'globalproxy: ',
    'tracksinterval:\n  task0: 180',
    '',
  ].join('\n');
}

function world(hostContent: string, srcContent: string) {
  const dir = mkdtempSync(path.join(tmpdir(), 'jcs-'));
  const bin = path.join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(path.join(bin, 'docker'), FAKE_DOCKER);
  chmodSync(path.join(bin, 'docker'), 0o755);
  const host = path.join(dir, 'init.yaml');
  const src = path.join(dir, 'src.yaml');
  writeFileSync(host, hostContent);
  writeFileSync(src, srcContent);
  const backups = path.join(dir, 'backups');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    FAKE_SRC: src,
    JACRED_SYNC_HOST_FILE: host,
    JACRED_SYNC_BACKUP_DIR: backups,
    JACRED_SYNC_LOCK: path.join(dir, 'lock'),
    TMPDIR: dir,
  };
  const run = (extra: NodeJS.ProcessEnv = {}) => {
    const r = spawnSync('bash', [SCRIPT], { env: { ...env, ...extra }, encoding: 'utf8' });
    return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
  };
  const list = () => (existsSync(backups) ? readdirSync(backups).sort() : []);
  return { dir, host, src, backups, run, list };
}

const hasYaml = spawnSync('python3', ['-c', 'import yaml']).status === 0;

describe('jacred-config-sync', () => {
  it('is shellcheck clean, and the units run the installed script every minute', () => {
    execFileSync('shellcheck', [`${DIR}/jacred-config-sync.sh`, `${DIR}/install.sh`], { stdio: 'inherit' });
    const service = readFileSync(`${DIR}/jacred-config-sync.service`, 'utf8');
    const timer = readFileSync(`${DIR}/jacred-config-sync.timer`, 'utf8');
    expect(service).toContain('ExecStart=/opt/omp-vps/jacred-config-sync/jacred-config-sync.sh');
    expect(service).toContain('Type=oneshot');
    expect(timer).toContain('OnUnitActiveSec=1min');
    const script = readFileSync(SCRIPT, 'utf8');
    expect(script).not.toMatch(/docker (restart|stop|start|compose|rm)\b/);
    expect(readFileSync('ops/vps/README.md', 'utf8')).toContain('jacred-config-sync');
  });

  it('in sync: does nothing and logs nothing', () => {
    const w = world(config(), config());
    const r = w.run();
    expect(r.status).toBe(0);
    expect(r.out).toBe('');
    expect(w.list()).toEqual([]);
  });

  it('a changed running config replaces the host file in place and keeps a backup; keys are never printed', () => {
    const w = world(config(), config('maxreadfile: 300'));
    const inode = statSync(w.host).ino;
    const r = w.run();
    expect(r.status).toBe(0);
    expect(readFileSync(w.host, 'utf8')).toBe(config('maxreadfile: 300'));
    expect(statSync(w.host).ino).toBe(inode);
    expect(w.list()).toHaveLength(1);
    expect(readFileSync(path.join(w.backups, w.list()[0]), 'utf8')).toBe(config());
    expect(statSync(path.join(w.backups, w.list()[0])).mode & 0o077).toBe(0);
    expect(r.out).toMatch(/updated .* previous copy/);
    expect(r.out).not.toContain('SECRET');
    expect(readdirSync(w.dir).filter((f) => f.startsWith('jacred-config-sync.'))).toEqual([]); // temp file removed
  });

  it.each([
    ['the container is not running', { FAKE_RUNNING: 'false' }, config('x: 1'), /not running/],
    ['the file cannot be read', { FAKE_EXEC_FAIL: '1' }, config('x: 1'), /cannot read/],
    ['the file is empty', {}, '', /is empty/],
    ['it is not a JacRed config', {}, 'foo: bar\n', /no syncapi/],
    ['the globalproxy WARP entry is missing', {}, config('x: 1', false), /no globalproxy entry/],
  ])('skips when %s, host file untouched', (_name, extra, src, msg) => {
    const w = world(config(), src);
    const r = w.run(extra as NodeJS.ProcessEnv);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(msg);
    expect(readFileSync(w.host, 'utf8')).toBe(config());
    expect(w.list()).toEqual([]);
  });

  it('skips when the sync pattern uses another proxy and WARP is only in a different entry', () => {
    const src = config('x: 1', false).replace(
      'globalproxy: ',
      'globalproxy:\n- pattern: sync\\.jacred\\.stream\n  list:\n  - http://other:8080\n- pattern: rutracker\\.org\n  list:\n  - http://warp:1080',
    );
    const w = world(config(), src);
    const r = w.run({ JACRED_SYNC_YAML_CHECK: 'none' });
    expect(r.out).toMatch(/no globalproxy entry/);
    expect(readFileSync(w.host, 'utf8')).toBe(config());
  });

  it('checks entries the same way when the list is indented', () => {
    const block = (syncProxy: string) =>
      `globalproxy:\n  - pattern: "sync\\\\.jacred\\\\.stream"\n    list:\n      - ${syncProxy}\n  - pattern: rutracker\\.org\n    list:\n      - http://warp:1080`;
    const bad = world(config(), config('x: 1', false).replace('globalproxy: ', block('http://other:8080')));
    expect(bad.run({ JACRED_SYNC_YAML_CHECK: 'none' }).out).toMatch(/no globalproxy entry/);
    const good = world(config(), config('x: 1', false).replace('globalproxy: ', block('http://warp:1080')));
    expect(good.run({ JACRED_SYNC_YAML_CHECK: 'none' }).out).toMatch(/updated/);
  });

  it('the git template passes the checks', () => {
    const w = world(config(), readFileSync('ops/vps/jacred/init.yaml', 'utf8'));
    const r = w.run({ JACRED_SYNC_YAML_CHECK: hasYaml ? 'python' : 'none' });
    expect(r.out).toMatch(/updated/);
  });

  it.skipIf(process.getuid?.() === 0)('a failed write exits 1 and leaves the host file as it was', () => {
    const w = world(config(), config('rev: 2'));
    chmodSync(w.host, 0o444);
    const r = w.run();
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/writing .* failed/);
    expect(readFileSync(w.host, 'utf8')).toBe(config());
    expect(w.list()).toHaveLength(1);
    expect(r.out).not.toContain('SECRET');
  });

  it.skipIf(!hasYaml)('skips invalid YAML', () => {
    const w = world(config(), config('bad: [unclosed'));
    const r = w.run({ JACRED_SYNC_YAML_CHECK: 'python' });
    expect(r.out).toMatch(/not valid YAML/);
    expect(readFileSync(w.host, 'utf8')).toBe(config());
  });

  it('keeps only the newest KEEP backups', () => {
    const w = world(config(), config());
    for (let i = 1; i <= 4; i++) {
      writeFileSync(w.src, config('rev: ' + i));
      // distinct backup names: one per second in real runs; here fake older backups between runs
      mkdirSync(w.backups, { recursive: true });
      writeFileSync(path.join(w.backups, `init.yaml.2026010${i}T000000Z`), 'old');
      expect(w.run({ JACRED_SYNC_KEEP: '2' }).status).toBe(0);
    }
    expect(w.list()).toHaveLength(2);
    expect(readFileSync(w.host, 'utf8')).toBe(config('rev: 4'));
  });
});
