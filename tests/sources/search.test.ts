import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CLOUDFLARE_TIMEOUT_MS, searchAll, SOURCE_TIMEOUT_MS } from '../../src/sources/search';
import { getHealth, resetHealth, reloadSourcePrefs, setCloudflareBypass, setSourceOn } from '../../src/sources/store';
import { loginRequired, isLoginRequired } from '../../src/sources/types';
import type { Source, SourceContext, SourceResult } from '../../src/sources/types';

const ctx: SourceContext = {
  http: { get: () => Promise.reject(new Error('no')), post: () => Promise.reject(new Error('no')), clearCookies: () => Promise.resolve() },
  client: null,
};

function res(source: string, Title: string, Seed: number, hash?: string): SourceResult {
  return { Title, Categories: '', Size: '', CreateDate: '', Tracker: source, Link: '', Magnet: '', Hash: '', Peer: 0, Seed, source, hash };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

function source(id: string, impl: (q: string) => Promise<SourceResult[]>, needsLogin?: boolean): Source {
  return { id, name: id, kind: 'builtin', needsLogin, search: (q) => impl(q) };
}

beforeEach(() => { localStorage.clear(); reloadSourcePrefs(); resetHealth(); vi.useFakeTimers(); vi.setSystemTime(1000); });
afterEach(() => { vi.useRealTimers(); });

describe('searchAll', () => {
  it('a site passing Cloudflare checks gets the long timeout; the others answer meanwhile', async () => {
    const slow = deferred<SourceResult[]>();
    setCloudflareBypass('cf', true);
    setCloudflareBypass('cf2', true);
    const cf: Source = { ...source('cf', () => slow.promise), cloudflare: true };
    const events: string[] = [];
    const h = searchAll('q', {
      ctx,
      from: [cf, source('fast', () => Promise.resolve([res('fast', 'F', 1)]))],
      onResult: (id) => events.push('result:' + id),
      onDone: (id, err) => events.push('done:' + id + (err ? ':' + err.message : '')),
    });
    await vi.advanceTimersByTimeAsync(0);
    // the fast source's results are there right away
    expect(events).toEqual(['result:fast', 'done:fast']);
    expect(h.results().map((r) => r.Title)).toEqual(['F']);
    await vi.advanceTimersByTimeAsync(SOURCE_TIMEOUT_MS + 1000);
    expect(h.pending()).toEqual(['cf']);
    // a late answer (the check passed) still streams in
    slow.resolve([res('cf', 'Late', 5)]);
    await h.done;
    expect(events).toEqual(['result:fast', 'done:fast', 'result:cf', 'done:cf']);
    expect(h.results().map((r) => r.Title).sort()).toEqual(['F', 'Late']);

    // still bounded
    const never = deferred<SourceResult[]>();
    const h2 = searchAll('q', { ctx, from: [{ ...source('cf2', () => never.promise), cloudflare: true }] });
    await vi.advanceTimersByTimeAsync(CLOUDFLARE_TIMEOUT_MS - 1);
    expect(h2.pending()).toEqual(['cf2']);
    await vi.advanceTimersByTimeAsync(2);
    expect(h2.failed()).toEqual(['cf2']);

    // the switch off, or a switch saved for a site that is not behind Cloudflare: the normal timeout
    setCloudflareBypass('cf4', true);
    const h3 = searchAll('q', { ctx, from: [{ ...source('cf3', () => never.promise), cloudflare: true }, source('cf4', () => never.promise)] });
    await vi.advanceTimersByTimeAsync(SOURCE_TIMEOUT_MS + 1);
    expect(h3.failed().sort()).toEqual(['cf3', 'cf4']);
  });

  it('runs sources in parallel, streams results and merges them', async () => {
    const a = deferred<SourceResult[]>();
    const b = deferred<SourceResult[]>();
    const queries: string[] = [];
    const events: string[] = [];
    const h = searchAll('matrix', {
      ctx,
      from: [
        source('a', (q) => { queries.push('a:' + q); return a.promise; }),
        source('b', (q) => { queries.push('b:' + q); return b.promise; }),
      ],
      onResult: (id, list) => events.push('result:' + id + ':' + list.length),
      onDone: (id, err) => events.push('done:' + id + (err ? ':err' : '')),
    });
    expect(queries).toEqual(['a:matrix', 'b:matrix']);
    expect(h.pending()).toEqual(['a', 'b']);
    vi.setSystemTime(1800);
    b.resolve([res('b', 'X', 3, 'h1'), res('b', 'Y', 1)]);
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toEqual(['result:b:2', 'done:b']);
    expect(h.pending()).toEqual(['a']);
    expect(h.results().map((r) => r.Title)).toEqual(['X', 'Y']);
    expect(getHealth('b')).toEqual({ state: 'ok', ms: 800, at: 1800 });
    a.resolve([res('a', 'X again', 10, 'h1')]);
    await h.done;
    expect(events).toEqual(['result:b:2', 'done:b', 'result:a:1', 'done:a']);
    const merged = h.results();
    expect(merged).toHaveLength(2);
    expect(merged[0].source).toBe('a');
    expect(merged[0].sources).toEqual(['b']);
    expect(h.answered()).toEqual(['b', 'a']);
    expect(h.failed()).toEqual([]);
    expect(h.sourceIds).toEqual(['a', 'b']);
  });

  it('a source over 15 s is reported as failed and its late answer ignored', async () => {
    const slow = deferred<SourceResult[]>();
    const done: { id: string; err?: string }[] = [];
    const results: string[] = [];
    const h = searchAll('q', {
      ctx,
      from: [source('slow', () => slow.promise)],
      onResult: (id) => results.push(id),
      onDone: (id, err) => done.push({ id, err: err && err.message }),
    });
    await vi.advanceTimersByTimeAsync(SOURCE_TIMEOUT_MS - 1);
    expect(done).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(SOURCE_TIMEOUT_MS).toBe(15000);
    expect(done).toEqual([{ id: 'slow', err: 'Источник не отвечает' }]);
    expect(getHealth('slow')!.state).toBe('error');
    expect(getHealth('slow')!.message).toBe('Источник не отвечает');
    await h.done;
    slow.resolve([res('slow', 'late', 1)]);
    await vi.advanceTimersByTimeAsync(0);
    expect(results).toEqual([]);
    expect(h.results()).toEqual([]);
    expect(done).toHaveLength(1);
  });

  it('errors and login-required are reported and recorded in health', async () => {
    const done: { id: string; err?: string }[] = [];
    const h = searchAll('q', {
      ctx,
      from: [
        source('broken', () => Promise.reject(new Error('boom'))),
        source('thrower', () => { throw new Error('sync'); }),
        source('locked', () => Promise.reject(loginRequired())),
      ],
      onDone: (id, err) => done.push({ id, err: err && err.message }),
    });
    await h.done;
    expect(done.map((d) => d.id).sort()).toEqual(['broken', 'locked', 'thrower']);
    expect(getHealth('broken')!.state).toBe('error');
    expect(getHealth('broken')!.message).toBe('boom');
    expect(getHealth('thrower')!.state).toBe('error');
    expect(getHealth('locked')!.state).toBe('login');
    expect(getHealth('locked')!.message).toBeUndefined();
    expect(h.failed().sort()).toEqual(['broken', 'locked', 'thrower']);
    expect(h.pending()).toEqual([]);
    expect(isLoginRequired(loginRequired())).toBe(true);
    expect(isLoginRequired(new Error('x'))).toBe(false);
  });

  it('defaults to the enabled sources and accepts ids', async () => {
    setSourceOn('off', false);
    const called: string[] = [];
    const all = [
      source('on', () => { called.push('on'); return Promise.resolve([]); }),
      source('off', () => { called.push('off'); return Promise.resolve([]); }),
      source('login', () => { called.push('login'); return Promise.resolve([]); }, true),
    ];
    await searchAll('q', { ctx, from: all }).done;
    expect(called).toEqual(['on']);
    called.length = 0;
    await searchAll('q', { ctx, from: all, sources: ['off', 'login'] }).done;
    expect(called).toEqual(['off', 'login']);
  });

  it('cancel stops callbacks', async () => {
    const d = deferred<SourceResult[]>();
    const seen: string[] = [];
    const h = searchAll('q', { ctx, from: [source('a', () => d.promise)], onResult: (id) => seen.push(id), onDone: (id) => seen.push('done ' + id) });
    h.cancel();
    d.resolve([res('a', 'X', 1)]);
    await vi.advanceTimersByTimeAsync(20000);
    await h.done;
    expect(seen).toEqual([]);
    expect(h.results()).toEqual([]);
  });

  it('with no sources resolves at once', async () => {
    const h = searchAll('q', { ctx, from: [] });
    await h.done;
    expect(h.results()).toEqual([]);
  });
});
