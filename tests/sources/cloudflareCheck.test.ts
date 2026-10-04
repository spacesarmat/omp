import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  BYPASS_WARNING,
  checkResultOf,
  clearanceText,
  NO_PHONE,
  onSearchFailure,
  phoneCheckRequest,
  runCloudflareCheck,
  setCloudflareChecker,
  sheetText,
  SHEET_NOTE_TV,
  SHEET_TITLE,
  TV_ERRORS,
  TV_HINT,
  tvCheckRequest,
  tvSiteNote,
  tvTitle,
  visibleCheckUrl,
  type CheckResult,
} from '../../src/sources/cloudflareCheck';
import { CF_INTERACTIVE, toCloudflareError } from '../../src/sources/cloudflare';
import { registerSource, unregisterSource } from '../../src/sources/registry';
import { siteOptions } from '../../src/sources/site';
import {
  isCloudflareBypassOn,
  isSourceOn,
  reloadSourcePrefs,
  sanitizeSourcePrefs,
  setCloudflareBypass,
  setSourceOn,
} from '../../src/sources/store';
import { clearLog, logEntries } from '../../src/lib/log';
import { tvChecker, installTvCloudflare } from '../../src/sources/cloudflareTv';
import type { Source } from '../../src/sources/types';

const site: Source = {
  id: 'rustorka',
  name: 'rustorka',
  kind: 'builtin',
  cloudflare: true,
  siteUrl: 'https://rustorka.example/',
  search: () => Promise.resolve([]),
};
const plain: Source = { id: 'plain', name: 'plain', kind: 'builtin', search: () => Promise.resolve([]) };

const interactive = () => toCloudflareError({ code: 'cloudflare-interactive', message: CF_INTERACTIVE }, 'https://rustorka.example/tracker.php?nm=secret')!;

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((a) => {
    resolve = a;
  });
  return { promise, resolve };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  localStorage.clear();
  reloadSourcePrefs();
  clearLog();
  registerSource(site);
  registerSource(plain);
});
afterEach(() => {
  setCloudflareChecker(null);
  unregisterSource('rustorka');
  unregisterSource('plain');
});

describe('copy of the visible check', () => {
  it('phone sheet and TV dialog texts follow the mockups', () => {
    expect(SHEET_TITLE).toBe('Подтвердите, что вы не робот');
    expect(sheetText('rustorka')).toBe('Сайт rustorka просит пройти проверку Cloudflare.');
    expect(sheetText('rustorka', 'Гостиная')).toBe('Сайт rustorka просит пройти проверку Cloudflare. Это нужно для телевизора «Гостиная».');
    expect(tvTitle('rustorka')).toBe('rustorka: проверка Cloudflare');
    expect(TV_HINT.replace('%s', 'Pixel 8')).toBe('Телефон «Pixel 8» получит запрос');
    expect(BYPASS_WARNING).toBe(
      'Обход проверки может нарушать правила сайта. Включайте на свой риск. OMP обращается только к самому сайту и к вашему FlareSolverr.',
    );
  });

  it('requests carry every text and no secret', () => {
    const tv = tvCheckRequest({ name: 'rustorka', url: 'https://rustorka.example/' });
    expect(tv).toMatchObject({ mode: 'tv', title: 'rustorka: проверка Cloudflare', phone: 'Пройти на телефоне', remote: 'Отметить пультом', cancel: 'Отмена', noPhone: NO_PHONE });
    expect(tv.errors).toBe(TV_ERRORS);
    expect(Object.keys(TV_ERRORS).sort()).toEqual(['BUSY', 'CANCELLED', 'FAILED', 'NOT_TAKEN', 'STORE_FAILED', 'TIMEOUT']);
    const own = phoneCheckRequest({ name: 'rustorka', url: 'https://rustorka.example/' });
    expect(own).toEqual({ url: 'https://rustorka.example/', site: 'rustorka', mode: 'phone', title: SHEET_TITLE, text: sheetText('rustorka'), cancel: 'Отмена' });
    const forTv = phoneCheckRequest({ name: 'rustorka', url: 'https://rustorka.example/' }, { id: 'c7', tv: 'Гостиная' });
    expect(forTv.note).toBe(SHEET_NOTE_TV);
    expect(forTv.forTv).toBe('c7');
    expect(forTv.text).toContain('«Гостиная»');
    expect(checkResultOf({ result: 'solved' })).toBe('solved');
    expect(checkResultOf({ result: 'weird' })).toBe('failed');
    expect(checkResultOf(null)).toBe('failed');
  });

  it('status line «проверка пройдена · действует до HH:MM»', () => {
    const now = new Date(2026, 9, 4, 20, 0).getTime();
    expect(clearanceText(new Date(2026, 9, 4, 22, 40).getTime(), now)).toBe('проверка пройдена · действует до 22:40');
    expect(clearanceText(new Date(2026, 9, 4, 21, 5).getTime(), now)).toBe('проверка пройдена · действует до 21:05');
    expect(clearanceText(now - 1, now)).toBeNull();
    expect(clearanceText(null, now)).toBeNull();
    expect(tvSiteNote(false, false, null, now)).toEqual({ text: 'выключен', tone: 'muted' });
    expect(tvSiteNote(true, true, null, now)).toEqual({ text: 'нужна проверка — пройдите на телефоне', tone: 'warn' });
    expect(tvSiteNote(true, false, new Date(2026, 9, 4, 22, 40).getTime(), now).text).toBe('обход Cloudflare · проверка пройдена · действует до 22:40');
    expect(tvSiteNote(true, false, null, now)).toEqual({ text: 'обход Cloudflare', tone: 'ok' });
  });
});

describe('per-site switch «Обходить проверку Cloudflare»', () => {
  it('is off by default, persists, and only counts for sites behind Cloudflare', () => {
    expect(isCloudflareBypassOn(site)).toBe(false);
    setCloudflareBypass('rustorka', true);
    setCloudflareBypass('plain', true);
    reloadSourcePrefs();
    expect(isCloudflareBypassOn(site)).toBe(true);
    expect(isCloudflareBypassOn(plain)).toBe(false);
    // the search switch keeps its default and its own value
    expect(isSourceOn(site)).toBe(true);
    setSourceOn('rustorka', false);
    expect(isCloudflareBypassOn(site)).toBe(true);
    expect(JSON.parse(localStorage.getItem('tsp.sources')!).rustorka).toEqual({ on: false, cloudflareBypass: true });
    setCloudflareBypass('rustorka', false);
    expect(JSON.parse(localStorage.getItem('tsp.sources')!).rustorka).toEqual({ on: false });
    expect(sanitizeSourcePrefs({ a: { cloudflareBypass: true }, b: { cloudflareBypass: 'yes' }, c: { on: true, cloudflareBypass: 1 } })).toEqual({
      a: { cloudflareBypass: true },
      c: { on: true },
    });
  });

  it('the site sends { cloudflare: true } only while its switch is on', () => {
    expect(siteOptions(site)).toEqual({ siteName: 'rustorka' });
    setCloudflareBypass('rustorka', true);
    expect(siteOptions(site, { timeoutMs: 5000 })).toEqual({ timeoutMs: 5000, siteName: 'rustorka', cloudflare: true });
    expect(siteOptions(plain, { cloudflare: true })).toEqual({ siteName: 'plain' });
  });
});

describe('opening the visible check from a search', () => {
  it('needs the switch, an interactive check and a checker', () => {
    expect(visibleCheckUrl(site, interactive())).toBeNull();
    setCloudflareChecker(() => Promise.resolve('solved'));
    expect(visibleCheckUrl(site, interactive())).toBeNull();
    setCloudflareBypass('rustorka', true);
    expect(visibleCheckUrl(site, interactive())).toBe('https://rustorka.example/');
    expect(visibleCheckUrl(site, new Error('Сайт ответил ошибкой 500'))).toBeNull();
    expect(visibleCheckUrl(site, toCloudflareError({ code: 'cloudflare' }, 'https://rustorka.example/'))).toBeNull();
  });

  it('opens once per site per search and retries the search when passed; logs the site name only', async () => {
    setCloudflareBypass('rustorka', true);
    const opened: { name: string; url: string }[] = [];
    let answer: CheckResult = 'solved';
    setCloudflareChecker((s) => {
      opened.push(s);
      return Promise.resolve(answer);
    });
    let retries = 0;
    const asked = {};
    expect(onSearchFailure('rustorka', interactive(), asked, () => retries++)).toBe(true);
    await tick();
    expect(opened).toEqual([{ name: 'rustorka', url: 'https://rustorka.example/' }]);
    expect(retries).toBe(1);
    // the retried search fails the same way: not again
    expect(onSearchFailure('rustorka', interactive(), asked, () => retries++)).toBe(false);
    expect(onSearchFailure('plain', interactive(), {}, () => retries++)).toBe(false);
    // closed without passing: no retry
    answer = 'cancelled';
    onSearchFailure('rustorka', interactive(), {}, () => retries++);
    await tick();
    expect(retries).toBe(1);
    const lines = logEntries().map((e) => e.x);
    expect(lines).toContain('Cloudflare: проверка пройдена · rustorka');
    expect(lines.join(' ')).not.toContain('secret');
    expect(lines.join(' ')).not.toContain('rustorka.example');
  });

  it('one check at a time; the same site joins the open one; no checker → failed', async () => {
    expect(await runCloudflareCheck('rustorka', 'https://rustorka.example/')).toBe('failed');
    const gates: { [u: string]: ReturnType<typeof deferred<CheckResult>> } = {};
    const order: string[] = [];
    setCloudflareChecker((s) => {
      order.push(s.url);
      gates[s.url] = deferred<CheckResult>();
      return gates[s.url].promise;
    });
    const a = runCloudflareCheck('rustorka', 'https://rustorka.example/forum/');
    const a2 = runCloudflareCheck('rustorka', 'https://rustorka.example/x');
    const b = runCloudflareCheck('other', 'https://other.example/');
    await tick();
    expect(order).toEqual(['https://rustorka.example/']);
    gates['https://rustorka.example/'].resolve('solved');
    expect(await a).toBe('solved');
    expect(await a2).toBe('solved');
    await tick();
    expect(order).toEqual(['https://rustorka.example/', 'https://other.example/']);
    gates['https://other.example/'].resolve('busy');
    expect(await b).toBe('busy');
  });
});

describe('Android TV checker', () => {
  it('passes the TV dialog texts to the native side and maps its answer', async () => {
    const seen: unknown[] = [];
    const plugin = {
      cloudflareVisible: (o: unknown) => {
        seen.push(o);
        return Promise.resolve({ result: 'solved', via: 'phone' });
      },
    };
    expect(await tvChecker(plugin)({ name: 'rustorka', url: 'https://rustorka.example/' })).toBe('solved');
    expect(seen[0]).toEqual(tvCheckRequest({ name: 'rustorka', url: 'https://rustorka.example/' }));
    const failing = { cloudflareVisible: () => Promise.reject(new Error('x')) };
    expect(await tvChecker(failing)({ name: 'rustorka', url: 'https://rustorka.example/' })).toBe('failed');
    installTvCloudflare(null);
    expect(await runCloudflareCheck('rustorka', 'https://rustorka.example/')).toBe('failed');
    installTvCloudflare(plugin as never);
    expect(await runCloudflareCheck('rustorka', 'https://rustorka.example/')).toBe('solved');
  });
});
