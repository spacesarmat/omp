import { describe, it, expect, beforeEach } from 'vitest';
import {
  INDEXERS_KEY,
  INDEXERS_MAX,
  indexerBadUrl,
  indexerNoKey,
  indexerNoStore,
  hostKey,
  indexerConnections,
  indexerId,
  indexerKeyName,
  normalizeIndexerUrl,
  reloadIndexers,
  removeIndexer,
  sanitizeIndexers,
  saveIndexer,
  getIndexer,
  onIndexersChange,
} from '../../src/sources/indexerStore';
import type { SecretStore } from '../../src/sources/types';

const KEY = 'k3y-SECRET-0001';

function memorySecrets(fail?: boolean): { store: SecretStore; map: { [k: string]: string } } {
  const map: { [k: string]: string } = {};
  return {
    map,
    store: {
      get: (k) => Promise.resolve(k in map ? map[k] : null),
      set: (k, v) => {
        if (fail) return Promise.reject(new Error('keystore'));
        map[k] = v;
        return Promise.resolve();
      },
      delete: (k) => {
        delete map[k];
        return Promise.resolve();
      },
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  reloadIndexers();
});

describe('normalizeIndexerUrl', () => {
  it('cleans http(s) addresses', () => {
    expect(normalizeIndexerUrl(' HTTP://192.168.1.5:9117/ ')).toBe('http://192.168.1.5:9117');
    expect(normalizeIndexerUrl('https://Jackett.Home/sub//')).toBe('https://jackett.home/sub');
    expect(normalizeIndexerUrl('http://h:9117/?apikey=x#y')).toBe('http://h:9117');
  });
  it('rejects the rest', () => {
    ['', 'ftp://h', 'h:9117', 'http://', 'http://u:p@h', 'http://h h', 5, null].forEach((v) => expect(normalizeIndexerUrl(v)).toBeNull());
  });
  it('hostKey makes the default port explicit', () => {
    expect(hostKey('http://Host/x')).toBe('host:80');
    expect(hostKey('https://host')).toBe('host:443');
    expect(hostKey('http://1.2.3.4:9117/api')).toBe('1.2.3.4:9117');
    expect(hostKey('nope')).toBe('');
  });
});

describe('sanitizeIndexers', () => {
  it('keeps valid rows only, recomputes ids, dedupes, drops foreign fields', () => {
    const list = sanitizeIndexers([
      { id: 'evil', kind: 'jackett', url: 'http://h:9117/', keySet: true, name: '  Дом  ', apiKey: KEY, extra: 1 },
      { kind: 'jackett', url: 'http://h:9117', keySet: false },
      { kind: 'prowlarr', url: 'http://h:9696', keySet: 'yes' },
      { kind: 'sonarr', url: 'http://h:1' },
      { kind: 'jackett', url: 'javascript:1' },
      'x',
      null,
    ]);
    expect(list).toEqual([
      { id: indexerId('jackett', 'http://h:9117'), kind: 'jackett', url: 'http://h:9117', keySet: true, name: 'Дом' },
      { id: indexerId('prowlarr', 'http://h:9696'), kind: 'prowlarr', url: 'http://h:9696', keySet: false },
    ]);
    expect(JSON.stringify(list)).not.toContain(KEY);
  });
  it('non-arrays and long lists', () => {
    expect(sanitizeIndexers({})).toEqual([]);
    const many = [];
    for (let i = 0; i < INDEXERS_MAX + 5; i++) many.push({ kind: 'jackett', url: 'http://h' + i + ':9117' });
    expect(sanitizeIndexers(many)).toHaveLength(INDEXERS_MAX);
  });
});

describe('saveIndexer / removeIndexer', () => {
  it('the key goes to the secret store, never to localStorage', async () => {
    const { store, map } = memorySecrets();
    const c = await saveIndexer({ kind: 'jackett', url: 'http://192.168.1.5:9117/', name: 'Дом', apiKey: '  ' + KEY + ' ' }, store);
    expect(c.keySet).toBe(true);
    expect(map[indexerKeyName(c.id)]).toBe(KEY);
    const raw = localStorage.getItem(INDEXERS_KEY) as string;
    expect(JSON.parse(raw)).toEqual([{ id: c.id, kind: 'jackett', url: 'http://192.168.1.5:9117', keySet: true, name: 'Дом' }]);
    for (let i = 0; i < localStorage.length; i++) expect(String(localStorage.getItem(localStorage.key(i) as string))).not.toContain(KEY);
    reloadIndexers();
    expect(indexerConnections()).toHaveLength(1);
  });

  it('updating keeps the saved key when none is given; same address does not duplicate', async () => {
    const { store, map } = memorySecrets();
    const a = await saveIndexer({ kind: 'prowlarr', url: 'http://h:9696', apiKey: KEY }, store);
    const b = await saveIndexer({ kind: 'prowlarr', url: 'http://h:9696/', name: 'Новое' }, store);
    expect(b.id).toBe(a.id);
    expect(indexerConnections()).toHaveLength(1);
    expect(getIndexer(a.id)!.name).toBe('Новое');
    expect(map[indexerKeyName(a.id)]).toBe(KEY);
  });

  it('rejects bad input without touching storage', async () => {
    const { store } = memorySecrets();
    await expect(saveIndexer({ kind: 'jackett', url: 'oops', apiKey: KEY }, store)).rejects.toThrow(indexerBadUrl());
    await expect(saveIndexer({ kind: 'jackett', url: 'http://h:9117' }, store)).rejects.toThrow(indexerNoKey());
    await expect(saveIndexer({ kind: 'jackett', url: 'http://h:9117', apiKey: KEY }, undefined)).rejects.toThrow(indexerNoStore());
    const failing = memorySecrets(true);
    await expect(saveIndexer({ kind: 'jackett', url: 'http://h:9117', apiKey: KEY }, failing.store)).rejects.toThrow(indexerNoStore());
    expect(localStorage.getItem(INDEXERS_KEY)).toBeNull();
    expect(indexerConnections()).toEqual([]);
  });

  it('remove deletes the key and the row; listeners hear changes', async () => {
    const { store, map } = memorySecrets();
    let n = 0;
    const off = onIndexersChange(() => n++);
    const c = await saveIndexer({ kind: 'jackett', url: 'http://h:9117', apiKey: KEY }, store);
    await removeIndexer(c.id, store);
    expect(map[indexerKeyName(c.id)]).toBeUndefined();
    expect(indexerConnections()).toEqual([]);
    expect(n).toBe(2);
    off();
  });

  it('a corrupt tsp.indexers is dropped', () => {
    localStorage.setItem(INDEXERS_KEY, '{"a":1}');
    reloadIndexers();
    expect(indexerConnections()).toEqual([]);
  });
});
