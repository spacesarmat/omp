// Parser monitor: the live checks. Runs the app's real parsers (src/sources) against the live sites through a Node
// http (nodeHttp.ts) and turns what happened into checks (logic.ts). Only the site parsers registered by builtin.ts
// are checked; Jackett / Prowlarr connections and TorrServer's own search are not site parsers.
import { builtinParsers } from '../../src/sources/builtin';
import { cloudflareFailure } from '../../src/sources/cloudflare';
import { isIpBan } from '../../src/sources/ipBan';
import { kinozalHosts, kinozalQuery, parseKinozal } from '../../src/sources/kinozal';
import { rustorkaHosts, parseRustorka } from '../../src/sources/rustorka';
import { challenge, hasLoginForm, parseError } from '../../src/sources/site';
import { siteLoginCode } from '../../src/sources/siteLoginText';
import { rutrackerBadLogin, rutrackerCaptcha } from '../../src/sources/rutrackerText';
import { encodeWin1251, parseHtml } from '../../src/sources/html';
import { isLoginRequired } from '../../src/sources/types';
import type { HttpResponse, SecretStore, Source, SourceContext, SourceResult } from '../../src/sources/types';
import { classifyCheck, makeSnippet, sourceStatus, type Check, type ErrorKind, type LoginMode, type Rules, type SourceReport } from './logic';
import { createNodeHttp, type NodeHttp } from './nodeHttp';

/** Anonymous checks of a site that needs a login (no credentials in the repository secrets). */
interface AnonProbe {
  /** The search page without a session, and the site's parser for it when it is exported (null: markers only). */
  search(ctx: SourceContext, query: string): Promise<HttpResponse>;
  parse: ((doc: Document, base: string) => SourceResult[]) | null;
  /** The answer is a sign-in page / has the login form (the site wants a login: expected). */
  signedOut(res: HttpResponse): boolean;
  /** The login page and the fields the app's login form posts. */
  loginPage(ctx: SourceContext): Promise<HttpResponse>;
  loginFields: RegExp[];
}

export interface Probe {
  source: Source;
  queries: string[];
  rules: Rules;
  /** Where the parser looks (the HTML snippet of an issue starts around the first one found). */
  markers: string[];
  /** Repository secrets with the site's login: [login, password]. */
  env?: [string, string];
  anon?: AnonProbe;
  /** The release link the app adds (magnet / .torrent) for one result; resolves a short description. */
  link(r: SourceResult, ctx: SourceContext, http: NodeHttp): Promise<string>;
}

const MOVIES = ['Джентльмены', 'Interstellar', 'Во все тяжкие'];
const ANIME = ['Наруто', 'Атака титанов'];

function fail(message: string): Error {
  return new Error(message);
}

function listMagnet(r: SourceResult): Promise<string> {
  return /^[0-9a-f]{40}$/.test(r.hash || '') ? Promise.resolve('магнет в списке') : Promise.reject(fail('в результате нет магнета'));
}

function viaMagnet(src: Source) {
  return (r: SourceResult, ctx: SourceContext): Promise<string> => {
    if (!src.magnet || !r.detailUrl) return Promise.reject(fail('нет страницы раздачи'));
    return src.magnet(r.detailUrl, ctx).then((m) => checkAddLink(m, ctx));
  };
}

function viaResolve(src: Source) {
  return (r: SourceResult, ctx: SourceContext): Promise<string> => {
    if (!src.resolve) return Promise.reject(fail('нет resolve'));
    return src.resolve(r, ctx).then((m) => checkAddLink(m, ctx));
  };
}

/** What TorrServer would get: a magnet, an http(s) .torrent (downloaded here and checked), or a stashed file. */
function checkAddLink(link: string, ctx: SourceContext): Promise<string> {
  if (/^magnet:\?/.test(link)) {
    if (!/xt=urn:btih:[0-9a-z]{32,40}/i.test(link)) return Promise.reject(fail('магнет без хеша'));
    return Promise.resolve('магнет со страницы раздачи');
  }
  if (/^omp-file:/.test(link)) return Promise.resolve('.torrent через сессию');
  if (/^https?:\/\//i.test(link)) {
    return ctx.http.get(link, { responseCharset: 'iso-8859-1' }).then((res) => {
      if (res.status >= 200 && res.status < 300 && /^d\d+:/.test(res.text)) return '.torrent скачивается (' + Math.round(res.text.length / 1024) + ' КБ)';
      throw fail('по ссылке не .torrent (HTTP ' + res.status + ')');
    });
  }
  return Promise.reject(fail('непонятная ссылка'));
}

const loginForm = (res: HttpResponse, path: RegExp) => path.test(res.url) || hasLoginForm(res.text);

function byId(id: string): Source {
  const s = builtinParsers().filter((p) => p.id === id)[0];
  if (!s) throw new Error('no source ' + id);
  return s;
}

/** Every built-in site parser with its checks. A parser added to builtin.ts without an entry here fails the run. */
export function probes(): Probe[] {
  const rutor = byId('rutor');
  const nnmclub = byId('nnmclub');
  const anidub = byId('anidub');
  const bigfangroup = byId('bigfangroup');
  const torrentby = byId('torrentby');
  const rutracker = byId('rutracker');
  const kinozal = byId('kinozal');
  const rustorka = byId('rustorka');
  const list: Probe[] = [
    {
      source: rutor,
      queries: MOVIES,
      rules: { minResults: 5, category: 'none', link: 'magnet', seedsAny: true },
      markers: ['id="index"', 'class="gai"'],
      link: listMagnet,
    },
    {
      source: nnmclub,
      queries: MOVIES,
      rules: { minResults: 3, category: 'all', link: 'detail', seedsAny: true },
      markers: ['tablesorter', 'topictitle'],
      link: viaMagnet(nnmclub),
    },
    {
      source: anidub,
      queries: ANIME,
      rules: { minResults: 1, category: 'some', link: 'torrent', seedsAny: false },
      markers: ['search_post', 'name="story"'],
      link: (r, ctx) => (anidub.magnet && r.detailUrl ? anidub.magnet(r.detailUrl, ctx).then((m) => checkAddLink(m, ctx)) : Promise.reject(fail('нет страницы'))),
    },
    {
      source: bigfangroup,
      queries: MOVIES,
      rules: { minResults: 1, category: 'all', link: 'torrent', seedsAny: true },
      markers: ['releases-table', 'class="error"'],
      link: (r, ctx) => checkAddLink(String(r.Link || ''), ctx),
    },
    {
      source: torrentby,
      // a small Belarusian tracker: titles it surely has (it has no «Interstellar» / «Во все тяжкие» releases)
      queries: ['Джентльмены', 'Аватар', 'Ведьмак'],
      rules: { minResults: 3, category: 'none', link: 'magnet', seedsAny: true },
      markers: ['torrents_table', 'text-to-find'],
      link: listMagnet,
    },
    {
      source: rutracker,
      queries: MOVIES,
      rules: { minResults: 5, category: 'all', link: 'detail', seedsAny: true },
      markers: ['tor-tbl', 'login_username'],
      env: ['RUTRACKER_LOGIN', 'RUTRACKER_PASSWORD'],
      anon: {
        search: (ctx, q) => ctx.http.get('https://rutracker.org/forum/tracker.php?nm=' + encodeURIComponent(q)),
        parse: null,
        signedOut: (res) => loginForm(res, /\/forum\/login\.php/i),
        loginPage: (ctx) => ctx.http.get('https://rutracker.org/forum/login.php'),
        loginFields: [/name=["']?login_username/i, /name=["']?login_password/i],
      },
      link: viaMagnet(rutracker),
    },
    {
      source: kinozal,
      queries: MOVIES,
      rules: { minResults: 3, category: 'some', link: 'detail', seedsAny: true },
      markers: ['class="nam"', 'class="bt"'],
      env: ['KINOZAL_LOGIN', 'KINOZAL_PASSWORD'],
      anon: {
        search: (ctx, q) => kinozalHosts.get(ctx, 'browse.php?s=' + encodeWin1251(kinozalQuery(q)) + '&g=0&c=0&v=0&d=0&w=0&t=0&f=0'),
        parse: (doc, base) => parseKinozal(doc, base),
        signedOut: (res) => loginForm(res, /\/(take)?login\.php/i),
        loginPage: (ctx) => kinozalHosts.get(ctx, 'login.php'),
        loginFields: [/name=["']?username/i, /name=["']?password/i],
      },
      link: viaResolve(kinozal),
    },
    {
      source: rustorka,
      queries: MOVIES,
      rules: { minResults: 3, category: 'all', link: 'torrent', seedsAny: true },
      markers: ['id="tor_', 'login_username'],
      env: ['RUSTORKA_LOGIN', 'RUSTORKA_PASSWORD'],
      anon: {
        search: (ctx, q) => rustorkaHosts.get(ctx, 'forum/tracker.php?nm=' + encodeWin1251(q) + '&f%5B%5D=-1&o=1&s=2&tm=-1'),
        parse: (doc, base) => parseRustorka(doc, base),
        signedOut: (res) => loginForm(res, /\/forum\/login\.php/i),
        loginPage: (ctx) => rustorkaHosts.get(ctx, 'forum/login.php'),
        loginFields: [/name=["']?login_username/i, /name=["']?login_password/i],
      },
      link: viaResolve(rustorka),
    },
  ];
  const known = list.map((p) => p.source.id);
  const missing = builtinParsers().filter((s) => known.indexOf(s.id) < 0);
  if (missing.length) throw new Error('parser monitor: no checks for ' + missing.map((s) => s.id).join(', ') + ' (scripts/parser-monitor/probes.ts)');
  return list;
}

/** The thrown error as a kind the classifier understands. */
export function errorOf(e: unknown, last: HttpResponse | null): { kind: ErrorKind; message: string } {
  const message = e instanceof Error ? e.message : String(e);
  const mk = e && typeof e === 'object' ? (e as { monitorKind?: unknown }).monitorKind : undefined;
  if (mk === 'timeout' || mk === 'network') return { kind: mk, message };
  if (isIpBan(e)) return { kind: 'ipban', message };
  if (isLoginRequired(e)) return { kind: 'login', message };
  if (cloudflareFailure(e) || message === challenge()) return { kind: 'challenge', message };
  if (message === parseError()) return { kind: 'parse', message };
  if (last && (last.status < 200 || last.status >= 400)) return { kind: 'http', message };
  return { kind: 'other', message };
}

function memorySecrets(): SecretStore {
  const m: { [k: string]: string } = {};
  return {
    get: (k) => Promise.resolve(Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null),
    set: (k, v) => {
      m[k] = v;
      return Promise.resolve();
    },
    delete: (k) => {
      delete m[k];
      return Promise.resolve();
    },
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error('проверка не уложилась в ' + Math.round(ms / 1000) + ' с'), { monitorKind: 'timeout' })), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export interface RunOptions {
  env: { [k: string]: string | undefined };
  /** Pause between requests of one site, ms. */
  pauseMs?: number;
  /** One check (search with its pages, a link) at most this long. */
  checkTimeoutMs?: number;
  log?: (line: string) => void;
}

const CHECK_TIMEOUT_MS = 90000;

/** Runs one check through `run` and classifies what happened: a search (a result list) or a link step (a text). */
async function check<T extends SourceResult[] | string>(
  label: string,
  http: NodeHttp,
  probe: Probe,
  secrets: string[],
  timeoutMs: number,
  run: () => Promise<T>,
): Promise<{ check: Check; value: T | null }> {
  http.reset();
  let value: T | null = null;
  let error: { kind: ErrorKind; message: string } | null = null;
  try {
    value = await withTimeout(run(), timeoutMs);
  } catch (e) {
    error = errorOf(e, http.last);
  }
  let c: Check;
  if (typeof value === 'string') {
    // a link step that resolved
    c = { label, status: 'OK', reason: 'ok', detail: value, httpStatus: http.last ? http.last.status : undefined, results: 0 };
  } else {
    c = classifyCheck({ label, page: http.last, error, results: value as SourceResult[] | null, rules: probe.rules });
  }
  const page = http.first || http.last;
  if (c.status === 'BROKEN' && page) c.snippet = makeSnippet(page.text, probe.markers, secrets);
  return { check: c, value };
}

/** Anonymous checks of a login site: the search page (parsed when the parser is exported) and the login form. */
async function anonChecks(p: Probe, http: NodeHttp, ctx: SourceContext, timeoutMs: number, pauseMs: number): Promise<Check[]> {
  const a = p.anon!;
  const out: Check[] = [];
  for (const q of p.queries.slice(0, 2)) {
    http.reset();
    let res: HttpResponse | null = null;
    let error: { kind: ErrorKind; message: string } | null = null;
    try {
      res = await withTimeout(a.search(ctx, q), timeoutMs);
    } catch (e) {
      error = errorOf(e, http.last);
    }
    const label = 'поиск без входа «' + q + '»';
    let c: Check;
    if (error || !res) {
      c = classifyCheck({ label, page: http.last, error, results: null, rules: p.rules });
    } else {
      let results: SourceResult[] = [];
      if (a.parse && res.status >= 200 && res.status < 400) {
        try {
          results = a.parse(parseHtml(res.text), res.url);
        } catch (e) {
          results = [];
        }
      }
      if (results.length) {
        c = classifyCheck({ label, page: res, error: null, results, rules: p.rules });
      } else if (a.signedOut(res) && res.status >= 200 && res.status < 400) {
        c = { label, status: 'OK', reason: 'login-form', detail: 'поиск без входа закрыт, форма входа на месте', httpStatus: res.status, results: 0 };
      } else {
        c = classifyCheck({ label, page: res, error: null, results: [], rules: p.rules });
      }
    }
    const page = http.first || http.last;
    if (c.status === 'BROKEN' && page) c.snippet = makeSnippet(page.text, p.markers);
    out.push(c);
    await sleep(pauseMs);
  }
  // the login form: the fields the app posts are still there
  http.reset();
  let lres: HttpResponse | null = null;
  let lerr: { kind: ErrorKind; message: string } | null = null;
  try {
    lres = await withTimeout(a.loginPage(ctx), timeoutMs);
  } catch (e) {
    lerr = errorOf(e, http.last);
  }
  const label = 'страница входа';
  let lc: Check;
  if (lerr || !lres) lc = classifyCheck({ label, page: http.last, error: lerr, results: null, rules: p.rules });
  else {
    lc = classifyCheck({ label, page: lres, error: null, results: [], rules: { ...p.rules, minResults: 0 } });
    if (lc.status === 'OK' || lc.status === 'BROKEN') {
      const missing = a.loginFields.filter((re) => !re.test(lres!.text));
      lc = missing.length
        ? { label, status: 'BROKEN', reason: 'login-fields', detail: 'на странице входа нет полей формы, которые отправляет приложение', httpStatus: lres.status, results: 0 }
        : { label, status: 'OK', reason: 'ok', detail: 'форма входа на месте', httpStatus: lres.status, results: 0 };
      if (lc.status === 'BROKEN') lc.snippet = makeSnippet(lres.text, ['<form', 'login']);
    }
  }
  out.push(lc);
  return out;
}

/** Checks one source; never throws. */
export async function runProbe(p: Probe, opts: RunOptions): Promise<SourceReport> {
  const pauseMs = opts.pauseMs === undefined ? 1500 : opts.pauseMs;
  const timeoutMs = opts.checkTimeoutMs || CHECK_TIMEOUT_MS;
  const log = opts.log || (() => undefined);
  const http = createNodeHttp();
  const ctx: SourceContext = { http, client: null, secrets: memorySecrets() };
  const at = new Date().toISOString();
  let login: LoginMode = p.env ? 'missing' : 'none';
  const secrets: string[] = [];
  const checks: Check[] = [];

  if (p.env) {
    const user = (opts.env[p.env[0]] || '').trim();
    const pass = opts.env[p.env[1]] || '';
    if (user && pass && p.source.login) {
      secrets.push(user, pass);
      http.reset();
      try {
        await withTimeout(p.source.login(user, pass, ctx), timeoutMs);
        login = 'used';
      } catch (e) {
        const err = errorOf(e, http.last);
        const refused = !!siteLoginCode(e) || (e instanceof Error && (e.message === rutrackerBadLogin() || e.message === rutrackerCaptcha()));
        if (refused) login = 'failed';
        else {
          // the site did not let us sign in (Cloudflare, network): that is the verdict
          const c = classifyCheck({ label: 'вход', page: http.last, error: err, results: null, rules: p.rules });
          if (c.status === 'BROKEN') c.snippet = makeSnippet((http.last && http.last.text) || '', p.markers, secrets);
          checks.push(c);
          login = 'failed';
          if (c.status === 'BLOCKED') {
            const v = sourceStatus(checks, undefined, 'used');
            return { id: p.source.id, name: p.source.name, status: v.status, detail: v.detail, login, checks, at };
          }
        }
      }
      log(p.source.name + ': вход — ' + login);
    }
  }

  if (p.env && login !== 'used') {
    checks.push(...(await anonChecks(p, http, ctx, timeoutMs, pauseMs)));
    const v = sourceStatus(checks, undefined, login);
    return { id: p.source.id, name: p.source.name, status: v.status, detail: v.detail, login, checks, at };
  }

  let sample: SourceResult | null = null;
  for (const q of p.queries) {
    const r = await check('поиск «' + q + '»', http, p, secrets, timeoutMs, () => p.source.search(q, ctx));
    checks.push(r.check);
    log(p.source.name + ' «' + q + '»: ' + r.check.status + ' — ' + r.check.detail);
    const list = (r.value as SourceResult[] | null) || [];
    if (!sample && r.check.status === 'OK' && list.length) sample = list.filter((x) => x.Seed > 0)[0] || list[0];
    await sleep(pauseMs);
  }
  let link: Check | undefined;
  if (sample) {
    const s = sample;
    link = (await check('ссылка на раздачу', http, p, secrets, timeoutMs, () => p.link(s, ctx, http))).check;
    log(p.source.name + ' ссылка: ' + link.status + ' — ' + link.detail);
  }
  const v = sourceStatus(checks, link, login);
  return { id: p.source.id, name: p.source.name, status: v.status, detail: v.detail, login, checks, link, at };
}
