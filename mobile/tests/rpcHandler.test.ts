import { describe, it, expect, vi } from 'vitest';
import { createRpcHandler, RpcError, MAX_RESULTS } from '../src/rpc/handler';
import { setSourceOn, reloadSourcePrefs, setHealth, resetHealth } from '../../src/sources/store';

const src = (id: string, extra = {}) => ({ id, name: id, kind: 'builtin', search: vi.fn(), ...extra }) as never;
const ts = { id: 'ts-rutor', name: 'Rutor', kind: 'torrserver', search: vi.fn() } as never;
const row = (i: number, p = {}) => ({ Title: 'Dune ' + i, Categories: '', Size: '1 GB', CreateDate: '', Tracker: 'x', Link: 'https://x/dl/' + i,
  Magnet: '', Hash: '', Peer: 0, Seed: i, source: 'nnmclub', detailUrl: 'https://nnm/t=' + i, ...p });

function fakeSearch(rows: unknown[]) {
  let cb: { onResult?: (id: string, r: unknown[]) => void; onDone?: (id: string, e?: Error) => void } = {};
  const h = { sourceIds: ['nnmclub'], results: () => rows, pending: () => [] as string[], answered: () => ['nnmclub'], failed: () => [] as string[],
    done: Promise.resolve(), cancel: vi.fn() };
  const search = vi.fn((_q: string, o: typeof cb) => { cb = o; return h; });
  return { search, h, fire: () => { cb.onResult && cb.onResult('nnmclub', rows); cb.onDone && cb.onDone('nnmclub'); } };
}
const deps = (over = {}) => ({ sources: () => [src('nnmclub'), src('rutracker', { needsLogin: true }), ts], ctx: () => ({}) as never, now: () => 0, ...over });

describe('rpc handler', () => {
  it('sources skips TorrServer ones and reports off/login', async () => {
    const r = (await createRpcHandler(deps()).dispatch('sources', {})) as { sources: { id: string; state: string }[] };
    expect(r.sources.map((s) => s.id)).toEqual(['nnmclub', 'rutracker']);
    expect(r.sources[1].state).toBe('off');           // needsLogin => off by default
  });
  it('search + poll returns trimmed rows once per rev', async () => {
    const f = fakeSearch([row(1, { Magnet: 'magnet:?xt=urn:btih:' + 'a'.repeat(40) })]);
    const rpc = createRpcHandler(deps({ search: f.search }));
    const { handle } = (await rpc.dispatch('search', { query: 'Dune' })) as { handle: string };
    f.fire();
    const p1 = (await rpc.dispatch('searchPoll', { handle })) as { rev: number; results: Record<string, unknown>[] };
    expect(p1.results[0].Link).toBeUndefined();
    expect(p1.results[0].detailUrl).toBeUndefined();
    expect(typeof p1.results[0].key).toBe('string');
    const p2 = (await rpc.dispatch('searchPoll', { handle, rev: p1.rev })) as { results?: unknown[] };
    expect(p2.results).toBeUndefined();
  });
  it('caps results', async () => {
    const f = fakeSearch(Array.from({ length: 400 }, (_, i) => row(i)));
    const rpc = createRpcHandler(deps({ search: f.search }));
    const { handle } = (await rpc.dispatch('search', { query: 'Dune' })) as { handle: string };
    f.fire();
    expect(((await rpc.dispatch('searchPoll', { handle })) as { results: unknown[] }).results.length).toBe(MAX_RESULTS);
  });
  it('rejects bad input and unknown methods', async () => {
    const rpc = createRpcHandler(deps());
    await expect(rpc.dispatch('search', { query: '' })).rejects.toMatchObject({ code: 'bad_request' });
    await expect(rpc.dispatch('rm', {})).rejects.toBeInstanceOf(RpcError);
    await expect(rpc.dispatch('searchPoll', { handle: 'nope' })).rejects.toMatchObject({ code: 'expired' });
    await expect(rpc.dispatch('setSourceEnabled', { id: 'ts-rutor', on: false })).rejects.toMatchObject({ code: 'bad_request' });
  });
  it('setSourceEnabled persists to tsp.sources', async () => {
    await createRpcHandler(deps()).dispatch('setSourceEnabled', { id: 'rutracker', on: true });
    reloadSourcePrefs();
    expect(JSON.parse(localStorage.getItem('tsp.sources') || '{}').rutracker.on).toBe(true);
    setSourceOn('rutracker', false);
  });
  it('resolve only for own rows, pending then link', async () => {
    vi.useFakeTimers();
    let done: (v: string) => void = () => undefined;
    const resolve = vi.fn(() => new Promise<string>((r) => { done = r; }));
    // the handler takes resolveLink through deps for tests: RpcDeps.resolve?: typeof resolveLink
    const f = fakeSearch([row(1)]);
    const rpc = createRpcHandler(deps({ search: f.search, resolve }));
    const { handle } = (await rpc.dispatch('search', { query: 'Dune' })) as { handle: string };
    f.fire();
    const key = ((await rpc.dispatch('searchPoll', { handle })) as { results: { key: string }[] }).results[0].key;
    const first = rpc.dispatch('resolve', { handle, key });
    await vi.advanceTimersByTimeAsync(3_600);
    expect(await first).toEqual({ pending: true });
    done('magnet:?xt=urn:btih:' + 'b'.repeat(40));
    expect(await rpc.dispatch('resolve', { handle, key })).toEqual({ link: 'magnet:?xt=urn:btih:' + 'b'.repeat(40) });
    expect(resolve).toHaveBeenCalledTimes(1);
    await expect(rpc.dispatch('resolve', { handle, key: 'other' })).rejects.toMatchObject({ code: 'bad_request' });
    vi.useRealTimers();
  });
});

describe('rpc handler: states, handles and failures', () => {
  it('sources reports health, login and loggedIn like the Sources screen', async () => {
    resetHealth();
    setHealth('nnmclub', { state: 'error', at: 1, message: 'Cloudflare blocks the site' });
    setHealth('kinozal', { state: 'error', at: 1, message: 'down' });
    setHealth('rutor', { state: 'ok', at: 1 });
    setSourceOn('rutracker', true);
    setSourceOn('kinozal', true);
    const list = [
      src('nnmclub'),
      src('rutracker', { needsLogin: true, loggedIn: () => Promise.resolve(false) }),
      src('kinozal', { needsLogin: true, loggedIn: () => Promise.resolve(true) }),
      src('rustorka', { loggedIn: () => Promise.resolve(true) }),
      src('rutor'),
      src('anidub'),
    ];
    const r = (await createRpcHandler(deps({ sources: () => list })).dispatch('sources', {})) as {
      sources: { id: string; state: string; message?: string; on: boolean }[];
    };
    const by = (id: string) => r.sources.filter((s) => s.id === id)[0];
    expect(by('nnmclub')).toMatchObject({ state: 'cloudflare', on: true });
    expect(by('rutracker').state).toBe('login');
    expect(by('kinozal')).toMatchObject({ state: 'error', message: 'down' });
    expect(by('rustorka').state).toBe('loggedIn');
    expect(by('rutor').state).toBe('ok');
    expect(by('anidub').state).toBe('unknown');
    setSourceOn('rutracker', false);
    setSourceOn('kinozal', false);
    resetHealth();
  });

  it('a loggedIn check that hangs counts as unknown after SOURCES_WAIT_MS', async () => {
    vi.useFakeTimers();
    const hang = src('rustorka', { loggedIn: () => new Promise(() => undefined) });
    const p = createRpcHandler(deps({ sources: () => [hang] })).dispatch('sources', {});
    await vi.advanceTimersByTimeAsync(3_600);
    expect(((await p) as { sources: { state: string }[] }).sources[0].state).toBe('unknown');
    vi.useRealTimers();
  });

  it('search passes only enabled, chosen, non-TorrServer sources', async () => {
    const f = fakeSearch([]);
    const rpc = createRpcHandler(deps({ search: f.search }));
    await rpc.dispatch('search', { query: '  Dune  ', sources: ['nnmclub', 'rutracker', 'ts-rutor'] });
    const [q, o] = f.search.mock.calls[0] as unknown as [string, { from: { id: string }[] }];
    expect(q).toBe('Dune');
    expect(o.from.map((s) => s.id)).toEqual(['nnmclub']);
    await expect(rpc.dispatch('search', { query: 'x'.repeat(201) })).rejects.toMatchObject({ code: 'bad_request' });
    await expect(rpc.dispatch('search', { query: 'Dune', sources: 'nnmclub' })).rejects.toMatchObject({ code: 'bad_request' });
  });

  it('a 4th handle cancels the oldest; cancel and TTL drop handles', async () => {
    let now = 0;
    const made: { cancel: ReturnType<typeof vi.fn> }[] = [];
    const search = vi.fn(() => {
      const h = { sourceIds: [], results: () => [], pending: () => [], answered: () => [], failed: () => [], done: Promise.resolve(), cancel: vi.fn() };
      made.push(h);
      return h;
    });
    const rpc = createRpcHandler(deps({ search, now: () => now }));
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push(((await rpc.dispatch('search', { query: 'q' + i })) as { handle: string }).handle);
    ids.forEach((id) => expect(id).toMatch(/^[0-9a-f]{16}$/));
    expect(made[0].cancel).toHaveBeenCalled();
    await expect(rpc.dispatch('searchPoll', { handle: ids[0] })).rejects.toMatchObject({ code: 'expired' });
    expect(await rpc.dispatch('searchCancel', { handle: ids[1] })).toEqual({});
    expect(made[1].cancel).toHaveBeenCalled();
    expect(await rpc.dispatch('searchCancel', { handle: 'nope' })).toEqual({});
    now = 10 * 60_000 + 1;
    await expect(rpc.dispatch('searchPoll', { handle: ids[2] })).rejects.toMatchObject({ code: 'expired' });
    rpc.dispose();
    expect(made[3].cancel).toHaveBeenCalled();
  });

  it('failed sources carry the health message and code', async () => {
    setHealth('rutor', { state: 'error', at: 1, message: 'code page', code: 'ipban' });
    setHealth('kinozal', { state: 'error', at: 1, message: 'Cloudflare' });
    const h = { sourceIds: ['rutor', 'kinozal'], results: () => [], pending: () => [], answered: () => [], failed: () => ['rutor', 'kinozal'], done: Promise.resolve(), cancel: vi.fn() };
    const rpc = createRpcHandler(deps({ search: () => h }));
    const { handle } = (await rpc.dispatch('search', { query: 'Dune' })) as { handle: string };
    const p = (await rpc.dispatch('searchPoll', { handle })) as { done: boolean; failed: unknown[] };
    expect(p.done).toBe(true);
    expect(p.failed).toEqual([
      { id: 'rutor', message: 'code page', code: 'ipban' },
      { id: 'kinozal', message: 'Cloudflare', code: 'cloudflare' },
    ]);
    resetHealth();
  });

  it('a failed resolve gives failed with the message', async () => {
    const f = fakeSearch([row(1)]);
    const rpc = createRpcHandler(deps({ search: f.search, resolve: () => Promise.reject(new Error('no link')) }));
    const { handle } = (await rpc.dispatch('search', { query: 'Dune' })) as { handle: string };
    const key = ((await rpc.dispatch('searchPoll', { handle })) as { results: { key: string }[] }).results[0].key;
    await expect(rpc.dispatch('resolve', { handle, key })).rejects.toMatchObject({ code: 'failed', message: 'no link' });
    await expect(rpc.dispatch('resolve', { handle: 'nope', key })).rejects.toMatchObject({ code: 'expired' });
  });
});
