import { parseEditorDraft, type EditorDraft } from '../shared/draft';

export interface EditorState {
  baseCommit: string;
  dirtyDesign: boolean;
}

export interface EditorClient {
  state(): Promise<EditorState>;
  getDraft(id: string): Promise<EditorDraft | null>;
  putDraft(draft: EditorDraft, options?: { keepalive?: boolean }): Promise<EditorDraft>;
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
  };
}
