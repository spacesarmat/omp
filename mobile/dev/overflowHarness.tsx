// Dev only: the phone app on mocked data for scripts/overflow-check.mjs, which opens mobile/overflow.html in headless
// Chrome at several widths and text sizes and checks that no screen is wider than the window. Nothing here talks to
// a real server, TV or tracker: TorrServer answers from a stubbed fetch, TMDB from a fake catalog client, the trackers
// from wrapped built-in sources.
import { render } from 'preact';
import { App } from '../src/app';
import { resetTo, switchTab, type MRoute } from '../src/nav';
import { setCatalogClientForTests, setCatalogMode } from '../src/catalog/phoneCatalog';
import { saveTv } from '../src/tv/tvStore';
import { nowPlaying, lastSeen } from '../src/tv/playerLink';
import { groupLibrary } from '../../src/lib/seriesGroups';
import { applyLanguageSetting } from '../../src/i18n';
import { addServer, setActiveServer } from '../../src/store/servers';
import { torrents } from '../../src/store/library';
import { registerSource } from '../../src/sources/registry';
import { builtinParsers } from '../../src/sources/builtin';
import { addFindings, addSubscription } from '../../src/monitor/subs';
import { EPISODES_ID } from '../../src/monitor/types';
import { SEEN_KEY, closeWhatsNew, openWhatsNew } from '../../src/store/whatsNew';
import { saveJson } from '../../src/store/storage';
import { APP_VERSION } from '../../src/version';
import { phoneChangelog } from '../src/lib/phoneChangelog';
import { ensureFirstRun } from '../src/donate';
import { saveSearchFilters } from '../src/ui/FiltersSheet';
import { NO_FILTERS } from '../../src/sources/filters';
import type { Torrent } from '../../src/api/types';
import type { CatalogCard, CatalogTitle, SeasonDetails } from '../../src/catalog/tmdb';
import type { CatalogClient } from '../../src/catalog/client';
import type { SourceResult } from '../../src/sources/types';

const SERVER = 'http://192.168.1.10:8090';
const GB = 1024 ** 3;
const DAY = 24 * 3600 * 1000;
const now = Date.now();

function files(names: string[]): string {
  return JSON.stringify({ TorrServer: { Files: names.map((p, i) => ({ id: i + 1, path: p, length: 2 * GB })) } });
}
const fileStats = (names: string[]) => names.map((p, i) => ({ id: i + 1, path: p, length: 2 * GB }));

const S1_FILES = ['Dark.Matter.S01E01.Blue.Box.1080p.WEB-DL.mkv', 'Dark.Matter.S01E02.Trapped.1080p.WEB-DL.mkv', 'Dark.Matter.S01E03.Superposition.1080p.WEB-DL.mkv'];
const S2_FILES = ['Dark.Matter.S02E01.2160p.WEB-DL.mkv', 'Dark.Matter.S02E02.2160p.WEB-DL.mkv'];

const LIBRARY: Torrent[] = [
  { hash: 's1', title: 'Тёмная материя / Dark Matter (2024) [S01] 1080p WEB-DL', category: 'tv', stat: 3, torrent_size: 18 * GB, timestamp: now / 1000 - 9000, data: files(S1_FILES), file_stats: fileStats(S1_FILES) },
  { hash: 's2', title: 'Тёмная материя / Dark Matter (2025) [S02] 2160p WEB-DL', category: 'tv', stat: 3, torrent_size: 26 * GB, timestamp: now / 1000 - 8000, data: files(S2_FILES), file_stats: fileStats(S2_FILES) },
  { hash: 'f1', title: 'Полуночный архив / Midnight Archive (2026) WEB-DL 2160p HDR10+ Dolby Vision | Дубляж, Многоголосый', category: 'movie', stat: 3, torrent_size: 41 * GB, timestamp: now / 1000 - 7000, file_stats: fileStats(['Midnight.Archive.2026.2160p.WEB-DL.DV.HDR10+.mkv']) },
  { hash: 'f2', title: 'Достопримечательностинепереводимоедлинноеслово (2025) BDRip 1080p', category: 'movie', stat: 3, torrent_size: 12 * GB, timestamp: now / 1000 - 6000 },
  { hash: 'f3', title: 'Ледяной перевал / Frost Pass (2024) S03 1080p WEB-DL', category: 'tv', stat: 3, torrent_size: 9 * GB, timestamp: now / 1000 - 5000, data: files(['Frost.Pass.S03E01.mkv', 'Frost.Pass.S03E02.mkv', 'Frost.Pass.S03E03.mkv', 'Frost.Pass.S03E04.mkv']) },
  { hash: 'f4', title: 'Тихая гавань (2026) WEB-DL 1080p', category: 'movie', stat: 3, torrent_size: 4 * GB, timestamp: now / 1000 - 4000 },
];

const CARDS: { [id: number]: CatalogCard } = {
  22: {
    kind: 'tv', id: 22, title: 'Тёмная материя', original: 'Dark Matter', year: 2024, poster: '', rating: 7.6, backdrop: '',
    genres: ['фантастика', 'драма', 'триллер', 'детектив'], runtime: 50, overview: 'Физик просыпается в чужой жизни, где его жена никогда не выходила за него замуж, а сын никогда не рождался. Он пытается вернуться домой сквозь бесконечные версии своей жизни.',
    cast: [{ id: 1, name: 'Джоэл Эдгертон', photo: '', role: 'Джейсон Дессен', job: 'cast' }, { id: 2, name: 'Дженнифер Коннелли', photo: '', role: 'Дэниела', job: 'cast' }, { id: 3, name: 'Элис Брага', photo: '', role: 'Аманда', job: 'cast' }],
    seasons: [{ number: 3, episodes: 10, year: 2026, aired: 2, airDate: '2026-09-01' }, { number: 2, episodes: 10, year: 2025, aired: 10 }, { number: 1, episodes: 9, year: 2024, aired: 9 }],
    airing: true, status: 'returning', nextEpisode: { season: 3, episode: 3, airDate: new Date(now + 2 * DAY).toISOString().slice(0, 10) },
  },
  11: {
    kind: 'movie', id: 11, title: 'Полуночный архив: Хроники невозможной библиотеки', original: 'Midnight Archive', year: 2026, poster: '', rating: 7.4, backdrop: '',
    genres: ['драма', 'мистика'], runtime: 118, overview: 'Архивариус находит письмо, которого не было.', cast: [], seasons: [], airing: false,
    releases: { theatrical: '2026-03-12', digital: '2026-06-01' },
  },
  21: {
    kind: 'tv', id: 21, title: 'Ледяной перевал', original: 'Frost Pass', year: 2024, poster: '', rating: 8, backdrop: '', genres: [], runtime: 50, overview: '',
    cast: [], airing: true, status: 'returning', lastAirDate: new Date(now - 2 * DAY).toISOString().slice(0, 10),
    seasons: [{ number: 3, episodes: 8, year: 2026, aired: 4, airDate: '2026-09-13' }, { number: 2, episodes: 8, year: 2025, aired: 8 }],
    nextEpisode: { season: 3, episode: 5, airDate: new Date(now + DAY).toISOString().slice(0, 10) },
  },
};
const title = (c: CatalogCard): CatalogTitle => ({ kind: c.kind, id: c.id, title: c.title, original: c.original, year: c.year, poster: '', rating: c.rating });
const NOVELTIES: CatalogTitle[] = [
  title(CARDS[11]), title(CARDS[22]), title(CARDS[21]),
  { kind: 'movie', id: 31, title: 'Очень длинное название фильма, которое не помещается в две строки плитки', original: 'Long', year: 2026, poster: '', rating: 6.1 },
  { kind: 'tv', id: 32, title: 'Сериалсоченьдлиннымсловомбезпробелов', original: 'X', year: 2025, poster: '', rating: 8.9 },
  { kind: 'movie', id: 33, title: 'Тихая гавань', original: 'Quiet Harbor', year: 2026, poster: '', rating: 5.5 },
];

function season(id: number, n: number): SeasonDetails {
  const dates = [-30, -23, -16, -9, -2, 1, 8, 15].map((d) => new Date(now + d * DAY).toISOString().slice(0, 10));
  return {
    number: n, name: 'Сезон ' + n, airDate: dates[0], overview: 'О сезоне ' + n + ': герои снова оказываются там, где всё началось.',
    episodes: dates.map((d, i) => ({ n: i + 1, title: 'Эпизод с довольно длинным названием номер ' + (i + 1), airDate: d, runtime: 52, overview: 'Описание серии ' + (i + 1) })),
  };
}

const catalog: CatalogClient = {
  novelties: () => Promise.resolve({ items: NOVELTIES, pages: 1 }),
  discover: () => Promise.resolve({ items: NOVELTIES, pages: 1 }),
  search: (q) => {
    if (/Тёмн|Темн|Dark/i.test(q)) return Promise.resolve({ items: [title(CARDS[22])], pages: 1 });
    if (/Ледян|Frost/i.test(q)) return Promise.resolve({ items: [title(CARDS[21])], pages: 1 });
    if (/Полуноч/i.test(q)) return Promise.resolve({ items: [title(CARDS[11])], pages: 1 });
    return Promise.resolve({ items: [], pages: 0 });
  },
  card: (_k, id) => (CARDS[id] ? Promise.resolve(CARDS[id]) : Promise.reject(new Error('catalog:bad'))),
  season: (id, n) => Promise.resolve(season(id, n)),
  person: () => Promise.reject(new Error('catalog:bad')),
};

const HASH = 'c'.repeat(40);
function row(i: number, source: string, p: Partial<SourceResult> = {}): SourceResult {
  const titles = [
    'Тёмная материя / Dark Matter [S01-02] (2024-2025) WEB-DL 2160p HDR10 | Дубляж, Многоголосый профессиональный (HDRezka Studio, LostFilm)',
    'Полуночный архив / Midnight Archive (2026) BDRip 1080p от селезень | Лицензия',
    'Ледяной перевал / Frost Pass / Сезон: 3 / Серии: 1-4 из 8 (Режиссёр Иванов) [2026, фантастика, WEB-DL 1080p]',
    'Достопримечательностинепереводимоедлинноесловобезединогопробела.2026.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-GROUP',
  ];
  const h = (HASH.slice(0, 38) + String(10 + i)).slice(0, 40);
  return {
    Title: titles[i % titles.length], Categories: '', Size: (4 + i * 7.3).toFixed(1).replace('.', ',') + ' ГБ', CreateDate: '', Tracker: '', Link: '',
    Magnet: 'magnet:?xt=urn:btih:' + h, Hash: h, hash: h, Peer: 3, Seed: 120 + i, source, date: now - i * 3600 * 1000, sizeBytes: (4 + i * 7.3) * GB, ...p,
  };
}

function seed(): void {
  applyLanguageSetting('ru');
  // no «Что нового» on start (its own scene opens it) and no «Поддержать» card yet
  saveJson(SEEN_KEY, APP_VERSION);
  ensureFirstRun(now);
  const srv = addServer({ url: SERVER, name: 'Домашний сервер в гостиной' });
  setActiveServer(srv.id);
  // two TVs: the remote shows the «Спальня ▾» switcher
  saveTv({ ip: '192.168.1.6', name: 'Гостиная' });
  saveTv({ ip: '192.168.1.5', name: 'Спальня', mac: 'AA:BB:CC:DD:EE:FF' });
  saveSearchFilters({ ...NO_FILTERS, res: [2160], hdr: true, season: 1 });
  torrents.value = LIBRARY;
  setCatalogClientForTests(catalog);
  // the built-in trackers with canned answers (their names and ids stay real)
  builtinParsers().forEach((s, k) => {
    registerSource({
      ...s,
      search: () => new Promise((r) => setTimeout(() => r([0, 1, 2, 3].map((i) => row(i + k * 4, s.id))), 50)),
      latest: () => Promise.resolve([0, 1, 2, 3].map((i) => row(i + k * 4, s.id))),
    });
  });
  const sub = addSubscription({ query: 'Тёмная материя 2160p HDR очень длинный запрос подписки', quality: 'any', sources: null, notify: true } as never, now - 5 * DAY);
  if (sub) addFindings([{ subId: sub.id, key: 'k1', result: row(0, 'rutor'), at: now - 3600 * 1000 }]);
  addFindings([
    {
      subId: EPISODES_ID, key: 's1:1:5', result: row(2, 'nnmclub'), at: now - 7200 * 1000,
      episodes: { torrentHash: 's1', torrentTitle: LIBRARY[0].title, season: 1, haveTo: 3, from: 4, to: 5 } as never,
    },
  ]);
  nowPlaying.value = {
    hash: 's1', file: 1, title: 'Тёмная материя: Синяя коробка и другие истории', subtitle: 'Dark Matter · S01E01 · Очень длинный подзаголовок серии',
    time: 1394, duration: 2912, paused: false, buffering: false,
    audio: { list: ['Русский', 'English'], sel: 0 }, subs: { list: [{ label: 'Выключены', value: 'off' }], sel: 'off' },
    next: { title: 'S01E02 · Ловушка в бесконечном коридоре' },
  } as never;
  lastSeen.value = Date.now();
}

// --- the TorrServer of the mocks: everything else is offline
const realFetch = window.fetch.bind(window);
window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.indexOf(SERVER) !== 0) {
    if (url.indexOf(location.origin) === 0) return realFetch(input, init);
    return Promise.reject(new TypeError('offline (overflow harness)'));
  }
  const path = url.slice(SERVER.length);
  let body: { action?: string; hash?: string } = {};
  try {
    body = init && typeof init.body === 'string' ? JSON.parse(init.body) : {};
  } catch {
    /* not JSON */
  }
  const json = (v: unknown) => Promise.resolve(new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  if (path.indexOf('/echo') === 0) return Promise.resolve(new Response('MatriX.136', { status: 200 }));
  if (path.indexOf('/torrents') === 0) {
    if (body.action === 'list') return json(LIBRARY);
    if (body.action === 'get') return json(LIBRARY.find((t) => t.hash === body.hash) || LIBRARY[0]);
    return json(null);
  }
  if (path.indexOf('/stream') === 0) return json(LIBRARY[0]);
  if (path.indexOf('/viewed') === 0) return json([]);
  if (path.indexOf('/cache') === 0) return json({ Capacity: 1, Filled: 0, PiecesLength: 1, PiecesCount: 0, Pieces: {} });
  if (path.indexOf('/settings') === 0) return json({ CacheSize: 64 * 1024 * 1024, PreloadCache: 50, ReaderReadAHead: 95 });
  if (path.indexOf('/search') === 0 || path.indexOf('/torznab') === 0) return json([]);
  return json(null);
}) as typeof window.fetch;

// --- the scenes the check walks through
type Scene = { route: MRoute; tab?: boolean; then?: () => void };
const clickTab = (i: number) => () => {
  const b = document.querySelectorAll<HTMLButtonElement>('.m-seg [role="tab"]')[i];
  if (b) b.click();
};
const seriesKey = () => {
  const g = groupLibrary(LIBRARY).find((x) => x.kind === 'series' && 'key' in x);
  return g && 'key' in g ? String(g.key) : '';
};
const SCENES: { [name: string]: () => Scene } = {
  mine: () => ({ route: { name: 'library' }, tab: true, then: () => setCatalogMode('mine') }),
  discover: () => ({ route: { name: 'library' }, tab: true, then: () => setCatalogMode('discover') }),
  'news-feed': () => ({ route: { name: 'news', seg: 'feed' } }),
  'news-subs': () => ({ route: { name: 'news', seg: 'subs' } }),
  'news-calendar': () => ({ route: { name: 'news', seg: 'calendar' } }),
  add: () => ({ route: { name: 'add' }, tab: true }),
  'add-results': () => ({ route: { name: 'add', query: 'Тёмная материя', run: true } }),
  'remote-buttons': () => ({ route: { name: 'remote' }, tab: true }),
  'remote-touchpad': () => ({ route: { name: 'remote' }, tab: true, then: clickTab(1) }),
  settings: () => ({ route: { name: 'settings' }, tab: true }),
  sources: () => ({ route: { name: 'sources' } }),
  sourceSite: () => ({ route: { name: 'sourceSite', id: 'nnmclub' } }),
  flaresolverr: () => ({ route: { name: 'flaresolverr' } }),
  monitor: () => ({ route: { name: 'monitor' } }),
  serverSettings: () => ({ route: { name: 'serverSettings' } }),
  tv: () => ({ route: { name: 'tv' } }),
  install: () => ({ route: { name: 'install' } }),
  faq: () => ({ route: { name: 'faq' } }),
  log: () => ({ route: { name: 'log' } }),
  backup: () => ({ route: { name: 'backup' } }),
  series: () => ({ route: { name: 'series', key: seriesKey() } }),
  torrent: () => ({ route: { name: 'torrent', hash: 's1' } }),
  'title-tv': () => ({ route: { name: 'title', kind: 'tv', id: 22 } }),
  'title-movie': () => ({ route: { name: 'title', kind: 'movie', id: 11 } }),
  nowPlaying: () => ({ route: { name: 'nowPlaying' } }),
  connect: () => ({ route: { name: 'connect' } }),
  whatsNew: () => ({ route: { name: 'settings' }, tab: true, then: () => openWhatsNew(phoneChangelog(), APP_VERSION) }),
};

// --- Android WebView text zoom: WebSettings.textZoom follows the system font scale and multiplies every font size
// (and px line heights) in the page, the layout lengths stay. Emulated by scaling the px font sizes and line heights
// of every style rule, the root size (inherited text) and the UA size of form controls.
const originals = new WeakMap<CSSStyleDeclaration, { fs: string; lh: string }>();
function eachRule(list: CSSRuleList, f: (s: CSSStyleDeclaration) => void): void {
  for (let i = 0; i < list.length; i++) {
    const r = list[i] as CSSRule & { style?: CSSStyleDeclaration; cssRules?: CSSRuleList };
    if (r.style) f(r.style);
    if (r.cssRules) eachRule(r.cssRules, f);
  }
}
// an absolute size (px, or viewport / container units) is multiplied; em and % follow the parent, already scaled
const ABSOLUTE = /\d(px|vw|vh|vmin|vmax|dvh|svh|lvh|cqw|cqh|cqi|cqb|cqmin|cqmax)/;
const scaled = (v: string, k: number) => (k === 1 ? v : 'calc(' + k + ' * (' + v + '))');
function setTextZoom(k: number): void {
  for (let i = 0; i < document.styleSheets.length; i++) {
    let rules: CSSRuleList;
    try {
      rules = document.styleSheets[i].cssRules;
    } catch {
      continue; // cross-origin (Google Fonts)
    }
    eachRule(rules, (s) => {
      let o = originals.get(s);
      if (!o) {
        o = { fs: s.getPropertyValue('font-size'), lh: s.getPropertyValue('line-height') };
        originals.set(s, o);
      }
      if (o.fs && ABSOLUTE.test(o.fs)) s.setProperty('font-size', scaled(o.fs, k), s.getPropertyPriority('font-size'));
      if (o.lh && ABSOLUTE.test(o.lh)) s.setProperty('line-height', scaled(o.lh, k), s.getPropertyPriority('line-height'));
    });
  }
  let el = document.getElementById('omp-text-zoom');
  if (!el) {
    el = document.createElement('style');
    el.id = 'omp-text-zoom';
    document.head.appendChild(el);
  }
  el.textContent = `html { font-size: ${16 * k}px; } :where(button, input, select, textarea) { font-size: ${13.333 * k}px; }`;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function go(name: string): Promise<void> {
  const s = SCENES[name]();
  closeWhatsNew();
  // through another screen: the same screen with new props (Add with a query) mounts afresh
  resetTo({ name: 'log' });
  await wait(30);
  if (s.tab) switchTab(s.route);
  else resetTo(s.route);
  await wait(250);
  if (s.then) {
    s.then();
    await wait(250);
  }
}

// screen-wide boxes that hide what sticks out: content cut by them is lost, not scrolled, so it still counts
const SCREEN_BOXES = '.m-screen, .m-library, .m-torrent, .m-remote, .m-rb, .m-rt, .m-now, .m-lib-pull, .m-lib-body, .m-sheet, .m-sheet-scroll';
// rows meant to scroll sideways (chips, cast): what sticks out of them is reachable
const ROW_SCROLLERS = '.m-tabs, .m-hfilters, .m-disc-chips, .m-tc-cast, .m-tc-chips, .m-scroll-x';

/**
 * Elements whose right edge is past the window (the outermost one of each overflowing subtree). An element inside a
 * horizontal scroller that fits (a chip row) is fine; one cut by a screen-wide hidden box is not.
 */
function overflow(): { scrollWidth: number; innerWidth: number; offenders: string[] } {
  const w = document.documentElement.clientWidth;
  const out: string[] = [];
  const all = document.querySelectorAll<HTMLElement>('#app *');
  for (let i = 0; i < all.length; i++) {
    const n = all[i];
    const r = n.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right <= w + 0.5 && r.left >= -0.5) continue;
    let clip: HTMLElement | null = n.parentElement;
    let clipped = false;
    while (clip && clip.id !== 'app') {
      const ox = getComputedStyle(clip).overflowX;
      const legit = clip.matches(ROW_SCROLLERS) || ((ox === 'hidden' || ox === 'clip') && !clip.matches(SCREEN_BOXES));
      if (legit) {
        const cr = clip.getBoundingClientRect();
        if (cr.right <= w + 0.5 && cr.left >= -0.5) {
          clipped = true;
          break;
        }
      }
      clip = clip.parentElement;
    }
    if (clipped) continue;
    const p = n.parentElement;
    if (p && p.id !== 'app' && !p.matches(SCREEN_BOXES)) {
      const pr = p.getBoundingClientRect();
      if (pr.right > w + 0.5 || pr.left < -0.5) continue; // the parent is reported
    }
    const cls = typeof n.className === 'string' && n.className ? '.' + n.className.trim().split(/\s+/).join('.') : '';
    const text = (n.textContent || '').trim().slice(0, 30);
    out.push(n.tagName.toLowerCase() + cls + ' [' + Math.round(r.left) + '..' + Math.round(r.right) + ']' + (text ? ' «' + text + '»' : ''));
  }
  // text spilling out of its own box (labels running into each other, a word wider than its button)
  for (let i = 0; i < all.length; i++) {
    const n = all[i];
    const wide = n.clientWidth > 0 && n.scrollWidth > n.clientWidth + 1;
    // (a lone glyph such as «+» may poke out of its line box by its own metrics: not counted)
    const tall = n.clientHeight > 0 && n.scrollHeight > n.clientHeight + 2 && (n.textContent || '').trim().length > 1;
    if (!wide && !tall) continue;
    let text = false;
    for (let c = n.firstChild; c; c = c.nextSibling) if (c.nodeType === 3 && (c.nodeValue || '').trim()) text = true;
    if (!text) continue;
    const cs = getComputedStyle(n);
    if (cs.overflowX !== 'visible' || cs.textOverflow === 'ellipsis') continue;
    const cls = typeof n.className === 'string' && n.className ? '.' + n.className.trim().split(/\s+/).join('.') : '';
    const how = wide ? 'spills ' + (n.scrollWidth - n.clientWidth) + 'px' : 'spills down ' + (n.scrollHeight - n.clientHeight) + 'px';
    out.push(n.tagName.toLowerCase() + cls + ' ' + how + ' «' + (n.textContent || '').trim().slice(0, 30) + '»');
  }
  // vertical: the bottom tab bar keeps its labels inside, and the remote (one fitted screen) ends above the tab bar
  const h = window.innerHeight;
  const nav = document.querySelector<HTMLElement>('.m-nav');
  const navTop = nav ? nav.getBoundingClientRect().top : h;
  const label = (n: HTMLElement, r: DOMRect) =>
    n.tagName.toLowerCase() + (typeof n.className === 'string' && n.className ? '.' + n.className.trim().split(/\s+/).join('.') : '') +
    ' [bottom ' + Math.round(r.bottom) + ' > ' + Math.round(n.closest('.m-nav') ? h : navTop) + ']';
  document.querySelectorAll<HTMLElement>('.m-nav *').forEach((n) => {
    const r = n.getBoundingClientRect();
    if (r.height > 0 && r.bottom > h + 0.5) out.push(label(n, r));
  });
  document.querySelectorAll<HTMLElement>('.m-remote *').forEach((n) => {
    const r = n.getBoundingClientRect();
    if (r.height === 0 || r.bottom <= navTop + 0.5) return;
    for (let a = n.parentElement; a && !a.classList.contains('m-screen'); a = a.parentElement) {
      if (getComputedStyle(a).overflowY !== 'visible' && a.getBoundingClientRect().bottom <= navTop + 0.5) return; // scrolls inside
    }
    if (n.parentElement && n.parentElement.getBoundingClientRect().bottom > navTop + 0.5 && !n.parentElement.classList.contains('m-remote')) return;
    out.push(label(n, r));
  });
  return { scrollWidth: document.documentElement.scrollWidth, innerWidth: w, offenders: out };
}

declare global {
  interface Window {
    __omp: { scenes: string[]; go(name: string): Promise<void>; setTextZoom(k: number): void; overflow: typeof overflow; ready: boolean };
  }
}

seed();
resetTo({ name: 'library' });
render(<App />, document.getElementById('app')!);
window.__omp = { scenes: Object.keys(SCENES), go, setTextZoom, overflow, ready: true };
