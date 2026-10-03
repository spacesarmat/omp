import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { request } from '../../src/api/http';
import { clearLog, logEntries } from '../../src/lib/log';
import { mockFetch } from '../helpers/fetchMock';

beforeEach(() => {
  localStorage.clear();
  clearLog();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('expected failures and timeouts', () => {
  it('quiet requests are not logged', async () => {
    mockFetch(() => ({ status: 404, body: '' }));
    await expect(request('http://h/ffp/status', { quiet: true })).rejects.toMatchObject({ status: 404 });
    await expect(request('http://h/ffp/status', { quiet: true, timeoutMs: 0 })).rejects.toMatchObject({ status: 404 });
    expect(logEntries()).toEqual([]);
  });
  it('a timeout followed by a late network error is logged once and rejects with the timeout', async () => {
    vi.useFakeTimers();
    let fail!: (e: unknown) => void;
    vi.stubGlobal('fetch', () => new Promise((_r, rej) => { fail = rej; }));
    const caught = request('http://h/x', { timeoutMs: 100 }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(101);
    fail(new TypeError('late'));
    await vi.advanceTimersByTimeAsync(10);
    expect(await caught).toMatchObject({ kind: 'timeout' });
    expect(logEntries().map((e) => e.x)).toEqual(['Запрос не удался (timeout): http://сервер']);
  });
});
