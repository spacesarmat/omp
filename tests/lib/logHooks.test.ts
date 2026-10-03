import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { request } from '../../src/api/http';
import { searchAll } from '../../src/sources/search';
import { resetHealth, reloadSourcePrefs } from '../../src/sources/store';
import { loginRequired } from '../../src/sources/types';
import type { Source, SourceContext } from '../../src/sources/types';
import { clearLog, logEntries } from '../../src/lib/log';
import { mockFetch } from '../helpers/fetchMock';

const ctx: SourceContext = {
  http: { get: () => Promise.reject(new Error('no')), post: () => Promise.reject(new Error('no')), clearCookies: () => Promise.resolve() },
  client: null,
};

beforeEach(() => {
  localStorage.clear();
  clearLog();
  reloadSourcePrefs();
  resetHealth();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('log hooks', () => {
  it('http failure: kind, status and site kind only', async () => {
    mockFetch(() => ({ status: 503, body: 'x' }));
    await expect(request('http://192.168.1.5:8090/torrents?link=magnet:?xt=urn:btih:abc&dn=Secret+Title')).rejects.toMatchObject({ status: 503 });
    const list = logEntries();
    expect(list.length).toBe(1);
    expect(list[0]).toMatchObject({ l: 'error', a: 'server', x: 'Запрос не удался (http 503): http://сервер' });
  });
  it('http network error and success', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    await expect(request('https://example.org/a?b=1')).rejects.toMatchObject({ kind: 'network' });
    expect(logEntries()[0].x).toBe('Запрос не удался (network): https://сервер');
    clearLog();
    mockFetch(() => ({ body: '{}' }));
    await request('http://h/x');
    expect(logEntries()).toEqual([]);
  });
  it('http without a timeout logs too and keeps the rejection', async () => {
    mockFetch(() => ({ status: 404, body: '' }));
    await expect(request('http://h/x', { timeoutMs: 0 })).rejects.toMatchObject({ status: 404 });
    expect(logEntries().length).toBe(1);
  });
  it('search source errors: id and message, never the query', async () => {
    vi.useFakeTimers();
    const mk = (id: string, search: () => Promise<never>): Source => ({ id, name: 'Моё имя', kind: 'builtin', search });
    const done: string[] = [];
    searchAll('Secret Query', {
      ctx,
      from: [
        mk('rutor', () => Promise.reject(new Error('HTTP 403'))),
        mk('rutracker', () => Promise.reject(loginRequired())),
        mk('my-torznab-home', () => Promise.reject(new Error('boom'))),
      ],
      onDone: (id) => done.push(id),
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(done.length).toBe(3);
    const xs = logEntries().map((e) => e.l + ' ' + e.a + ' ' + e.x);
    expect(xs).toContain('error search rutor: HTTP 403');
    expect(xs).toContain('warn search rutracker: нужен вход');
    expect(xs).toContain('error search источник: boom');
    expect(xs.join('\n')).not.toContain('Secret');
  });
});
