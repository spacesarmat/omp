import { describe, it, expect, beforeEach } from 'vitest';
import {
  checkIndexer,
  checkedText,
  connLine,
  connTitle,
  getIndexerStatus,
  hasIndexerKey,
  jackettErrorState,
  prowlarrTrackers,
  refreshIndexerStatus,
  resetIndexerStatus,
  shortVersion,
  successText,
  summaryText,
  trackerStateText,
  STATUS_BAD_KEY,
  STATUS_DOWN,
  STATUS_NEED_KEY,
  JACKETT_HIDDEN_STATES,
  type IndexerStatus,
} from '../../src/sources/indexerStatus';
import { indexerKeyName, type IndexerConn } from '../../src/sources/indexerStore';
import { fakeSite, page, type HttpCall } from './fakeSite';

// test-only key
const KEY = 'test0only0key0000000000000000abc';
const NOW = 1_800_000_000_000;
const now = () => NOW;

const JACKETT: IndexerConn = { id: 'jackett-1', kind: 'jackett', url: 'http://192.168.1.5:9117', keySet: true };
const PROWLARR: IndexerConn = { id: 'prowlarr-1', kind: 'prowlarr', url: 'http://192.168.1.5:9696', keySet: true };

const INDEXERS_XML =
  '<?xml version="1.0" encoding="UTF-8"?><indexers>' +
  '<indexer id="rutor" configured="true"><title>RuTor</title></indexer>' +
  '<indexer id="nnmclub" configured="true"><title>NNM-Club</title></indexer>' +
  '<indexer id="kinozal" configured="true"><title>Kinozal</title></indexer>' +
  '<indexer id="rustorka" configured="true"><title>Rustorka</title></indexer>' +
  '<indexer id="torrentby" configured="true"><title>Torrent.by</title></indexer>' +
  '<indexer id="other" configured="false"><title>Unused</title></indexer>' +
  '</indexers>';

const ERRORS_JSON = JSON.stringify([
  { id: 'rutor', name: 'RuTor', last_error: '' },
  { id: 'nnmclub', name: 'NNM-Club' },
  { id: 'kinozal', name: 'Kinozal', last_error: 'Login failed: check your credentials' },
  { id: 'rustorka', name: 'Rustorka', last_error: 'Challenge detected: the site is protected by Cloudflare' },
  { id: 'torrentby', name: 'Torrent.by', last_error: 'The request timed out' },
]);

function jackettSite(errors: (c: HttpCall) => ReturnType<typeof page> = (c) => page(ERRORS_JSON, c.url)) {
  return fakeSite((c) => {
    if (c.url.indexOf('/results/torznab/api') >= 0) return page(INDEXERS_XML, c.url);
    if (c.url.indexOf('/api/v2.0/indexers?') >= 0) return errors(c);
    return page('', c.url, 404);
  }, { [indexerKeyName(JACKETT.id)]: KEY });
}

beforeEach(() => resetIndexerStatus());

describe('Jackett tracker status', () => {
  it('lists the configured trackers and maps their last errors', async () => {
    const site = jackettSite();
    const st = await checkIndexer(JACKETT, KEY, site.ctx.http, now);
    expect(st.state).toBe('ok');
    expect(st.at).toBe(NOW);
    expect(st.trackers.map((t) => t.name + ':' + trackerStateText(t))).toEqual([
      'RuTor:работает',
      'NNM-Club:работает',
      'Kinozal:нужен вход',
      'Rustorka:Cloudflare',
      'Torrent.by:не отвечает',
    ]);
    expect(trackerStateText(st.trackers[4], true)).toBe('ошибка: не отвечает');
    expect(summaryText(st)).toBe('5 трекеров, 2 работают');
    // the key goes only to Jackett's own address, as the Torznab apikey parameter
    expect(site.calls.every((c) => c.url.indexOf('http://192.168.1.5:9117/') === 0)).toBe(true);
    expect(site.calls[0].url).toContain('t=indexers');
  });

  it('without the UI list (admin password) the tracker states are unknown, never «работает»', async () => {
    const site = jackettSite((c) => page('<html><title>Login</title></html>', 'http://192.168.1.5:9117/UI/Login'));
    const st = await checkIndexer(JACKETT, KEY, site.ctx.http, now);
    expect(st.state).toBe('ok');
    expect(st.trackers.every((t) => t.state === 'unknown')).toBe(true);
    expect(trackerStateText(st.trackers[0])).toBe('состояние неизвестно');
    expect(summaryText(st)).toBe('5 трекеров · состояние неизвестно');
    expect(summaryText(st)).not.toContain('работа');
    expect(st.hint).toBe(JACKETT_HIDDEN_STATES);
    expect(connLine(st, true)).toEqual({ text: 'напрямую · 5 трекеров · состояние неизвестно', tone: 'ok' });
    // an older Jackett without last_error: unknown too
    const old = jackettSite((c) => page(JSON.stringify([{ id: 'rutor', name: 'RuTor' }, { id: 'kinozal', name: 'Kinozal' }]), c.url));
    expect((await checkIndexer(JACKETT, KEY, old.ctx.http, now)).trackers.every((t) => t.state === 'unknown')).toBe(true);
    const failing = jackettSite(() => {
      throw new Error('net ' + KEY);
    });
    const f = await checkIndexer(JACKETT, KEY, failing.ctx.http, now);
    expect(f.state).toBe('ok');
    expect(f.trackers.every((t) => t.state === 'unknown')).toBe(true);
  });

  it('a wrong key: 401, or the Torznab error 100 in a 200 answer', async () => {
    const s401 = fakeSite((c) => page('', c.url, 401));
    expect(await checkIndexer(JACKETT, KEY, s401.ctx.http, now)).toMatchObject({ state: 'badkey', message: STATUS_BAD_KEY });
    const s100 = fakeSite((c) => page('<error code="100" description="Invalid API Key"/>', c.url));
    expect(await checkIndexer(JACKETT, KEY, s100.ctx.http, now)).toMatchObject({ state: 'badkey', message: STATUS_BAD_KEY });
  });

  it('a native failure is «не отвечает» and its text (it may hold the keyed URL) is never passed on', async () => {
    const site = fakeSite((c) => {
      throw new Error('failed ' + c.url);
    });
    const st = await checkIndexer(JACKETT, KEY, site.ctx.http, now);
    expect(st).toMatchObject({ state: 'down', message: STATUS_DOWN });
    expect(JSON.stringify(st)).not.toContain(KEY);
  });

  it('error texts map to states', () => {
    expect(jackettErrorState('')).toEqual({ state: 'ok' });
    expect(jackettErrorState('DDoS-Guard protection')).toEqual({ state: 'cloudflare' });
    expect(jackettErrorState('Captcha required')).toEqual({ state: 'login' });
    expect(jackettErrorState('No such host is known')).toEqual({ state: 'error', detail: 'не отвечает' });
    expect(jackettErrorState('Parse error')).toEqual({ state: 'error' });
  });
});

describe('Prowlarr tracker status', () => {
  const indexers = [
    { id: 1, name: 'RuTor', enable: true, protocol: 'torrent' },
    { id: 2, name: 'NNM-Club', enable: true, protocol: 'torrent' },
    { id: 3, name: 'Kinozal', enable: false, protocol: 'torrent' },
    { id: 4, name: 'Torrent.by', enable: true, protocol: 'torrent' },
    { id: 5, name: 'Usenet one', enable: true, protocol: 'usenet' },
    { id: 6, name: 'RuTracker', enable: true, protocol: 'torrent' },
  ];
  const statuses = [
    { indexerId: 4, disabledTill: new Date(NOW + 3600000).toISOString(), mostRecentFailure: new Date(NOW - 60000).toISOString() },
    { indexerId: 6, mostRecentFailure: new Date(NOW - 60000).toISOString(), escalationLevel: 1 },
    // recovered: the failure is old, or the escalation went back to 0 after a success
    { indexerId: 1, mostRecentFailure: new Date(NOW - 3 * 3600000).toISOString(), escalationLevel: 1 },
    { indexerId: 2, mostRecentFailure: new Date(NOW - 60000).toISOString(), escalationLevel: 0 },
    { indexerId: 3, disabledTill: new Date(NOW - 60000).toISOString() },
  ];

  it('maps /api/v1/indexer + /api/v1/indexerstatus with the key in the header only', async () => {
    const site = fakeSite((c) => {
      if (c.url.endsWith('/api/v1/system/status')) return page(JSON.stringify({ version: '2.1.5.4925' }), c.url);
      if (c.url.endsWith('/api/v1/indexer')) return page(JSON.stringify(indexers), c.url);
      if (c.url.endsWith('/api/v1/indexerstatus')) return page(JSON.stringify(statuses), c.url);
      return page('', c.url, 404);
    });
    const st = await checkIndexer(PROWLARR, KEY, site.ctx.http, now);
    expect(st.state).toBe('ok');
    expect(st.version).toBe('2.1');
    expect(st.trackers.map((t) => t.name + ':' + t.state)).toEqual(['RuTor:ok', 'NNM-Club:ok', 'Kinozal:off', 'Torrent.by:error', 'RuTracker:error']);
    expect(trackerStateText(st.trackers[2])).toBe('выключен');
    expect(successText('prowlarr', st)).toBe('Prowlarr 2.1 · 5 трекеров, 2 работают');
    expect(site.calls.every((c) => c.url.indexOf(KEY) < 0 && c.opts!.headers!['X-Api-Key'] === KEY)).toBe(true);
  });

  it('a refused key and odd answers', async () => {
    const s401 = fakeSite((c) => page('', c.url, 401));
    expect((await checkIndexer(PROWLARR, KEY, s401.ctx.http, now)).state).toBe('badkey');
    const html = fakeSite((c) => page('<html></html>', c.url));
    expect((await checkIndexer(PROWLARR, KEY, html.ctx.http, now)).state).toBe('error');
    const s500 = fakeSite((c) => page('', c.url, 500));
    expect(await checkIndexer(PROWLARR, KEY, s500.ctx.http, now)).toMatchObject({ state: 'error', message: 'Индексатор ответил ошибкой 500' });
  });

  it('pure mapping ignores junk', () => {
    expect(prowlarrTrackers(null, null, NOW)).toEqual([]);
    expect(prowlarrTrackers([{ id: 1 }, 'x', { id: 2, name: '  A  b ' }], 'junk', NOW)).toEqual([{ name: 'A b', state: 'ok' }]);
    expect(shortVersion('1.24.3')).toBe('1.24');
    expect(shortVersion(5)).toBeUndefined();
  });
});

describe('key re-prompt and cache', () => {
  it('«ключ задан» but no key on this device (restored backup) -> «нужен API-ключ», no request', async () => {
    const site = fakeSite((c) => page('', c.url, 401), {});
    const st = await refreshIndexerStatus(JACKETT, site.ctx, now);
    expect(st).toMatchObject({ state: 'nokey', message: STATUS_NEED_KEY });
    expect(site.calls).toHaveLength(0);
    expect(getIndexerStatus(JACKETT.id)).toBe(st);
    expect(connLine(st, true)).toEqual({ text: 'нужен API-ключ', tone: 'warn' });
    expect(await hasIndexerKey(JACKETT, site.ctx)).toBe(false);
    const noKeySet = await refreshIndexerStatus({ ...JACKETT, keySet: false }, site.ctx, now);
    expect(noKeySet.state).toBe('nokey');
  });

  it('with the saved key the check runs and is cached', async () => {
    const site = jackettSite();
    const st = await refreshIndexerStatus(JACKETT, site.ctx, now);
    expect(st.state).toBe('ok');
    expect(getIndexerStatus(JACKETT.id)!.trackers).toHaveLength(5);
    expect(await hasIndexerKey(JACKETT, site.ctx)).toBe(true);
  });
});

describe('texts', () => {
  const st = (n: number, ok: number): IndexerStatus => ({
    state: 'ok',
    at: 0,
    trackers: Array.from({ length: n }, (_, i) => ({ name: 't' + i, state: i < ok ? 'ok' : 'error' })),
  });

  it('plurals', () => {
    expect(summaryText(st(1, 1))).toBe('1 трекер, 1 работает');
    expect(summaryText(st(3, 2))).toBe('3 трекера, 2 работают');
    expect(summaryText(st(9, 8))).toBe('9 трекеров, 8 работают');
    expect(summaryText(st(21, 21))).toBe('21 трекер, 21 работает');
    expect(summaryText(st(0, 0))).toBe('нет трекеров');
  });

  it('checked time', () => {
    expect(checkedText(NOW - 10000, NOW)).toBe('Проверено только что');
    expect(checkedText(NOW - 5 * 60000, NOW)).toBe('Проверено 5 минут назад');
    expect(checkedText(NOW - 1 * 60000, NOW)).toBe('Проверено 1 минуту назад');
    expect(checkedText(NOW - 2 * 3600000, NOW)).toBe('Проверено 2 часа назад');
    expect(checkedText(NOW - 3 * 86400000, NOW)).toBe('Проверено 3 дня назад');
  });

  it('titles and lines', () => {
    expect(connTitle(JACKETT)).toBe('Jackett · 192.168.1.5');
    expect(connTitle({ ...PROWLARR, name: 'Дом' })).toBe('Дом · 192.168.1.5');
    expect(connLine(st(6, 5), true)).toEqual({ text: 'напрямую · 6 трекеров, 5 работают', tone: 'ok' });
    expect(connLine(null, true).tone).toBe('muted');
    expect(connLine({ state: 'down', at: 0, trackers: [] }, true)).toEqual({ text: 'не отвечает', tone: 'bad' });
  });
});
