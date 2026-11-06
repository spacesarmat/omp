import { describe, it, expect, vi, afterEach } from 'vitest';
import { request, errorMessage, isApiError, apiError } from '../../src/api/http';
import { mockFetch } from '../helpers/fetchMock';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('request', () => {
  it('parses json and sends body as POST', async () => {
    const fn = mockFetch(() => ({ body: '{"a":1}' }));
    const r = await request<{ a: number }>('http://h/x', { body: { action: 'list' } });
    expect(r).toEqual({ a: 1 });
    const init = fn.mock.calls[0][1];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"action":"list"}');
    expect(init.headers['Content-Type']).toBe('application/json');
  });
  it('returns null on empty body', async () => {
    mockFetch(() => ({ body: '' }));
    expect(await request('http://h/x')).toBeNull();
  });
  it('returns text when asked', async () => {
    mockFetch(() => ({ body: 'MatriX.145.1' }));
    expect(await request('http://h/echo', { responseType: 'text' })).toBe('MatriX.145.1');
  });
  it('adds basic auth header', async () => {
    const fn = mockFetch(() => ({ body: '1' }));
    await request('http://h/x', { auth: 'dTpw' });
    expect(fn.mock.calls[0][1].headers.Authorization).toBe('Basic dTpw');
  });
  it('rejects with http error', async () => {
    mockFetch(() => ({ status: 500, body: 'oops' }));
    await expect(request('http://h/x')).rejects.toMatchObject({ kind: 'http', status: 500 });
  });
  it('rejects with parse error', async () => {
    mockFetch(() => ({ body: '<html>' }));
    await expect(request('http://h/x')).rejects.toMatchObject({ kind: 'parse' });
  });
  it('rejects an oversized response body', async () => {
    mockFetch(() => ({ body: 'x'.repeat(5 * 1024 * 1024 + 1) }));
    await expect(request('http://h/x')).rejects.toMatchObject({ kind: 'http', status: 413 });
  });
  it('measures the response limit in UTF-8 bytes', async () => {
    mockFetch(() => ({ body: 'яяя' }));
    await expect(request('http://h/x', { maxBytes: 4 })).rejects.toMatchObject({ kind: 'http', status: 413 });
  });
  it('cancels a streamed response as soon as its chunks exceed the limit', async () => {
    let cancelled = false;
    const text = vi.fn(() => Promise.resolve('{}'));
    const body = {
      getReader: () => ({
        read: () => Promise.resolve({ done: false, value: new Uint8Array([1, 2, 3]) }),
        cancel: () => {
          cancelled = true;
          return Promise.resolve();
        },
        releaseLock: () => {},
      }),
    };
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, body, text })));
    await expect(request('http://h/x', { maxBytes: 2 })).rejects.toMatchObject({ kind: 'http', status: 413 });
    expect(cancelled).toBe(true);
    expect(text).not.toHaveBeenCalled();
  });
  it('rejects an oversized binary response', async () => {
    mockFetch(() => ({ body: 'x'.repeat(5 * 1024 * 1024 + 1) }));
    await expect(request('http://h/x', { responseType: 'arraybuffer' })).rejects.toMatchObject({ kind: 'http', status: 413 });
  });
  it('rejects with network error', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(request('http://h/x')).rejects.toMatchObject({ kind: 'network' });
  });
  it('rejects with timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const p = request('http://h/x', { timeoutMs: 1000 });
    vi.advanceTimersByTime(1001);
    await expect(p).rejects.toMatchObject({ kind: 'timeout' });
  });
  it('aborts the underlying fetch on timeout', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url, init) => {
      signal = init.signal;
      return new Promise(() => {});
    }));
    const p = request('http://h/x', { timeoutMs: 1000 });
    vi.advanceTimersByTime(1001);
    await expect(p).rejects.toMatchObject({ kind: 'timeout' });
    expect(signal?.aborted).toBe(true);
  });
  it('maps body read error to network error', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.reject(new TypeError('body read failed')),
    })));
    await expect(request('http://h/x')).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('errors', () => {
  it('maps messages', () => {
    expect(errorMessage(apiError('network', 'x'))).toBe('Сервер недоступен');
    expect(errorMessage(apiError('timeout', 'x'))).toBe('Сервер не отвечает');
    expect(errorMessage(apiError('http', 'x', 404))).toBe('Ошибка сервера (404)');
    expect(errorMessage(apiError('parse', 'x'))).toBe('Некорректный ответ сервера');
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(isApiError(apiError('http', 'x'))).toBe(true);
    expect(isApiError(new Error('x'))).toBe(false);
  });
});
