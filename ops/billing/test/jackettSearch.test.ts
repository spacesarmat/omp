import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
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
import { createApp, listen } from '../src/server.mjs';
import { emptyState } from '../src/state.mjs';
import { writeState, testStore } from './pg';

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
    expect(found.indexers).toEqual({ ok: 1, failed: 1, timedOut: 1 });
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
      expect(found.indexers).toEqual({ ok: 0, failed: 0, timedOut: 2 });
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
    expect(found.indexers).toEqual({ ok: 0, failed: 0, timedOut: 0 });
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
    expect(found.indexers).toEqual({ ok: 0, failed: 0, timedOut: 0 });
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

function deviceHash(id: string) {
  return createHash('sha256').update(id).digest('hex').slice(0, 8);
}

async function subscriber(extra: { user?: string; pass?: string; device?: string } = {}) {
  const file = await testStore();
  const now = Date.now();
  const opened = openAccount(emptyState(), { telegramId: '42', now });
  const created = createSubscription(opened.state, { accountId: opened.account.id, now, days: 30 });
  const device = extra.device || 'ab'.repeat(16);
  const act = activate(created.state, { code: created.result.code, deviceId: device, now });
  act.state.settings.jackettUrl = ORIGIN;
  act.state.settings.jackettApiKey = KEY;
  act.state.settings.jacredUrl = 'http://jacred.test:9118';
  act.state.settings.jacredApiKey = 'JACREDKEY';
  if (extra.user) {
    act.state.settings.indexerUser = extra.user;
    act.state.settings.indexerPass = extra.pass || '';
  }
  await writeState(file, act.state);
  return { file, device, token: act.result.token as string };
}

async function postSearch(
  app: (req: unknown, res: unknown) => Promise<void>,
  opts: {
    token?: string;
    device?: string;
    body: { [key: string]: string };
    headers?: { [key: string]: string };
    client?: 'abort' | 'close';
  },
) {
  const payload = JSON.stringify(opts.body);
  const headers = {
    authorization: opts.token ? 'Bearer ' + opts.token : '',
    'x-device-id': opts.device || '',
    'content-type': 'application/json',
    ...(opts.headers || {}),
  };
  const req = new EventEmitter() as EventEmitter & {
    method: string;
    url: string;
    headers: { [key: string]: string };
    aborted: boolean;
    [Symbol.asyncIterator]: () => AsyncGenerator<Buffer>;
  };
  req.method = 'POST';
  req.url = '/v1/search';
  req.headers = headers;
  req.aborted = false;
  req[Symbol.asyncIterator] = async function* () {
    yield Buffer.from(payload);
    if (opts.client === 'abort') {
      req.aborted = true;
      req.emit('aborted');
      req.emit('close');
    } else if (opts.client === 'close') {
      req.emit('close');
    }
  };
  const res = mockRes();
  await app(req, res);
  return res;
}

async function captureStderr(run: () => Promise<void>) {
  const lines: string[] = [];
  const orig = process.stderr.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    lines.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    await run();
  } finally {
    process.stderr.write = orig;
  }
  return lines.join('');
}

function searchLogLines(log: string) {
  return log
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.indexOf('route=/v1/search') >= 0);
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
    const { file, device, token } = await subscriber({ user: 'omp', pass: 'pw' });
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
    const { file, device, token } = await subscriber();
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
    const { file, device, token } = await subscriber();
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
    const { file, device, token } = await subscriber();
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
    const { file, device, token } = await subscriber();
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
    const { file, device, token } = await subscriber();
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
    const { file, device, token } = await subscriber();
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

describe('POST /v1/search log', () => {
  const QUERY = 'secret-query-text-zz';
  const IP = '203.0.113.77';
  const PASS = 'panel-secret-pass';

  function assertNoSecrets(line: string, secret: { device: string; token?: string; query: string }) {
    expect(line).not.toContain(secret.query);
    expect(line).not.toContain(secret.device);
    expect(line).not.toContain(KEY);
    expect(line).not.toContain('JACREDKEY');
    expect(line).not.toContain(PASS);
    expect(line).not.toContain(IP);
    expect(line).not.toContain('jackett.test');
    expect(line).not.toContain('jacred.test');
    if (secret.token) expect(line).not.toContain(secret.token);
    expect(line).not.toContain('apikey');
  }

  it('logs status, duration, indexer counts, and no secrets', async () => {
    process.env.BILLING_JACKETT_INDEXER_TIMEOUT_MS = '200';
    process.env.BILLING_JACKETT_SEARCH_DEADLINE_MS = '2000';
    const device = 'aa'.repeat(16);
    const { file, token } = await subscriber({ device, user: 'omp', pass: PASS });
    const fetchImpl = (url: string, opts: FetchOpts = {}) => {
      if (isJsonList(url)) return Promise.resolve({ status: 200, text: async () => INDEXERS_JSON });
      if (isIndexerSearch(url, 'rutor')) return Promise.resolve({ status: 200, text: async () => rss('Fast Film', KEY) });
      if (isIndexerSearch(url, 'kinozal')) return Promise.resolve({ status: 500, text: async () => 'no' });
      if (isIndexerSearch(url, 'rutracker')) return hangUntilAbort(opts.signal);
      return Promise.resolve({ status: 404, text: async () => '' });
    };
    const app = createApp(file, fetchImpl);
    let resStatus = 0;
    const log = await captureStderr(async () => {
      const res = await postSearch(app, {
        token,
        device,
        headers: { 'x-forwarded-for': IP },
        body: { q: QUERY, deviceId: device },
      });
      resStatus = res.status;
    });
    expect(resStatus).toBe(200);
    const lines = searchLogLines(log);
    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line).toMatch(
      /^search route=\/v1\/search at=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z source=jackett status=200 ms=\d+ results=1 indexers_ok=1 indexers_fail=1 indexers_timeout=1 abort=0 device=[0-9a-f]{8} qlen=\d+$/,
    );
    expect(line).toContain('device=' + deviceHash(device));
    expect(line).toContain('qlen=' + String(QUERY.length));
    assertNoSecrets(line, { device, token, query: QUERY });
    expect(log).not.toContain(KEY);
    expect(log).not.toContain(QUERY);
    expect(log).not.toContain(token);
  });

  it('logs 401, 403, and 429 without the token or the query', async () => {
    const device = 'bb'.repeat(16);
    const { file, token } = await subscriber({ device });
    const badToken = 'a1.' + 'S'.repeat(40);
    const app = createApp(file, () => Promise.resolve({ status: 200, text: async () => rss('Nope') }));
    const log = await captureStderr(async () => {
      const denied = await postSearch(app, {
        token: badToken,
        device,
        headers: { 'x-forwarded-for': IP },
        body: { q: QUERY + ' apikey=' + KEY, deviceId: device },
      });
      expect(denied.status).toBe(401);
      const expired = await postSearch(app, {
        device,
        headers: { 'x-forwarded-for': IP },
        body: { q: QUERY, deviceId: device, source: 'jacred' },
      });
      expect(expired.status).toBe(403);
    });
    const lines = searchLogLines(log);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('source=jackett');
    expect(lines[0]).toContain('status=401');
    expect(lines[0]).toContain('abort=0');
    expect(lines[0]).toContain('indexers_ok=-');
    expect(lines[0]).toContain('results=0');
    expect(lines[0]).toContain('device=' + deviceHash(device));
    assertNoSecrets(lines[0], { device, token: badToken, query: QUERY });
    expect(lines[1]).toContain('source=jacred');
    expect(lines[1]).toContain('status=403');
    expect(lines[1]).toContain('indexers_ok=-');
    assertNoSecrets(lines[1], { device, token, query: QUERY });

    const limitedDevice = 'cc'.repeat(16);
    const limited = await subscriber({ device: limitedDevice });
    const limitedApp = createApp(limited.file, (url: string) => {
      if (isJsonList(url)) {
        return Promise.resolve({ status: 200, text: async () => JSON.stringify([{ id: 'rutor', configured: true }]) });
      }
      return Promise.resolve({ status: 200, text: async () => rss('Hit') });
    });
    const rateLog = await captureStderr(async () => {
      for (let i = 0; i < 31; i++) {
        const res = await postSearch(limitedApp, {
          token: limited.token,
          device: limitedDevice,
          body: { q: 'rate-bucket-query', deviceId: limitedDevice },
        });
        expect(res.status).toBe(i < 30 ? 200 : 429);
      }
    });
    const rateLines = searchLogLines(rateLog);
    expect(rateLines).toHaveLength(31);
    expect(rateLines[0]).toContain('status=200');
    expect(rateLines[0]).toContain('indexers_ok=1');
    expect(rateLines[30]).toContain('status=429');
    expect(rateLines[30]).toContain('abort=0');
    expect(rateLines[30]).toContain('results=0');
    expect(rateLines[30]).toContain('indexers_ok=-');
    expect(rateLines[30]).toContain('device=' + deviceHash(limitedDevice));
    assertNoSecrets(rateLines.join('\n'), { device: limitedDevice, token: limited.token, query: 'rate-bucket-query' });
  });

  it('logs abort=1 on req aborted and abort=0 on a normal body close', async () => {
    const device = 'dd'.repeat(16);
    const { file, token } = await subscriber({ device });
    const fetchImpl = (url: string) => {
      if (isJsonList(url)) {
        return Promise.resolve({ status: 200, text: async () => JSON.stringify([{ id: 'rutor', configured: true }]) });
      }
      return Promise.resolve({ status: 200, text: async () => rss('Still') });
    };
    const app = createApp(file, fetchImpl);
    const log = await captureStderr(async () => {
      const dropped = await postSearch(app, {
        token,
        device,
        client: 'abort',
        body: { q: QUERY, deviceId: device },
      });
      expect(dropped.status).toBe(200);
      const closed = await postSearch(app, {
        token,
        device,
        client: 'close',
        body: { q: 'other-close-query', deviceId: device },
      });
      expect(closed.status).toBe(200);
    });
    const lines = searchLogLines(log);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('abort=1');
    expect(lines[0]).toContain('status=200');
    expect(lines[1]).toContain('abort=0');
    expect(lines[1]).toContain('status=200');
    assertNoSecrets(lines[0], { device, token, query: QUERY });
  });

  it('logs abort=1 when the client drops the socket before the response', async () => {
    const device = 'ee'.repeat(16);
    const { file, token } = await subscriber({ device });
    const fetchImpl = (url: string) => {
      if (isJsonList(url)) {
        return Promise.resolve({ status: 200, text: async () => JSON.stringify([{ id: 'rutor', configured: true }]) });
      }
      return new Promise((resolve) => {
        setTimeout(() => resolve({ status: 200, text: async () => rss('Late Film') }), 250);
      });
    };
    const lines: string[] = [];
    const orig = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    const server = await listen(file, 0, fetchImpl, { host: '127.0.0.1' });
    try {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const ctrl = new AbortController();
      const pending = fetch('http://127.0.0.1:' + port + '/v1/search', {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + token,
          'x-device-id': device,
          'content-type': 'application/json',
          'x-forwarded-for': IP,
        },
        body: JSON.stringify({ q: 'socket-drop-query-zz', deviceId: device }),
        signal: ctrl.signal,
      }).catch((err) => err);
      setTimeout(() => ctrl.abort(), 40);
      await pending;
      const deadline = Date.now() + 3000;
      let line = '';
      while (Date.now() < deadline) {
        const found = lines.map((chunk) => String(chunk)).join('').split('\n').find((row) => row.indexOf('route=/v1/search') >= 0);
        if (found) {
          line = found.trim();
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(line).toContain('abort=1');
      expect(line).toContain('status=200');
      expect(line).toContain('source=jackett');
      expect(line).toContain('device=' + deviceHash(device));
      assertNoSecrets(line, { device, token, query: 'socket-drop-query-zz' });
    } finally {
      process.stderr.write = orig;
      await new Promise((resolve) => server.close(() => resolve(null)));
    }
  });

  it('logs abort=1 once when the response closes before finish', async () => {
    const device = 'a0'.repeat(16);
    const { file, token } = await subscriber({ device });
    const fetchImpl = (url: string) => {
      if (isJsonList(url)) {
        return Promise.resolve({ status: 200, text: async () => JSON.stringify([{ id: 'rutor', configured: true }]) });
      }
      return Promise.resolve({ status: 200, text: async () => rss('Buffered') });
    };
    const app = createApp(file, fetchImpl);
    const payload = JSON.stringify({ q: 'buffered-drop-query', deviceId: device });
    const req = new EventEmitter() as EventEmitter & {
      method: string;
      url: string;
      headers: { [key: string]: string };
      aborted: boolean;
    };
    req.method = 'POST';
    req.url = '/v1/search';
    req.aborted = false;
    req.headers = {
      authorization: 'Bearer ' + token,
      'x-device-id': device,
      'content-type': 'application/json',
    };
    req[Symbol.asyncIterator] = async function* () {
      yield Buffer.from(payload);
    };
    const res = new EventEmitter() as EventEmitter & {
      status: number;
      headers: { [key: string]: string | number };
      writableFinished: boolean;
      writeHead: (status: number, headers?: { [key: string]: string | number }) => void;
      end: (buf?: Buffer | string) => void;
    };
    res.status = 0;
    res.headers = {};
    res.writableFinished = false;
    res.writeHead = (status: number, headers?: { [key: string]: string | number }) => {
      res.status = status;
      if (headers) Object.assign(res.headers, headers);
    };
    // end() only buffers. 'finish' is not emitted until the socket drains.
    res.end = () => {};
    const before = await captureStderr(async () => {
      await app(req, res);
    });
    expect(res.status).toBe(200);
    expect(searchLogLines(before)).toEqual([]);
    const onClose = await captureStderr(async () => {
      res.emit('close');
    });
    const lines = searchLogLines(onClose);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('status=200');
    expect(lines[0]).toContain('abort=1');
    expect(lines[0]).toContain('source=jackett');
    assertNoSecrets(lines[0], { device, token, query: 'buffered-drop-query' });
    const onFinish = await captureStderr(async () => {
      res.writableFinished = true;
      res.emit('finish');
    });
    expect(searchLogLines(onFinish)).toEqual([]);
  });

  it('logs a JacRed search with indexer counts left unset', async () => {
    const device = 'ff'.repeat(16);
    const { file, token } = await subscriber({ device });
    const app = createApp(file, () =>
      Promise.resolve({
        status: 200,
        text: async () =>
          '<rss><channel><item><title>Jac</title><link>http://jacred.test:9118/dl/j?apikey=JACREDKEY</link></item><item><title>Two</title></item></channel></rss>',
      }),
    );
    let resStatus = 0;
    const log = await captureStderr(async () => {
      const res = await postSearch(app, {
        token,
        device,
        headers: { 'x-forwarded-for': IP },
        body: { source: 'jacred', q: 'Секретныйзапрос', deviceId: device },
      });
      resStatus = res.status;
    });
    expect(resStatus).toBe(200);
    const line = searchLogLines(log)[0];
    expect(line).toContain('source=jacred');
    expect(line).toContain('status=200');
    expect(line).toContain('results=2');
    expect(line).toContain('indexers_ok=-');
    expect(line).toContain('indexers_fail=-');
    expect(line).toContain('indexers_timeout=-');
    expect(line).toContain('abort=0');
    assertNoSecrets(line, { device, token, query: 'Секретныйзапрос' });
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
    const { file, device, token } = await subscriber();
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
    const { file, device, token } = await subscriber();
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

  it('turns a Jackett 401 or 403 into 502 upstream and logs the /dl indexer', async () => {
    const { file, device, token } = await subscriber();
    const link = 'omp-fetch:/dl/megapeer/?path=ENC&file=Name.torrent';
    for (const status of [401, 403]) {
      const seen: string[] = [];
      const logs: string[] = [];
      const orig = process.stderr.write;
      process.stderr.write = ((chunk: string | Uint8Array) => {
        logs.push(String(chunk));
        return true;
      }) as typeof process.stderr.write;
      try {
        const fetchImpl = (url: string) => {
          seen.push(String(url));
          return Promise.resolve({
            status,
            headers: {},
            arrayBuffer: async () => new ArrayBuffer(0),
          });
        };
        const app = createApp(file, fetchImpl);
        const res = await postTorrent(app, { token, device, link });
        expect(res.status).toBe(502);
        expect(JSON.parse(res.body)).toEqual({ error: 'upstream' });
        expect(String(res.headers['content-type'])).toContain('application/json');
        expect(seen).toHaveLength(1);
        const upstream = new URL(seen[0]);
        expect(upstream.origin + upstream.pathname).toBe(ORIGIN + '/dl/megapeer/');
        expect(upstream.searchParams.get('jackett_apikey')).toBe(KEY);
        expect(upstream.searchParams.get('apikey')).toBeNull();
        expect(upstream.searchParams.get('path')).toBe('ENC');
        expect(upstream.searchParams.get('file')).toBe('Name.torrent');
        const log = logs.join('');
        expect(log).toContain('status=' + status);
        expect(log).toContain('indexer=megapeer');
        expect(log).not.toContain(KEY);
        expect(log).not.toContain('jackett.test');
      } finally {
        process.stderr.write = orig;
      }
    }
  });

  it('keeps apikey on a JacRed download and hides its 401 the same way', async () => {
    const { file, device, token } = await subscriber();
    const seen: string[] = [];
    const logs: string[] = [];
    const orig = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      logs.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      const fetchImpl = (url: string) => {
        seen.push(String(url));
        return Promise.resolve({
          status: 401,
          headers: {},
          arrayBuffer: async () => new ArrayBuffer(0),
        });
      };
      const app = createApp(file, fetchImpl);
      const res = await postTorrent(app, { token, device, link: 'omp-jacred:/dl/nnmclub/?path=ENC&file=Name' });
      expect(res.status).toBe(502);
      expect(JSON.parse(res.body)).toEqual({ error: 'upstream' });
      expect(seen).toHaveLength(1);
      const upstream = new URL(seen[0]);
      expect(upstream.searchParams.get('apikey')).toBe('JACREDKEY');
      expect(upstream.searchParams.get('jackett_apikey')).toBeNull();
      expect(upstream.searchParams.get('path')).toBe('ENC');
      const log = logs.join('');
      expect(log).toContain('indexer=nnmclub');
      expect(log).toContain('status=401');
      expect(log).not.toContain('JACREDKEY');
    } finally {
      process.stderr.write = orig;
    }
  });
});
