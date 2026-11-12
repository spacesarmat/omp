// @vitest-environment node
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { getCommittedDesign, rebaseDraft } from '../../editor/design.mjs';
import { createDefaultDraft } from '../../editor/shared/draft';
import type { LayoutClone, LayoutContainer, LayoutPlacement } from '../../design/schema';

const execute = promisify(execFile);
const roots: string[] = [];

async function head(root: string): Promise<string> {
  const { stdout } = await execute('git', ['rev-parse', 'HEAD'], { cwd: root });
  return stdout.trim();
}

async function commit(root: string, message: string): Promise<string> {
  await execute('git', ['add', 'design'], { cwd: root });
  await execute('git', ['-c', 'user.name=OMP Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', message], { cwd: root });
  return head(root);
}

async function makeRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'omp-editor-design-'));
  roots.push(root);
  await execute('git', ['init', '--quiet'], { cwd: root });
  await mkdir(join(root, 'design'), { recursive: true });
  await execute('git', ['-c', 'user.name=OMP Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '--quiet', '-m', 'initial'], { cwd: root });
  return root;
}

async function writeDesign(root: string, draft: ReturnType<typeof createDefaultDraft>): Promise<void> {
  const baseCommit = await head(root);
  draft.baseCommit = baseCommit;
  draft.theme.baseCommit = baseCommit;
  draft.flow.baseCommit = baseCommit;
  for (const snapshot of draft.snapshots) {
    snapshot.theme.baseCommit = baseCommit;
    snapshot.flow.baseCommit = baseCommit;
  }
  await mkdir(join(root, 'design/themes'), { recursive: true });
  await mkdir(join(root, 'design/flows'), { recursive: true });
  await writeFile(join(root, 'design/themes/default.json'), JSON.stringify(draft.theme), 'utf8');
  await writeFile(join(root, 'design/flows/desktop-default.json'), JSON.stringify(draft.flow), 'utf8');
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('committed editor designs', () => {
  it('loads the checked-in theme and flow instead of hardcoded defaults', async () => {
    const root = await makeRepo();
    const initial = createDefaultDraft('draft-1', await head(root));
    initial.theme.name = 'Saved in Git';
    initial.theme.tokens['--omp-color-accent'] = '#112233';
    initial.flow.rules.push({ id: 'saved-rule', screenId: 'library', elementId: 'saved-button', event: 'click', action: { type: 'toast', message: 'Saved' } });
    await writeDesign(root, initial);
    const designHead = await commit(root, 'commit design');

    const design = await getCommittedDesign(root);
    expect(design).toMatchObject({ baseCommit: designHead });
    expect(design?.theme.name).toBe('Saved in Git');
    expect(design?.theme.tokens['--omp-color-accent']).toBe('#112233');
    expect(design?.flow.rules.slice(-1)[0]?.id).toBe('saved-rule');
  });

  it('returns null before any design has been committed', async () => {
    const root = await makeRepo();
    await expect(getCommittedDesign(root)).resolves.toBeNull();
  });

  it('rebases local edits over nonconflicting committed theme and flow changes', async () => {
    const root = await makeRepo();
    const initial = createDefaultDraft('draft-1', await head(root));
    await writeDesign(root, initial);
    const base = await commit(root, 'base design');
    const local = createDefaultDraft('draft-1', base);
    local.snapshots = [{ id: 'snapshot-1', name: 'Before', createdAt: '2026-11-10T10:00:00.000Z', theme: structuredClone(local.theme), flow: structuredClone(local.flow) }];
    local.theme.overrides.push({ id: 'local-accent', scope: 'target', target: 'desktop-windows', tokens: { '--omp-color-accent': '#112233' } });

    const incoming = createDefaultDraft('draft-1', base);
    incoming.theme.name = 'Incoming name';
    incoming.theme.tokens['--omp-color-muted'] = '#A0A0A0';
    incoming.flow.rules.push({ id: 'incoming-rule', screenId: 'library', elementId: 'incoming-button', event: 'click', action: { type: 'toast', message: 'Incoming' } });
    await writeDesign(root, incoming);
    const nextHead = await commit(root, 'incoming design');

    const result = await rebaseDraft({ root, draft: local });
    expect(result.changes).toEqual(['design/flows/desktop-default.json', 'design/themes/default.json']);
    expect(result.draft.baseCommit).toBe(nextHead);
    expect(result.draft.theme.name).toBe('Incoming name');
    expect(result.draft.theme.tokens['--omp-color-muted']).toBe('#A0A0A0');
    expect(result.draft.theme.overrides.map((entry) => entry.id)).toEqual(['local-accent']);
    expect(result.draft.flow.rules.slice(-1)[0]?.id).toBe('incoming-rule');
    expect(result.draft.snapshots).toHaveLength(1);
    expect(result.draft.snapshots[0].theme.baseCommit).toBe(nextHead);
  });

  it('reports a conflicting field without changing the local draft', async () => {
    const root = await makeRepo();
    const initial = createDefaultDraft('draft-1', await head(root));
    await writeDesign(root, initial);
    const base = await commit(root, 'base design');
    const local = createDefaultDraft('draft-1', base);
    local.theme.name = 'Local name';
    const before = JSON.stringify(local);

    const incoming = createDefaultDraft('draft-1', base);
    incoming.theme.name = 'Incoming name';
    await writeDesign(root, incoming);
    await commit(root, 'incoming design');

    await expect(rebaseDraft({ root, draft: local })).rejects.toMatchObject({
      code: 'REBASE_CONFLICT',
      issues: [{ path: 'theme.name' }],
    });
    expect(JSON.stringify(local)).toBe(before);
  });

  it('merges independent layout placements, containers, clones and preset additions by id', async () => {
    const root = await makeRepo();
    const layoutContext = { target: 'desktop-windows', screenId: 'settings', format: 'landscape' } as const;
    const placementOf = (nodeId: string, x: number): LayoutPlacement => ({
      id: `place-${nodeId}`,
      ...layoutContext,
      nodeId,
      mode: 'absolute',
      x,
      y: 24,
      anchor: 'top-left',
      width: 200,
      height: 'auto',
      zIndex: 1,
      hidden: false,
      locked: false,
      label: nodeId,
    });
    const containerOf = (nodeId: string, order: string[]): LayoutContainer => ({ id: `flow-${nodeId}`, ...layoutContext, nodeId, order });
    const cloneOf = (nodeId: string): LayoutClone => ({
      id: `clone-${nodeId}`,
      ...layoutContext,
      nodeId,
      parentId: 'panel',
      label: nodeId,
      html: `<div data-design-id="${nodeId}">Copy</div>`,
    });
    const presetOf = (id: string) => ({ id, name: id, tokens: { '--omp-color-accent': '#112233' } });

    const initial = createDefaultDraft('draft-1', await head(root));
    initial.theme.layout = {
      containers: [containerOf('list', ['card-a', 'card-b'])],
      placements: [placementOf('card-a', 10), placementOf('card-b', 20)],
      clones: [],
    };
    initial.theme.stylePresets = [presetOf('preset-base')];
    await writeDesign(root, initial);
    const base = await commit(root, 'base design');

    // Local moves card-a and adds its own container, clone and preset.
    const local = createDefaultDraft('draft-1', base);
    local.theme.layout = {
      containers: [containerOf('list', ['card-a', 'card-b']), containerOf('local-grid', ['card-c'])],
      placements: [placementOf('card-a', 500), placementOf('card-b', 20)],
      clones: [cloneOf('copy-local')],
    };
    local.theme.stylePresets = [presetOf('preset-base'), presetOf('preset-local')];

    // Incoming independently moves card-b and adds its own container, clone and preset.
    const incoming = createDefaultDraft('draft-1', base);
    incoming.theme.layout = {
      containers: [containerOf('list', ['card-a', 'card-b']), containerOf('incoming-grid', ['card-d'])],
      placements: [placementOf('card-a', 10), placementOf('card-b', 300)],
      clones: [cloneOf('copy-incoming')],
    };
    incoming.theme.stylePresets = [presetOf('preset-base'), presetOf('preset-incoming')];
    await writeDesign(root, incoming);
    await commit(root, 'incoming design');

    const result = await rebaseDraft({ root, draft: local });
    const layout = result.draft.theme.layout!;
    // Both node placements survive: each side edited a different node of the same collection.
    expect(layout.placements.find((entry) => entry.nodeId === 'card-a')?.x).toBe(500);
    expect(layout.placements.find((entry) => entry.nodeId === 'card-b')?.x).toBe(300);
    // Both new containers, clones and presets survive instead of conflicting as whole arrays.
    expect(layout.containers.map((entry) => entry.nodeId).sort()).toEqual(['incoming-grid', 'list', 'local-grid']);
    expect((layout.clones ?? []).map((entry) => entry.nodeId).sort()).toEqual(['copy-incoming', 'copy-local']);
    expect((result.draft.theme.stylePresets ?? []).map((entry) => entry.id).sort()).toEqual(['preset-base', 'preset-incoming', 'preset-local']);
  });

  it('rejects competing rebase moves of the same node to different parents', async () => {
    const root = await makeRepo();
    const layoutContext = { target: 'desktop-windows', screenId: 'settings', format: 'landscape' } as const;
    const containerOf = (nodeId: string, order: string[]): LayoutContainer => ({ id: `flow-${nodeId}`, ...layoutContext, nodeId, order });
    const layoutOf = (a: string[], b: string[], c: string[]) => ({
      containers: [containerOf('parent-a', a), containerOf('parent-b', b), containerOf('parent-c', c)],
      placements: [],
    });
    const initial = createDefaultDraft('draft-1', await head(root));
    initial.theme.layout = layoutOf(['node-x', 'card-a'], ['card-b'], ['card-c']);
    await writeDesign(root, initial);
    const base = await commit(root, 'base design');

    // Local moves node-x from parent-a to parent-b.
    const local = createDefaultDraft('draft-1', base);
    local.theme.layout = layoutOf(['card-a'], ['card-b', 'node-x'], ['card-c']);
    // Incoming independently moves the same node to parent-c: merge-by-id keeps both
    // destination orders and the runtime would move the node between them forever.
    const incoming = createDefaultDraft('draft-1', base);
    incoming.theme.layout = layoutOf(['card-a'], ['card-b'], ['card-c', 'node-x']);
    await writeDesign(root, incoming);
    await commit(root, 'incoming move');

    await expect(rebaseDraft({ root, draft: local })).rejects.toMatchObject({
      code: 'REBASE_CONFLICT',
      issues: [{ path: 'theme.layout.containers' }],
    });
  });

  it('merges moves of different nodes to different parents without a false conflict', async () => {
    const root = await makeRepo();
    const layoutContext = { target: 'desktop-windows', screenId: 'settings', format: 'landscape' } as const;
    const containerOf = (nodeId: string, order: string[]): LayoutContainer => ({ id: `flow-${nodeId}`, ...layoutContext, nodeId, order });
    const layoutOf = (a: string[], b: string[], d: string[], e: string[]) => ({
      containers: [containerOf('parent-a', a), containerOf('parent-b', b), containerOf('parent-d', d), containerOf('parent-e', e)],
      placements: [],
    });
    const initial = createDefaultDraft('draft-1', await head(root));
    initial.theme.layout = layoutOf(['node-x', 'card-a'], ['card-b'], ['node-y', 'card-d'], ['card-e']);
    await writeDesign(root, initial);
    const base = await commit(root, 'base design');

    // Local moves node-x from parent-a to parent-b.
    const local = createDefaultDraft('draft-1', base);
    local.theme.layout = layoutOf(['card-a'], ['card-b', 'node-x'], ['node-y', 'card-d'], ['card-e']);
    // Incoming independently moves node-y from parent-d to parent-e: no shared destination.
    const incoming = createDefaultDraft('draft-1', base);
    incoming.theme.layout = layoutOf(['node-x', 'card-a'], ['card-b'], ['card-d'], ['card-e', 'node-y']);
    await writeDesign(root, incoming);
    await commit(root, 'incoming move');

    const result = await rebaseDraft({ root, draft: local });
    const orderOf = (nodeId: string) =>
      result.draft.theme.layout!.containers.find((entry) => entry.nodeId === nodeId)!.order;
    expect(orderOf('parent-a')).toEqual(['card-a']);
    expect(orderOf('parent-b')).toEqual(['card-b', 'node-x']);
    expect(orderOf('parent-d')).toEqual(['card-d']);
    expect(orderOf('parent-e')).toEqual(['card-e', 'node-y']);
  });

  it('preserves committed precedence while merging edited entries', async () => {
    const root = await makeRepo();
    const initial = createDefaultDraft('draft-1', await head(root));
    initial.theme.overrides.push(
      { id: 'first', scope: 'component', componentId: 'button', tokens: { '--omp-color-accent': '#111111' } },
      { id: 'second', scope: 'component', componentId: 'button', tokens: { '--omp-color-accent': '#222222' } },
    );
    await writeDesign(root, initial);
    const base = await commit(root, 'base design');
    const local = createDefaultDraft('draft-1', base);
    local.theme.overrides = structuredClone(initial.theme.overrides);
    local.theme.overrides[0].tokens['--omp-color-accent'] = '#333333';
    local.flow.rules[0].action = { type: 'toast', message: 'Local edit' };

    const incoming = createDefaultDraft('draft-1', base);
    incoming.theme.overrides = [initial.theme.overrides[1], initial.theme.overrides[0]];
    incoming.flow.rules = [initial.flow.rules[1], initial.flow.rules[0], ...initial.flow.rules.slice(2)];
    await writeDesign(root, incoming);
    await commit(root, 'reorder design');

    const result = await rebaseDraft({ root, draft: local });
    expect(result.draft.theme.overrides.map((entry) => entry.id)).toEqual(['second', 'first']);
    expect(result.draft.theme.overrides[1].tokens['--omp-color-accent']).toBe('#333333');
    expect(result.draft.flow.rules.slice(0, 2).map((entry) => entry.id)).toEqual(['nav-news', 'nav-library']);
    expect(result.draft.flow.rules[1].action).toEqual({ type: 'toast', message: 'Local edit' });
  });

  it('reports independent order changes instead of choosing one silently', async () => {
    const root = await makeRepo();
    const initial = createDefaultDraft('draft-1', await head(root));
    await writeDesign(root, initial);
    const base = await commit(root, 'base design');
    const local = createDefaultDraft('draft-1', base);
    local.flow.rules = [local.flow.rules[1], local.flow.rules[0], ...local.flow.rules.slice(2)];
    const incoming = createDefaultDraft('draft-1', base);
    incoming.flow.rules = [incoming.flow.rules[2], incoming.flow.rules[1], incoming.flow.rules[0], ...incoming.flow.rules.slice(3)];
    await writeDesign(root, incoming);
    await commit(root, 'different reorder');

    await expect(rebaseDraft({ root, draft: local })).rejects.toMatchObject({
      code: 'REBASE_CONFLICT',
      issues: [{ path: 'flow.rules.order' }],
    });
  });

  it('rejects an inserted rule whose placement conflicts with the incoming reorder', async () => {
    const root = await makeRepo();
    const initial = createDefaultDraft('draft-1', await head(root));
    await writeDesign(root, initial);
    const base = await commit(root, 'base design');
    const local = createDefaultDraft('draft-1', base);
    const inserted = { id: 'inserted', screenId: '*', elementId: local.flow.rules[1].elementId, event: 'click' as const, action: { type: 'toast' as const, message: 'Inserted' } };
    local.flow.rules = [local.flow.rules[0], inserted, ...local.flow.rules.slice(1)];
    const incoming = createDefaultDraft('draft-1', base);
    incoming.flow.rules = [incoming.flow.rules[1], incoming.flow.rules[0], ...incoming.flow.rules.slice(2)];
    await writeDesign(root, incoming);
    await commit(root, 'reorder around inserted rule');

    await expect(rebaseDraft({ root, draft: local })).rejects.toMatchObject({
      code: 'REBASE_CONFLICT',
      issues: [{ path: 'flow.rules.order' }],
    });
  });

  it('ignores deleted entries when checking placement', async () => {
    const root = await makeRepo();
    const initial = createDefaultDraft('draft-1', await head(root));
    await writeDesign(root, initial);
    const base = await commit(root, 'base design');
    const local = createDefaultDraft('draft-1', base);
    local.flow.rules[0].action = { type: 'toast', message: 'Local edit' };
    const incoming = createDefaultDraft('draft-1', base);
    incoming.flow.rules = [incoming.flow.rules[2], incoming.flow.rules[0]];
    await writeDesign(root, incoming);
    await commit(root, 'delete unchanged rule');

    const result = await rebaseDraft({ root, draft: local });
    expect(result.draft.flow.rules.map((entry) => entry.id)).toEqual(['nav-search', 'nav-library']);
    expect(result.draft.flow.rules[1].action).toEqual({ type: 'toast', message: 'Local edit' });
  });

  it('stops instead of inventing a base when its commit is unavailable', async () => {
    const root = await makeRepo();
    const draft = createDefaultDraft('draft-1', '0000000000000000000000000000000000000000');
    const before = JSON.stringify(draft);
    await expect(rebaseDraft({ root, draft })).rejects.toMatchObject({ code: 'BASE_HISTORY_UNAVAILABLE' });
    expect(JSON.stringify(draft)).toBe(before);
  });
});
