// @vitest-environment node
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { afterEach, expect, it, vi } from 'vitest';
import { exportDraft } from '../../editor/export.mjs';
import { createDefaultDraft } from '../../editor/shared/draft';

const firstRename = vi.hoisted(() => {
  let notify!: () => void;
  let release!: () => void;
  return {
    active: true,
    entered: new Promise<void>((resolve) => { notify = resolve; }),
    released: new Promise<void>((resolve) => { release = resolve; }),
    notify: () => notify(),
    release: () => release(),
  };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: async (from: Parameters<typeof actual.rename>[0], to: Parameters<typeof actual.rename>[1]) => {
      if (firstRename.active && String(from).includes('draft-1.json.tmp')) {
        firstRename.active = false;
        firstRename.notify();
        await firstRename.released;
      }
      return actual.rename(from, to);
    },
  };
});

const execute = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it('serializes the full check and write cycle for concurrent exports', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omp-editor-export-lock-'));
  roots.push(root);
  await execute('git', ['init', '--quiet'], { cwd: root });
  await mkdir(join(root, 'design'), { recursive: true });
  await execute('git', ['-c', 'user.name=OMP Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'initial'], { cwd: root });
  const { stdout } = await execute('git', ['rev-parse', 'HEAD'], { cwd: root });
  const draft = createDefaultDraft('draft-1', stdout.trim());

  const first = exportDraft({ root, draft });
  await firstRename.entered;
  const second = exportDraft({ root, draft });
  const observedSecond = second.then(() => undefined, () => undefined);
  await Promise.race([observedSecond, delay(1000)]);
  firstRename.release();
  await Promise.all([first, second]);

  expect(JSON.parse(await readFile(join(root, 'design/themes/default.json'), 'utf8')).id).toBe('default');
  expect(JSON.parse(await readFile(join(root, '.omp-editor/exports/draft-1.json'), 'utf8')).draftId).toBe('draft-1');
});
