import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setRpcTransport, phoneStatus } from '../../src/phone/rpc';
import { savePhoneLink, forgetPhoneLink } from '../../src/phone/phoneStore';
import { phoneFeed, phoneSubs, phoneSubCheck, phoneSubSet, phoneSubRemove, phoneWantAdd, phoneFindingLink, phoneFindingsSeen } from '../../src/phone/monitor';

const PH = { url: 'http://192.168.1.20:8097', token: 'a'.repeat(32), name: 'Pixel' };
beforeEach(() => savePhoneLink(PH));
afterEach(() => { vi.useRealTimers(); setRpcTransport(null); forgetPhoneLink(); phoneStatus.value = 'unknown'; });

const SUB = { id: 's1', query: 'dune', quality: '', notify: true, better: false, unseen: 0, checking: false, createdAt: 1 };

function reply(result: unknown, bodies: Array<{ method: string; params: unknown }>) {
  setRpcTransport((_u, body) => { bodies.push(JSON.parse(body)); return Promise.resolve(JSON.stringify({ ok: true, result: result })); });
}

describe('monitor wrappers', () => {
  it('feed and subs unwrap', async () => {
    const b: Array<{ method: string; params: unknown }> = [];
    reply({ findings: [], lastRun: 5 }, b);
    expect(await phoneFeed()).toEqual({ findings: [], lastRun: 5 });
    reply({ subs: [SUB] }, b);
    expect(await phoneSubs()).toEqual([SUB]);
    expect(b.map((x) => x.method)).toEqual(['feed', 'subs']);
  });
  it('subCheck / subRemove / findingsSeen send params', async () => {
    const b: Array<{ method: string; params: unknown }> = [];
    reply({ started: true }, b);
    await phoneSubCheck('s1');
    await phoneSubRemove('s1');
    await phoneFindingsSeen();
    await phoneFindingsSeen('s1', ['k']);
    expect(b).toEqual([
      { method: 'subCheck', params: { id: 's1' } },
      { method: 'subRemove', params: { id: 's1' } },
      { method: 'findingsSeen', params: {} },
      { method: 'findingsSeen', params: { subId: 's1', keys: ['k'] } },
    ]);
  });
  it('subSet and wantAdd', async () => {
    const b: Array<{ method: string; params: unknown }> = [];
    reply({ sub: SUB, created: true }, b);
    expect(await phoneSubSet('s1', { notify: false })).toEqual(SUB);
    expect(await phoneWantAdd('dune')).toEqual({ sub: SUB, created: true });
    expect(b).toEqual([
      { method: 'subSet', params: { id: 's1', notify: false } },
      { method: 'wantAdd', params: { query: 'dune' } },
    ]);
  });
});

describe('phoneFindingLink', () => {
  it('returns the link', async () => {
    const b: Array<{ method: string; params: unknown }> = [];
    reply({ link: 'magnet:?xt=urn:btih:abc' }, b);
    expect(await phoneFindingLink('s1', 'k')).toBe('magnet:?xt=urn:btih:abc');
    expect(b[0]).toEqual({ method: 'findingLink', params: { subId: 's1', key: 'k' } });
  });
  it('retries on pending then returns', async () => {
    vi.useFakeTimers();
    let n = 0;
    setRpcTransport(() => { n++; return Promise.resolve(JSON.stringify({ ok: true, result: n < 3 ? { pending: true } : { link: 'https://x/t.torrent' } })); });
    const p = phoneFindingLink('s1', 'k');
    await vi.advanceTimersByTimeAsync(2000);
    expect(await p).toBe('https://x/t.torrent');
    expect(n).toBe(3);
  });
  it('times out after 8 pendings', async () => {
    vi.useFakeTimers();
    let n = 0;
    setRpcTransport(() => { n++; return Promise.resolve('{"ok":true,"result":{"pending":true}}'); });
    const p = phoneFindingLink('s1', 'k');
    const assertion = expect(p).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(10000);
    await assertion;
    expect(n).toBe(8);
  });
  it('failed with tvFileOnly rejects with that message', async () => {
    setRpcTransport(() => Promise.resolve('{"ok":false,"error":{"code":"failed","message":"sources.tvFileOnly"}}'));
    await expect(phoneFindingLink('s1', 'k')).rejects.toMatchObject({ code: 'failed', message: 'sources.tvFileOnly' });
  });
});
