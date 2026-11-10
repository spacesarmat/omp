import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const temporary: string[] = [];

function workflowStep(file: string, name: string) {
  const modulePath = fileURLToPath(import.meta.url);
  const path = resolve(dirname(modulePath), '../../.github/workflows', file);
  const step = readFileSync(path, 'utf8')
    .split(/^ {6}- /m)
    .slice(1)
    .map((block) => `      - ${block}`)
    .find((block) => block.match(/^ {6}- name: (.+)$/m)?.[1] === name);
  expect(step, `step "${name}" in ${file}`).toBeDefined();
  return step ?? '';
}

function fakeGh(root: string, mode: string) {
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  const log = join(root, 'gh.log');
  writeFileSync(log, '');
  if (process.platform === 'win32') {
    writeFileSync(join(bin, 'gh.cmd'), `@echo off
if "%1"=="release" exit /b 0
if not "%1"=="api" exit /b 1
if "%2"=="--method" (echo %* >> "%LOG%" & exit /b 0)
if "%MODE%"=="404" (echo {"message":"Not Found","status":"404"} 1>&2 & exit /b 1)
if "%MODE%"=="500" (echo {"message":"Server Error","status":"500"} 1>&2 & exit /b 1)
if "%MODE%"=="existing" (echo feed-sha & exit /b 0)
exit /b 1
`);
  } else {
    const path = join(bin, 'gh');
    writeFileSync(path, `#!/bin/sh
if [ "$1" = release ]; then exit 0; fi
if [ "$1" != api ]; then exit 1; fi
if [ "$2" = --method ]; then printf '%s\\n' "$@" >> "$LOG"; exit 0; fi
case "$MODE" in
  404) echo '{"message":"Not Found","status":"404"}' >&2; exit 1;;
  500) echo '{"message":"Server Error","status":"500"}' >&2; exit 1;;
  existing) echo feed-sha; exit 0;;
esac
exit 1
`);
    chmodSync(path, 0o755);
  }
  return { bin, log };
}

function runPublish(mode: string) {
  const root = mkdtempSync(join(tmpdir(), 'omp-publish-'));
  temporary.push(root);
  const output = join(root, 'desktop', 'dist-desktop');
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'OMP-0.20.12-beta.1-setup.exe'), 'test installer');
  writeFileSync(join(output, 'update-windows.json'), '{"version":"0.20.12-beta.1"}');
  const script = workflowStep('desktop.yml', 'Publish release asset and feed').match(/run: \|\n([\s\S]*)$/)?.[1];
  expect(script).toBeTruthy();
  const scriptPath = join(root, 'publish.ps1');
  writeFileSync(scriptPath, script!.replace(/^ {10}/gm, '').replace(/\$\{\{ github\.repository \}\}/g, 'spacesarmat/omp'));
  const { bin, log } = fakeGh(root, mode);
  const shell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
  const result = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-File', scriptPath], {
    cwd: root,
    env: { ...process.env, PATH: `${bin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}`, GH_TOKEN: 'test', RELEASE_TAG: 'v0.20.12-beta.1', MODE: mode, LOG: log },
    encoding: 'utf8',
  });
  return { ...result, output: `${result.stdout}${result.stderr}`, log: readFileSync(log, 'utf8') };
}

describe('desktop publish workflow', () => {
  afterEach(() => {
    for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
  });

  it('creates a missing feed, updates an existing one and stops on other failures', (ctx) => {
    const shell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
    const probe = spawnSync(shell, ['-NoProfile', '-Command', 'exit 0']);
    if (probe.error) ctx.skip(`PowerShell is unavailable: ${probe.error.message}`);

    const missing = runPublish('404');
    expect(missing.status, missing.output).toBe(0);
    expect(missing.log).toContain('Add Windows desktop feed');
    expect(missing.log).not.toContain('feed-sha');

    const existing = runPublish('existing');
    expect(existing.status, existing.output).toBe(0);
    expect(existing.log).toContain('Update Windows desktop feed');
    expect(existing.log).toContain('feed-sha');

    const failure = runPublish('500');
    expect(failure.status, failure.output).not.toBe(0);
    expect(failure.log).not.toContain('Windows desktop feed');
  }, 30_000);
});
