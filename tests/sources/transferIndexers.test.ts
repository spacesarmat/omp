import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  applyRemoteIndexers,
  applyRemoteSources,
  buildTransferPayload,
  MAX_TRANSFER_BYTES,
  parseRemoteSources,
  transferBytes,
  transferIndexers,
  validateTransferPayload,
  type TransferIndexer,
} from '../../src/sources/transfer';
import { indexerConnections, indexerKeyName, indexerPendingKeyName, reloadIndexers, type IndexerConn } from '../../src/sources/indexerStore';
import { isSourceOn, reloadSourcePrefs } from '../../src/sources/store';
import { applyRemoteSourcesEvent, resetRemoteSources } from '../../src/platform/androidRemote';
import { clearLog, logEntries } from '../../src/lib/log';
import type { SecretStore, Source, SourceContext } from '../../src/sources/types';

// test-only keys
const KEY = 'test0only0key0000000000000000abc';
const KEY2 = 'test0only0key0000000000000000def';

function memSecrets(init: { [k: string]: string } = {}) {
  const map: { [k: string]: string } = { ...init };
  const store: SecretStore = {
    get: (k) => Promise.resolve(Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null),
    set: (k, v) => {
      map[k] = v;
      return Promise.resolve();
    },
    delete: (k) => {
      delete map[k];
      return Promise.resolve();
    },
  };
  return { map, store };
}

const src = (id: string): Source => ({ id, name: id, kind: 'builtin', search: () => Promise.resolve([]) });

beforeEach(() => {
  localStorage.clear();
  reloadIndexers();
  reloadSourcePrefs();
  clearLog();
  resetRemoteSources();
});

const J: TransferIndexer = { kind: 'jackett', url: 'http://192.168.1.5:9117', key: KEY };
const P: TransferIndexer = { kind: 'prowlarr', url: 'http://192.168.1.7:9696', name: 'Дом' };

describe('transfer schema with indexers', () => {
  it('accepts connections with and without keys', () => {
    const p = validateTransferPayload({ v: 1, sources: { rutor: true }, indexers: [J, P] });
    expect(p!.indexers).toEqual([J, P]);
  });

  it('refuses invalid connections', () => {
    const bad: unknown[] = [
      [],
      [{ ...J, kind: 'sonarr' }],
      [{ ...J, url: 'http://192.168.1.5:9117/' }],
      [{ ...J, url: 'HTTP://Host:9117' }],
      [{ ...J, url: 'ftp://h' }],
      [{ ...J, url: 'http://h/' + 'x'.repeat(200) }],
      [{ ...J, key: 'has space' }],
      [{ ...J, key: '' }],
      [{ ...J, key: 'k'.repeat(201) }],
      [{ ...J, key: 'ключ' }],
      [{ ...J, apiKey: KEY }],
      [{ ...J, name: 'x'.repeat(41) }],
      [{ ...J, name: 'a\u0007b' }],
      [J, { ...J, key: KEY2 }],
      Array.from({ length: 21 }, (_, i) => ({ kind: 'jackett', url: 'http://192.168.1.' + (i + 1) + ':9117' })),
      'x',
    ];
    bad.forEach((indexers) => expect(validateTransferPayload({ v: 1, sources: { rutor: true }, indexers })).toBeNull());
  });

  it('the largest valid body fits the TV limit; an oversized one is refused', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ kind: 'jackett', url: 'http://192.168.1.' + (i + 1) + ':9117/' + 'p'.repeat(170), key: 'k'.repeat(200), name: 'н'.repeat(40) }));
    const sources: { [id: string]: boolean } = {};
    for (let i = 0; i < 40; i++) sources['indexer-prowlarr-' + String(i).padStart(23, '0')] = true;
    const largest = { v: 1, sources, rutracker: { username: 'u'.repeat(100), password: 'п'.repeat(200) }, indexers: many };
    expect(validateTransferPayload(largest)).not.toBeNull();
    expect(transferBytes(largest)).toBeLessThan(MAX_TRANSFER_BYTES);
    const p = { v: 1, sources: { rutor: true }, indexers: [J], pad: 'x'.repeat(MAX_TRANSFER_BYTES) };
    expect(transferBytes(p)).toBeGreaterThan(MAX_TRANSFER_BYTES);
    expect(validateTransferPayload(p)).toBeNull();
    // the usual size fits easily
    expect(transferBytes(buildTransferPayload([src('rutor')], null, [J, P]))).toBeLessThan(1000);
    expect(transferBytes({ s: 'я😀' })).toBe(JSON.stringify({ s: '' }).length + 2 + 4);
  });

  it('the phone reads keys only «вместе с ключами»; an unreadable key leaves that connection without it', async () => {
    const conns: IndexerConn[] = [
      { id: 'jackett-1', kind: 'jackett', url: J.url, keySet: true },
      { id: 'prowlarr-1', kind: 'prowlarr', url: P.url, keySet: true, name: 'Дом' },
      { id: 'jackett-2', kind: 'jackett', url: 'http://192.168.1.8:9117', keySet: false },
    ];
    const { store } = memSecrets({ [indexerKeyName('jackett-1')]: KEY, [indexerKeyName('prowlarr-1')]: 'bad key' });
    expect(await transferIndexers(conns, store, true)).toEqual([J, P, { kind: 'jackett', url: 'http://192.168.1.8:9117' }]);
    const without = await transferIndexers(conns, store, false);
    expect(JSON.stringify(without)).not.toContain(KEY);
    const failing: SecretStore = { ...store, get: () => Promise.reject(new Error('keystore')) };
    expect((await transferIndexers(conns, failing, true)).every((x) => !x.key)).toBe(true);
  });
});

describe('TV side', () => {
  it('the event carries only «key: true», never a key string', () => {
    const ok = parseRemoteSources({ id: 's1', sources: { rutor: true }, rutracker: false, phone: 'Pixel', indexers: [{ kind: 'jackett', url: J.url, key: true }] });
    expect(ok!.indexers).toEqual([{ kind: 'jackett', url: J.url, key: true }]);
    expect(parseRemoteSources({ id: 's1', sources: { rutor: true }, indexers: [{ kind: 'jackett', url: J.url, key: KEY }] })).toBeNull();
    expect(parseRemoteSources({ id: 's1', sources: { rutor: true }, indexers: [{ kind: 'jackett', url: 'x', key: true }] })).toBeNull();
    expect(parseRemoteSources({ id: 's1', sources: { rutor: true } })!.indexers).toBeUndefined();
  });

  it('moves staged keys to the connection entries and saves the connections', async () => {
    const { map, store } = memSecrets({ [indexerPendingKeyName(0)]: KEY });
    const r = parseRemoteSources({
      id: 's2',
      sources: { rutor: true },
      phone: 'Pixel',
      indexers: [
        { kind: 'jackett', url: J.url, key: true },
        { kind: 'prowlarr', url: P.url, name: 'Дом', key: false },
      ],
    })!;
    expect(await applyRemoteIndexers(r, store)).toBe(2);
    const conns = indexerConnections();
    expect(conns.map((c) => [c.kind, c.url, c.keySet, c.name || ''])).toEqual([
      ['jackett', J.url, true, ''],
      ['prowlarr', P.url, false, 'Дом'],
    ]);
    expect(map[indexerKeyName(conns[0].id)]).toBe(KEY);
    // the staged entry is the native side's to drop; nothing of the key in localStorage
    for (let i = 0; i < localStorage.length; i++) expect(localStorage.getItem(localStorage.key(i)!)).not.toContain(KEY);
  });

  it('a key that did not arrive keeps an earlier one; a missing store saves without keys', async () => {
    const { map, store } = memSecrets({ [indexerPendingKeyName(0)]: KEY });
    const r = parseRemoteSources({ id: 's3', sources: { rutor: true }, indexers: [{ kind: 'jackett', url: J.url, key: true }] })!;
    await applyRemoteIndexers(r, store);
    delete map[indexerPendingKeyName(0)];
    await applyRemoteIndexers(r, store);
    expect(indexerConnections()[0].keySet).toBe(true);
    localStorage.clear();
    reloadIndexers();
    expect(await applyRemoteIndexers(r, undefined)).toBe(1);
    expect(indexerConnections()[0].keySet).toBe(false);
  });

  it('switches of the transferred connections apply even before the registry knows them', async () => {
    const r = parseRemoteSources({ id: 's4', sources: { 'indexer-x': false }, indexers: [{ kind: 'jackett', url: J.url, key: false }] })!;
    await applyRemoteIndexers(r, undefined);
    const id = 'indexer-' + indexerConnections()[0].id;
    const r2 = parseRemoteSources({ id: 's5', sources: { [id]: false }, indexers: [{ kind: 'jackett', url: J.url, key: false }] })!;
    await applyRemoteSources(r2, [src('rutor')], () => ({}) as SourceContext);
    expect(isSourceOn({ id })).toBe(false);
    // an id of a connection that did not come is still unknown
    expect(isSourceOn({ id: 'indexer-x' })).toBe(true);
  });

  it('androidRemote saves the connections first and tells the native side how many', async () => {
    const { store } = memSecrets({ [indexerPendingKeyName(0)]: KEY });
    const done = vi.fn((_o: object) => Promise.resolve({ stored: true }));
    const ctx = (): SourceContext => ({ http: { get: () => Promise.reject(new Error('x')), post: () => Promise.reject(new Error('x')), clearCookies: () => Promise.resolve() }, client: null, secrets: store });
    await applyRemoteSourcesEvent(
      { id: 's6', sources: { rutor: true }, rutracker: false, phone: 'Pixel', indexers: [{ kind: 'jackett', url: J.url, key: true }] },
      { remoteSourcesDone: done },
      () => [src('rutor')],
      ctx,
    );
    expect(done).toHaveBeenCalledWith({ id: 's6', indexers: 1 });
    expect(indexerConnections()).toHaveLength(1);
    expect(JSON.stringify(logEntries())).not.toContain(KEY);
    expect(logEntries().some((e) => e.x.indexOf('индексаторов: 1 из 1') >= 0)).toBe(true);
  });
});
