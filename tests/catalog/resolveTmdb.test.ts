import { describe, it, expect, afterEach } from 'vitest';
import { resolveTmdbKey } from '../../src/catalog/resolveTmdb';
import { setLocalTmdbSource, type TmdbSource } from '../../src/catalog/localTmdb';
import type { TmdbSettingsRead } from '../../src/api/torrserver';

afterEach(() => setLocalTmdbSource(null));

function src(baseUrl: string, read: TmdbSettingsRead | (() => Promise<TmdbSettingsRead>)): TmdbSource {
  return {
    baseUrl: baseUrl,
    readTmdbSettings: () => (typeof read === 'function' ? read() : Promise.resolve(read)),
  };
}

const key = (api: string, extra?: { APIURL?: string }): TmdbSettingsRead => ({
  status: 'ok',
  config: { APIKey: api, APIURL: extra && extra.APIURL },
});

describe('resolveTmdbKey', () => {
  it('uses the active server key and does not ask the phone', async () => {
    let localReads = 0;
    const local = src('http://127.0.0.1:8090', () => {
      localReads++;
      return Promise.resolve(key('phone'));
    });
    const r = await resolveTmdbKey({
      active: src('http://192.168.1.191:5665', key('home', { APIURL: 'https://mirror.test' })),
      local: local,
      fallbackKey: 'built',
    });
    expect(r).toEqual({ status: 'ok', source: 'active', config: { APIKey: 'home', APIURL: 'https://mirror.test' } });
    expect(localReads).toBe(0);
  });

  it('uses the phone TorrServer when the active server has no key', async () => {
    const r = await resolveTmdbKey({
      active: src('http://home:5665', { status: 'ok', config: { APIKey: '' } }),
      local: src('http://127.0.0.1:8090', key('phone', { APIURL: 'https://phone.mirror' })),
      fallbackKey: 'built',
    });
    expect(r).toEqual({ status: 'ok', source: 'local', config: { APIKey: 'phone', APIURL: 'https://phone.mirror' } });
  });

  it('uses the phone key when the active server is unreachable', async () => {
    const r = await resolveTmdbKey({
      active: src('http://home:5665', { status: 'unreachable' }),
      local: src('http://127.0.0.1:8090', key('phone')),
      fallbackKey: '',
    });
    expect(r).toEqual({ status: 'ok', source: 'local', config: { APIKey: 'phone' } });
  });

  it('uses the built-in key when neither server has one', async () => {
    const r = await resolveTmdbKey({
      active: src('http://home:5665', { status: 'ok', config: {} }),
      local: src('http://127.0.0.1:8090', { status: 'ok', config: { APIKey: '  ' } }),
      fallbackKey: ' built ',
    });
    expect(r).toEqual({ status: 'ok', source: 'builtin', config: { APIKey: 'built' } });
  });

  it('says unreachable when the active server does not answer and nothing else has a key', async () => {
    const r = await resolveTmdbKey({
      active: src('http://home:5665', { status: 'unreachable' }),
      local: null,
      fallbackKey: '',
    });
    expect(r).toEqual({ status: 'unreachable' });
  });

  it('says nokey when the server answered without a key and there is no fallback', async () => {
    const r = await resolveTmdbKey({
      active: src('http://home:5665', { status: 'ok', config: { APIKey: '' } }),
      local: src('http://127.0.0.1:8090', { status: 'unreachable' }),
      fallbackKey: '',
    });
    expect(r).toEqual({ status: 'nokey' });
  });

  it('does not ask the phone server twice when it is the active one', async () => {
    let reads = 0;
    const phone = src('http://127.0.0.1:8090', () => {
      reads++;
      return Promise.resolve({ status: 'ok', config: { APIKey: '' } });
    });
    const r = await resolveTmdbKey({ active: phone, local: phone, fallbackKey: 'built' });
    expect(reads).toBe(1);
    expect(r.status).toBe('ok');
  });

  it('reads the registered phone server when local is omitted', async () => {
    setLocalTmdbSource(() => src('http://127.0.0.1:8090', key('reg')));
    const r = await resolveTmdbKey({ active: src('http://home:5665', { status: 'unreachable' }), fallbackKey: '' });
    expect(r).toEqual({ status: 'ok', source: 'local', config: { APIKey: 'reg' } });
  });
});
