import { describe, it, expect, beforeEach } from 'vitest';
import { FLARE_KEY, flareSolverrUrl, normalizeFlareUrl, onFlareChange, sanitizeFlare, setFlareSolverrUrl } from '../../src/sources/flareStore';
import {
  BAD_ADDRESS,
  checkFlareSolverr,
  checkText,
  flareScanDue,
  flareStatus,
  NOT_ANSWERING,
  NOT_FLARE,
  phoneFlareNote,
  readyVersion,
  refreshFlareStatus,
  scanFlareSolverr,
  SCAN_EVERY_MS,
  setFlareStatus,
  shortVersion,
  TV_FLARE_CHECKING,
  TV_FLARE_NONE,
  TV_FLARE_OK,
  tvFlareLines,
  tvFlareRefresh,
} from '../../src/sources/flaresolverr';
import type { HttpOptions, HttpResponse, SourceHttp } from '../../src/sources/types';

const NOW = 1_800_000_000_000;
const READY = JSON.stringify({ msg: 'FlareSolverr is ready!', version: '3.4.0', userAgent: 'Mozilla/5.0' });

let calls: { url: string; opts?: HttpOptions }[];
let answers: { [url: string]: HttpResponse | 'down' };

const http: SourceHttp = {
  get: (url, opts) => {
    calls.push({ url, opts });
    const a = answers[url];
    if (!a || a === 'down') return Promise.reject(new Error('Сайт не отвечает'));
    return Promise.resolve(a);
  },
  post: () => Promise.reject(new Error('x')),
  clearCookies: () => Promise.resolve(),
};

function ok(url: string, text = READY, status = 200): HttpResponse {
  return { status, url, text };
}

beforeEach(() => {
  localStorage.clear();
  calls = [];
  answers = {};
  setFlareStatus(null);
});

describe('flareStore', () => {
  it('normalizes addresses', () => {
    expect(normalizeFlareUrl('192.168.1.191')).toBe('http://192.168.1.191:8191');
    expect(normalizeFlareUrl(' 192.168.1.191:8192/ ')).toBe('http://192.168.1.191:8192');
    expect(normalizeFlareUrl('HTTP://NAS.local:8191/')).toBe('http://nas.local:8191');
    expect(normalizeFlareUrl('https://flare.example.com')).toBe('https://flare.example.com');
    expect(normalizeFlareUrl('http://h:8191/proxy/?x=1#y')).toBe('http://h:8191/proxy');
    expect(normalizeFlareUrl('http://user:pw@h:8191')).toBeNull();
    expect(normalizeFlareUrl('ftp://h')).toBeNull();
    expect(normalizeFlareUrl('http://h:99999')).toBeNull();
    expect(normalizeFlareUrl('')).toBeNull();
    expect(normalizeFlareUrl(5)).toBeNull();
  });

  it('keeps only a clean address', () => {
    expect(sanitizeFlare({ url: '192.168.1.5', cookies: 'x' })).toEqual({ url: 'http://192.168.1.5:8191' });
    expect(sanitizeFlare({ url: 'javascript:alert(1)' })).toBeNull();
    expect(sanitizeFlare('http://h')).toBeNull();
    localStorage.setItem(FLARE_KEY, '{"url":"bad url"}');
    expect(flareSolverrUrl()).toBeNull();
    localStorage.setItem(FLARE_KEY, 'not json');
    expect(flareSolverrUrl()).toBeNull();
  });

  it('saves, forgets and tells listeners', () => {
    let n = 0;
    const off = onFlareChange(() => n++);
    setFlareSolverrUrl('192.168.1.5');
    expect(flareSolverrUrl()).toBe('http://192.168.1.5:8191');
    expect(JSON.parse(localStorage.getItem(FLARE_KEY)!)).toEqual({ url: 'http://192.168.1.5:8191' });
    setFlareSolverrUrl(null);
    expect(flareSolverrUrl()).toBeNull();
    off();
    setFlareSolverrUrl('h');
    expect(n).toBe(2);
  });
});

describe('check', () => {
  it('reads the version and the answer time', async () => {
    answers['http://192.168.1.5:8191/'] = ok('http://192.168.1.5:8191/');
    let t = NOW;
    const c = await checkFlareSolverr('192.168.1.5', http, () => (t += 300));
    expect(c).toEqual({ ok: true, version: '3.4.0', ms: 300 });
    expect(checkText(c)).toBe('Работает · версия 3.4 · ответ 0,3 с');
    expect(calls[0].opts!.timeoutMs).toBeGreaterThan(0);
  });

  it('tells a stranger, a silent address and a bad one apart', async () => {
    answers['http://192.168.1.5:8191/'] = ok('http://192.168.1.5:8191/', '<html>router</html>');
    expect(await checkFlareSolverr('http://192.168.1.5:8191', http)).toEqual({ ok: false, message: NOT_FLARE });
    answers['http://192.168.1.6:8191/'] = ok('http://192.168.1.6:8191/', READY, 500);
    expect(await checkFlareSolverr('http://192.168.1.6:8191', http)).toEqual({ ok: false, message: NOT_FLARE });
    expect(await checkFlareSolverr('http://192.168.1.7:8191', http)).toEqual({ ok: false, message: NOT_ANSWERING });
    expect(await checkFlareSolverr('ftp://x', http)).toEqual({ ok: false, message: BAD_ADDRESS });
    expect(calls.length).toBe(3);
  });

  it('versions', () => {
    expect(shortVersion('3.4.0')).toBe('3.4');
    expect(shortVersion('v3.3.21')).toBe('3.3');
    expect(readyVersion('{"msg":"FlareSolverr is ready!"}')).toBe('');
    expect(readyVersion('{"msg":"other"}')).toBeNull();
    expect(readyVersion('[]')).toBeNull();
    expect(checkText({ ok: true, version: '', ms: 1200 })).toBe('Работает · ответ 1,2 с');
  });

  it('remembers the last check of the saved address', async () => {
    expect(await refreshFlareStatus(http)).toBeNull();
    setFlareSolverrUrl('192.168.1.5');
    answers['http://192.168.1.5:8191/'] = ok('http://192.168.1.5:8191/');
    const s = await refreshFlareStatus(http, () => NOW);
    expect(s!.check.ok).toBe(true);
    expect(flareStatus()).toEqual(s);
  });
});

describe('LAN search', () => {
  it('probes private hits on 8191 one by one and keeps FlareSolverr only', async () => {
    answers['http://192.168.1.5:8191/'] = ok('http://192.168.1.5:8191/');
    answers['http://192.168.1.9:8191/'] = ok('http://192.168.1.9:8191/', 'nginx');
    let asked: number[] = [];
    const found = await scanFlareSolverr(
      (ports) => {
        asked = ports;
        return Promise.resolve([
          { ip: '192.168.1.5', port: 8191 },
          { ip: '192.168.1.5', port: 8191 },
          { ip: '192.168.1.9', port: 8191 },
          { ip: '8.8.8.8', port: 8191 },
          { ip: '192.168.1.10', port: 9117 },
        ]);
      },
      http,
      () => NOW,
    );
    expect(asked).toEqual([8191]);
    expect(found).toEqual(['http://192.168.1.5:8191']);
    expect(calls.map((c) => c.url)).toEqual(['http://192.168.1.5:8191/', 'http://192.168.1.9:8191/']);
    // only the time is kept, never the addresses
    expect(localStorage.getItem('tsp.flareScan')).toBe(JSON.stringify({ at: NOW }));
    expect(flareScanDue(NOW + 1000)).toBe(false);
    expect(flareScanDue(NOW + SCAN_EVERY_MS)).toBe(true);
    expect(flareScanDue(NOW - 1)).toBe(true);
  });

  it('off a home network or on a failed scan: null, nothing saved', async () => {
    expect(await scanFlareSolverr(() => Promise.resolve(null), http)).toBeNull();
    expect(await scanFlareSolverr(() => Promise.reject(new Error('x')), http)).toBeNull();
    expect(localStorage.getItem('tsp.flareScan')).toBeNull();
    expect(flareScanDue(NOW)).toBe(true);
  });

  it('TV: searches once a day without an address and keeps the first found', async () => {
    answers['http://192.168.1.5:8191/'] = ok('http://192.168.1.5:8191/');
    let scans = 0;
    const scan = () => {
      scans++;
      return Promise.resolve([{ ip: '192.168.1.5', port: 8191 }]);
    };
    const s = await tvFlareRefresh(http, scan, () => NOW);
    expect(flareSolverrUrl()).toBe('http://192.168.1.5:8191');
    expect(s!.check.ok).toBe(true);
    // with an address: checked, not searched
    await tvFlareRefresh(http, scan, () => NOW + 10);
    expect(scans).toBe(1);
    // nothing found today: no new search until tomorrow
    setFlareSolverrUrl(null);
    await tvFlareRefresh(http, scan, () => NOW + 20);
    expect(scans).toBe(1);
  });
});

describe('texts', () => {
  it('TV block', () => {
    expect(tvFlareLines(null, null)).toEqual({ where: '', state: TV_FLARE_NONE, tone: 'muted' });
    const url = 'http://192.168.1.191:8191';
    expect(tvFlareLines(url, null)).toEqual({ where: '192.168.1.191:8191', state: TV_FLARE_CHECKING, tone: 'muted' });
    expect(tvFlareLines(url, { url, at: NOW, check: { ok: true, version: '3.4.0', ms: 300 } })).toEqual({
      where: '192.168.1.191:8191 · версия 3.4',
      state: TV_FLARE_OK,
      tone: 'ok',
    });
    expect(tvFlareLines(url, { url, at: NOW, check: { ok: false, message: NOT_ANSWERING } }).tone).toBe('bad');
    // a check of another address is not shown
    expect(tvFlareLines(url, { url: 'http://x:8191', at: NOW, check: { ok: true, version: '3', ms: 1 } }).state).toBe(TV_FLARE_CHECKING);
  });

  it('phone row', () => {
    expect(phoneFlareNote(null, null).text).toBe('не задан · запасной путь для сайтов за Cloudflare');
    const url = 'http://192.168.1.191:8191';
    expect(phoneFlareNote(url, { url, at: NOW, check: { ok: true, version: '3.4.0', ms: 1 } })).toEqual({ text: '192.168.1.191:8191 · работает', tone: 'ok' });
    expect(phoneFlareNote(url, { url, at: NOW, check: { ok: false, message: NOT_ANSWERING } }).tone).toBe('bad');
  });
});
