// @vitest-environment node
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';
import { createDefaultDraft } from '../../editor/shared/draft';

const execute = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it('waits for a repository lock held by another process', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omp-editor-process-lock-'));
  roots.push(root);
  await execute('git', ['init', '--quiet'], { cwd: root });
  await mkdir(join(root, 'design'), { recursive: true });
  await execute('git', ['-c', 'user.name=OMP Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'initial'], { cwd: root });
  const { stdout } = await execute('git', ['rev-parse', 'HEAD'], { cwd: root });
  const draft = createDefaultDraft('draft-1', stdout.trim());
  const lockPath = join(root, '.omp-editor', 'exports', '.lock');
  await mkdir(join(root, '.omp-editor', 'exports'), { recursive: true });
  await writeFile(lockPath, JSON.stringify({ id: 'other-process', pid: process.pid, createdAt: Date.now() }), { flag: 'wx' });

  const moduleUrl = pathToFileURL(resolve('editor/export.mjs')).href;
  const source = `import { exportDraft } from ${JSON.stringify(moduleUrl)}; const draft = JSON.parse(${JSON.stringify(JSON.stringify(draft))}); console.log('export-started'); await exportDraft({ root: process.argv[1], draft });`;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', source, root], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  let settled = false;
  const completion = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => {
      settled = true;
      if (code === 0) resolve();
      else reject(new Error(`Export process exited with ${code}: ${stderr}`));
    });
  });
  const started = new Promise<void>((resolve, reject) => {
    child.stdout.once('data', () => resolve());
    child.once('exit', (code) => reject(new Error(`Export process exited before start with ${code}: ${stderr}`)));
  });

  try {
    await started;
    await delay(1000);
    expect(settled).toBe(false);
  } finally {
    await rm(lockPath, { force: true });
    await completion;
  }
  expect(JSON.parse(await readFile(join(root, 'design/themes/default.json'), 'utf8')).id).toBe('default');
});
