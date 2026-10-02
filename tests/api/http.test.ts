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
