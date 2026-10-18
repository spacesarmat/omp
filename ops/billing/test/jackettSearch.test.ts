import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activate, createSubscription, openAccount } from '../src/logic.mjs';
import {
  JACKETT_INDEXER_TIMEOUT_MS,
  JACKETT_SEARCH_DEADLINE_MS,
  createIndexerListCache,
  jackettIndexerTimeoutMs,
  jackettSearchDeadlineMs,
  jackettSearchLimits,
  jacredBroaderQuery,
  jacredSearchName,
  mergeTorznabFeeds,
  parseConfiguredIndexers,
  resetJackettListCache,
  safeTorznabCat,
  searchJackett,
  searchJacRed,
} from '../src/jackett.mjs';
import { createApp } from '../src/server.mjs';
import { emptyState, writeState } from '../src/store.mjs';

const ORIGIN = 'http://jackett.test:9117';
const KEY = 'SECRETKEY';

const INDEXERS_JSON = JSON.stringify([
  { id: 'rutor', name: 'RuTor', configured: true },
  { id: 'rutracker', name: 'RuTracker', configured: true },
  { id: 'kinozal', name: 'Kinozal', configured: true },
  { id: 'other', name: 'Unused', configured: false },
  { id: 'all', name: 'All', configured: true },
  { id: '../evil', name: 'Bad', configured: true },
]);

const INDEXERS_XML =
  '<?xml version="1.0" encoding="UTF-8"?><indexers>' +
  '<indexer configured="true" id="rutor"><title>RuTor</title></indexer>' +
  '<indexer id="nnmclub" configured="true"><title>NNM-Club</title></indexer>' +
  '<indexer id="other" configured="false"><title>Unused</title></indexer>' +
  '<indexer id="all" configured="true"><title>All</title></indexer>' +
  '</indexers>';

function rss(title: string, extra = '') {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel>' +
    '<item><title>' +
    title +
    '</title><link>' +
    ORIGIN +
    '/dl/' +
    title +
    '?apikey=' +
    KEY +
    '</link>' +
    extra +
    '</item></channel></rss>'
  );
}

function hangUntilAbort(signal: AbortSignal | undefined, delayMs = 100000): Promise<never> {
  return new Promise((_resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('hang exceeded ' + delayMs)), delayMs);
    const abort = () => {
      clearTimeout(timer);
      const err = new Error('aborted');
      err.name = 'AbortError';
      reject(err);
    };
    if (!signal) return;
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
  });
}

type Upstream = { status: number; text: string };
type FetchOpts = { signal?: AbortSignal; headers?: { [name: string]: string } };

function isJsonList(url: string) {
  return url.indexOf('/api/v2.0/indexers?') >= 0 && url.indexOf('/results/') < 0;
}

function isTorznabList(url: string) {
  return url.indexOf('/results/torznab/api') >= 0 && url.indexOf('t=indexers') >= 0;
}

function isAggregateSearch(url: string) {
  return url.indexOf('/indexers/all/results/torznab/api') >= 0 && url.indexOf('t=search') >= 0;
}

function queryOf(url: string) {
  const m = /[?&]q=([^&]*)/.exec(url);
  return m ? decodeURIComponent(m[1]) : '';
}

function isIndexerSearch(url: string, id: string) {
  return url.indexOf('/indexers/' + id + '/results/torznab/api') >= 0 && url.indexOf('t=search') >= 0;
}

beforeEach(() => {
  resetJackettListCache();
});

afterEach(() => {
  delete process.env.BILLING_JACKETT_INDEXER_TIMEOUT_MS;
  delete process.env.BILLING_JACKETT_SEARCH_DEADLINE_MS;
});

describe('Jackett search limits', () => {
  it('keeps a 12s indexer cap and a 6s catalog lookup inside an 18s deadline', () => {
    expect(JACKETT_INDEXER_TIMEOUT_MS).toBe(12000);
    expect(JACKETT_SEARCH_DEADLINE_MS).toBe(18000);
    expect(jackettIndexerTimeoutMs()).toBe(12000);
    expect(jackettSearchDeadlineMs()).toBe(18000);
    const limits = jackettSearchLimits();
    expect(limits).toEqual({ deadlineMs: 18000, indexerTimeoutMs: 12000, listMaxMs: 6000 });
    expect(limits.listMaxMs + limits.indexerTimeoutMs).toBeLessThanOrEqual(limits.deadlineMs);
    process.env.BILLING_JACKETT_INDEXER_TIMEOUT_MS = '5000';
    process.env.BILLING_JACKETT_SEARCH_DEADLINE_MS = '9000';
    expect(jackettIndexerTimeoutMs()).toBe(5000);
    expect(jackettSearchDeadlineMs()).toBe(9000);
    expect(jackettSearchLimits(jackettSearchDeadlineMs(), jackettIndexerTimeoutMs()).deadlineMs).toBe(9000);
    process.env.BILLING_JACKETT_INDEXER_TIMEOUT_MS = 'nope';
    expect(jackettIndexerTimeoutMs()).toBe(12000);
  });
});

describe('configured indexer list', () => {
  it('reads the JSON list and the Torznab catalog, skipping unconfigured and unsafe ids', () => {
    expect(parseConfiguredIndexers(INDEXERS_JSON)).toEqual(['rutor', 'rutracker', 'kinozal']);
    expect(parseConfiguredIndexers(INDEXERS_XML)).toEqual(['rutor', 'nnmclub']);
    expect(parseConfiguredIndexers('[]')).toEqual([]);
    expect(parseConfiguredIndexers('<error code="100" description="Invalid API Key" />')).toBeNull();
    expect(parseConfiguredIndexers('<html>login</html>')).toBeNull();
  });

  it('merges item rows and drops error documents', () => {
    const merged = mergeTorznabFeeds([
      rss('Fast'),
      '<error code="300" description="timeout" />',
      rss('Also'),
      '',
    ]);
    expect(merged).toContain('<title>Fast</title>');
    expect(merged).toContain('<title>Also</title>');
    expect(merged).not.toContain('timeout');
    expect(merged.match(/<item\b/g)).toHaveLength(2);
  });
});

describe('parallel Jackett search', () => {
  it('returns fast indexers and drops one that would take 100s', async () => {
    const calls: string[] = [];
    const auths: string[] = [];
    const logged: string[][] = [];
    const started = Date.now();
    const found = await searchJackett({
      origin: ORIGIN,
      apiKey: KEY,
      query: 'film 2',
      headers: { Authorization: 'Basic abc' },
      indexerTimeoutMs: 180,
      deadlineMs: 2000,
      listCache: createIndexerListCache(60_000),
      log: (ids: string[]) => logged.push(ids),
      fetchImpl: (url: string, opts: FetchOpts) => {
        calls.push(url);
        if (opts.headers && opts.headers.Authorization) auths.push(opts.headers.Authorization);
        if (isJsonList(url)) {
          return Promise.resolve({ status: 200, text: async () => INDEXERS_JSON });
        }
        if (isIndexerSearch(url, 'rutor')) {
          return Promise.resolve({ status: 200, text: async () => rss('Fast Film') });
        }
        if (isIndexerSearch(url, 'kinozal')) {
          return Promise.resolve({ status: 500, text: async () => 'no' });
        }
        if (isIndexerSearch(url, 'rutracker')) return hangUntilAbort(opts.signal);
        return Promise.resolve({ status: 404, text: async () => '' });
      },
    });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(1500);
    expect(found.ok).toBe(true);
    expect(found.xml).toContain('Fast Film');
    expect(found.xml).not.toContain('Slow');
    expect(found.timedOut).toEqual(['rutracker']);
    expect(logged).toEqual([['rutracker']]);
    expect(calls.some(isAggregateSearch)).toBe(false);
    expect(calls.some((url) => url.indexOf('/indexers/other/') >= 0)).toBe(false);
    expect(calls.some((url) => url.indexOf('/indexers/all/') >= 0 && url.indexOf('t=search') >= 0)).toBe(false);
    expect(calls.filter(isJsonList)).toHaveLength(1);
    expect(calls.every((url) => url.indexOf('apikey=' + encodeURIComponent(KEY)) >= 0)).toBe(true);
    expect(calls.find((url) => isIndexerSearch(url, 'rutor'))).toContain('q=' + encodeURIComponent('film 2'));
    expect(calls.find((url) => isIndexerSearch(url, 'rutor'))).not.toContain('cat=');
    expect(auths.length).toBe(calls.length);
    expect(auths.every((header) => header === 'Basic abc')).toBe(true);
  });

  it('logs the default timeout line without the API key', async () => {
    const lines: string[] = [];
    const orig = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      const found = await searchJackett({
        origin: ORIGIN,
        apiKey: KEY,
        query: 'slow',
        indexerTimeoutMs: 120,
        deadlineMs: 1500,
        listCache: createIndexerListCache(60_000),
        fetchImpl: (url: string, opts: FetchOpts) => {
          if (isJsonList(url)) {
            return Promise.resolve({
              status: 200,
              text: async () => JSON.stringify([{ id: 'rutracker', configured: true }, { id: 'kinozal', configured: true }]),
            });
          }
          return hangUntilAbort(opts.signal);
        },
      });
      expect(found.ok).toBe(false);
      expect(found.timedOut).toEqual(['kinozal', 'rutracker']);
      const log = lines.join('');
      expect(log).toContain('jackett indexer timeout: kinozal,rutracker');
      expect(log).not.toContain(KEY);
      expect(log).not.toContain(ORIGIN);
    } finally {
      process.stderr.write = orig;
    }
  });

  it('falls back to the Torznab catalog when the JSON list is refused', async () => {
    const calls: string[] = [];
    const found = await searchJackett({
      origin: ORIGIN,
      apiKey: KEY,
      query: 'q',
      indexerTimeoutMs: 500,
      deadlineMs: 3000,
      listCache: createIndexerListCache(60_000),
      log: () => {},
      fetchImpl: (url: string) => {
        calls.push(url);
        if (isJsonList(url)) return Promise.resolve({ status: 401, text: async () => 'login' });
        if (isTorznabList(url)) return Promise.resolve({ status: 200, text: async () => INDEXERS_XML });
        if (isIndexerSearch(url, 'rutor')) return Promise.resolve({ status: 200, text: async () => rss('From RuTor') });
        if (isIndexerSearch(url, 'nnmclub')) return Promise.resolve({ status: 200, text: async () => rss('From NNM') });
        return Promise.resolve({ status: 404, text: async () => '' });
      },
    });
    expect(found.ok).toBe(true);
    expect(found.xml).toContain('From RuTor');
    expect(found.xml).toContain('From NNM');
    expect(calls.some(isTorznabList)).toBe(true);
    expect(calls.some(isAggregateSearch)).toBe(false);
  });

  it('caches the indexer list and shares one in-flight lookup', async () => {
    let listCalls = 0;
    const cache = createIndexerListCache(60_000);
    const fetchImpl = (url: string) => {
      if (isJsonList(url)) {
        listCalls += 1;
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              status: 200,
              text: async () => JSON.stringify([{ id: 'rutor', configured: true }]),
            });
          }, 40);
        });
      }
      return Promise.resolve({ status: 200, text: async () => rss('Hit') });
    };
    const opts = {
      origin: ORIGIN,
      apiKey: KEY,
      indexerTimeoutMs: 500,
      deadlineMs: 3000,
      listCache: cache,
      log: () => {},
      fetchImpl,
    };
    const both = await Promise.all([
      searchJackett({ ...opts, query: 'one' }),
      searchJackett({ ...opts, query: 'two' }),
    ]);
    expect(both.every((row) => row.ok && row.xml.indexOf('Hit') >= 0)).toBe(true);
    expect(listCalls).toBe(1);
    const again = await searchJackett({ ...opts, query: 'three' });
    expect(again.xml).toContain('Hit');
    expect(listCalls).toBe(1);
  });

  it('stops a hung catalog lookup on the deadline instead of waiting on a slow indexer', async () => {
    const started = Date.now();
    const found = await searchJackett({
      origin: ORIGIN,
      apiKey: KEY,
      query: 'q',
      indexerTimeoutMs: 60000,
      deadlineMs: 350,
      listCache: createIndexerListCache(60_000),
      log: () => {},
      fetchImpl: (_url: string, opts: FetchOpts) => hangUntilAbort(opts.signal),
    });
    expect(found.ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(1200);
  });

  it('answers an empty catalog without calling the aggregate search', async () => {
    const calls: string[] = [];
    const found = await searchJackett({
      origin: ORIGIN,
      apiKey: KEY,
      query: 'q',
      indexerTimeoutMs: 500,
      deadlineMs: 2000,
      listCache: createIndexerListCache(60_000),
      log: () => {},
      fetchImpl: (url: string) => {
        calls.push(url);
        return Promise.resolve({ status: 200, text: async () => '[]' });
      },
    });
    expect(found.ok).toBe(true);
    expect(found.xml).toContain('<channel>');
    expect(found.xml).not.toContain('<item');
    expect(calls.every((url) => !isAggregateSearch(url) && !isTorznabList(url))).toBe(true);
  });
});

function mockRes() {
  return {
    status: 0,
    headers: {} as { [name: string]: string | number },
    body: '',
    writeHead(status: number, headers?: { [name: string]: string | number }) {
      this.status = status;
      if (headers) Object.assign(this.headers, headers);
    },
    end(buf?: Buffer | string) {
      this.body = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf || '');
    },
  };
}

function subscriber(extra: { user?: string; pass?: string } = {}) {
  const file = join(mkdtempSync(join(tmpdir(), 'omp-search-')), 'billing.db');
  const now = Date.now();
  const opened = openAccount(emptyState(), { telegramId: '42', now });
  const created = createSubscription(opened.state, { accountId: opened.account.id, now, days: 30 });
  const device = 'ab'.repeat(16);
  const act = activate(created.state, { code: created.result.code, deviceId: device, now });
  act.state.settings.jackettUrl = ORIGIN;
  act.state.settings.jackettApiKey = KEY;
  act.state.settings.jacredUrl = 'http://jacred.test:9118';
  act.state.settings.jacredApiKey = 'JACREDKEY';
  if (extra.user) {
    act.state.settings.indexerUser = extra.user;
    act.state.settings.indexerPass = extra.pass || '';
  }
  writeState(file, act.state);
  return { file, device, token: act.result.token as string };
}

async function postSearch(
  app: (req: unknown, res: unknown) => Promise<void>,
  opts: { token?: string; device?: string; body: { [key: string]: string } },
) {
  const payload = JSON.stringify(opts.body);
  const req = {
    method: 'POST',
    url: '/v1/search',
    headers: {
      authorization: opts.token ? 'Bearer ' + opts.token : '',
      'x-device-id': opts.device || '',
      'content-type': 'application/json',
    },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(payload);
    },
  };
  const res = mockRes();
  await app(req, res);
  return res;
}

describe('JacRed query widening', () => {
  it('stems a Latin title and leaves a Cyrillic or bilingual query alone', () => {
    expect(jacredSearchName('The Matrix!')).toBe('thematrix');
    expect(jacredSearchName('Ёлка')).toBe('елка');
    expect(jacredBroaderQuery('matrix')).toBe('matr');
    expect(jacredBroaderQuery('matrix 1999')).toBe('matr');
    expect(jacredBroaderQuery('Matrix S01E02')).toBe('matr');
    expect(jacredBroaderQuery('jac')).toBe('');
    expect(jacredBroaderQuery('Война миров')).toBe('');
    expect(jacredBroaderQuery('Матрица / The Matrix')).toBe('');
  });

  it('merges the wider feed and skips it once the first answer is large enough', async () => {
    const thin = await searchJacRed({
      origin: 'http://jacred.test:9118',
      apiKey: 'JACREDKEY',
      query: 'matrix',
      fetchImpl: (url: string) => {
        const title = queryOf(String(url)) === 'matr' ? 'The Matrix' : 'Matrix';
        return Promise.resolve({
          status: 200,
          text: async () => '<rss><channel><item><title>' + title + '</title></item></channel></rss>',
        });
      },
    });
    expect(thin.ok).toBe(true);
    expect(thin.xml).toContain('Matrix');
    expect(thin.xml).toContain('The Matrix');
    const calls: string[] = [];
    const full = await searchJacRed({
      origin: 'http://jacred.test:9118',
      apiKey: 'JACREDKEY',
      query: 'avatar',
      fetchImpl: (url: string) => {
        calls.push(String(url));
        const items = new Array(8).fill('<item><title>Avatar</title></item>').join('');
        return Promise.resolve({ status: 200, text: async () => '<rss><channel>' + items + '</channel></rss>' });
      },
    });
    expect(full.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

describe('POST /v1/search', () => {
  it('strips Jackett links, caches the merged feed, and logs the slow indexer', async () => {
    process.env.BILLING_JACKETT_INDEXER_TIMEOUT_MS = '200';
    process.env.BILLING_JACKETT_SEARCH_DEADLINE_MS = '2000';
    const { file, device, token } = subscriber({ user: 'omp', pass: 'pw' });
    const calls: string[] = [];
    let sawAuth = false;
    const fetchImpl = (url: string, opts: FetchOpts = {}) => {
      calls.push(String(url));
      if (opts.headers && opts.headers.Authorization && opts.headers.Authorization.indexOf('Basic ') === 0) sawAuth = true;
      if (isJsonList(url)) return Promise.resolve({ status: 200, text: async () => INDEXERS_JSON });
      if (isIndexerSearch(url, 'rutor')) return Promise.resolve({ status: 200, text: async () => rss('Fast Film', KEY) });
      if (isIndexerSearch(url, 'kinozal')) {
        return Promise.resolve({ status: 200, text: async () => '<error code="300" description="down" />' });
      }
      if (isIndexerSearch(url, 'rutracker')) return hangUntilAbort(opts.signal);
      return Promise.resolve({ status: 404, text: async () => '' });
    };
    const lines: string[] = [];
    const orig = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    const app = createApp(file, fetchImpl);
    try {
      const started = Date.now();
      const first = await postSearch(app, { token, device, body: { q: 'Parallel Film', deviceId: device } });
      expect(Date.now() - started).toBeLessThan(1500);
      expect(first.status).toBe(200);
      expect(String(first.headers['content-type'])).toContain('application/xml');
      expect(first.body).toContain('Fast Film');
      expect(first.body).toContain('omp-fetch:/dl/Fast Film');
      expect(first.body).not.toContain(KEY);
      expect(first.body).not.toContain('jackett.test');
      expect(first.body).not.toContain('Slow');
      expect(sawAuth).toBe(true);
      expect(calls.some(isAggregateSearch)).toBe(false);
      expect(lines.join('')).toContain('jackett indexer timeout: rutracker');
      expect(lines.join('')).not.toContain(KEY);
      const after = calls.length;
      const second = await postSearch(app, { token, device, body: { q: 'Parallel Film', deviceId: device } });
      expect(second.status).toBe(200);
      expect(second.body).toBe(first.body);
      expect(calls.length).toBe(after);
      const third = await postSearch(app, { token, device, body: { q: 'Other Query', deviceId: device } });
      expect(third.status).toBe(200);
      expect(third.body).toContain('Fast Film');
      expect(calls.filter(isJsonList)).toHaveLength(1);
    } finally {
      process.stderr.write = orig;
    }
  });

  it('keeps JacRed on the aggregate Torznab search', async () => {
    const { file, device, token } = subscriber();
    const calls: string[] = [];
    const fetchImpl = (url: string) => {
      calls.push(String(url));
      return Promise.resolve({
        status: 200,
        text: async () => '<rss><channel><item><title>Jac</title><link>http://jacred.test:9118/dl/j?apikey=JACREDKEY</link></item></channel></rss>',
      });
    };
    const app = createApp(file, fetchImpl);
    const res = await postSearch(app, { token, device, body: { source: 'jacred', q: 'jac', deviceId: device } });
    expect(res.status).toBe(200);
    expect(res.body).toContain('omp-jacred:/dl/j');
    expect(res.body).not.toContain('JACREDKEY');
    expect(calls).toHaveLength(1);
    expect(isAggregateSearch(calls[0])).toBe(true);
    expect(queryOf(calls[0])).toBe('jac');
  });

  it('searches a thin Latin JacRed query again without its last two letters', async () => {
    const { file, device, token } = subscriber();
    const calls: string[] = [];
    const fetchImpl = (url: string) => {
      calls.push(String(url));
      const q = queryOf(String(url));
      const title = q === 'matr' ? 'The Matrix' : 'Matrix';
      return Promise.resolve({
        status: 200,
        text: async () =>
          '<rss><channel><item><title>' +
          title +
          '</title><link>http://jacred.test:9118/dl/' +
          title +
          '?apikey=JACREDKEY</link></item></channel></rss>',
      });
    };
    const app = createApp(file, fetchImpl);
    const res = await postSearch(app, { token, device, body: { source: 'jacred', q: 'matrix', deviceId: device } });
    expect(res.status).toBe(200);
    expect(calls.map(queryOf)).toEqual(['matrix', 'matr']);
    expect(res.body).toContain('<title>Matrix</title>');
    expect(res.body).toContain('<title>The Matrix</title>');
    expect(res.body).not.toContain('JACREDKEY');
    expect(res.body).not.toContain('jacred.test');
    const again = await postSearch(app, { token, device, body: { source: 'jacred', q: 'matrix', deviceId: device } });
    expect(again.body).toBe(res.body);
    expect(calls).toHaveLength(2);
  });

  it('does not widen a Cyrillic JacRed query or a Latin query that already filled the bucket', async () => {
    const { file, device, token } = subscriber();
    const calls: string[] = [];
    const many = '<rss><channel>' + new Array(8).fill('<item><title>Avatar</title><link>http://jacred.test:9118/dl/a</link></item>').join('') + '</channel></rss>';
    const fetchImpl = (url: string) => {
      calls.push(String(url));
      const q = queryOf(String(url));
      const body = q === 'Война миров'
        ? '<rss><channel><item><title>Война миров</title><link>http://jacred.test:9118/dl/w</link></item></channel></rss>'
        : many;
      return Promise.resolve({ status: 200, text: async () => body });
    };
    const app = createApp(file, fetchImpl);
    const ru = await postSearch(app, { token, device, body: { source: 'jacred', q: 'Война миров', deviceId: device } });
    expect(ru.status).toBe(200);
    expect(ru.body).toContain('Война миров');
    expect(calls.map(queryOf)).toEqual(['Война миров']);
    const full = await postSearch(app, { token, device, body: { source: 'jacred', q: 'avatar', deviceId: device } });
    expect(full.status).toBe(200);
    expect(calls.map(queryOf)).toEqual(['Война миров', 'avatar']);
  });

  it('keeps the first JacRed feed when the wider query fails', async () => {
    const { file, device, token } = subscriber();
    const fetchImpl = (url: string) => {
      if (queryOf(String(url)) === 'matr') return Promise.resolve({ status: 502, text: async () => '' });
      return Promise.resolve({
        status: 200,
        text: async () => '<rss><channel><item><title>Matrix</title><link>http://jacred.test:9118/dl/m</link></item></channel></rss>',
      });
    };
    const app = createApp(file, fetchImpl);
    const res = await postSearch(app, { token, device, body: { source: 'jacred', q: 'matrix 1999', deviceId: device } });
    expect(res.status).toBe(200);
    expect(res.body).toContain('Matrix');
    expect(res.body).not.toContain('The Matrix');
  });

  it('does not call Jackett without a session, and returns 502 when every indexer fails', async () => {
    const { file, device, token } = subscriber();
    const calls: string[] = [];
    const fetchImpl = (url: string) => {
      calls.push(String(url));
      if (isJsonList(url)) {
        return Promise.resolve({
          status: 200,
          text: async () => JSON.stringify([{ id: 'rutor', configured: true }]),
        });
      }
      return Promise.resolve({ status: 502, text: async () => '' });
    };
    const app = createApp(file, fetchImpl);
    const denied = await postSearch(app, { body: { q: 'nope', deviceId: device } });
    expect(denied.status).toBe(403);
    expect(calls).toHaveLength(0);
    const down = await postSearch(app, { token, device, body: { q: 'all-down', deviceId: device } });
    expect(down.status).toBe(502);
    expect(JSON.parse(down.body).error).toBe('down');
    expect(calls.some(isAggregateSearch)).toBe(false);
  });

  it('forwards cat=3030 to Jackett and JacRed and drops anything that is not a category id', async () => {
    expect(safeTorznabCat('3030')).toBe('3030');
    expect(safeTorznabCat('3030, 3040')).toBe('3030,3040');
    expect(safeTorznabCat('')).toBe('');
    expect(safeTorznabCat('3030&apikey=nope')).toBe('');
    const { file, device, token } = subscriber();
    const calls: string[] = [];
    const fetchImpl = (url: string) => {
      calls.push(String(url));
      if (isJsonList(url)) {
        return Promise.resolve({ status: 200, text: async () => JSON.stringify([{ id: 'rutracker', configured: true }]) });
      }
      const title = /[?&]cat=3030(?:&|$)/.test(url) ? 'With cat' : 'Open';
      return Promise.resolve({
        status: 200,
        text: async () => '<rss><channel><item><title>' + title + '</title><link>' + ORIGIN + '/dl/' + title + '</link></item></channel></rss>',
      });
    };
    const app = createApp(file, fetchImpl);
    const categorized = await postSearch(app, { token, device, body: { q: 'audiobook-cat', cat: '3030', deviceId: device } });
    expect(categorized.status).toBe(200);
    expect(categorized.body).toContain('With cat');
    const searchCalls = calls.filter((url) => isIndexerSearch(url, 'rutracker'));
    expect(searchCalls.length).toBeGreaterThan(0);
    expect(searchCalls.every((url) => url.indexOf('cat=3030') >= 0)).toBe(true);
    const after = calls.length;
    const open = await postSearch(app, { token, device, body: { q: 'audiobook-cat', deviceId: device } });
    expect(open.status).toBe(200);
    expect(open.body).toContain('Open');
    expect(calls.length).toBeGreaterThan(after);
    const dirty = await postSearch(app, { token, device, body: { q: 'audiobook-dirty', cat: '3030&x=1', deviceId: device } });
    expect(dirty.status).toBe(200);
    expect(calls.filter((url) => url.indexOf('audiobook-dirty') >= 0 || queryOf(url) === 'audiobook-dirty').every((url) => url.indexOf('cat=') < 0)).toBe(true);
    expect(calls.join('\n')).not.toContain('x=1');

    const jacredCalls: string[] = [];
    const jacred = createApp(file, (url: string) => {
      jacredCalls.push(String(url));
      const q = queryOf(String(url));
      return Promise.resolve({
        status: 200,
        text: async () => '<rss><channel><item><title>' + q + '</title><link>http://jacred.test:9118/dl/j</link></item></channel></rss>',
      });
    });
    const widened = await postSearch(jacred, { token, device, body: { source: 'jacred', q: 'matrix', cat: '3030', deviceId: device } });
    expect(widened.status).toBe(200);
    expect(jacredCalls.map(queryOf)).toEqual(['matrix', 'matr']);
    expect(jacredCalls.every((url) => url.indexOf('cat=3030') >= 0)).toBe(true);
  });
});

async function postTorrent(
  app: (req: unknown, res: unknown) => Promise<void>,
  opts: { token: string; device: string; link: string },
) {
  const payload = JSON.stringify({ link: opts.link, deviceId: opts.device });
  const req = {
    method: 'POST',
    url: '/v1/torrent',
    headers: {
      authorization: 'Bearer ' + opts.token,
      'x-device-id': opts.device,
      'content-type': 'application/json',
    },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(payload);
    },
  };
  const res = mockRes();
  await app(req, res);
  return res;
}

describe('POST /v1/torrent magnet redirect', () => {
  const LINK = 'omp-fetch:/api/v2.0/indexers/rutracker/results/torznab/download';

  it('returns a magnet and does not log the download URL', async () => {
    const { file, device, token } = subscriber();
    const magnet = 'magnet:?xt=urn:btih:' + 'cd'.repeat(20);
    const seen: { redirect?: string }[] = [];
    const logs: string[] = [];
    const orig = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      logs.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      const fetchImpl = (url: string, opts?: { redirect?: string }) => {
        seen.push({ redirect: opts && opts.redirect });
        const hop = seen.length;
        if (hop === 1) {
          return Promise.resolve({
            status: 302,
            headers: { location: 'https://tracker.example/file.torrent' },
            arrayBuffer: async () => new ArrayBuffer(0),
          });
        }
        return Promise.resolve({
          status: 301,
          headers: { Location: magnet },
          arrayBuffer: async () => new ArrayBuffer(0),
        });
      };
      const app = createApp(file, fetchImpl);
      const res = await postTorrent(app, { token, device, link: LINK });
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ magnet });
      expect(seen.map((s) => s.redirect)).toEqual(['manual', 'manual']);
      const log = logs.join('');
      expect(log).toContain('status=301');
      expect(log).toContain('indexer=rutracker');
      expect(log).toContain('kind=magnet');
      expect(log).not.toContain(KEY);
      expect(log).not.toContain('jackett.test');
      expect(log).not.toContain(magnet);
    } finally {
      process.stderr.write = orig;
    }
  });

  it('still returns a torrent file', async () => {
    const { file, device, token } = subscriber();
    const body = 'd4:infod4:name4:testee';
    const fetchImpl = (_url: string, opts?: { redirect?: string }) => {
      expect(opts && opts.redirect).toBe('manual');
      return Promise.resolve({
        status: 200,
        headers: {},
        arrayBuffer: async () => Uint8Array.from(body, (ch) => ch.charCodeAt(0)).buffer,
      });
    };
    const app = createApp(file, fetchImpl);
    const res = await postTorrent(app, { token, device, link: 'omp-fetch:/dl/file' });
    expect(res.status).toBe(200);
    expect(res.body.indexOf('d4:info')).toBe(0);
  });
});
