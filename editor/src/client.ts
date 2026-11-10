import { parseEditorDraft, type EditorDraft } from '../shared/draft';
import { parseFlowDocument, parseThemeDocument } from '../../design/validation';
import type { ExportResult } from '../export.mjs';
import type { CommittedDesign, RebaseResult } from '../design.mjs';

export interface EditorState {
  baseCommit: string;
  dirtyDesign: boolean;
}

export interface EditorClient {
  state(): Promise<EditorState>;
  getDraft(id: string): Promise<EditorDraft | null>;
  putDraft(draft: EditorDraft, options?: { keepalive?: boolean }): Promise<EditorDraft>;
  getDesign(): Promise<CommittedDesign | null>;
  rebaseDraft(draft: EditorDraft): Promise<RebaseResult>;
  exportDraft(draft: EditorDraft): Promise<ExportResult>;
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
      if (!response.ok) throw new Error(`EDITOR_HTTP_${response.status}`);
      return response.json() as Promise<EditorState>;
    },
    getDraft: async (id) => {
      const response = await request(`/api/drafts/${encodeURIComponent(id)}`);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`EDITOR_HTTP_${response.status}`);
      return parseEditorDraft(await response.json());
    },
    putDraft: async (draft, options) => {
      const response = await request(`/api/drafts/${encodeURIComponent(draft.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
        keepalive: options?.keepalive,
      });
      if (!response.ok) throw new Error(`EDITOR_HTTP_${response.status}`);
      return parseEditorDraft(await response.json());
    },
    getDesign: async () => {
      const response = await request('/api/design');
      if (!response.ok) throw new Error(`EDITOR_HTTP_${response.status}`);
      const body = await response.json() as { design?: unknown };
      return body.design === null ? null : committedDesign(body.design);
    },
    rebaseDraft: async (draft) => {
      const response = await request('/api/rebase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (!response.ok) throw new Error(`EDITOR_HTTP_${response.status}`);
      return rebaseResult(await response.json());
    },
    exportDraft: async (draft) => {
      const response = await request('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (!response.ok) throw new Error(`EDITOR_HTTP_${response.status}`);
      return response.json() as Promise<ExportResult>;
    },
  };
}
