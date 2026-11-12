// @vitest-environment node
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { ExportError, createExportDiff, createExportPlan, exportDraft } from '../../editor/export.mjs';
import { createDefaultDraft } from '../../editor/shared/draft';
import { buildOverride, type OverrideIdentity } from '../../design/catalog';
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

function styleIdentity(patch: Partial<OverrideIdentity> = {}): OverrideIdentity {
  return {
    scope: 'element',
    target: 'desktop-windows',
    screenId: 'settings',
    elementId: 'sidebar',
    format: 'landscape',
    state: 'default',
    ...patch,
  };
}

const SETTINGS_FILES = [
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

const GENERATED_SETTINGS_FILES = SETTINGS_FILES.filter((path) => path.startsWith('design/generated/'));

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
  'design/generated/flow.ts',
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
    expect(plan.files.map((file) => file.path)).toEqual(SETTINGS_FILES);
    const diff = await createExportDiff(root, plan);
    // The layout and theme carry the page edit; css without style changes stays untouched.
    expect(diff.files.map((file) => file.action)).toEqual([
      'unchanged',
      'unchanged',
      'unchanged',
      'unchanged',
      'unchanged',
      'unchanged',
      'update',
      'unchanged',
      'update',
    ]);

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
    expect(plan.files.map((file) => file.path)).toEqual([
      'design/flows/desktop-default.json',
      'design/generated/android-phone.css',
      'design/generated/layout.ts',
      'design/themes/default.json',
    ]);
    const diff = await createExportDiff(root, plan);
    expect(diff.files.map((file) => file.action)).toEqual(['unchanged', 'unchanged', 'update', 'update']);

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

  it('keeps the old parent container record when a component export follows a reparent', async () => {
    const { root, head } = await makeRepo();
    const phone = 'android-phone' as DesignTarget;
    const first = createDefaultDraft('draft-1', head);
    first.theme.layout = {
      containers: [
        { ...container('list', 'settings', ['card-a', 'card-b'], phone), padding: '8px', alignment: 'center' },
        container('other', 'settings', ['card-c'], phone),
      ],
      placements: [placement('card-a', 'settings', { x: 5 }, phone), placement('card-b', 'settings', { x: 6 }, phone)],
    };
    await exportDraft({ root, draft: first });

    // Local edit: card-a moves from list to other. The old parent list stays in the draft with
    // its padding and alignment, only the order loses card-a.
    const second = createDefaultDraft('draft-1', head);
    second.theme.layout = {
      containers: [
        { ...container('list', 'settings', ['card-b'], phone), padding: '8px', alignment: 'center' },
        container('other', 'settings', ['card-c', 'card-a'], phone),
      ],
      placements: [placement('card-a', 'settings', { x: 5 }, phone), placement('card-b', 'settings', { x: 6 }, phone)],
    };
    const plan = createExportPlan(second, { kind: 'component', nodeId: 'card-a' });
    expect(plan.targets).toEqual(['android-phone']);

    await exportDraft({ root, draft: second, scope: { kind: 'component', nodeId: 'card-a' } });
    const shipped = await readProductionLayout(root);
    // The moved node ships with its new parent; the old parent must not be deleted, its record
    // comes from the draft so the runtime never pulls the node back through a stale order.
    expect(shipped.containers).toEqual([
      { ...container('list', 'settings', ['card-b'], phone), padding: '8px', alignment: 'center' },
      container('other', 'settings', ['card-c', 'card-a'], phone),
    ]);
    const theme = JSON.parse(await readFile(join(root, 'design', 'themes', 'default.json'), 'utf8'));
    expect(theme.layout.containers).toEqual(shipped.containers);
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
    expect(repeatDiff.files.map((file) => file.action)).toEqual(SETTINGS_FILES.map(() => 'unchanged'));

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
    expect([...(await readdir(join(root, 'design', 'generated')))].sort()).toEqual(GENERATED_SETTINGS_FILES.map((path) => path.slice('design/generated/'.length)));
    // The scoped flow export ships the rules the page owns: the two settings-continue rules.
    const flow = JSON.parse(await readFile(join(root, 'design', 'flows', 'desktop-default.json'), 'utf8'));
    expect(flow.rules.map((rule: { id: string }) => rule.id)).toEqual(['settings-continue-connected', 'settings-continue-disconnected']);
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


describe('scoped style export', () => {
  it('ships the selected page style edits, regenerates its css and preserves unrelated overrides', async () => {
    const { root, head } = await makeRepo();
    const newsIdentity = styleIdentity({ screenId: 'news', elementId: 'card' });
    const first = createDefaultDraft('draft-1', head);
    first.theme.layout = { containers: [], placements: [placement('card-a', 'settings')] };
    first.theme.overrides = [buildOverride(newsIdentity, { '--omp-color-panel': '#2A2F3A' })];
    await exportDraft({ root, draft: first });

    const foreign = join(root, 'design', 'themes', 'foreign.json');
    await writeFile(foreign, '{"foreign":true}\n');
    const second = createDefaultDraft('draft-1', head);
    second.theme.layout = { containers: [], placements: [placement('card-a', 'settings')] };
    second.theme.overrides = [
      buildOverride(newsIdentity, { '--omp-color-panel': '#2A2F3A' }),
      buildOverride(styleIdentity(), { '--omp-color-panel': '#242A38' }),
    ];
    const result = await exportDraft({ root, draft: second, scope: { kind: 'page', screenId: 'settings' } });
    expect(result.targets).toEqual([...DESIGN_TARGETS]);

    const theme = JSON.parse(await readFile(join(root, 'design', 'themes', 'default.json'), 'utf8'));
    const byScreen = new Map((theme.overrides as Array<{ screenId?: string; tokens: Record<string, string> }>).map((entry) => [entry.screenId, entry]));
    expect(byScreen.get('settings')?.tokens['--omp-color-panel']).toBe('#242A38');
    expect(byScreen.get('news')?.tokens['--omp-color-panel']).toBe('#2A2F3A');

    const css = await readFile(join(root, 'design', 'generated', 'desktop-windows.css'), 'utf8');
    expect(css).toContain('#242A38');
    expect(css).toContain('#2A2F3A');
    expect(await readFile(foreign, 'utf8')).toBe('{"foreign":true}\n');
    await rm(foreign);
    await expect(checkGeneratedThemes(root)).resolves.toBeUndefined();
    const manifest = JSON.parse(await readFile(join(root, '.omp-editor', 'exports', 'draft-1.json'), 'utf8'));
    expect(manifest.files.map((file: { path: string }) => file.path)).toEqual(ALL_FILES);
  });

  it('ships the selected component style edits and keeps overrides outside the component', async () => {
    const { root, head } = await makeRepo();
    const phone = 'android-phone' as DesignTarget;
    const layout = {
      containers: [container('list', 'settings', ['card-a', 'card-b'], phone)],
      placements: [
        placement('card-a', 'settings', { x: 5 }, phone),
        placement('card-b', 'settings', { x: 6 }, phone),
        placement('card-c', 'news', { x: 7 }),
      ],
    };
    const cardA = styleIdentity({ target: phone, elementId: 'card-a' });
    const cardC = styleIdentity({ target: phone, screenId: 'news', elementId: 'card-c' });
    const first = createDefaultDraft('draft-1', head);
    first.theme.layout = layout;
    first.theme.overrides = [
      buildOverride(cardC, { '--omp-color-accent': '#2A2F3A' }),
      buildOverride(cardA, { '--omp-color-accent': '#FFD34D' }),
    ];
    await exportDraft({ root, draft: first });

    const second = createDefaultDraft('draft-1', head);
    second.theme.layout = layout;
    second.theme.overrides = [
      ...first.theme.overrides,
      buildOverride(styleIdentity({ target: phone, elementId: 'card-b' }), { '--omp-color-accent': '#FFC42E' }),
    ];
    await exportDraft({ root, draft: second, scope: { kind: 'component', nodeId: 'card-a' } });

    const theme = JSON.parse(await readFile(join(root, 'design', 'themes', 'default.json'), 'utf8'));
    const byElement = new Map((theme.overrides as Array<{ elementId?: string; tokens: Record<string, string> }>).map((entry) => [entry.elementId, entry]));
    expect(byElement.get('card-a')?.tokens['--omp-color-accent']).toBe('#FFD34D');
    expect(byElement.get('card-b')?.tokens['--omp-color-accent']).toBe('#FFC42E');
    expect(byElement.get('card-c')?.tokens['--omp-color-accent']).toBe('#2A2F3A');
    const css = await readFile(join(root, 'design', 'generated', 'android-phone.css'), 'utf8');
    expect(css).toContain('#FFD34D');
    expect(css).toContain('#FFC42E');
    await expect(checkGeneratedThemes(root)).resolves.toBeUndefined();
  });

  it('drops a deleted in-scope override on a repeated page export', async () => {
    const { root, head } = await makeRepo();
    const first = createDefaultDraft('draft-1', head);
    first.theme.layout = { containers: [], placements: [placement('card-a', 'settings')] };
    first.theme.overrides = [buildOverride(styleIdentity(), { '--omp-color-panel': '#242A38' })];
    await exportDraft({ root, draft: first });

    const second = createDefaultDraft('draft-1', head);
    second.theme.layout = { containers: [], placements: [placement('card-a', 'settings')] };
    second.theme.overrides = [];
    await exportDraft({ root, draft: second, scope: { kind: 'page', screenId: 'settings' } });
    const theme = JSON.parse(await readFile(join(root, 'design', 'themes', 'default.json'), 'utf8'));
    expect(theme.overrides).toEqual([]);
  });

  it('regenerates css for every target a changed component override ships to', async () => {
    const { root, head } = await makeRepo();
    const phone = 'android-phone' as DesignTarget;
    const tv = 'lg-webos' as DesignTarget;
    const layout = { containers: [], placements: [placement('card-a', 'settings', { x: 5 }, phone)] };
    const first = createDefaultDraft('draft-1', head);
    first.theme.layout = layout;
    first.theme.overrides = [
      buildOverride(styleIdentity({ target: phone, elementId: 'card-a' }), { '--omp-color-accent': '#111111' }),
      buildOverride(styleIdentity({ target: tv, elementId: 'card-a' }), { '--omp-color-accent': '#222222' }),
    ];
    await exportDraft({ root, draft: first });

    const second = createDefaultDraft('draft-1', head);
    second.theme.layout = layout;
    second.theme.overrides = [
      buildOverride(styleIdentity({ target: phone, elementId: 'card-a' }), { '--omp-color-accent': '#333333' }),
      buildOverride(styleIdentity({ target: tv, elementId: 'card-a' }), { '--omp-color-accent': '#444444' }),
    ];
    const result = await exportDraft({ root, draft: second, scope: { kind: 'component', nodeId: 'card-a' } });
    expect(result.targets).toEqual(['android-phone', 'lg-webos']);

    const theme = JSON.parse(await readFile(join(root, 'design', 'themes', 'default.json'), 'utf8'));
    const byTarget = new Map((theme.overrides as Array<{ target?: string; tokens: Record<string, string> }>).map((entry) => [entry.target, entry]));
    expect(byTarget.get('android-phone')?.tokens['--omp-color-accent']).toBe('#333333');
    expect(byTarget.get('lg-webos')?.tokens['--omp-color-accent']).toBe('#444444');
    // The theme and every target css stay consistent: the tv override ships together with its
    // regenerated css instead of changing the theme while the platform css goes stale.
    expect(await readFile(join(root, 'design', 'generated', 'android-phone.css'), 'utf8')).toContain('#333333');
    expect(await readFile(join(root, 'design', 'generated', 'lg-webos.css'), 'utf8')).toContain('#444444');
    await expect(checkGeneratedThemes(root)).resolves.toBeUndefined();
  });

  it('keeps overrides from other pages when exporting a component scope', async () => {
    const { root, head } = await makeRepo();
    const phone = 'android-phone' as DesignTarget;
    const layout = { containers: [], placements: [placement('card-a', 'settings', { x: 5 }, phone)] };
    const first = createDefaultDraft('draft-1', head);
    first.theme.layout = layout;
    first.theme.overrides = [buildOverride(styleIdentity({ target: phone, screenId: 'news', elementId: 'card-a' }), { '--omp-color-accent': '#111111' })];
    await exportDraft({ root, draft: first });

    const second = createDefaultDraft('draft-1', head);
    second.theme.layout = layout;
    second.theme.overrides = [buildOverride(styleIdentity({ target: phone, screenId: 'news', elementId: 'card-a' }), { '--omp-color-accent': '#555555' })];
    await exportDraft({ root, draft: second, scope: { kind: 'component', nodeId: 'card-a' } });

    const theme = JSON.parse(await readFile(join(root, 'design', 'themes', 'default.json'), 'utf8'));
    const news = (theme.overrides as Array<{ screenId?: string; tokens: Record<string, string> }>).find((entry) => entry.screenId === 'news');
    // The scoped node lives on the settings page only, so its news page override stays with the
    // base theme even though the element id matches.
    expect(news?.tokens['--omp-color-accent']).toBe('#111111');
  });
});
