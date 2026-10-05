import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  applyRemoteSources,
  buildTransferPayload,
  MAX_TRANSFER_BYTES,
  parseRemoteSources,
  transferBytes,
  validateTransferPayload,
  withoutNewParts,
} from '../../src/sources/transfer';
import { flareSolverrUrl, setFlareSolverrUrl } from '../../src/sources/flareStore';
import { isCloudflareBypassOn, reloadSourcePrefs, setCloudflareBypass } from '../../src/sources/store';
import type { Source, SourceContext } from '../../src/sources/types';

const src = (id: string, cloudflare?: boolean): Source => ({ id, name: id, kind: 'builtin', cloudflare, search: () => Promise.resolve([]) });
const kinozal = src('kinozal', true);
const rustorka = src('rustorka', true);
const rutor = src('rutor');
const ctx = (): SourceContext => ({ http: { get: () => Promise.reject(new Error('x')), post: () => Promise.reject(new Error('x')), clearCookies: () => Promise.resolve() }, client: null });

beforeEach(() => {
  localStorage.clear();
  reloadSourcePrefs();
});
afterEach(() => localStorage.clear());

describe('«Передать на телевизор»: FlareSolverr and the Cloudflare switches', () => {
  it('the payload carries every Cloudflare site\'s switch and the FlareSolverr address', () => {
    setCloudflareBypass('kinozal', true);
    const p = buildTransferPayload([kinozal, rustorka, rutor], null, undefined, '192.168.1.191');
    expect(p.cloudflare).toEqual({ kinozal: true, rustorka: false });
    expect(p.flaresolverr).toBe('http://192.168.1.191:8191');
    expect(validateTransferPayload(p)).toEqual(p);
    // nothing behind Cloudflare, no FlareSolverr: the parts are left out
    const bare = buildTransferPayload([rutor], null);
    expect(bare.cloudflare).toBeUndefined();
    expect(bare.flaresolverr).toBeUndefined();
    expect(withoutNewParts({ ...p, rutracker: { username: 'u', password: 'p' } })).toEqual({ v: 1, sources: p.sources, rutracker: { username: 'u', password: 'p' } });
  });

  it('the same schema as the TV: refused shapes', () => {
    const base = { v: 1, sources: { rutor: true } };
    for (const bad of [
      { flaresolverr: 'http://h:8191/' },
      { flaresolverr: 'HTTP://h:8191' },
      { flaresolverr: 'h' },
      { flaresolverr: 'ftp://h' },
      { flaresolverr: 1 },
      { flaresolverr: 'http://h/' + 'x'.repeat(200) },
      { cloudflare: {} },
      { cloudflare: { Kinozal: true } },
      { cloudflare: { kinozal: 'yes' } },
      { cloudflare: [] },
    ]) {
      expect(validateTransferPayload({ ...base, ...bad })).toBeNull();
    }
    expect(validateTransferPayload({ ...base, flaresolverr: 'http://h:8191', cloudflare: { kinozal: false } })).not.toBeNull();
  });

  it('the largest valid body with the new parts fits the limit', () => {
    const sources: { [id: string]: boolean } = {};
    const cloudflare: { [id: string]: boolean } = {};
    for (let i = 0; i < 40; i++) {
      sources['indexer-prowlarr-' + String(i).padStart(23, '0')] = true;
      cloudflare['site-' + String(i).padStart(35, '0')] = false;
    }
    const indexers = [];
    for (let i = 1; i <= 20; i++) indexers.push({ kind: 'jackett', url: 'http://192.168.1.' + i + ':9117/' + 'p'.repeat(170), key: 'k'.repeat(200), name: 'н'.repeat(40) });
    const p = {
      v: 1,
      sources,
      rutracker: { username: 'u'.repeat(100), password: 'п'.repeat(200) },
      indexers,
      flaresolverr: 'http://192.168.100.200:8191/' + 'f'.repeat(172),
      cloudflare,
    };
    expect(p.flaresolverr.length).toBe(200);
    expect(transferBytes(p)).toBeLessThanOrEqual(MAX_TRANSFER_BYTES);
    expect(validateTransferPayload(p)).not.toBeNull();
  });

  it('the TV applies them: switches of the sites it knows to be behind Cloudflare, the FlareSolverr address', async () => {
    const r = parseRemoteSources({
      id: 's1',
      sources: { rutor: true },
      rutracker: false,
      phone: 'Pixel 8',
      at: 0,
      flaresolverr: 'http://192.168.1.191:8191',
      cloudflare: { kinozal: true, rustorka: false, rutor: true, unknown: true },
    });
    expect(r).not.toBeNull();
    setCloudflareBypass('rustorka', true);
    await applyRemoteSources(r!, [kinozal, rustorka, rutor], ctx);
    expect(isCloudflareBypassOn(kinozal)).toBe(true);
    expect(isCloudflareBypassOn(rustorka)).toBe(false);
    expect(JSON.parse(localStorage.getItem('tsp.sources')!).rutor).toEqual({ on: true });
    expect(flareSolverrUrl()).toBe('http://192.168.1.191:8191');
    // a malformed event part is refused as a whole
    expect(parseRemoteSources({ id: 's2', sources: { rutor: true }, flaresolverr: 'javascript:x' })).toBeNull();
    expect(parseRemoteSources({ id: 's2', sources: { rutor: true }, cloudflare: { 'Bad Id': true } })).toBeNull();
  });

  it('a transfer without the parts keeps the TV\'s own FlareSolverr', async () => {
    setFlareSolverrUrl('http://10.0.0.5:8191');
    const r = parseRemoteSources({ id: 's3', sources: { rutor: true }, rutracker: false, phone: 'P', at: 0 })!;
    await applyRemoteSources(r, [rutor], ctx);
    expect(flareSolverrUrl()).toBe('http://10.0.0.5:8191');
  });
});
