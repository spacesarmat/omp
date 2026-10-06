import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRpcHandler, RpcError } from '../src/rpc/handler';
import { addSubscription, addFindings, loadFound, loadSubs } from '../../src/monitor/subs';
import { BETTER_ID, EPISODES_ID } from '../../src/monitor/types';
import { stashFile } from '../../src/api/torrentFiles';
import * as sourceStore from '../../src/sources/store';

const deps = () => ({
  sources: () => [], ctx: () => ({} as never), now: () => 1_000,
  checkSubscription: vi.fn(() => Promise.resolve({ findings: [], first: false, answered: 1, failed: 0 })),
});
const row = (t: string) => ({ Title: t, Size: '1 GB', Seed: 5, Peer: 1, Tracker: 'rutor', Magnet: 'magnet:?xt=urn:btih:' + 'a'.repeat(40), Hash: 'a'.repeat(40), source: 'rutor', CreateDate: '' });

beforeEach(() => localStorage.clear());

describe('monitor RPC', () => {
  it('subs lists subscriptions with unseen counts', async () => {
    const s = addSubscription({ query: 'Дюна', quality: '', sources: null, notify: true }, 1)!;
    addFindings([{ subId: s.id, key: 'k1', result: row('Дюна 2160p') as never, at: 2 }]);
    const rpc = createRpcHandler(deps() as never);
    const r = await rpc.dispatch('subs', {}) as { subs: { id: string; unseen: number }[] };
    expect(r.subs).toEqual([expect.objectContaining({ id: s.id, unseen: 1, checking: false })]);
  });
  it('feed returns findings newest first with kinds', async () => {
    addFindings([{ subId: EPISODES_ID, key: 'h:2:5', result: row('S02E05') as never, at: 5, episodes: { torrentHash: 'h', torrentTitle: 'X', season: 2, haveTo: 4, to: 5 } }]);
    addFindings([{ subId: BETTER_ID, key: 'h2:3', result: row('4K') as never, at: 9, better: { torrentHash: 'h2', torrentTitle: 'Y', have: '1080p', got: '4K' } }]);
    const rpc = createRpcHandler(deps() as never);
    const f = await rpc.dispatch('feed', {}) as { findings: { kind: string; title: string; result: { key: string } }[]; lastRun: number | null };
    expect(f.findings.map((x) => x.kind)).toEqual(['better', 'episodes']);
    expect(f.findings.map((x) => x.title)).toEqual(['Y', 'X']);
    expect(f.findings[0].result.key).toBe('h2:3');
    expect(f.lastRun).toBeNull();
  });
  it('subSet and subRemove change the store', async () => {
    const s = addSubscription({ query: 'A', quality: '', sources: null, notify: true }, 1)!;
    const rpc = createRpcHandler(deps() as never);
    await rpc.dispatch('subSet', { id: s.id, notify: false });
    expect(loadSubs()[0].notify).toBe(false);
    await rpc.dispatch('subRemove', { id: s.id });
    expect(loadSubs()).toHaveLength(0);
  });
  it('wantAdd creates once, then returns the same subscription', async () => {
    const rpc = createRpcHandler(deps() as never);
    const a = await rpc.dispatch('wantAdd', { query: 'Аватар 2025' }) as { created: boolean; sub: { id: string; better: boolean } };
    const b = await rpc.dispatch('wantAdd', { query: 'аватар  2025' }) as { created: boolean; sub: { id: string } };
    expect(a.created).toBe(true); expect(a.sub.better).toBe(true);
    expect(b.created).toBe(false); expect(b.sub.id).toBe(a.sub.id);
  });
  it('subCheck starts a check and reports checking until it ends', async () => {
    let done!: () => void;
    const d = deps(); d.checkSubscription = vi.fn(() => new Promise((r) => { done = () => r({ findings: [], first: false, answered: 1, failed: 0 }); })) as never;
    const s = addSubscription({ query: 'A', quality: '', sources: null, notify: true }, 1)!;
    const rpc = createRpcHandler(d as never);
    expect(await rpc.dispatch('subCheck', { id: s.id })).toEqual({ started: true });
    expect(((await rpc.dispatch('subs', {})) as { subs: { checking: boolean }[] }).subs[0].checking).toBe(true);
    done(); await Promise.resolve(); await Promise.resolve();
    expect(((await rpc.dispatch('subs', {})) as { subs: { checking: boolean }[] }).subs[0].checking).toBe(false);
  });
  it('bad params are bad_request', async () => {
    const rpc = createRpcHandler(deps() as never);
    await expect(rpc.dispatch('subRemove', {})).rejects.toBeInstanceOf(RpcError);
  });
  it('findingLink resolves a stored finding and refuses a phone-only .torrent', async () => {
    addFindings([{ subId: 's1', key: 'k1', result: row('A') as never, at: 1 }, { subId: 's1', key: 'k2', result: row('B') as never, at: 2 }]);
    const resolve = vi.fn((r: { Title: string }) => Promise.resolve(r.Title === 'A' ? 'magnet:?xt=urn:btih:' + 'b'.repeat(40) : stashFile(new Uint8Array([1]) as never)));
    const rpc = createRpcHandler({ ...deps(), resolve } as never);
    expect(await rpc.dispatch('findingLink', { subId: 's1', key: 'k1' })).toEqual({ link: 'magnet:?xt=urn:btih:' + 'b'.repeat(40) });
    await expect(rpc.dispatch('findingLink', { subId: 's1', key: 'k2' })).rejects.toMatchObject({ code: 'failed' });
    await expect(rpc.dispatch('findingLink', { subId: 's1', key: 'nope' })).rejects.toMatchObject({ code: 'bad_request' });
  });
  it('findingsSeen marks findings seen', async () => {
    const s = addSubscription({ query: 'A', quality: '', sources: null, notify: true }, 1)!;
    addFindings([{ subId: s.id, key: 'k1', result: row('A') as never, at: 1 }]);
    const rpc = createRpcHandler(deps() as never);
    expect(await rpc.dispatch('findingsSeen', { subId: s.id })).toEqual({ ok: true });
    expect(((await rpc.dispatch('subs', {})) as { subs: { unseen: number }[] }).subs[0].unseen).toBe(0);
  });
  it('subCheck re-reads the source prefs and searches the searchable sources only', async () => {
    const reload = vi.spyOn(sourceStore, 'reloadSourcePrefs');
    const builtin = { id: 'rutor', name: 'Rutor', kind: 'builtin', search: vi.fn() };
    const ts = { id: 'ts-rutor', name: 'Rutor', kind: 'torrserver', search: vi.fn() };
    const d = { ...deps(), sources: vi.fn(() => [builtin, ts]) };
    const s = addSubscription({ query: 'A', quality: '', sources: null, notify: true }, 1)!;
    const rpc = createRpcHandler(d as never);
    await rpc.dispatch('subCheck', { id: s.id });
    expect(reload).toHaveBeenCalled();
    expect(d.sources).toHaveBeenCalled();
    expect(d.checkSubscription).toHaveBeenCalledWith(expect.objectContaining({ id: s.id }), [builtin]);
    reload.mockRestore();
  });
  it('subRemove leaves the reserved episodes / better findings alone', async () => {
    addFindings([{ subId: EPISODES_ID, key: 'h:2:5', result: row('S02E05') as never, at: 5, episodes: { torrentHash: 'h', torrentTitle: 'X', season: 2, haveTo: 4, to: 5 } }]);
    addFindings([{ subId: BETTER_ID, key: 'h2:3', result: row('4K') as never, at: 9, better: { torrentHash: 'h2', torrentTitle: 'Y', have: '1080p', got: '4K' } }]);
    const rpc = createRpcHandler(deps() as never);
    expect(await rpc.dispatch('subRemove', { id: EPISODES_ID })).toEqual({ removed: true });
    expect(await rpc.dispatch('subRemove', { id: BETTER_ID })).toEqual({ removed: true });
    expect(loadFound().map((f) => f.subId).sort()).toEqual([BETTER_ID, EPISODES_ID].sort());
  });
});
