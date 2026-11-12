import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { DESIGN_ELEMENTS } from '../design/catalog.ts';
import { generateThemeCss } from '../design/theme.ts';
import { checkTheme } from '../design/theme-checks.ts';
import { validateFlow, validateFlowGraph } from '../design/flow-validation.ts';
import { generateLayoutModule } from '../design/generate.ts';
import { parseFlowDocument, parseThemeDocument } from '../design/validation.ts';
import { createFlowExportPlan, diffFlowDocuments, flowRuleInScope } from '../design/production-flow.ts';
import { parseEditorDraft } from './shared/draft.ts';
import { DESIGN_TARGETS, DESIGN_FORMATS, DESIGN_STATES } from '../design/schema.ts';
import { DESKTOP_ROUTES } from '../desktop/src/shell/routes.ts';
import { getEditorPages, isEditorRoute } from './shared/routes.ts';
import { isDesignElementAvailable } from '../design/catalog.ts';

const execute = promisify(execFile);

export class ExportError extends Error {
  constructor(code, status = 409, issues) {
    super(code);
    this.code = code;
    this.status = status;
    this.issues = issues;
  }
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function safePath(path) {
  if (!path.startsWith('design/') || path.includes('..') || path.includes('\\') || path.startsWith('/')) {
    throw new ExportError('UNSAFE_EXPORT_PATH', 400);
  }
  return path;
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function gitLines(root, args) {
  const { stdout } = await execute('git', args, { cwd: root });
  return stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).sort();
}

async function manifestFor(root, draftId) {
  const path = join(root, '.omp-editor', 'exports', `${draftId}.json`);
  let source;
  try {
    source = await readFile(path, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return null;
    throw error;
  }
  try {
    const manifest = JSON.parse(source);
    if (manifest.schemaVersion !== 1 || manifest.draftId !== draftId || !Array.isArray(manifest.files)) throw new Error('schema');
    const files = manifest.files.map((file) => {
      if (!file || typeof file.path !== 'string' || typeof file.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(file.sha256)) throw new Error('schema');
      return { path: safePath(file.path), sha256: file.sha256 };
    });
    return { files };
  } catch {
    throw new ExportError('INVALID_EXPORT_MANIFEST', 409);
  }
}

export async function inheritExportManifest(root, sourceId, targetId) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(sourceId) || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(targetId) || sourceId === targetId) {
    throw new ExportError('INVALID_EXPORT_COPY', 400);
  }
  const manifest = await manifestFor(root, sourceId);
  if (!manifest) return null;
  const path = join(root, '.omp-editor', 'exports', `${targetId}.json`);
  let handle;
  let created = false;
  try {
    handle = await open(path, 'wx', 0o600);
    created = true;
    await handle.writeFile(json({ schemaVersion: 1, draftId: targetId, files: manifest.files }));
    await handle.close();
    handle = null;
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    if (created) {
      try {
        await rm(path, { force: true });
      } catch {}
    }
    if (error && typeof error === 'object' && error.code === 'EEXIST') throw new ExportError('EXPORT_MANIFEST_EXISTS', 409);
    throw error;
  }
  return async () => {
    await rm(path, { force: true });
  };
}

async function dirtyDesignFiles(root) {
  return [...new Set([
    ...await gitLines(root, ['diff', '--name-only', '--', 'design']),
    ...await gitLines(root, ['diff', '--cached', '--name-only', '--', 'design']),
    ...await gitLines(root, ['ls-files', '--others', '--exclude-standard', '--', 'design']),
  ])].sort();
}

// Scoped exports only guard the files they write; dirty foreign files stay untouched and
// are reported back so the reviewer sees what remains outside the exported scope. The all
// scope keeps the full ownership check because it also removes previously exported files.
async function verifyPlanDirty(root, plan, manifest) {
  const planPaths = new Set(plan.files.map((file) => file.path));
  const dirty = await dirtyDesignFiles(root);
  const foreignDirty = [];
  for (const path of dirty) {
    const guarded = plan.scope.kind === 'all' || planPaths.has(path);
    if (!guarded) {
      foreignDirty.push(path);
      continue;
    }
    safePath(path);
    const owned = manifest ? manifest.files.find((file) => file.path === path) : undefined;
    if (!owned) throw new ExportError('DIRTY_DESIGN', 409);
    let current;
    try {
      current = await readFile(join(root, path), 'utf8');
    } catch {
      throw new ExportError('DIRTY_DESIGN', 409);
    }
    if (sha256(current) !== owned.sha256) throw new ExportError('DIRTY_DESIGN', 409);
  }
  return foreignDirty;
}

function contexts() {
  const navigationElements = DESKTOP_ROUTES.filter((route) => route.menu).map((route) => ({
    componentId: 'sidebar-item',
    id: `nav-${route.id}`,
  }));
  const allElements = [...DESIGN_ELEMENTS, ...navigationElements];
  return DESIGN_TARGETS.flatMap((target) => getEditorPages(target).flatMap((page) => (
    allElements.filter((element) => isDesignElementAvailable(element.id, page.id, target)).flatMap((element) => (
      DESIGN_FORMATS.flatMap((format) => DESIGN_STATES.map((state) => ({
        target,
        screenId: page.id,
        componentId: element.componentId,
        elementId: element.id,
        format,
        state,
      })))
    ))
  )));
}

function outputFiles(draft) {
  const files = [
    { path: `design/themes/${draft.theme.id}.json`, content: json(draft.theme) },
    ...DESIGN_TARGETS.map((target) => ({
      path: `design/generated/${target}.css`,
      content: generateThemeCss(draft.theme, target),
    })),
    { path: 'design/generated/layout.ts', content: generateLayoutModule(draft.theme.layout) },
  ];
  return files.map((file) => ({ ...file, path: safePath(file.path) })).sort((a, b) => a.path.localeCompare(b.path));
}

const SCOPE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

function normalizeScope(scope) {
  if (typeof scope !== 'object' || scope === null || Array.isArray(scope)) {
    throw new ExportError('INVALID_EXPORT_SCOPE', 400);
  }
  if (scope.kind === 'all') return { kind: 'all' };
  if (scope.kind === 'page') {
    const screenId = scope.screenId;
    if (typeof screenId !== 'string' || !SCOPE_ID.test(screenId)) {
      throw new ExportError('INVALID_EXPORT_SCOPE', 400);
    }
    if (!DESIGN_TARGETS.some((target) => isEditorRoute(target, screenId))) {
      throw new ExportError('INVALID_EXPORT_SCOPE', 400);
    }
    return { kind: 'page', screenId };
  }
  if (scope.kind === 'component') {
    const nodeId = scope.nodeId;
    if (typeof nodeId !== 'string' || !SCOPE_ID.test(nodeId)) {
      throw new ExportError('INVALID_EXPORT_SCOPE', 400);
    }
    return { kind: 'component', nodeId };
  }
  throw new ExportError('INVALID_EXPORT_SCOPE', 400);
}

function layoutEntryInScope(entry, scope) {
  if (scope.kind === 'page') return entry.screenId === scope.screenId;
  if (entry.nodeId === scope.nodeId) return true;
  if (Array.isArray(entry.order) && entry.order.includes(scope.nodeId)) return true;
  return entry.parentId === scope.nodeId;
}

// Style overrides name what they style: a page scope owns every override carrying that
// screenId inside its target contexts, a component scope owns the overrides whose elementId is
// one of the layout node ids covered by the scope and whose target and page match the scoped
// node contexts. Overrides outside those contexts stay with the base theme.
function overrideInScope(override, scope, scopedNodeIds, scopeTargets, scopeScreens) {
  if (scope.kind === 'page') return override.screenId === scope.screenId && scopeTargets.has(override.target);
  if (scope.kind === 'component') {
    return override.elementId != null && scopedNodeIds.has(override.elementId)
      && scopeTargets.has(override.target) && scopeScreens.has(override.screenId);
  }
  return false;
}

// One value per layout entry the scope covers: the target contexts for ownership checks and
// css regeneration, the page contexts for the component ownership match.
function layoutContextValues(layout, scope, pick) {
  const source = layout ?? emptyLayout();
  const values = new Set();
  for (const entry of [...source.containers, ...source.placements, ...(source.clones ?? [])]) {
    if (!layoutEntryInScope(entry, scope)) continue;
    values.add(pick(entry));
  }
  return values;
}

function scopedNodeIds(layout, scope) {
  const ids = new Set();
  if (scope.kind !== 'component') return ids;
  const source = layout ?? emptyLayout();
  const inScope = (entry) => layoutEntryInScope(entry, scope);
  for (const entry of [...source.containers, ...source.placements, ...(source.clones ?? [])]) {
    if (!inScope(entry)) continue;
    ids.add(entry.nodeId);
    if (Array.isArray(entry.order)) for (const id of entry.order) ids.add(id);
  }
  return ids;
}

function emptyLayout() {
  return { containers: [], placements: [] };
}

function layoutForScope(layout, scope) {
  if (scope.kind === 'all') return layout ?? emptyLayout();
  const source = layout ?? emptyLayout();
  const inScope = (entry) => layoutEntryInScope(entry, scope);
  const containers = source.containers.filter(inScope);
  const placements = source.placements.filter(inScope);
  const clones = (source.clones ?? []).filter(inScope);
  return clones.length ? { containers, placements, clones } : { containers, placements };
}

function targetsForScope(scope, theme) {
  if (scope.kind === 'all') return [...DESIGN_TARGETS];
  if (scope.kind === 'page') {
    const matched = new Set(DESIGN_TARGETS.filter((target) => getEditorPages(target).some((page) => page.id === scope.screenId)));
    // Every override the page changes ships with its target: the css of each such target is
    // regenerated so the theme file and the platform styles never drift apart.
    for (const override of theme.overrides) {
      if (override.screenId === scope.screenId) matched.add(override.target);
    }
    return DESIGN_TARGETS.filter((target) => matched.has(target));
  }
  const layout = theme.layout ?? emptyLayout();
  const matched = layoutContextValues(layout, scope, (entry) => entry.target);
  const nodeIds = scopedNodeIds(layout, scope);
  const screens = layoutContextValues(layout, scope, (entry) => entry.screenId);
  for (const override of theme.overrides) {
    if (override.elementId != null && nodeIds.has(override.elementId) && screens.has(override.screenId)) {
      matched.add(override.target);
    }
  }
  return DESIGN_TARGETS.filter((target) => matched.has(target));
}

// The plan is a pure, validated view of what the draft contributes for the scope. Merging
// with the files already on disk happens in createExportDiff, where the foreign scopes are
// preserved byte for byte.
export function createExportPlan(input, scopeInput) {
  let draft;
  try {
    draft = parseEditorDraft(input);
  } catch {
    throw new ExportError('INVALID_DRAFT', 400);
  }
  const scope = normalizeScope(scopeInput);
  let flowPlan;
  try {
    flowPlan = createFlowExportPlan(draft, scope);
  } catch (error) {
    throw new ExportError(error && typeof error === 'object' && error.message === 'INVALID_EXPORT_SCOPE' ? 'INVALID_EXPORT_SCOPE' : 'INVALID_FLOW', 400);
  }
  const theme = scope.kind === 'all'
    ? draft.theme
    : { ...draft.theme, layout: layoutForScope(draft.theme.layout, scope) };
  const routes = DESKTOP_ROUTES.map((route) => route.id);
  const flowIssues = [
    ...validateFlow(flowPlan.flow, routes),
    ...validateFlowGraph(flowPlan.flow, routes),
  ];
  if (flowIssues.length) throw new ExportError('INVALID_FLOW', 400, flowIssues);
  if (scope.kind === 'all') {
    const designIssues = checkTheme(draft.theme, contexts());
    if (designIssues.length) throw new ExportError('DESIGN_ISSUES', 422, designIssues);
  }
  const targets = targetsForScope(scope, theme);
  const files = scope.kind === 'all'
    ? [...outputFiles({ ...draft, theme }), ...flowPlan.files].sort((a, b) => a.path.localeCompare(b.path))
    : [
        // A scoped export ships the selected style edits too: the theme file merges the
        // in-scope overrides with the base theme and the generated CSS for the scope targets
        // is rewritten from the merged theme, so the exported page/component renders with
        // its actual colors.
        { path: safePath('design/generated/layout.ts'), content: generateLayoutModule(theme.layout) },
        { path: safePath(`design/themes/${draft.theme.id}.json`), content: json(theme) },
        ...targets.map((target) => ({
          path: safePath(`design/generated/${target}.css`),
          content: generateThemeCss(theme, target),
        })),
        ...flowPlan.files,
      ].sort((a, b) => a.path.localeCompare(b.path));
  return { scope, targets, draft, theme, flow: flowPlan.flow, files };
}

// Scoped flow merge mirrors the layout merge: rules merge by id, so independent edits to
// other screens survive, a scoped rule the draft edited ships with its new trigger, and a
// scoped rule the draft dropped exports the deletion. Variables are global state: a scoped
// export may add or update the variables its rules reference, but never deletes base ones.
async function mergedFlowContents(root, plan) {
  const flowFile = plan.files.find((file) => file.path.startsWith('design/flows/'));
  let baseFlow = null;
  try {
    baseFlow = parseFlowDocument(JSON.parse(await readFile(join(root, flowFile.path), 'utf8')));
  } catch (error) {
    if (!(error && typeof error === 'object' && error.code === 'ENOENT')) {
      throw new ExportError('INVALID_EXPORT_BASE', 409);
    }
  }
  const scopedFlow = plan.flow;
  const scopedIds = new Set(scopedFlow.rules.map((rule) => rule.id));
  const draftRules = new Map(plan.draft.flow.rules.map((rule) => [rule.id, rule]));
  const mergedRules = [];
  for (const baseRule of baseFlow?.rules ?? []) {
    if (scopedIds.has(baseRule.id)) continue;
    if (flowRuleInScope(baseRule, plan.scope)) {
      // The scope no longer covers this rule: ship the draft record (its trigger moved), or
      // drop it when the draft deleted the rule.
      const draftRule = draftRules.get(baseRule.id);
      if (draftRule) mergedRules.push(draftRule);
      continue;
    }
    mergedRules.push(baseRule);
  }
  mergedRules.push(...scopedFlow.rules);
  const baseVariables = baseFlow?.variables ?? [];
  const scopedVariables = new Map((scopedFlow.variables ?? []).map((variable) => [variable.id, variable]));
  const mergedVariables = [
    ...baseVariables.map((variable) => scopedVariables.get(variable.id) ?? variable),
    ...(scopedFlow.variables ?? []).filter((variable) => !baseVariables.some((base) => base.id === variable.id)),
  ];
  let mergedFlow;
  try {
    mergedFlow = parseFlowDocument({
      schemaVersion: 1,
      id: scopedFlow.id,
      baseCommit: baseFlow?.baseCommit ?? scopedFlow.baseCommit,
      rules: mergedRules,
      ...(mergedVariables.length ? { variables: mergedVariables } : {}),
    });
  } catch {
    throw new ExportError('INVALID_EXPORT_BASE', 409);
  }
  const routes = DESKTOP_ROUTES.map((route) => route.id);
  const flowIssues = [
    ...validateFlow(mergedFlow, routes),
    ...validateFlowGraph(mergedFlow, routes),
  ];
  if (flowIssues.length) throw new ExportError('INVALID_FLOW', 422, flowIssues);
  return json(mergedFlow);
}

async function exportContents(root, plan) {
  const contents = new Map();
  if (plan.scope.kind === 'all') {
    for (const file of plan.files) contents.set(file.path, file.content);
    return contents;
  }
  const themeFile = plan.files.find((file) => file.path.startsWith('design/themes/'));
  const layoutFile = plan.files.find((file) => file.path === 'design/generated/layout.ts');
  const cssFiles = plan.files.filter((file) => file.path.startsWith('design/generated/') && file.path.endsWith('.css'));
  let baseTheme = null;
  try {
    baseTheme = parseThemeDocument(JSON.parse(await readFile(join(root, themeFile.path), 'utf8')));
  } catch (error) {
    if (!(error && typeof error === 'object' && error.code === 'ENOENT')) {
      throw new ExportError('INVALID_EXPORT_BASE', 409);
    }
  }
  const scopedLayout = plan.theme.layout ?? emptyLayout();
  // Layout records merge by identity (target, screen, format, node), not by scope match alone:
  // after a reparent the old parent container no longer references the scoped node, so the
  // scope filter misses it, while the base record still references it and would be dropped or
  // duplicated. Every in-scope base identity is replaced by the draft record with that
  // identity: the scoped record when the scope covers it, otherwise the draft copy (the old
  // parent ships with its padding and alignment and without the moved node). A draft without
  // the record exports the deletion.
  const layoutIdentityKey = (entry) => `${entry.target}|${entry.screenId}|${entry.format}|${entry.nodeId}`;
  const draftLayout = plan.draft.theme.layout ?? emptyLayout();
  const draftContainers = new Map(draftLayout.containers.map((entry) => [layoutIdentityKey(entry), entry]));
  const draftPlacements = new Map(draftLayout.placements.map((entry) => [layoutIdentityKey(entry), entry]));
  const draftClones = new Map((draftLayout.clones ?? []).map((entry) => [layoutIdentityKey(entry), entry]));
  const scopedContainers = new Set(scopedLayout.containers.map(layoutIdentityKey));
  const scopedPlacements = new Set(scopedLayout.placements.map(layoutIdentityKey));
  const scopedClones = new Set((scopedLayout.clones ?? []).map(layoutIdentityKey));
  let mergedLayout;
  if (baseTheme) {
    const inScope = (entry) => layoutEntryInScope(entry, plan.scope);
    const mergeRecords = (baseRecords, scopedRecords, draftRecords, scopedKeys) => {
      const merged = [];
      for (const entry of baseRecords) {
        const key = layoutIdentityKey(entry);
        // Identities the scoped layout carries are replaced by the scoped record below; this
        // also covers the new parent of a reparented node, which the base record cannot
        // reference yet and would otherwise duplicate.
        if (scopedKeys.has(key)) continue;
        if (inScope(entry)) {
          // Stale reference the scope no longer covers (the old parent after a reparent): ship
          // the draft record for this identity, or drop it when the draft deleted the record.
          const draftEntry = draftRecords.get(key);
          if (draftEntry) merged.push(draftEntry);
          continue;
        }
        merged.push(entry);
      }
      merged.push(...scopedRecords);
      return merged;
    };
    const containers = mergeRecords(baseTheme.layout?.containers ?? [], scopedLayout.containers, draftContainers, scopedContainers);
    const placements = mergeRecords(baseTheme.layout?.placements ?? [], scopedLayout.placements, draftPlacements, scopedPlacements);
    const clones = mergeRecords(baseTheme.layout?.clones ?? [], scopedLayout.clones ?? [], draftClones, scopedClones);
    mergedLayout = clones.length ? { containers, placements, clones } : { containers, placements };
  } else {
    mergedLayout = scopedLayout.clones?.length
      ? { containers: scopedLayout.containers, placements: scopedLayout.placements, clones: scopedLayout.clones }
      : { containers: scopedLayout.containers, placements: scopedLayout.placements };
  }
  const nodeIds = scopedNodeIds(plan.draft.theme.layout, plan.scope);
  const scopeTargets = new Set(plan.targets);
  const scopeScreens = plan.scope.kind === 'component'
    ? layoutContextValues(plan.draft.theme.layout, plan.scope, (entry) => entry.screenId)
    : null;
  const inScopeOverride = (override) => overrideInScope(override, plan.scope, nodeIds, scopeTargets, scopeScreens);
  const scopedOverrides = plan.theme.overrides.filter(inScopeOverride);
  const mergedOverrides = baseTheme
    ? [...baseTheme.overrides.filter((entry) => !inScopeOverride(entry)), ...scopedOverrides]
    : scopedOverrides;
  let mergedTheme;
  try {
    mergedTheme = parseThemeDocument(baseTheme
      ? { ...baseTheme, baseCommit: plan.draft.baseCommit, layout: mergedLayout, overrides: mergedOverrides }
      : { ...plan.theme, layout: mergedLayout, overrides: mergedOverrides });
  } catch {
    throw new ExportError('INVALID_EXPORT_BASE', 409);
  }
  const designIssues = checkTheme(mergedTheme, contexts());
  if (designIssues.length) throw new ExportError('DESIGN_ISSUES', 422, designIssues);
  contents.set(themeFile.path, json(mergedTheme));
  contents.set(layoutFile.path, generateLayoutModule(mergedTheme.layout));
  for (const file of cssFiles) {
    const target = file.path.slice('design/generated/'.length, -'.css'.length);
    contents.set(file.path, generateThemeCss(mergedTheme, target));
  }
  if (plan.files.some((file) => file.path.startsWith('design/flows/'))) {
    contents.set(flowFilePathOf(plan), await mergedFlowContents(root, plan));
  }
  return contents;
}

function flowFilePathOf(plan) {
  return plan.files.find((file) => file.path.startsWith('design/flows/')).path;
}

export async function createExportDiff(root, plan) {
  const { stdout } = await execute('git', ['rev-parse', 'HEAD'], { cwd: root });
  const baseCommit = stdout.trim();
  if (plan.draft.baseCommit !== baseCommit) throw new ExportError('STALE_BASE', 409);
  const manifest = await manifestFor(root, plan.draft.id);
  const foreignDirty = await verifyPlanDirty(root, plan, manifest);
  const contents = await exportContents(root, plan);
  const files = [];
  for (const planned of plan.files) {
    const after = contents.get(planned.path);
    let before = null;
    try {
      before = await readFile(join(root, planned.path), 'utf8');
    } catch (error) {
      if (!(error && typeof error === 'object' && error.code === 'ENOENT')) throw error;
    }
    files.push({
      path: planned.path,
      action: before === null ? 'create' : before === after ? 'unchanged' : 'update',
      before,
      after,
    });
  }
  // Flow files carry a structured review diff by rule, node, edge and variable ids. A
  // foreign hand edit can make the base unparsable; the ownership checks guard that, and
  // the file-level before/after stay available either way.
  for (const file of files) {
    if (!file.path.startsWith('design/flows/') || file.action !== 'update' || file.before === null) continue;
    try {
      file.flow = diffFlowDocuments(
        parseFlowDocument(JSON.parse(file.before)),
        parseFlowDocument(JSON.parse(file.after)),
      );
    } catch {
      // keep the plain before/after diff
    }
  }
  return { baseCommit, targets: plan.targets, files, foreignDirty };
}

async function backupFor(root, paths) {
  const backup = new Map();
  for (const path of paths) {
    try {
      backup.set(path, await readFile(join(root, path), 'utf8'));
    } catch {
      backup.set(path, null);
    }
  }
  return backup;
}

async function restore(root, backup) {
  for (const [path, content] of backup) {
    if (content === null) await rm(join(root, path), { force: true });
    else await writeFile(join(root, path), content, 'utf8');
  }
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && typeof error === 'object' && error.code === 'EPERM');
  }
}

async function staleLock(path) {
  try {
    const owner = JSON.parse(await readFile(path, 'utf8'));
    if (Number.isInteger(owner.pid) && owner.pid > 0) return !processAlive(owner.pid);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return false;
  }
  try {
    const info = await stat(path);
    return Date.now() - info.mtimeMs > 1000;
  } catch {
    return false;
  }
}

async function acquireRepositoryLock(root) {
  const path = join(root, '.omp-editor', 'exports', '.lock');
  await mkdir(dirname(path), { recursive: true });
  const id = randomBytes(8).toString('hex');
  const deadline = Date.now() + 30000;
  while (true) {
    try {
      await writeFile(path, JSON.stringify({ id, pid: process.pid, createdAt: Date.now() }), { flag: 'wx', mode: 0o600 });
      break;
    } catch (error) {
      if (!error || typeof error !== 'object' || error.code !== 'EEXIST') throw error;
    }
    if (await staleLock(path)) {
      const stalePath = `${path}.${id}.stale`;
      try {
        await rename(path, stalePath);
        await rm(stalePath, { force: true });
        continue;
      } catch {}
    }
    if (Date.now() >= deadline) throw new ExportError('EXPORT_LOCK_TIMEOUT', 409);
    await delay(25);
  }
  return async () => {
    try {
      const owner = JSON.parse(await readFile(path, 'utf8'));
      if (owner.id === id) await rm(path, { force: true });
    } catch {}
  };
}

export async function withRepositoryLock(root, operation) {
  const release = await acquireRepositoryLock(root);
  try {
    return await operation();
  } finally {
    await release();
  }
}

const exportQueues = new Map();

export function exportDraft(options) {
  const key = resolve(options.root);
  const previous = exportQueues.get(key) || Promise.resolve();
  const result = previous.then(() => withRepositoryLock(options.root, () => performExport(options)));
  const settled = result.then(() => undefined, () => undefined);
  exportQueues.set(key, settled);
  void settled.then(() => {
    if (exportQueues.get(key) === settled) exportQueues.delete(key);
  });
  return result;
}

async function performExport({ root, draft: input, scope: scopeInput }) {
  const plan = createExportPlan(input, scopeInput ?? { kind: 'all' });
  const diff = await createExportDiff(root, plan);
  const manifest = await manifestFor(root, plan.draft.id);
  const writes = diff.files.filter((file) => file.action !== 'unchanged');
  const nextPaths = new Set(diff.files.map((file) => file.path));
  const removed = plan.scope.kind === 'all' && manifest
    ? manifest.files.map((file) => file.path).filter((path) => !nextPaths.has(path))
    : [];
  // Removed files must be backed up before any write: a failure after deletion and before
  // the manifest rename rolls back to the previous consistent state.
  const backup = await backupFor(root, [...writes.map((file) => file.path), ...removed]);
  try {
    for (const file of writes) {
      await mkdir(dirname(join(root, file.path)), { recursive: true });
      await writeFile(join(root, file.path), file.after, 'utf8');
    }
    let entries;
    if (plan.scope.kind === 'all') {
      for (const path of removed) await rm(join(root, path), { force: true });
      entries = diff.files.map((file) => ({ path: file.path, sha256: sha256(file.after) }));
    } else {
      // A scoped export never deletes: ownership of files outside the scope is retained so
      // their dirty state keeps matching the recorded hashes on the next export.
      const touched = new Map(writes.map((file) => [file.path, sha256(file.after)]));
      const kept = manifest ? manifest.files.filter((file) => !touched.has(file.path)) : [];
      entries = [
        ...kept,
        ...[...touched].map(([path, hash]) => ({ path, sha256: hash })),
      ];
    }
    const manifestContent = json({
      schemaVersion: 1,
      draftId: plan.draft.id,
      files: entries.sort((a, b) => a.path.localeCompare(b.path)),
    });
    const manifestPath = join(root, '.omp-editor', 'exports', `${plan.draft.id}.json`);
    await mkdir(dirname(manifestPath), { recursive: true });
    const temporary = `${manifestPath}.tmp`;
    await writeFile(temporary, manifestContent, { mode: 0o600 });
    await rename(temporary, manifestPath);
  } catch (error) {
    await restore(root, backup);
    throw error;
  }
  return {
    baseCommit: diff.baseCommit,
    files: diff.files.map((file) => file.path),
    releaseIntents: plan.draft.theme.releaseIntents,
    targets: plan.targets,
    scope: plan.scope.kind,
  };
}
