import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditorClient } from '../../editor/src/client';
import { createDefaultDraft } from '../../editor/shared/draft';

const BASE = '0000000000000000000000000000000000000000';

afterEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

describe('editor client', () => {
  it('reads a fragment token once, clears the URL and sends it only to loopback API', async () => {
    window.history.replaceState(null, '', '/#token=test-token');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ baseCommit: BASE, dirtyDesign: false }), { status: 200 }));
    const client = createEditorClient({ origin: 'http://127.0.0.1:4173', fetch: fetchMock as typeof fetch });
    await client.state();
    expect(window.location.hash).toBe('');
    expect(window.sessionStorage.getItem('omp.editor.token')).toBe('test-token');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:4173/api/state');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer test-token');
  });

  it('round-trips drafts and returns null for a missing id', async () => {
    const draft = createDefaultDraft('draft-1', BASE);
    const responses = [
      new Response(JSON.stringify(draft), { status: 200 }),
      new Response(JSON.stringify(draft), { status: 200 }),
      new Response(JSON.stringify({ error: 'NOT_FOUND' }), { status: 404 }),
    ];
    const fetchMock = vi.fn(async () => responses.shift()!);
    const client = createEditorClient({ origin: 'http://127.0.0.1:4173', token: 'test-token', fetch: fetchMock as typeof fetch });
    expect(await client.putDraft(draft)).toEqual(draft);
    expect(await client.getDraft('draft-1')).toEqual(draft);
    expect(await client.getDraft('missing')).toBeNull();
  });

  it('rejects token forwarding to a non-loopback origin', () => {
    expect(() => createEditorClient({ origin: 'https://attacker.invalid', token: 'test-token' })).toThrow();
  });
});
