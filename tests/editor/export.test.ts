// @vitest-environment node
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { exportDraft } from '../../editor/export.mjs';
import { startEditorServer, type RunningEditorServer } from '../../editor/server.mjs';
import { createEditorClient } from '../../editor/src/client';
import { createDraftController } from '../../editor/src/drafts';
import { createDefaultDraft } from '../../editor/shared/draft';
import { checkGeneratedThemes } from '../../design/generate';

const execute = promisify(execFile);
const roots: string[] = [];
const servers: RunningEditorServer[] = [];

async function makeRepo(): Promise<{ root: string; head: string }> {
  const root = await mkdtemp(join(tmpdir(), 'omp-editor-export-'));
  roots.push(root);
  await execute('git', ['init', '--quiet'], { cwd: root });
  await mkdir(join(root, 'design'), { recursive: true });
  await execute('git', ['-c', 'user.name=OMP Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'initial'], { cwd: root });
  const { stdout } = await execute('git', ['rev-parse', 'HEAD'], { cwd: root });
  return { root, head: stdout.trim() };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('design export', () => {
  it('exports deterministic theme, flow and generated CSS with release intent', async () => {
    const { root, head } = await makeRepo();
    const draft = createDefaultDraft('draft-1', head);
    draft.theme.releaseIntents = [{ target: 'desktop-windows', version: '0.20.12-beta.3', channel: 'beta' }];
    const result = await exportDraft({ root, draft });
    expect(result.files).toEqual([
      'design/flows/desktop-default.json',
      'design/generated/desktop-linux.css',
      'design/generated/desktop-macos.css',
      'design/generated/desktop-windows.css',
      'design/themes/default.json',
    ]);
    expect(result.releaseIntents).toEqual([{ target: 'desktop-windows', version: '0.20.12-beta.3', channel: 'beta' }]);
    const theme = JSON.parse(await readFile(join(root, 'design/themes/default.json'), 'utf8'));
    expect(theme.releaseIntents).toEqual(result.releaseIntents);
    await expect(checkGeneratedThemes(root)).resolves.toBeUndefined();
  });

  it('rejects a stale base without creating files', async () => {
    const { root } = await makeRepo();
    const draft = createDefaultDraft('draft-1', '0000000000000000000000000000000000000000');
    await expect(exportDraft({ root, draft })).rejects.toMatchObject({ code: 'STALE_BASE' });
    expect(await readdir(join(root, 'design'))).toEqual([]);
  });

  it('protects unrelated design changes without a manifest', async () => {
    const { root, head } = await makeRepo();
    await mkdir(join(root, 'design', 'themes'), { recursive: true });
    await writeFile(join(root, 'design', 'themes', 'other.json'), '{"custom":true}\n');
    const draft = createDefaultDraft('draft-1', head);
    await expect(exportDraft({ root, draft })).rejects.toMatchObject({ code: 'DIRTY_DESIGN' });
    expect(await readFile(join(root, 'design', 'themes', 'other.json'), 'utf8')).toBe('{"custom":true}\n');
  });

  it('allows only matching manifest changes on repeated exports', async () => {
    const { root, head } = await makeRepo();
    const draft = createDefaultDraft('draft-1', head);
    const first = await exportDraft({ root, draft });
    const windows = join(root, 'design', 'generated', 'desktop-windows.css');
    const initial = await readFile(windows, 'utf8');
    const second = await exportDraft({ root, draft });
    expect(second.files).toEqual(first.files);
    expect(await readFile(windows, 'utf8')).toBe(initial);
    await writeFile(windows, initial + '\n/* user edit */\n');
    await expect(exportDraft({ root, draft })).rejects.toMatchObject({ code: 'DIRTY_DESIGN' });
    expect(await readFile(windows, 'utf8')).toBe(initial + '\n/* user edit */\n');
  });

  it('preserves only verified export ownership for a recovered copy', async () => {
    const { root, head } = await makeRepo();
    const running = await startEditorServer({ root, token: 'test-token', port: 0, withVite: false });
    servers.push(running);
    const client = createEditorClient({ origin: running.origin, token: 'test-token' });
    const original = await client.putDraft(createDefaultDraft('draft-1', head));
    await client.exportDraft(original);
    const controller = createDraftController({ draft: original, client });
    try {
      controller.update((draft) => {
        draft.theme.name = 'Recovered local edit';
      });
      await controller.saveAsNewDraft();
      await expect(client.exportDraft(controller.draft)).resolves.toMatchObject({ baseCommit: head });
      const manifest = JSON.parse(await readFile(join(root, '.omp-editor', 'exports', `${controller.draft.id}.json`), 'utf8'));
      expect(manifest.draftId).toBe(controller.draft.id);
      const windows = join(root, 'design', 'generated', 'desktop-windows.css');
      await writeFile(windows, await readFile(windows, 'utf8') + '\n/* another tab */\n');
      await expect(client.exportDraft(controller.draft)).rejects.toMatchObject({ code: 'DIRTY_DESIGN' });
      expect(await readFile(windows, 'utf8')).toContain('/* another tab */');
    } finally {
      controller.dispose();
    }
  });

  it('rejects staged design changes without overwriting them', async () => {
    const { root, head } = await makeRepo();
    await mkdir(join(root, 'design', 'themes'), { recursive: true });
    const stagedPath = join(root, 'design', 'themes', 'staged.json');
    await writeFile(stagedPath, '{"version":"staged"}\n');
    await execute('git', ['add', 'design/themes/staged.json'], { cwd: root });
    const draft = createDefaultDraft('draft-1', head);
    await expect(exportDraft({ root, draft })).rejects.toMatchObject({ code: 'DIRTY_DESIGN' });
    expect(await readFile(stagedPath, 'utf8')).toBe('{"version":"staged"}\n');
  });

  it('checks contrast for navigation elements before export', async () => {
    const { root, head } = await makeRepo();
    const draft = createDefaultDraft('draft-1', head);
    draft.theme.overrides.push({
      id: 'nav-low-contrast',
      scope: 'element',
      target: 'desktop-windows',
      screenId: 'settings',
      elementId: 'nav-library',
      tokens: { '--omp-color-accent': '#000000' },
    });
    await expect(exportDraft({ root, draft })).rejects.toMatchObject({ code: 'DESIGN_ISSUES' });
    expect(await readdir(join(root, 'design'))).toEqual([]);
  });

  it('removes only files owned by the previous manifest', async () => {
    const { root, head } = await makeRepo();
    const draft = createDefaultDraft('draft-1', head);
    await exportDraft({ root, draft });
    draft.theme.id = 'renamed';
    draft.theme.name = 'Renamed';
    await exportDraft({ root, draft });
    expect(await readFile(join(root, 'design', 'themes', 'renamed.json'), 'utf8')).toContain('Renamed');
    await expect(readFile(join(root, 'design', 'themes', 'default.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('blocks unreadable themes before any write', async () => {
    const { root, head } = await makeRepo();
    const draft = createDefaultDraft('draft-1', head);
    draft.theme.tokens['--omp-color-accent'] = '#000000';
    draft.theme.tokens['--omp-size-font'] = '8px';
    await expect(exportDraft({ root, draft })).rejects.toMatchObject({ code: 'DESIGN_ISSUES' });
    expect(await readdir(join(root, 'design'))).toEqual([]);
  });

  it('rejects invalid release intents and unsafe ids before writing', async () => {
    const { root, head } = await makeRepo();
    const invalid = createDefaultDraft('draft-1', head);
    invalid.theme.releaseIntents = [{ target: 'desktop-windows', version: '1.0.0', channel: 'beta' }];
    await expect(exportDraft({ root, draft: invalid })).rejects.toThrow();
    const duplicate = createDefaultDraft('draft-1', head);
    duplicate.theme.releaseIntents = [
      { target: 'desktop-windows', version: '1.0.0-beta.1', channel: 'beta' },
      { target: 'desktop-windows', version: '1.0.0-beta.2', channel: 'beta' },
    ];
    await expect(exportDraft({ root, draft: duplicate })).rejects.toThrow();
    const unsafe = createDefaultDraft('draft-1', head);
    unsafe.theme.id = '../../evil';
    await expect(exportDraft({ root, draft: unsafe })).rejects.toThrow();
    expect(await readdir(join(root, 'design'))).toEqual([]);
  });

  it('requires auth and same origin for the export API', async () => {
    const { root, head } = await makeRepo();
    const running = await startEditorServer({ root, token: 'test-token', port: 0, withVite: false });
    servers.push(running);
    const draft = createDefaultDraft('draft-1', head);
    const response = await fetch(running.origin + '/api/export', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
    expect(response.status).toBe(200);
    expect((await fetch(running.origin + '/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) })).status).toBe(401);
    expect((await fetch(running.origin + '/api/export', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json', Origin: 'https://attacker.invalid' },
      body: JSON.stringify(draft),
    })).status).toBe(403);
  });
});
