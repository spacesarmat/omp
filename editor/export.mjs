import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { DESIGN_ELEMENTS } from '../design/catalog.ts';
import { generateThemeCss } from '../design/theme.ts';
import { checkTheme } from '../design/theme-checks.ts';
import { validateFlow } from '../design/flow-validation.ts';
import { parseEditorDraft } from './shared/draft.ts';
import { DESKTOP_DESIGN_TARGETS, DESIGN_FORMATS, DESIGN_STATES } from '../design/schema.ts';
import { DESKTOP_ROUTES } from '../desktop/src/shell/routes.ts';

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

async function verifyDirty(root, manifest) {
  const dirty = [...new Set([
    ...await gitLines(root, ['diff', '--name-only', '--', 'design']),
    ...await gitLines(root, ['diff', '--cached', '--name-only', '--', 'design']),
    ...await gitLines(root, ['ls-files', '--others', '--exclude-standard', '--', 'design']),
  ])].sort();
  for (const path of dirty) safePath(path);
  if (!manifest) {
    if (dirty.length) throw new ExportError('DIRTY_DESIGN', 409);
    return;
  }
  const owned = new Map(manifest.files.map((file) => [file.path, file.sha256]));
  for (const path of dirty) {
    if (!owned.has(path)) throw new ExportError('DIRTY_DESIGN', 409);
    let current;
    try {
      current = await readFile(join(root, path), 'utf8');
    } catch {
      throw new ExportError('DIRTY_DESIGN', 409);
    }
    if (sha256(current) !== owned.get(path)) throw new ExportError('DIRTY_DESIGN', 409);
  }
}

function contexts() {
  const navigationElements = DESKTOP_ROUTES.filter((route) => route.menu).map((route) => ({
    componentId: 'sidebar-item',
    id: `nav-${route.id}`,
  }));
  const elements = [...DESIGN_ELEMENTS, ...navigationElements];
  return DESKTOP_DESIGN_TARGETS.flatMap((target) => elements.flatMap((element) => (
    DESIGN_FORMATS.flatMap((format) => DESIGN_STATES.map((state) => ({
      target,
      screenId: 'settings',
      componentId: element.componentId,
      elementId: element.id,
      format,
      state,
    })))
  )));
}

function outputFiles(draft) {
  const files = [
    { path: `design/themes/${draft.theme.id}.json`, content: json(draft.theme) },
    { path: `design/flows/${draft.flow.id}.json`, content: json(draft.flow) },
    ...DESKTOP_DESIGN_TARGETS.map((target) => ({
      path: `design/generated/${target}.css`,
      content: generateThemeCss(draft.theme, target),
    })),
  ];
  return files.map((file) => ({ ...file, path: safePath(file.path) })).sort((a, b) => a.path.localeCompare(b.path));
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

async function withRepositoryLock(root, operation) {
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

async function performExport({ root, draft: input }) {
  let draft;
  try {
    draft = parseEditorDraft(input);
  } catch {
    throw new ExportError('INVALID_DRAFT', 400);
  }
  const flowIssues = validateFlow(draft.flow, DESKTOP_ROUTES.map((route) => route.id));
  if (flowIssues.length) throw new ExportError('INVALID_FLOW', 400, flowIssues);
  const designIssues = checkTheme(draft.theme, contexts());
  if (designIssues.length) throw new ExportError('DESIGN_ISSUES', 422, designIssues);
  const { stdout } = await execute('git', ['rev-parse', 'HEAD'], { cwd: root });
  const baseCommit = stdout.trim();
  if (draft.baseCommit !== baseCommit) throw new ExportError('STALE_BASE', 409);

  const manifest = await manifestFor(root, draft.id);
  await verifyDirty(root, manifest);
  const files = outputFiles(draft);
  const nextPaths = new Set(files.map((file) => file.path));
  const removed = manifest ? manifest.files.map((file) => file.path).filter((path) => !nextPaths.has(path)) : [];
  const backup = await backupFor(root, [...nextPaths, ...removed]);
  try {
    for (const file of files) {
      await mkdir(dirname(join(root, file.path)), { recursive: true });
      await writeFile(join(root, file.path), file.content, 'utf8');
    }
    for (const path of removed) await rm(join(root, path), { force: true });
    const manifestContent = json({
      schemaVersion: 1,
      draftId: draft.id,
      files: files.map((file) => ({ path: file.path, sha256: sha256(file.content) })),
    });
    const manifestPath = join(root, '.omp-editor', 'exports', `${draft.id}.json`);
    await mkdir(dirname(manifestPath), { recursive: true });
    const temporary = `${manifestPath}.tmp`;
    await writeFile(temporary, manifestContent, { mode: 0o600 });
    await rename(temporary, manifestPath);
  } catch (error) {
    await restore(root, backup);
    throw error;
  }
  return { baseCommit, files: [...nextPaths].sort(), releaseIntents: draft.theme.releaseIntents };
}
