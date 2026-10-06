import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setRpcTransport, phoneStatus } from '../../src/phone/rpc';
import { savePhoneLink, forgetPhoneLink } from '../../src/phone/phoneStore';
import { startTvSearch, resolveTvResult, POLL_MS } from '../../src/phone/phoneSearch';
import type { TvResult } from '../../src/phone/phoneSearch';
import { servers, addServer, setActiveServer, removeServer } from '../../src/store/servers';
import { reloadSourcePrefs, resetHealth } from '../../src/sources/store';
import { mockFetch } from '../helpers/fetchMock';

const PH = { url: 'http://192.168.1.20:8097', token: 'b'.repeat(32), name: 'Pixel' };
const HASH = 'c'.repeat(40);
const TS_ROW = { Title: 'Dune 2021 TS', Categories: '', Size: '20 GB', CreateDate: '', Tracker: 'rutor', Link: '', Magnet: 'magnet:?xt=urn:btih:' + HASH, Hash: HASH, Peer: 1, Seed: 9 };

function phoneRow(key: string, title: string) {
  return { key, Title: title, Size: '10 GB', Seed: 50, Peer: 3, Tracker: 'RuTracker', CreateDate: '2024-03-01', date: '01.03.2024', Categories: '', Magnet: '', Hash: '', source: 'rutracker' };
}

type Reply = unknown;
let script: { [method: string]: Reply[] };
let calls: Array<{ method: string; params: any }>;

function useScript(s: { [method: string]: Reply[] }) {
  script = s;
  calls = [];
  setRpcTransport((_url, body) => {
    const req = JSON.parse(body);
    calls.push(req);
    const list = script[req.method] || [];
    const next = list.length > 1 ? list.shift() : list[0];
    if (next instanceof Error) return Promise.reject(next);
    if (next === undefined) return Promise.reject(new Error('network'));
    if (typeof next === 'string') return Promise.resolve(next);
    return Promise.resolve(JSON.stringify({ ok: true, result: next }));
  });
}

const count = (m: string) => calls.filter((c) => c.method === m).length;
let fetchFn: ReturnType<typeof mockFetch>;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  reloadSourcePrefs();
  resetHealth();
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(addServer({ url: 'http://srv:8090' }).id);
  fetchFn = mockFetch((url) => ({ body: url.indexOf('/search/') >= 0 && url.indexOf('/torznab/') < 0 ? JSON.stringify([TS_ROW]) : '[]' }));
  savePhoneLink(PH);
});

afterEach(() => {
  setRpcTransport(null);
  forgetPhoneLink();
  phoneStatus.value = 'unknown';
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const tsAsked = () => fetchFn.mock.calls.some((c) => String(c[0]).indexOf('/search/?query=Dune') >= 0);

describe('startTvSearch', () => {
  it('phone path: polls until done, rows carry via', async () => {
    useScript({
      search: [{ handle: 'h1', sourceIds: ['rutracker', 'nnmclub'] }],
      searchPoll: [
        { rev: 2, done: false, pending: ['nnmclub'], answered: ['rutracker'], failed: [], results: [phoneRow('1', 'Dune 2021')] },
        { rev: 3, done: true, pending: [], answered: ['rutracker', 'nnmclub'], failed: [], results: [phoneRow('1', 'Dune 2021'), phoneRow('2', 'Dune Part Two')] },
      ],
    });
    const start = await startTvSearch('Dune');
    expect(start.note).toBe('');
    expect(start.handle.by).toBe('phone');
    expect(start.handle.sourceIds).toEqual(['rutracker', 'nnmclub']);
    expect(start.handle.pending()).toEqual(['rutracker', 'nnmclub']);
    const fired = vi.fn();
    start.handle.subscribe(fired);
    let settled = false;
    start.handle.done.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(1600);
    const rows = start.handle.results();
    expect(rows.map((r) => r.Title)).toEqual(['Dune 2021', 'Dune Part Two']);
    expect(rows[0].via).toEqual({ handle: 'h1', key: '1' });
    expect(rows[0].date).toBe(new Date(2024, 2, 1).getTime());
    expect(rows[0].groupKey).toBe('phone:h1:1');
    expect(fired).toHaveBeenCalled();
    expect(settled).toBe(true);
    expect(start.handle.pending()).toEqual([]);
    expect(calls.filter((c) => c.method === 'searchPoll').map((c) => c.params)).toEqual([{ handle: 'h1', rev: 0 }, { handle: 'h1', rev: 2 }]);
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(count('searchPoll')).toBe(2);
    expect(tsAsked()).toBe(false);
  });

  it('phone down at start: TorrServer with the phoneDown note', async () => {
    useScript({ search: [new Error('timeout')] });
    const start = await startTvSearch('Dune');
    expect(start.note).toBe('phoneDown');
    expect(start.handle.by).toBe('torrserver');
    await vi.advanceTimersByTimeAsync(10);
    await start.handle.done;
    expect(tsAsked()).toBe(true);
    expect(start.handle.results().map((r) => r.Title)).toContain('Dune 2021 TS');
  });

  it('no phone: noPhone without a request', async () => {
    forgetPhoneLink();
    useScript({});
    const start = await startTvSearch('Dune');
    expect(start.note).toBe('noPhone');
    expect(start.handle.by).toBe('torrserver');
    expect(calls).toEqual([]);
  });

  it('two failed polls mid-search: TorrServer joins, rows of both', async () => {
    useScript({
      search: [{ handle: 'h2', sourceIds: ['rutracker', 'nnmclub'] }],
      searchPoll: [
        { rev: 2, done: false, pending: ['nnmclub'], answered: ['rutracker'], failed: [], results: [phoneRow('1', 'Dune 2021')] },
        new Error('network'),
        new Error('timeout'),
      ],
    });
    const start = await startTvSearch('Dune');
    let settled = false;
    start.handle.done.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(tsAsked()).toBe(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(settled).toBe(true);
    const h = start.handle;
    expect(h.by).toBe('phone');
    expect(h.results().map((r) => r.Title).sort()).toEqual(['Dune 2021', 'Dune 2021 TS']);
    expect(h.failed()).toContain('nnmclub');
    expect(h.failures()[0]).toEqual({ id: 'phone', message: '' });
    expect(h.sourceIds).toContain('ts-rutor');
    const polls = count('searchPoll');
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(count('searchPoll')).toBe(polls);
  });

  it('expired poll ends the search with the rows so far', async () => {
    useScript({
      search: [{ handle: 'h3', sourceIds: ['rutracker', 'nnmclub'] }],
      searchPoll: [
        { rev: 2, done: false, pending: ['nnmclub'], answered: ['rutracker'], failed: [], results: [phoneRow('1', 'Dune 2021')] },
        '{"ok":false,"error":{"code":"expired"}}',
      ],
    });
    const start = await startTvSearch('Dune');
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    await start.handle.done;
    expect(start.handle.results().map((r) => r.Title)).toEqual(['Dune 2021']);
    expect(start.handle.pending()).toEqual([]);
    expect(tsAsked()).toBe(false);
  });

  it('cancel sends searchCancel and stops polling', async () => {
    useScript({
      search: [{ handle: 'h4', sourceIds: ['rutracker'] }],
      searchPoll: [{ rev: 2, done: false, pending: ['rutracker'], answered: [], failed: [] }],
      searchCancel: [{}],
    });
    const start = await startTvSearch('Dune');
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(count('searchPoll')).toBe(1);
    start.handle.cancel();
    await start.handle.done;
    expect(calls.filter((c) => c.method === 'searchCancel').map((c) => c.params)).toEqual([{ handle: 'h4' }]);
    await vi.advanceTimersByTimeAsync(POLL_MS * 5);
    expect(count('searchPoll')).toBe(1);
  });

  it('cancel after done keeps the phone search: no searchCancel, rows still resolve', async () => {
    useScript({
      search: [{ handle: 'h6', sourceIds: ['rutracker'] }],
      searchPoll: [{ rev: 2, done: true, pending: [], answered: ['rutracker'], failed: [], results: [phoneRow('1', 'Dune 2021')] }],
      searchCancel: [{}],
      resolve: [{ link: 'magnet:?xt=urn:btih:' + HASH }],
    });
    const start = await startTvSearch('Dune');
    await vi.advanceTimersByTimeAsync(POLL_MS);
    await start.handle.done;
    start.handle.cancel();
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(count('searchCancel')).toBe(0);
    expect(count('searchPoll')).toBe(1);
    const row = start.handle.results()[0];
    await expect(resolveTvResult(row)).resolves.toBe('magnet:?xt=urn:btih:' + HASH);
    expect(calls.filter((c) => c.method === 'resolve').map((c) => c.params)).toEqual([{ handle: 'h6', key: '1' }]);
  });

  it('after the fallback a release found by both keeps only the TorrServer row', async () => {
    useScript({
      search: [{ handle: 'h7', sourceIds: ['rutracker', 'nnmclub'] }],
      searchPoll: [
        { rev: 2, done: false, pending: ['nnmclub'], answered: ['rutracker'], failed: [], results: [{ ...phoneRow('1', 'Dune 2021 phone'), Hash: HASH.toUpperCase() }, phoneRow('2', 'Dune 2021')] },
        new Error('network'),
        new Error('network'),
      ],
    });
    const start = await startTvSearch('Dune');
    await vi.advanceTimersByTimeAsync(POLL_MS * 3 + 10);
    await start.handle.done;
    const titles = start.handle.results().map((r) => r.Title).sort();
    expect(titles).toEqual(['Dune 2021', 'Dune 2021 TS']);
    expect(start.handle.results().filter((r) => r.Title === 'Dune 2021 TS')[0].via).toBeUndefined();
  });

  it('phone source failures pass through with their codes', async () => {
    useScript({
      search: [{ handle: 'h5', sourceIds: ['rutracker', 'kinozal'] }],
      searchPoll: [{ rev: 2, done: true, pending: [], answered: ['rutracker'], failed: [{ id: 'kinozal', message: 'Sign in', code: 'login' }], results: [] }],
    });
    const start = await startTvSearch('Dune');
    await vi.advanceTimersByTimeAsync(POLL_MS);
    await start.handle.done;
    expect(start.handle.failed()).toEqual(['kinozal']);
    expect(start.handle.failures()).toEqual([{ id: 'kinozal', message: 'Sign in', code: 'login' }]);
  });
});

describe('resolveTvResult', () => {
  const viaRow = { Title: 'Dune', Size: '', Seed: 0, Peer: 0, Tracker: '', CreateDate: '', Categories: '', Link: '', Magnet: '', Hash: '', source: 'rutracker', via: { handle: 'h1', key: '7' } } as TvResult;

  it('retries while pending, then gives the link', async () => {
    useScript({ resolve: [{ pending: true }, { pending: true }, { link: 'magnet:?xt=urn:btih:' + HASH }] });
    const p = resolveTvResult(viaRow);
    await vi.advanceTimersByTimeAsync(3000);
    await expect(p).resolves.toBe('magnet:?xt=urn:btih:' + HASH);
    expect(count('resolve')).toBe(3);
    expect(calls[0].params).toEqual({ handle: 'h1', key: '7' });
  });

  it('a row with a magnet resolves without an RPC', async () => {
    useScript({});
    await expect(resolveTvResult({ ...viaRow, Magnet: 'magnet:?xt=urn:btih:' + HASH })).resolves.toBe('magnet:?xt=urn:btih:' + HASH);
    expect(calls).toEqual([]);
  });

  it('times out after 4 pending answers; expired and failed pass their codes', async () => {
    useScript({ resolve: [{ pending: true }] });
    const caught = resolveTvResult(viaRow).catch((e) => e);
    await vi.advanceTimersByTimeAsync(6000);
    expect(await caught).toMatchObject({ code: 'timeout' });
    expect(count('resolve')).toBe(4);
    useScript({ resolve: ['{"ok":false,"error":{"code":"expired"}}'] });
    await expect(resolveTvResult(viaRow)).rejects.toMatchObject({ code: 'expired' });
    useScript({ resolve: ['{"ok":false,"error":{"code":"failed","message":"only a file"}}'] });
    await expect(resolveTvResult(viaRow)).rejects.toMatchObject({ code: 'failed', message: 'only a file' });
  });
});
