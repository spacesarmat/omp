// @vitest-environment node
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createExportDiff, createExportPlan, exportDraft } from '../../editor/export.mjs';
import { checkGeneratedThemes } from '../../design/generate';
import { startEditorServer, type RunningEditorServer } from '../../editor/server.mjs';
import { createEditorClient } from '../../editor/src/client';
import { createDefaultDraft } from '../../editor/shared/draft';
import type { InteractionRule } from '../../design/schema';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, writeFile: vi.fn(actual.writeFile) };
});

const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
const execute = promisify(execFile);
const roots: string[] = [];
const servers: RunningEditorServer[] = [];

function rule(patch: Partial<InteractionRule> & Pick<InteractionRule, 'id' | 'screenId' | 'elementId'>): InteractionRule {
  return {
    event: 'click',
    action: { type: 'navigate', screenId: 'library' },
    ...patch,
  };
}

async function makeRepo(): Promise<{ root: string; head: string }> {
  const root = await mkdtemp(join(tmpdir(), 'omp-editor-flow-export-'));
  roots.push(root);
  await execute('git', ['init', '--quiet'], { cwd: root });
  await mkdir(join(root, 'design'), { recursive: true });
  await execute('git', ['-c', 'user.name=OMP Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'initial'], { cwd: root });
  const { stdout } = await execute('git', ['rev-parse', 'HEAD'], { cwd: root });
  return { root, head: stdout.trim() };
}

afterEach(async () => {
  vi.mocked(writeFile).mockImplementation(actualFs.writeFile);
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('design flow export', () => {
  it('ships the flow json and the generated production module for the all scope', async () => {
    const { root, head } = await makeRepo();
    const draft = createDefaultDraft('draft-1', head);
    draft.flow.rules = [rule({ id: 'go', screenId: 'settings', elementId: 'settings-continue', action: { type: 'navigate', screenId: 'library' } })];
    const result = await exportDraft({ root, draft });
    expect(result.files).toContain('design/generated/flow.ts');
    expect(result.files).toContain('design/flows/desktop-default.json');
    const module = await readFile(join(root, 'design', 'generated', 'flow.ts'), 'utf8');
    expect(module).toContain('export const PRODUCTION_FLOW');
    expect(module).toContain('"settings-continue"');
    const jsonFile = JSON.parse(await readFile(join(root, 'design', 'flows', 'desktop-default.json'), 'utf8'));
    expect(jsonFile.rules).toHaveLength(1);
    // The repeated export rewrites the module and json deterministically.
    await exportDraft({ root, draft });
    expect(await readFile(join(root, 'design', 'generated', 'flow.ts'), 'utf8')).toBe(module);
  });

  it('rejects the all scope when a graph rule fails validation', async () => {
    const { root, head } = await makeRepo();
    const draft = createDefaultDraft('draft-1', head);
    // A playback action without steps or a graph parses fine but no runtime executes it.
    draft.flow.rules = [
      rule({ id: 'dead', screenId: 'settings', elementId: 'status', event: 'playback.started', action: { type: 'playback.playPause' } }),
    ];
    await expect(exportDraft({ root, draft })).rejects.toMatchObject({ code: 'INVALID_FLOW' });
  });

  it('merges a page-scoped export by rule id and rewrites the production module from the merged document', async () => {
    const { root, head } = await makeRepo();
    const draft = createDefaultDraft('draft-1', head);
    draft.flow.rules = [
      rule({ id: 'lib-play', screenId: 'library', elementId: 'card-play', action: { type: 'navigate', screenId: 'remote' } }),
      rule({ id: 'set-save', screenId: 'settings', elementId: 'settings-save', action: { type: 'navigate', screenId: 'library' } }),
    ];
    await exportDraft({ root, draft });

    draft.flow.rules = [
      rule({ id: 'lib-play', screenId: 'library', elementId: 'card-play', action: { type: 'navigate', screenId: 'news' } }),
      rule({ id: 'lib-new', screenId: 'library', elementId: 'card-open', action: { type: 'navigate', screenId: 'remote' } }),
    ];
    const result = await exportDraft({ root, draft, scope: { kind: 'page', screenId: 'library' } });
    expect(result.files).toContain('design/flows/desktop-default.json');
    expect(result.files).toContain('design/generated/flow.ts');

    const merged = JSON.parse(await readFile(join(root, 'design', 'flows', 'desktop-default.json'), 'utf8'));
    expect(merged.rules.map((entry: InteractionRule) => entry.id).sort()).toEqual(['lib-new', 'lib-play', 'set-save']);
    const edited = merged.rules.find((entry: InteractionRule) => entry.id === 'lib-play');
    expect(edited.action).toEqual({ type: 'navigate', screenId: 'news' });
    const foreign = merged.rules.find((entry: InteractionRule) => entry.id === 'set-save');
    expect(foreign.action).toEqual({ type: 'navigate', screenId: 'library' });

    // The production module is regenerated from the same merged document: foreign screens
    // survive in it and the scoped edit is applied, so the generator check and the runtime
    // stay in sync with the json.
    const module = await readFile(join(root, 'design', 'generated', 'flow.ts'), 'utf8');
    for (const id of ['lib-play', 'lib-new', 'set-save']) expect(module).toContain(`"${id}"`);
    expect(module).toContain('"screenId": "news"');
  });

  it('exports the deletion of a scoped rule dropped from the draft', async () => {
    const { root, head } = await makeRepo();
    const draft = createDefaultDraft('draft-1', head);
    draft.flow.rules = [
      rule({ id: 'lib-play', screenId: 'library', elementId: 'card-play', action: { type: 'navigate', screenId: 'remote' } }),
    ];
    await exportDraft({ root, draft });
    draft.flow.rules = [];
    await exportDraft({ root, draft, scope: { kind: 'page', screenId: 'library' } });
    const merged = JSON.parse(await readFile(join(root, 'design', 'flows', 'desktop-default.json'), 'utf8'));
    expect(merged.rules).toEqual([]);
  });

  it('keeps the generated module in sync through page and component scoped exports', async () => {
    const { root, head } = await makeRepo();
    const draft = createDefaultDraft('draft-1', head);
    draft.flow.rules = [
      rule({ id: 'set-save', screenId: 'settings', elementId: 'settings-save', action: { type: 'navigate', screenId: 'library' } }),
      rule({ id: 'lib-play', screenId: 'library', elementId: 'card-play', action: { type: 'navigate', screenId: 'remote' } }),
    ];
    await exportDraft({ root, draft });
    await expect(checkGeneratedThemes(root)).resolves.toBeUndefined();

    // Page scope: the edited page ships, the foreign settings rule is preserved and the
    // generator check sees the module rewritten from the merged document.
    draft.flow.rules = [
      rule({ id: 'lib-play', screenId: 'library', elementId: 'card-play', action: { type: 'navigate', screenId: 'news' } }),
    ];
    const pageResult = await exportDraft({ root, draft, scope: { kind: 'page', screenId: 'library' } });
    expect(pageResult.files).toContain('design/generated/flow.ts');
    let module = await readFile(join(root, 'design', 'generated', 'flow.ts'), 'utf8');
    expect(module).toContain('"set-save"');
    expect(module).toContain('"screenId": "news"');
    await expect(checkGeneratedThemes(root)).resolves.toBeUndefined();

    // Component scope on the other screen: the same guarantee for a component-level merge.
    draft.flow.rules = [
      rule({ id: 'set-save', screenId: 'settings', elementId: 'settings-save', action: { type: 'navigate', screenId: 'connect' } }),
    ];
    const componentResult = await exportDraft({ root, draft, scope: { kind: 'component', nodeId: 'settings-save' } });
    expect(componentResult.files).toContain('design/generated/flow.ts');
    module = await readFile(join(root, 'design', 'generated', 'flow.ts'), 'utf8');
    expect(module).toContain('"lib-play"');
    expect(module).toContain('"screenId": "connect"');
    await expect(checkGeneratedThemes(root)).resolves.toBeUndefined();
  });

  it('reports the production module update in the scoped export diff', async () => {
    const { root, head } = await makeRepo();
    const draft = createDefaultDraft('draft-1', head);
    draft.flow.rules = [
      rule({ id: 'lib-play', screenId: 'library', elementId: 'card-play', action: { type: 'navigate', screenId: 'remote' } }),
    ];
    await exportDraft({ root, draft });
    draft.flow.rules = [
      rule({ id: 'lib-play', screenId: 'library', elementId: 'card-play', action: { type: 'navigate', screenId: 'news' } }),
    ];
    const diff = await createExportDiff(root, createExportPlan(draft, { kind: 'page', screenId: 'library' }));
    const moduleFile = diff.files.find((file) => file.path === 'design/generated/flow.ts');
    expect(moduleFile?.action).toBe('update');
    expect(moduleFile?.after).toContain('"screenId": "news"');
    expect(moduleFile?.before).toContain('"screenId": "remote"');
  });

  it('rejects a scoped export whose scoped flow fails validation', async () => {
    const { root, head } = await makeRepo();
    const draft = createDefaultDraft('draft-1', head);
    await exportDraft({ root, draft });
    draft.flow.rules = [
      rule({ id: 'lib-bad', screenId: 'library', elementId: 'card-play', action: { type: 'navigate', screenId: 'no-such-route' } }),
    ];
    await expect(exportDraft({ root, draft, scope: { kind: 'page', screenId: 'library' } }))
      .rejects.toMatchObject({ code: 'INVALID_FLOW' });
  });

  it('reports structured flow changes with rule, node, edge and variable ids in the diff', async () => {
    const { root, head } = await makeRepo();
    const draft = createDefaultDraft('draft-1', head);
    draft.flow.rules = [
      rule({ id: 'keep', screenId: 'library', elementId: 'card-play', action: { type: 'navigate', screenId: 'remote' } }),
    ];
    await exportDraft({ root, draft });
    draft.flow.rules = [
      rule({ id: 'keep', screenId: 'library', elementId: 'card-play', action: { type: 'navigate', screenId: 'news' } }),
      rule({ id: 'added', screenId: 'library', elementId: 'card-open', action: { type: 'toast', message: 'hi' } }),
    ];
    draft.flow.variables = [{ id: 'var-1', name: 'One', type: 'string', initial: '' }];
    const diff = await createExportDiff(root, createExportPlan(draft, { kind: 'all' }));
    const flowFile = diff.files.find((file) => file.path === 'design/flows/desktop-default.json');
    expect(flowFile?.action).toBe('update');
    expect(flowFile?.flow).toMatchObject({
      rules: { added: ['added'], removed: [], changed: ['keep'] },
      variables: { added: ['var-1'], removed: [], changed: [] },
    });
  });

  it('guards a manifest-owned flow file against foreign edits', async () => {
    const { root, head } = await makeRepo();
    const draft = createDefaultDraft('draft-1', head);
    await exportDraft({ root, draft });
    const flowPath = join(root, 'design', 'flows', 'desktop-default.json');
    const original = await readFile(flowPath, 'utf8');
    await writeFile(flowPath, `${original.trimEnd()}\n/* foreign hand edit */\n`);
    await expect(exportDraft({ root, draft, scope: { kind: 'page', screenId: 'library' } }))
      .rejects.toMatchObject({ code: 'DIRTY_DESIGN' });
    await expect(exportDraft({ root, draft })).rejects.toMatchObject({ code: 'DIRTY_DESIGN' });
    expect(await readFile(flowPath, 'utf8')).toContain('foreign hand edit');
  });

  it('rolls back to the previous flow content when a write fails mid-export', async () => {
    const { root, head } = await makeRepo();
    const draft = createDefaultDraft('draft-1', head);
    draft.flow.rules = [rule({ id: 'before', screenId: 'settings', elementId: 'settings-continue' })];
    await exportDraft({ root, draft });
    const flowPath = join(root, 'design', 'flows', 'desktop-default.json');
    const before = await readFile(flowPath, 'utf8');

    draft.flow.rules = [rule({ id: 'after', screenId: 'settings', elementId: 'settings-continue' })];
    vi.mocked(writeFile).mockImplementation(async (target, ...rest) => {
      const path = String(target);
      if (path.endsWith(join('flows', 'desktop-default.json'))) throw new Error('disk full');
      return (actualFs.writeFile as (...args: unknown[]) => Promise<void>)(target, ...rest);
    });
    await expect(exportDraft({ root, draft })).rejects.toThrow('disk full');
    expect(await readFile(flowPath, 'utf8')).toBe(before);
  });

  it('serves the structured flow diff through the editor server and client', async () => {
    const { root, head } = await makeRepo();
    const draft = createDefaultDraft('draft-1', head);
    draft.flow.rules = [rule({ id: 'base-rule', screenId: 'settings', elementId: 'settings-continue' })];
    await exportDraft({ root, draft });
    const running = await startEditorServer({ root, token: 'test-token', port: 0, withVite: false });
    servers.push(running);
    const client = createEditorClient({ origin: running.origin, token: 'test-token' });
    draft.flow.rules = [
      rule({ id: 'base-rule', screenId: 'settings', elementId: 'settings-continue', action: { type: 'navigate', screenId: 'news' } }),
      rule({ id: 'server-rule', screenId: 'settings', elementId: 'status', event: 'server.connected', action: { type: 'toast', message: 'up' } }),
    ];
    const diff = await client.exportDiff!(draft, { scope: { kind: 'all' } });
    const flowFile = diff.files.find((file) => file.path === 'design/flows/desktop-default.json');
    expect(flowFile?.action).toBe('update');
    expect(flowFile?.flow?.rules.added).toEqual(['server-rule']);
    expect(flowFile?.flow?.rules.changed).toEqual(['base-rule']);
  });
});
