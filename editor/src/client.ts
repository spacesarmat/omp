import { parseEditorDraft, type EditorDraft } from '../shared/draft';
import { parseFlowDocument, parseThemeDocument } from '../../design/validation';
import type { ExportDiff, ExportResult, ExportScope } from '../export.mjs';
import type { CommittedDesign, RebaseResult } from '../design.mjs';

export class EditorApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly issues: unknown[];

  constructor(code: string, status: number, issues: unknown[] = []) {
    super(code);
    this.name = 'EditorApiError';
    this.code = code;
    this.status = status;
    this.issues = issues;
  }
}

async function apiError(response: Response): Promise<EditorApiError> {
  let body: Record<string, unknown> = {};
  try {
    const value = await response.json() as unknown;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) body = value as Record<string, unknown>;
  } catch {
    body = {};
  }
  const code = typeof body.error === 'string' && body.error ? body.error : `EDITOR_HTTP_${response.status}`;
  return new EditorApiError(code, response.status, Array.isArray(body.issues) ? body.issues : []);
}

export function formatEditorIssue(issue: unknown): string {
  if (typeof issue === 'string') return issue;
  if (typeof issue === 'object' && issue !== null && !Array.isArray(issue)) {
    const source = issue as Record<string, unknown>;
    const code = typeof source.code === 'string' ? source.code : '';
    const context = ['target', 'screenId', 'elementId', 'format', 'state', 'token', 'path']
      .map((key) => source[key])
      .filter((value): value is string => typeof value === 'string')
      .join(' / ');
    const message = typeof source.message === 'string' ? source.message : '';
    return [code, context, message].filter(Boolean).join(': ');
  }
  return JSON.stringify(issue) ?? String(issue);
}

export interface EditorState {
  baseCommit: string;
  dirtyDesign: boolean;
}

export interface EditorClient {
  state(): Promise<EditorState>;
  getDraft(id: string): Promise<EditorDraft | null>;
  putDraft(draft: EditorDraft, options?: { keepalive?: boolean }): Promise<EditorDraft>;
  copyDraft?(draft: EditorDraft, sourceId: string): Promise<EditorDraft>;
  getDesign(): Promise<CommittedDesign | null>;
  rebaseDraft(draft: EditorDraft): Promise<RebaseResult>;
  exportDraft(draft: EditorDraft, options?: { scope?: ExportScope }): Promise<ExportResult>;
  exportDiff?(draft: EditorDraft, options?: { scope?: ExportScope }): Promise<ExportDiff>;
}

export interface EditorClientOptions {
  origin?: string;
  token?: string;
  fetch?: typeof fetch;
}

function tokenFromLocation(): string {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const fromHash = params.get('token');
  if (fromHash) {
    window.sessionStorage.setItem('omp.editor.token', fromHash);
    window.history.replaceState(null, document.title, window.location.pathname + window.location.search);
    return fromHash;
  }
  const stored = window.sessionStorage.getItem('omp.editor.token');
  if (!stored) throw new Error('EDITOR_TOKEN_REQUIRED');
  return stored;
}

function loopbackOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.origin !== value) throw new Error('Editor API requires a loopback origin');
  return value;
}

function committedDesign(value: unknown): CommittedDesign {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('INVALID_DESIGN_RESPONSE');
  const source = value as Record<string, unknown>;
  if (typeof source.baseCommit !== 'string' || !/^[0-9a-f]{40}$/.test(source.baseCommit)) throw new Error('INVALID_DESIGN_RESPONSE');
  const theme = parseThemeDocument(source.theme);
  const flow = parseFlowDocument(source.flow);
  if (theme.baseCommit !== source.baseCommit || flow.baseCommit !== source.baseCommit) throw new Error('INVALID_DESIGN_RESPONSE');
  return { baseCommit: source.baseCommit, theme, flow };
}

function rebaseResult(value: unknown): RebaseResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('INVALID_REBASE_RESPONSE');
  const source = value as Record<string, unknown>;
  const allowed = ['design/flows/desktop-default.json', 'design/themes/default.json'];
  if (!Array.isArray(source.changes) || source.changes.some((path) => typeof path !== 'string' || !allowed.includes(path))) {
    throw new Error('INVALID_REBASE_RESPONSE');
  }
  return { draft: parseEditorDraft(source.draft), changes: [...source.changes] };
}

export function createEditorClient(options: EditorClientOptions = {}): EditorClient {
  const origin = loopbackOrigin(options.origin || window.location.origin);
  const token = options.token || tokenFromLocation();
  const fetchImpl = options.fetch || fetch;

  const request = async (path: string, init: RequestInit = {}): Promise<Response> => {
    if (!path.startsWith('/api/')) throw new Error('Invalid editor API path');
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return fetchImpl(origin + path, { ...init, headers });
  };

  return {
    state: async () => {
      const response = await request('/api/state');
      if (!response.ok) throw await apiError(response);
      return response.json() as Promise<EditorState>;
    },
    getDraft: async (id) => {
      const response = await request(`/api/drafts/${encodeURIComponent(id)}`);
      if (response.status === 404) return null;
      if (!response.ok) throw await apiError(response);
      return parseEditorDraft(await response.json());
    },
    putDraft: async (draft, options) => {
      const response = await request(`/api/drafts/${encodeURIComponent(draft.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
        keepalive: options?.keepalive,
      });
      if (!response.ok) throw await apiError(response);
      return parseEditorDraft(await response.json());
    },
    copyDraft: async (draft, sourceId) => {
      const response = await request(`/api/drafts/${encodeURIComponent(sourceId)}/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (!response.ok) throw await apiError(response);
      return parseEditorDraft(await response.json());
    },
    getDesign: async () => {
      const response = await request('/api/design');
      if (!response.ok) throw await apiError(response);
      const body = await response.json() as { design?: unknown };
      return body.design === null ? null : committedDesign(body.design);
    },
    rebaseDraft: async (draft) => {
      const response = await request('/api/rebase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (!response.ok) throw await apiError(response);
      return rebaseResult(await response.json());
    },
    exportDraft: async (draft, options) => {
      const response = await request('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft, scope: options?.scope ?? { kind: 'all' } }),
      });
      if (!response.ok) throw await apiError(response);
      return response.json() as Promise<ExportResult>;
    },
    exportDiff: async (draft, options) => {
      const response = await request('/api/export/diff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft, scope: options?.scope ?? { kind: 'all' } }),
      });
      if (!response.ok) throw await apiError(response);
      return response.json() as Promise<ExportDiff>;
    },
  };
}
