// @vitest-environment node
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { ExportError, createExportDiff, createExportPlan, exportDraft } from '../../editor/export.mjs';
import { createDefaultDraft } from '../../editor/shared/draft';
import { checkGeneratedThemes } from '../../design/generate';
import {
  DESIGN_TARGETS,
  type DesignTarget,
  type LayoutClone,
  type LayoutContainer,
  type LayoutDocument,
  type LayoutPlacement,
} from '../../design/schema';

const execute = promisify(execFile);
const roots: string[] = [];

async function makeRepo(): Promise<{ root: string; head: string }> {
  const root = await mkdtemp(join(tmpdir(), 'omp-editor-export-layout-'));
  roots.push(root);
  await execute('git', ['init', '--quiet'], { cwd: root });
  await mkdir(join(root, 'design'), { recursive: true });
  await execute('git', ['-c', 'user.name=OMP Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'initial'], { cwd: root });
  const { stdout } = await execute('git', ['rev-parse', 'HEAD'], { cwd: root });
  return { root, head: stdout.trim() };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function placement(nodeId: string, screenId: string, patch: Partial<LayoutPlacement> = {}, target: DesignTarget = 'desktop-windows'): LayoutPlacement {
  return {
    id: `place-${nodeId}`,
    target,
    screenId,
    format: 'landscape',
    nodeId,
    mode: 'absolute',
    x: 40,
    y: 24,
    anchor: 'top-left',
    width: 200,
    height: 'auto',
    zIndex: 1,
    hidden: false,
    locked: false,
    label: nodeId,
    ...patch,
  };
}

function container(nodeId: string, screenId: string, order: string[], target: DesignTarget = 'desktop-windows'): LayoutContainer {
  return { id: `flow-${nodeId}`, target, screenId, format: 'landscape', nodeId, order };
}

function clone(nodeId: string, screenId: string, html: string, parentId = 'panel', target: DesignTarget = 'desktop-windows'): LayoutClone {
  return { id: `clone-${nodeId}`, target, screenId, format: 'landscape', nodeId, parentId, label: nodeId, html };
}

async function readProductionLayout(root: string): Promise<LayoutDocument> {
  const source = await readFile(join(root, 'design', 'generated', 'layout.ts'), 'utf8');
  const match = source.match(/= (\{[\s\S]*\});\n?$/);
  if (!match) throw new Error('layout module not found');
  return JSON.parse(match[1]) as LayoutDocument;
}

const ALL_FILES = [
  'design/flows/desktop-default.json',
  'design/generated/android-phone.css',
  'design/generated/android-tv.css',
  'design/generated/desktop-linux.css',
  'design/generated/desktop-macos.css',
  'design/generated/desktop-windows.css',
  'design/generated/layout.ts',
  'design/generated/lg-webos.css',
  'design/themes/default.json',
];

describe('scoped layout export', () => {
  it('plans every generated file and target for the all scope', async () => {
    const { root, head } = await makeRepo();
    const draft = createDefaultDraft('draft-1', head);
    const plan = createExportPlan(draft, { kind: 'all' });
    expect(plan.scope).toEqual({ kind: 'all' });
    expect(plan.targets).toEqual([...DESIGN_TARGETS]);
    expect(plan.files.map((file) => file.path)).toEqual(ALL_FILES);
    const diff = await createExportDiff(root, plan);
    expect(diff.baseCommit).toBe(head);
    expect(diff.files.map((file) => `${file.action}:${file.path}`)).toEqual(ALL_FILES.map((path) => `create:${path}`));
    expect(diff.foreignDirty).toEqual([]);
  });

  it('merges only the selected page and lists the targets that ship it', async () => {
    const { root, head } = await makeRepo();
    const first = createDefaultDraft('draft-1', head);
    first.theme.layout = {
      containers: [],
      placements: [placement('card-a', 'settings', { x: 40 }), placement('card-b', 'news', { x: 20 })],
    };
    await exportDraft({ root, draft: first });

    const second = createDefaultDraft('draft-1', head);
    second.theme.layout = {
      containers: [],
      placements: [placement('card-a', 'settings', { x: 400 }), placement('card-b', 'news', { x: 20 })],
    };
    const newsPlan = createExportPlan(second, { kind: 'page', screenId: 'news' });
    expect(newsPlan.targets).toEqual(['android-phone', 'desktop-windows', 'desktop-macos', 'desktop-linux']);

    const plan = createExportPlan(second, { kind: 'page', screenId: 'settings' });
    expect(plan.targets).toEqual([...DESIGN_TARGETS]);
    expect(plan.files.map((file) => file.path)).toEqual(['design/generated/layout.ts', 'design/themes/default.json']);
    const diff = await createExportDiff(root, plan);
    expect(diff.files.map((file) => file.action)).toEqual(['update', 'update']);

    await exportDraft({ root, draft: second, scope: { kind: 'page', screenId: 'settings' } });
    const shipped = await readProductionLayout(root);
    expect(shipped).toEqual({
      containers: [],
      placements: [placement('card-b', 'news', { x: 20 }), placement('card-a', 'settings', { x: 400 })],
    });
    const theme = JSON.parse(await readFile(join(root, 'design', 'themes', 'default.json'), 'utf8'));
    expect(theme.layout.placements).toEqual(shipped.placements);
    await expect(checkGeneratedThemes(root)).resolves.toBeUndefined();
    const flow = JSON.parse(await readFile(join(root, 'design', 'flows', 'desktop-default.json'), 'utf8'));
    expect(flow.rules).toEqual(second.flow.rules);
  });

  it('merges only the selected component and its containers', async () => {
    const { root, head } = await makeRepo();
    const phone = 'android-phone' as DesignTarget;
    const first = createDefaultDraft('draft-1', head);
    first.theme.layout = {
      containers: [container('list', 'settings', ['card-a', 'card-b'], phone), container('other', 'news', ['card-c'])],
      placements: [placement('card-a', 'settings', { x: 5 }, phone), placement('card-b', 'settings', { x: 6 }, phone), placement('card-c', 'news', { x: 7 })],
    };
    await exportDraft({ root, draft: first });

    const second = createDefaultDraft('draft-1', head);
    second.theme.layout = {
      containers: [container('list', 'settings', ['card-b', 'card-a'], phone), container('other', 'news', ['card-c'])],
      placements: [placement('card-a', 'settings', { x: 500 }, phone), placement('card-b', 'settings', { x: 6 }, phone), placement('card-c', 'news', { x: 7 })],
    };
    const plan = createExportPlan(second, { kind: 'component', nodeId: 'card-a' });
    expect(plan.targets).toEqual(['android-phone']);
    const diff = await createExportDiff(root, plan);
    expect(diff.files.map((file) => file.action)).toEqual(['update', 'update']);

    await exportDraft({ root, draft: second, scope: { kind: 'component', nodeId: 'card-a' } });
    const shipped = await readProductionLayout(root);
    expect(shipped.containers).toEqual([container('other', 'news', ['card-c']), container('list', 'settings', ['card-b', 'card-a'], phone)]);
    expect(shipped.placements).toEqual([
      placement('card-b', 'settings', { x: 6 }, phone),
      placement('card-c', 'news', { x: 7 }),
      placement('card-a', 'settings', { x: 500 }, phone),
    ]);
    await expect(checkGeneratedThemes(root)).resolves.toBeUndefined();
  });

  it('leaves dirty foreign files byte for byte and keeps manifest ownership', async () => {
    const { root, head } = await makeRepo();
    const first = createDefaultDraft('draft-1', head);
    first.theme.layout = { containers: [], placements: [placement('card-a', 'settings')] };
    await exportDraft({ root, draft: first });

    const foreign = join(root, 'design', 'themes', 'foreign.json');
    await writeFile(foreign, '{"foreign":true}\n');
    const second = createDefaultDraft('draft-1', head);
    second.theme.layout = { containers: [], placements: [placement('card-a', 'settings', { x: 90 })] };
    await exportDraft({ root, draft: second, scope: { kind: 'page', screenId: 'settings' } });
    expect(await readFile(foreign, 'utf8')).toBe('{"foreign":true}\n');

    const manifest = JSON.parse(await readFile(join(root, '.omp-editor', 'exports', 'draft-1.json'), 'utf8'));
    expect(manifest.files.map((file: { path: string }) => file.path)).toEqual(ALL_FILES);

    await expect(exportDraft({ root, draft: second })).rejects.toMatchObject({ code: 'DIRTY_DESIGN' });
    expect(await readFile(foreign, 'utf8')).toBe('{"foreign":true}\n');
  });

  it('rejects a foreign edit inside the scope without overwriting it', async () => {
    const { root, head } = await makeRepo();
    const first = createDefaultDraft('draft-1', head);
    first.theme.layout = { containers: [], placements: [placement('card-a', 'settings')] };
    await exportDraft({ root, draft: first });
    const themePath = join(root, 'design', 'themes', 'default.json');
    const edited = (await readFile(themePath, 'utf8')) + '\n/* foreign edit */\n';
    await writeFile(themePath, edited);

    const second = createDefaultDraft('draft-1', head);
    second.theme.layout = { containers: [], placements: [placement('card-a', 'settings', { x: 90 })] };
    await expect(exportDraft({ root, draft: second, scope: { kind: 'page', screenId: 'settings' } })).rejects.toMatchObject({ code: 'DIRTY_DESIGN' });
    expect(await readFile(themePath, 'utf8')).toBe(edited);
  });

  it('rejects a stale base for scoped exports before writing', async () => {
    const { root, head } = await makeRepo();
    const draft = createDefaultDraft('draft-1', head);
    draft.theme.layout = { containers: [], placements: [placement('card-a', 'settings')] };
    const stale = createDefaultDraft('draft-1', '0000000000000000000000000000000000000000');
    stale.theme.layout = draft.theme.layout;
    const plan = createExportPlan(stale, { kind: 'page', screenId: 'settings' });
    await expect(createExportDiff(root, plan)).rejects.toMatchObject({ code: 'STALE_BASE' });
    await expect(exportDraft({ root, draft: stale, scope: { kind: 'page', screenId: 'settings' } })).rejects.toMatchObject({ code: 'STALE_BASE' });
    expect(await readdir(join(root, 'design'))).toEqual([]);
  });

  it('keeps repeated and mixed scope exports owned by the manifest', async () => {
    const { root, head } = await makeRepo();
    const first = createDefaultDraft('draft-1', head);
    first.theme.layout = { containers: [], placements: [placement('card-a', 'settings')] };
    await exportDraft({ root, draft: first });

    const second = createDefaultDraft('draft-1', head);
    second.theme.layout = { containers: [], placements: [placement('card-a', 'settings', { x: 64 })] };
    await exportDraft({ root, draft: second, scope: { kind: 'page', screenId: 'settings' } });
    const repeat = createExportPlan(second, { kind: 'page', screenId: 'settings' });
    const repeatDiff = await createExportDiff(root, repeat);
    expect(repeatDiff.files.map((file) => file.action)).toEqual(['unchanged', 'unchanged']);

    await exportDraft({ root, draft: second, scope: { kind: 'page', screenId: 'settings' } });
    const full = await exportDraft({ root, draft: second });
    expect(full.files).toEqual(ALL_FILES);
    expect(full.targets).toEqual([...DESIGN_TARGETS]);
    expect(full.scope).toBe('all');
    const manifest = JSON.parse(await readFile(join(root, '.omp-editor', 'exports', 'draft-1.json'), 'utf8'));
    expect(manifest.files.map((file: { path: string }) => file.path)).toEqual(ALL_FILES);
    await expect(checkGeneratedThemes(root)).resolves.toBeUndefined();
  });

  it('ships clone metadata so duplicates stay visible after export', async () => {
    const { root, head } = await makeRepo();
    const first = createDefaultDraft('draft-1', head);
    first.theme.layout = {
      containers: [],
      placements: [placement('card-a', 'settings', { x: 10 })],
      clones: [clone('dup-1', 'settings', '<div class="dup">copy</div>')],
    };
    await exportDraft({ root, draft: first });

    const shipped = await readProductionLayout(root);
    expect(shipped.clones).toEqual([clone('dup-1', 'settings', '<div class="dup">copy</div>')]);
    expect(await readFile(join(root, 'design', 'generated', 'layout.ts'), 'utf8')).toContain('clone-dup-1');

    const second = createDefaultDraft('draft-1', head);
    second.theme.layout = {
      containers: [],
      placements: [placement('card-a', 'settings', { x: 80 })],
      clones: [clone('dup-1', 'settings', '<div class="dup">copy</div>')],
    };
    await exportDraft({ root, draft: second, scope: { kind: 'page', screenId: 'news' } });
    const preserved = await readProductionLayout(root);
    expect(preserved.clones).toEqual([clone('dup-1', 'settings', '<div class="dup">copy</div>')]);
    expect(preserved.placements).toEqual([placement('card-a', 'settings', { x: 10 })]);
  });

  it('refuses unvalidated clone html before any write', async () => {
    const { root, head } = await makeRepo();
    const draft = createDefaultDraft('draft-1', head);
    draft.theme.layout = {
      containers: [],
      placements: [],
      clones: [clone('dup-1', 'settings', '<script>window.x = 1</script>')],
    };
    await expect(exportDraft({ root, draft, scope: { kind: 'page', screenId: 'settings' } })).rejects.toMatchObject({ code: 'INVALID_DRAFT' });
    expect(await readdir(join(root, 'design'))).toEqual([]);
  });

  it('activates only the selected scope on a fresh repository', async () => {
    const { root, head } = await makeRepo();
    const draft = createDefaultDraft('draft-1', head);
    draft.theme.layout = {
      containers: [],
      placements: [placement('card-a', 'settings', { x: 40 }), placement('card-b', 'news', { x: 20 })],
    };
    await exportDraft({ root, draft, scope: { kind: 'page', screenId: 'settings' } });
    const shipped = await readProductionLayout(root);
    expect(shipped).toEqual({ containers: [], placements: [placement('card-a', 'settings', { x: 40 })] });
    const theme = JSON.parse(await readFile(join(root, 'design', 'themes', 'default.json'), 'utf8'));
    expect(theme.layout.placements).toEqual([placement('card-a', 'settings', { x: 40 })]);
    expect(await readdir(join(root, 'design', 'generated'))).toEqual(['layout.ts']);
    await expect(readFile(join(root, 'design', 'flows', 'desktop-default.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects unknown scopes and ids', async () => {
    const { root, head } = await makeRepo();
    const draft = createDefaultDraft('draft-1', head);
    const invalid = [
      { kind: 'page', screenId: 'no-such-page' },
      { kind: 'page', screenId: '../settings' },
      { kind: 'component', nodeId: 'Bad Id' },
      { kind: 'other' },
      null,
    ];
    for (const scope of invalid) {
      expect(() => createExportPlan(draft, scope)).toThrow(ExportError);
    }
    try {
      createExportPlan(draft, { kind: 'page', screenId: 'no-such-page' });
      expect.unreachable();
    } catch (error) {
      expect((error as ExportError).code).toBe('INVALID_EXPORT_SCOPE');
    }
    const plan = createExportPlan(draft, { kind: 'all' });
    await expect(createExportDiff(root, plan)).resolves.toBeTruthy();
    await expect(exportDraft({ root, draft, scope: { kind: 'component', nodeId: 'Bad Id' } })).rejects.toMatchObject({ code: 'INVALID_EXPORT_SCOPE' });
  });
});
