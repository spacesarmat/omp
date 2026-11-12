import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createDefaultFlow, createDefaultTheme } from '../design/defaults.ts';
import { parseFlowDocument, parseThemeDocument } from '../design/validation.ts';
import { parseEditorDraft } from './shared/draft.ts';

const execute = promisify(execFile);
const THEME_PATH = 'design/themes/default.json';
const FLOW_PATH = 'design/flows/desktop-default.json';

export class DesignError extends Error {
  constructor(code, status = 409, issues) {
    super(code);
    this.code = code;
    this.status = status;
    this.issues = issues;
  }
}

function equal(left, right) {
  if (left === right) return true;
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((entry, index) => equal(entry, right[index]));
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return equal(leftKeys, rightKeys) && leftKeys.every((key) => equal(left[key], right[key]));
}

function object(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function reordered(base, current, key, survivors) {
  const baseIds = base.map((entry) => entry[key]).filter((id) => survivors.has(id));
  const currentIds = current.map((entry) => entry[key]).filter((id) => baseIds.includes(id));
  const expected = baseIds.filter((id) => currentIds.includes(id));
  return !equal(currentIds, expected);
}

function mergeOrder(base, local, incoming, key, path, issues, survivors) {
  const localReordered = reordered(base, local, key, survivors);
  const incomingReordered = reordered(base, incoming, key, survivors);
  if (localReordered && incomingReordered) {
    const baseIds = base.map((entry) => entry[key]).filter((id) => survivors.has(id));
    const localOrder = local.map((entry) => entry[key]).filter((id) => baseIds.includes(id));
    const incomingOrder = incoming.map((entry) => entry[key]).filter((id) => baseIds.includes(id));
    if (!equal(localOrder, incomingOrder)) issues.push({ path: `${path}.order` });
  }
  const preferredSource = incomingReordered ? incoming : localReordered ? local : incoming;
  const secondary = preferredSource === incoming ? local : incoming;
  const ordered = preferredSource.map((entry) => entry[key]).filter((id) => survivors.has(id));
  for (let index = 0; index < secondary.length; index += 1) {
    const id = secondary[index][key];
    if (!survivors.has(id) || ordered.includes(id)) continue;
    let insertAt = 0;
    for (let previous = index - 1; previous >= 0; previous -= 1) {
      const position = ordered.indexOf(secondary[previous][key]);
      if (position >= 0) {
        insertAt = position + 1;
        break;
      }
    }
    let nextAt = -1;
    for (let next = index + 1; next < secondary.length; next += 1) {
      const position = ordered.indexOf(secondary[next][key]);
      if (position >= 0) {
        nextAt = position;
        break;
      }
    }
    if (nextAt >= 0 && insertAt > nextAt) {
      issues.push({ path: `${path}.order` });
      continue;
    }
    ordered.splice(insertAt, 0, id);
  }
  return ordered;
}

// A node listed in the destination orders of two containers of one context has two competing
// parents: merge-by-id can produce this when local moves a node to one parent and incoming
// moves the same node to another, and the runtime would then move the node back and forth on
// every refresh. The merged layout must give every node at most one destination per context.
function competingParentIssues(layout) {
  const byContext = new Map();
  for (const container of layout?.containers ?? []) {
    const key = `${container.target}|${container.screenId}|${container.format}`;
    const claimed = byContext.get(key) ?? new Set();
    for (const nodeId of container.order) {
      if (claimed.has(nodeId)) return [{ path: 'theme.layout.containers' }];
      claimed.add(nodeId);
    }
    byContext.set(key, claimed);
  }
  return [];
}

function mergeValue(base, local, incoming, path, issues) {  if (equal(local, base)) return structuredClone(incoming);
  if (equal(incoming, base) || equal(local, incoming)) return structuredClone(local);
  if (object(base) && object(local) && object(incoming)) {
    const result = {};
    const keys = [...new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(incoming)])];
    for (const key of keys) {
      const value = mergeValue(base[key], local[key], incoming[key], `${path}.${key}`, issues);
      if (value !== undefined) result[key] = value;
    }
    return result;
  }
  if (Array.isArray(base) && Array.isArray(local) && Array.isArray(incoming)) {
    // Layout records and style presets carry unique record ids, so independent edits to
    // different nodes, containers, clones or presets merge entry by entry instead of
    // conflicting as whole arrays.
    const key = path === 'theme.releaseIntents' ? 'target'
      : path === 'theme.overrides'
        || path === 'flow.rules'
        || path === 'theme.stylePresets'
        || path === 'theme.layout.placements'
        || path === 'theme.layout.containers'
        || path === 'theme.layout.clones'
        ? 'id'
        : null;
    if (key) {
      const merged = new Map();
      const allIds = new Set([...base, ...local, ...incoming].map((entry) => entry[key]));
      for (const id of allIds) {
        const value = mergeValue(
          base.find((entry) => entry[key] === id),
          local.find((entry) => entry[key] === id),
          incoming.find((entry) => entry[key] === id),
          `${path}[${id}]`,
          issues,
        );
        if (value !== undefined) merged.set(id, value);
      }
      const ids = mergeOrder(base, local, incoming, key, path, issues, new Set(merged.keys()));
      return ids.map((id) => merged.get(id));
    }
  }
  issues.push({ path });
  return structuredClone(local);
}

async function head(root) {
  const { stdout } = await execute('git', ['rev-parse', 'HEAD'], { cwd: root });
  return stdout.trim();
}

async function readDocument(root, commit, path, parser) {
  let source;
  try {
    const { stdout } = await execute('git', ['show', `${commit}:${path}`], { cwd: root });
    source = stdout;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 128) return null;
    throw error;
  }
  try {
    const document = parser(JSON.parse(source));
    return { ...document, baseCommit: commit };
  } catch {
    throw new DesignError('INVALID_COMMITTED_DESIGN', 409, [{ path }]);
  }
}

async function designAt(root, commit) {
  try {
    await execute('git', ['cat-file', '-e', `${commit}^{commit}`], { cwd: root });
  } catch {
    throw new DesignError('BASE_HISTORY_UNAVAILABLE', 409, [{ path: 'baseCommit' }]);
  }
  const theme = await readDocument(root, commit, THEME_PATH, parseThemeDocument);
  const flow = await readDocument(root, commit, FLOW_PATH, parseFlowDocument);
  return {
    baseCommit: commit,
    theme: theme || createDefaultTheme(commit),
    flow: flow || createDefaultFlow(commit),
    exists: Boolean(theme || flow),
  };
}

export async function getCommittedDesign(root) {
  const commit = await head(root);
  const design = await designAt(root, commit);
  if (!design.exists) return null;
  return { baseCommit: design.baseCommit, theme: design.theme, flow: design.flow };
}

export async function rebaseDraft({ root, draft: input }) {
  let draft;
  try {
    draft = parseEditorDraft(input);
  } catch {
    throw new DesignError('INVALID_DRAFT', 400);
  }
  const base = await designAt(root, draft.baseCommit);
  const commit = await head(root);
  const incoming = await designAt(root, commit);
  const issues = [];
  const theme = mergeValue(base.theme, draft.theme, incoming.theme, 'theme', issues);
  const flow = mergeValue(base.flow, draft.flow, incoming.flow, 'flow', issues);
  issues.push(...competingParentIssues(theme.layout));
  if (issues.length) throw new DesignError('REBASE_CONFLICT', 409, issues);
  const rebased = parseEditorDraft({
    ...draft,
    baseCommit: commit,
    theme,
    flow,
    snapshots: draft.snapshots.map((snapshot) => ({
      ...snapshot,
      theme: { ...snapshot.theme, baseCommit: commit },
      flow: { ...snapshot.flow, baseCommit: commit },
    })),
    lastError: null,
  });
  const changes = [
    ...(!equal(base.flow, incoming.flow) ? [FLOW_PATH] : []),
    ...(!equal(base.theme, incoming.theme) ? [THEME_PATH] : []),
  ];
  return { draft: rebased, changes };
}
