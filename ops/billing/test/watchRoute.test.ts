import { describe, expect, it } from 'vitest';
import { createSubscription } from '../src/logic.mjs';
import { createApp } from '../src/server.mjs';
import { createCacheRepo } from '../src/db/pg/cacheNodesSql.mjs';
import { createWatchRepo, rankSearchXml } from '../src/db/pg/watchSql.mjs';
import { runWatchFollow } from '../src/watchFollow.mjs';
import { emptyState } from '../src/state.mjs';
import { testStore, writeState } from './pg';

const A = 'aa'.repeat(20);
const B = 'bb'.repeat(20);
const DEV = 'c'.repeat(32);

function mockRes() {
  return {
    status: 0,
    headers: {} as Record<string, string>,
    body: '',
    writeHead(status: number, headers?: Record<string, string>) {
      this.status = status;
      if (headers) Object.assign(this.headers, headers);
    },
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
    },
    end(buf?: Buffer | string) {
      this.body = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf || '');
    },
  };
}

async function call(
  app: (req: unknown, res: unknown) => Promise<void>,
  method: string,
  path: string,
  opts: { json?: unknown; headers?: Record<string, string> } = {},
) {
  const payload = opts.json === undefined ? '' : JSON.stringify(opts.json);
  const req = {
    method,
    url: path,
    headers: {
      'content-type': opts.json === undefined ? '' : 'application/json',
      ...(opts.headers || {}),
    },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload);
    },
  };
  const res = mockRes();
  await app(req, res);
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(res.body) as Record<string, unknown>;
  } catch (e) {
    data = {};
  }
  return { status: res.status, data, headers: res.headers, body: res.body };
}

function rss(title: string, hash: string, seeds: number) {
  return (
    '<item><title>' +
    title +
    '</title><torznab:attr name="seeders" value="' +
    seeds +
    '"/><torznab:attr name="infohash" value="' +
    hash +
    '"/><link>magnet:?xt=urn:btih:' +
    hash +
    '</link></item>'
  );
}

describe('watch signals and rank', () => {
  it('keeps one vote, ranks the release that played, and warms the cache once', async () => {
    const file = await testStore();
    const now = Date.now();
    const created = createSubscription(emptyState(), { accountId: 'acc-watch', now, days: 30 });
    await writeState(file, created.state);
    const app = createApp(file, async () => ({ status: 200, headers: { get: () => null }, text: async () => '' }), {
      env: {},
      monitor: { health: () => null },
    });
    const activated = await call(app, 'POST', '/v1/activate', { json: { code: created.result.code, deviceId: DEV, tokens: 'pair' } });
    expect(activated.status).toBe(200);
    const headers = { authorization: 'Bearer ' + (activated.data.accessToken as string), 'x-device-id': DEV };
    const signal = {
      deviceClass: 'tv',
      help: true,
      codecs: 'h264,hevc',
      items: [
        {
          infohash: B,
          file: 0,
          title: 'Show S01E02 2160p HDR',
          season: 1,
          episode: 2,
          ttffMs: 900,
          rebufferCount: 0,
          rebufferMs: 0,
          watchedPct: 95,
          completed: true,
          voice: 'LostFilm',
          codecOk: true,
        },
      ],
    };
    const first = await call(app, 'POST', '/v1/watch-signals', { json: signal, headers });
    expect(first.status).toBe(200);
    expect(first.data.accepted).toBe(1);
    const second = await call(app, 'POST', '/v1/watch-signals', { json: signal, headers });
    expect(second.data.accepted).toBe(1);
    const samples = await file.query('SELECT samples FROM watch_release_stats WHERE infohash = $1', [B]);
    expect(samples.rows[0].samples).toBe(1);
    const off = await call(app, 'POST', '/v1/watch-signals', { json: { help: false, items: signal.items }, headers });
    expect(off.data.accepted).toBe(0);
    const repo = createWatchRepo(file);
    const xml =
      '<?xml version="1.0"?><rss><channel>' + rss('Other', A, 2) + rss('Show S01E02 2160p HDR', B, 5) + '</channel></rss>';
    const ranked = await rankSearchXml(repo, xml, { deviceClass: 'tv', now, readOnly: false });
    expect(ranked.indexOf(B)).toBeLessThan(ranked.indexOf(A));
    expect(ranked).toContain('omp_voice" value="LostFilm"');
    const best = await call(app, 'GET', '/v1/watch-best?titleKey=Show&season=1&episode=2&deviceClass=tv', { headers });
    expect(best.status).toBe(200);
    await runWatchFollow(repo, null, { watchRankEnabled: true, cacheNodesEnabled: false }, now);
    const after = await call(app, 'GET', '/v1/watch-best?titleKey=Show%20S01E02&season=1&episode=2&deviceClass=tv', { headers });
    expect(after.data.infohash).toBe(B);
    const cache = createCacheRepo((sql: string, params: unknown[]) => file.query(sql, params));
    const warmed = await runWatchFollow(repo, cache, { watchRankEnabled: true, cacheNodesEnabled: true }, now);
    expect(warmed.warmed).toBeGreaterThan(0);
    const interest = await file.query('SELECT plays, seeders FROM cache_interest WHERE infohash = $1', [B]);
    expect(interest.rows[0].plays).toBeGreaterThan(0);
    const again = await runWatchFollow(repo, cache, { watchRankEnabled: true, cacheNodesEnabled: true }, now + 1000);
    expect(again.warmed).toBe(0);
    const abandoned = now - 22 * 24 * 60 * 60 * 1000;
    await file.query('UPDATE watch_best SET updated_at = $1, warmed_at = 0', [abandoned]);
    await file.query('UPDATE watch_follow SET updated_at = $1', [abandoned]);
    const stale = await runWatchFollow(repo, cache, { watchRankEnabled: true, cacheNodesEnabled: true }, now);
    expect(stale.warmed).toBe(0);
    const admin = await call(app, 'GET', '/admin/api/watch-rank');
    expect(admin.status).toBe(401);
  });
});
