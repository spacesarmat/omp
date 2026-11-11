import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { fmtSize, t, tp } from '../../../src/i18n';
import { Icon, ICONS } from '../ui/Icon';
import { Poster, qualityBadge } from '../ui/Poster';
import { Logo } from '../../../src/ui/Logo';
import { TvChip } from '../ui/TvChip';
import { TorrentMenu } from '../ui/TorrentMenu';
import { sharedResume } from '../lib/sharedProgress';
import { useBackHandler } from '../ui/backStack';
import { deleteTorrents, reportDeleted, watchTarget } from '../lib/torrentActions';
import { askConfirm } from '../ui/confirm';
import { LaunchError } from '../ui/LaunchError';
import { CatalogUnavailable } from '../ui/CatalogUnavailable';
import { navigate, scrollToTop, switchTab } from '../nav';
import { routeForTorrent } from '../audiobooks/route';
import { filesOf, useTvLaunch } from '../watch';
import { client, activeServer } from '../../../src/store/servers';
import { activeTv } from '../tv/tvStore';
import { FoundTvs } from '../ui/FoundTvs';
import { catalogReason, cachedBanner } from '../../../src/lib/catalogState';
import { torrents, libraryTab, refreshTorrents, torrentsAt, autoFillPosters } from '../../../src/store/library';
import { continueWatching, refreshViewed, progressVersion, serverViewed, getLocalProgress, localFileIds, markWatched, saveProgress, MIN_RESUME, WATCHED_RATIO } from '../../../src/store/progress';
import { buildHistory, collapseHistoryShows, unfinishedFirst, resumeFrom, sourceLine, historyFilters, type HistoryItem } from '../../../src/lib/history';
import { continueCards, continueSourceLine, isLocalWatch, type ContinueCard, type ContinueFile, type ContinueWatch } from '../../../src/lib/phoneContinue';
import { movieRowLine, seriesRowLine } from '../../../src/lib/phoneRows';
import { hiddenHistory, hideHistory, isHistoryHidden } from '../../../src/store/historyHide';
import { settings, updateSettings } from '../../../src/store/settings';
import { sortTorrents, sortLabel, phoneSortOptions } from '../../../src/lib/librarySearch';
import { libraryTabs, BY_SIZE, phoneViewLabel, phoneViewOptions, isRowCatalogView, episodeLine, positionLabel, phoneRemainingLabel, phoneHistoryFinished, libraryTitle, type LibraryTab } from '../../../src/lib/libraryView';
import { categoryOf } from '../../../src/lib/category';
import { baseName, episodeLabel, fileKind, parseEpisode, playableFiles, stripExt } from '../../../src/lib/episodes';
import type { Torrent } from '../../../src/api/types';
import { errorMessage } from '../../../src/api/http';
import { native } from '../platform/native';
import { donateCardDue, dismissDonateCard, openDonate, supporterActive } from '../donate';
import { localServer, startLocal, refreshLocalServer, LOCAL_URL, canRun, downloadSize } from '../server/localServer';
import { displayTitle, yearOf } from '../../../src/lib/torrentName';
import { parseEpisodeRange } from '../../../src/monitor/episodes';
import { episodeCountOf } from '../lib/releaseContents';
import { tileBadgeInfo } from '../../../src/lib/seriesStatus';
import { catalogMode, setCatalogMode } from '../catalog/phoneCatalog';
import { Discover } from './catalog/Discover';
import { setDiscoverHeadSlot, useCompactCatalogBar } from './catalog/compactBar';
import { usePinchStep } from '../ui/usePinchStep';
import { cardWidth, gridCols, gridTemplate, useContentWidth, type GridMode } from '../ui/landscapeCols';
import { useHint } from '../ui/Hint';
import { SeriesMenu } from '../ui/SeriesMenu';
import { SeriesTileBadge } from '../ui/SeriesTileBadge';
import { groupLabel, groupSize, singleGroup, seriesKey, NO_SEASON, type SeriesGroup } from '../../../src/lib/seriesGroups';
import { groupPhoneLibrary, phoneItemHashes, type FilmGroup, type PhoneItem } from '../lib/filmGroups';
import { Sheet } from '../ui/Sheet';
import { tvFirst, playOnPhone } from '../watchHere';
import { cachedSeriesMatch, seriesMatchVersion } from '../../../src/lib/seriesMatch';
import { withAds } from '../../../src/ads/ads';
import { AdCell, type AdCellKind } from '../ads/AdCell';
import { PER_SCREEN, useAdSlots } from '../ads/useAdSlots';

const POLL_MS = 15000;
// pull-to-refresh: the list follows the finger at half speed; release past TRIGGER refreshes
const PULL_DAMP = 0.5;
const PULL_MAX = 110;
const PULL_TRIGGER = 64;
const PULL_HOLD = 56;
const pullOf = (dy: number) => (dy > 0 ? Math.min(PULL_MAX, dy * PULL_DAMP) : 0);
const titleOf = (t: Torrent) => displayTitle(t);
// the short name and its meta («2 сезон · серии 1-6 из 10», the year); the torrent screen shows the full title
function ShortTitle({ tor }: { tor: Torrent }) {
  const s = libraryTitle(tor);
  return (
    <>
      {s.title}
      {s.meta && <span class="m-title-meta">{' · ' + s.meta}</span>}
    </>
  );
}

/**
 * A «Мои» tile's name: the TMDB show's once the series is matched (the name the series screen shows), else the short
 * name from the torrent title. Never the season, episodes or the count of releases: those go on the line under it.
 */
function TileName({ tor, g }: { tor: Torrent; g?: SeriesGroup | null }) {
  void seriesMatchVersion.value;
  const s = useMemo(() => g || singleGroup(tor), [g, tor]);
  const card = s ? cachedSeriesMatch(s.key) : null;
  return <>{card && card.title ? card.title : libraryTitle(g ? g.named : tor).title}</>;
}

/** The line under a tile's name: «2 сезон · серии 1-6 из 10» or the year; for a series card «2 сезона», «2 раздачи». */
function tileMeta(tor: Torrent, g?: SeriesGroup | null): string {
  return g ? groupLabel(g) : libraryTitle(tor).meta;
}

const itemKey = (it: PhoneItem) => (it.kind === 'torrent' ? it.tor.hash : it.kind === 'film' ? 'f:' + it.key : 'g:' + it.key);

function showKeyOf(tor: Torrent): string {
  try {
    const key = seriesKey(tor);
    return key || tor.hash;
  } catch (e) {
    return tor.hash;
  }
}

function filesByShow(list: Torrent[]): { [k: string]: ContinueFile[] } {
  const out: { [k: string]: ContinueFile[] } = {};
  list.forEach((tor) => {
    const key = showKeyOf(tor);
    const files = filesOf(tor).map((f) => ({ id: f.id, path: f.path, hash: tor.hash, playable: fileKind(f.path) === 'video' }));
    out[key] = (out[key] || []).concat(files);
  });
  return out;
}

function restarted(hash: string, at: number): boolean {
  let best = 0;
  let time = 1;
  localFileIds(hash).forEach((id) => {
    const p = getLocalProgress(hash, id);
    if (!p || p.updated < best) return;
    best = p.updated;
    time = p.time;
  });
  return time < 1 && best >= at;
}

function watchFrom(it: HistoryItem): ContinueWatch {
  const row: ContinueWatch = {
    hash: it.torrent.hash,
    fileIndex: it.fileIndex,
    time: it.progress.time,
    duration: it.progress.duration,
    updated: it.progress.updated || it.source.at,
    src: it.source.src,
    showKey: showKeyOf(it.torrent),
  };
  if (it.progress.open) row.open = true;
  if (it.source.name) row.name = it.source.name;
  return row;
}

function localItems(list: Torrent[], phoneName: string): HistoryItem[] {
  const out: HistoryItem[] = [];
  list.forEach((tor) => {
    localFileIds(tor.hash).forEach((id) => {
      const p = getLocalProgress(tor.hash, id);
      if (!p || !isLocalWatch(p.time, p.duration)) return;
      out.push({
        torrent: tor,
        fileIndex: id,
        progress: p,
        source: { src: 'phone', name: phoneName, at: p.updated },
      });
    });
  });
  out.sort((a, b) => (b.source.at || 0) - (a.source.at || 0));
  return out;
}

function watchesOf(list: Torrent[], shared: boolean, phoneName: string): ContinueWatch[] {
  if (!shared) {
    return localItems(list, phoneName)
      .filter((it) => !restarted(it.torrent.hash, it.source.at || 0))
      .map(watchFrom);
  }
  const rows = buildHistory(list, 'all', continueWatching(list, 80), getLocalProgress, 80, { src: 'phone', name: phoneName });
  return collapseHistoryShows(rows).filter((it) => !restarted(it.torrent.hash, it.source.at || it.progress.updated || 0)).map(watchFrom);
}

function rowBottom(it: PhoneItem): string {
  const tor = it.kind === 'series' ? it.named : it.kind === 'film' ? it.lead : it.tor;
  const movie = it.kind === 'film' || (it.kind !== 'series' && tor.category !== 'tv' && playableFiles(filesOf(tor)).length <= 1);
  if (movie) return movieRowLine(yearOf(displayTitle(tor)) || '', 0);
  const range = parseEpisodeRange(displayTitle(tor));
  const seasons = it.kind === 'series' ? it.seasons.filter((s) => s !== NO_SEASON) : [];
  const files = it.kind === 'series' ? it.members.reduce<ReturnType<typeof filesOf>>((all, m) => all.concat(filesOf(m)), []) : filesOf(tor);
  const counted = episodeCountOf(files) || 0;
  const episodes = counted || (range.from && range.to ? range.to - range.from + 1 : 0);
  const card = it.kind === 'series' ? cachedSeriesMatch(it.key) : null;
  const ended = !!(card && card.status === 'ended');
  const seasonCount = seasons.length || (range.seasonTo && range.season ? range.seasonTo - range.season + 1 : range.season ? 1 : 0);
  if (seasonCount > 1) return seriesRowLine(seasonCount, 0, ended);
  const one = seasons.length === 1 ? seasons[0] : range.season || 0;
  const head = one ? t('filters.season', { n: one }) : '';
  const eps = episodes > 1 ? tp('library.episodes', episodes) : '';
  return [head, eps].filter(Boolean).join(' · ');
}
const hashesOf = (it: PhoneItem) => (it.kind === 'torrent' ? [it.tor.hash] : it.members.map((m) => m.hash));
/** The size of every release of a film card. */
const filmSize = (g: FilmGroup) => g.members.reduce((n, m) => n + (m.torrent_size || 0), 0);

/** «18 серий» (from the file names, «1-2 серия» counted as two), else «16 файлов»; '' for a film. */
const SEARCH = 'M5 11a6 6 0 1 0 12 0 6 6 0 0 0-12 0zM21 21l-5-5';
const CLOSE = 'M6 6l12 12M18 6L6 18';
const MORE = 'M5 12h.01M12 12h.01M19 12h.01';
const CHECK = 'M5 12.5l4.5 4.5L19 7';
const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP = 10;

/** The views drawn as rows (the others are poster grids). */
function isRowView(v: string): boolean {
  return isRowCatalogView(v);
}

export function Library() {
  useHint('catalog');
  useHint('mine');
  const c = client.value;
  const tab = libraryTab.value;
  const aliveRef = useRef(true);
  useEffect(
    () => () => {
      aliveRef.current = false;
    },
    [],
  );
  // the search is the «Поиск» tab now («Мои» there): the cards here are never filtered by a query
  const query = '';
  const list = torrents.value;
  const cachedAt = torrentsAt.value;
  const sort = settings.value.librarySort;
  const view = settings.value.libraryView;
  const hfilter = settings.value.historyFilter;
  const mode = catalogMode.value;
  const compactBar = useCompactCatalogBar();
  const mine = mode === 'mine';
  const [loaded, setLoaded] = useState(list.length > 0);
  const [error, setError] = useState('');
  const [tvError, setTvError] = useState('');
  const [reload, setReload] = useState(0);
  const [starting, setStarting] = useState(false);
  // why the last start from here failed (the store's error is reset by the next status refresh)
  const [startError, setStartError] = useState('');
  const [phoneName, setPhoneName] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [donateCard, setDonateCard] = useState(() => donateCardDue());
  const [pull, setPull] = useState(0);
  const [dragging, setDragging] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  // selection mode (null = off) and the torrent whose menu is open; a long press that fired swallows the click after it
  const [selected, setSelected] = useState<string[] | null>(null);
  const [menuFor, setMenuFor] = useState<PhoneItem | null>(null);
  const [viewSheet, setViewSheet] = useState(false);
  const [hideTick, setHideTick] = useState(0);
  const [resumeMenu, setResumeMenu] = useState<ContinueCard | null>(null);
  const [deleting, setDeleting] = useState(false);
  const press = useRef<{ timer: ReturnType<typeof setTimeout> | undefined; x: number; y: number; fired: boolean }>({ timer: undefined, x: 0, y: 0, fired: false });
  const loadRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const launch = useTvLaunch();
  progressVersion.value; // re-render when local progress changes
  serverViewed.value;

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY || document.documentElement.scrollTop || 0;
      const on = y > 48;
      const node = rootRef.current;
      if (!node || node.getAttribute('data-collapsed') === (on ? '1' : '0')) return;
      node.setAttribute('data-collapsed', on ? '1' : '0');
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    native.phoneIdentity().then(
      (id) => {
        setPhoneName(id.name);
      },
      () => undefined,
    );
  }, []);

  useEffect(() => {
    if (!c) return;
    let alive = true;
    const load = () => {
      const p = refreshTorrents(c).then(
        () => {
          // posters for torrents added elsewhere (TorrServer page, Lampa): each one is tried once
          void autoFillPosters(c);
          if (!alive) return;
          setError('');
          setLoaded(true);
        },
        (e) => {
          if (!alive) return;
          setError(errorMessage(e));
          setLoaded(true);
          if (c.baseUrl === LOCAL_URL) void refreshLocalServer();
        },
      );
      void refreshViewed(c);
      return p;
    };
    loadRef.current = load;
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [c, reload]);

  // pull-to-refresh: a downward drag from the very top of the page (not from the horizontal chip rows)
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let startY = 0;
    let startX = 0;
    let pulling = false;
    let busy = false;
    const atTop = () => (window.scrollY || document.documentElement.scrollTop || 0) <= 0;
    let frame = 0;
    let next = 0;
    const show = (v: number) => {
      next = v;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setPull(next);
      });
    };
    const move = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      const dy = t.clientY - startY;
      const dx = t.clientX - startX;
      if (dy > 0 && dy > Math.abs(dx) && atTop()) {
        if (e.cancelable) e.preventDefault();
        setDragging(true);
        show(pullOf(dy));
      } else show(0);
    };
    const stop = () => {
      pulling = false;
      document.removeEventListener('touchmove', move);
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      setDragging(false);
    };
    const start = (e: TouchEvent) => {
      stop();
      // «Обзор» has no pull-to-refresh: the list below is the library's
      if (busy || e.touches.length !== 1 || !atTop() || catalogMode.peek() !== 'mine') return;
      const target = e.target as Element | null;
      if (target && target.closest && target.closest('.m-tabs, .m-hfilters, .m-hist-seg')) return;
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      pulling = true;
      document.addEventListener('touchmove', move, { passive: false });
    };
    const end = (e: TouchEvent) => {
      if (!pulling) return;
      const t = e.changedTouches[0];
      const dy = t ? t.clientY - startY : 0;
      const dx = t ? t.clientX - startX : 0;
      stop();
      if (pullOf(dy) >= PULL_TRIGGER && dy > Math.abs(dx) * 1.5 && atTop() && !busy) {
        busy = true;
        setPull(PULL_HOLD);
        setRefreshing(true);
        const done = () => {
          busy = false;
          setRefreshing(false);
          setPull(0);
        };
        loadRef.current().then(done, done);
      } else setPull(0);
    };
    root.addEventListener('touchstart', start, { passive: true });
    root.addEventListener('touchend', end, { passive: true });
    const cancel = () => {
      stop();
      if (!busy) setPull(0);
    };
    root.addEventListener('touchcancel', cancel, { passive: true });
    return () => {
      stop();
      root.removeEventListener('touchstart', start);
      root.removeEventListener('touchend', end);
      root.removeEventListener('touchcancel', cancel);
    };
  }, []);

  // switching the tab or the «Мои / Обзор» switch leaves selection mode
  useEffect(() => {
    setSelected(null);
  }, [tab, mine]);
  useBackHandler(() => setSelected(null), selected !== null);
  useEffect(() => () => clearTimeout(press.current.timer), []);

  // the active server is the phone's own one and it is stopped: offer to start it right here
  const local = localServer.value;
  const canStartLocal = !!error && !!c && c.baseUrl === LOCAL_URL && local.supported && !local.running;
  // no binary yet (e.g. updated from 0.14, when it was in the APK): the setup screen offers the download
  const mustDownload = canStartLocal && !canRun(local);
  const size = downloadSize(local);
  const startLabel = mustDownload ? (size ? t('library.downloadServerSize', { size }) : t('library.downloadServer')) : t('remote.startServer');
  const startNote = mustDownload
    ? t('library.mustDownload')
    : startError || undefined;
  async function startServer() {
    if (mustDownload) {
      navigate({ name: 'localServer' });
      return;
    }
    if (starting) return;
    setStarting(true);
    try {
      await startLocal();
      setStartError(localServer.value.running ? '' : localServer.value.error || t('library.startFailed'));
    } finally {
      setStarting(false);
      setReload((n) => n + 1);
    }
  }

  const isHistory = tab === 'history';
  // «Все» and «Сериалы»: the torrents of one series are one card
  // and the releases of one film are one card too («Все», «Фильмы»)
  const shown = useMemo<PhoneItem[]>(() => {
    if (isHistory) return [];
    const inTab = sortTorrents(list.filter((t) => tab === 'all' || categoryOf(t.category) === tab), sort);
    let items: PhoneItem[] = tab === 'all' || tab === 'tv' || tab === 'movie' ? groupPhoneLibrary(inTab) : inTab.map((tor) => ({ kind: 'torrent' as const, tor }));
    if (sort === 'fresh') {
      const fresh: PhoneItem[] = [];
      const rest: PhoneItem[] = [];
      items.forEach((it) => {
        const card = it.kind === 'series' ? cachedSeriesMatch(it.key) : null;
        if (card && it.kind === 'series' && tileBadgeInfo(card, it.seasons).kind) fresh.push(it);
        else rest.push(it);
      });
      items = fresh.concat(rest);
    }
    return items;
  }, [list, tab, isHistory, sort, seriesMatchVersion.value]);
  const shownHashes = useMemo(() => phoneItemHashes(shown), [shown]);
  const pv = progressVersion.value;
  const sv = serverViewed.value;
  const sharedHistory = settings.value.sharedHistory !== false;
  const history = useMemo(() => {
    if (!isHistory) return [];
    const rows = sharedHistory
      ? buildHistory(list, hfilter, continueWatching(list, 80), getLocalProgress, 80, { src: 'phone', name: phoneName })
      : localItems(list, phoneName);
    const grouped = collapseHistoryShows(rows).filter((it) => !restarted(it.torrent.hash, it.source.at || it.progress.updated || 0) && !isHistoryHidden(showKeyOf(it.torrent)) && !isHistoryHidden(it.torrent.hash + ':' + it.fileIndex));
    return unfinishedFirst(grouped, (it: HistoryItem) => phoneHistoryFinished(it.progress.time, it.progress.duration, it.progress.open));
  }, [list, isHistory, hfilter, pv, sv, phoneName, sharedHistory, hideTick]);
  const resume = useMemo(() => {
    if (isHistory) return [];
    const hidden = hiddenHistory();
    return continueCards(watchesOf(list, sharedHistory, phoneName), filesByShow(list), Date.now())
      .filter((c) => !isHistoryHidden(c.showKey, hidden) && !isHistoryHidden(c.hash + ':' + c.fileIndex, hidden))
      .slice(0, 12);
  }, [list, isHistory, pv, sv, phoneName, sharedHistory, hideTick]);

  // nothing to show: no server, or the server failed and there is no cached list
  const unavailable = !c || (!!error && !list.length);
  const serverName = activeServer.value ? activeServer.value.name : null;
  const online = typeof navigator === 'undefined' || navigator.onLine !== false || (!!c && c.baseUrl === LOCAL_URL);
  const now = Date.now();
  const count = isHistory ? history.length : shown.length;
  let empty = '';
  if (loaded && !count && !unavailable) {
    if (query.trim()) empty = t('catalog.nothingFound');
    else if (isHistory && hfilter !== 'all') empty = hfilter === 'phone' ? t('catalog.nothingFromPhone') : t('catalog.nothingFromTv');
    else if (isHistory) empty = t('catalog.historyEmpty');
    else if (!list.length) empty = t('library.noTorrents');
    else empty = t('catalog.categoryEmpty');
  }

  // poster grids: columns from the content width, the same rule in portrait and landscape
  const gridView = mine && !isHistory && (view === 'large' || view === 'small');
  const gridMode: GridMode = view === 'small' ? 'small' : 'large';
  const gridWidth = useContentWidth(gridRef, gridView);
  const gridColsNow = gridView && gridWidth > 0 ? gridCols(gridWidth, gridMode) : 0;
  const gridStyle = gridView ? { gridTemplateColumns: gridTemplate(gridMode) } : undefined;

  // two fingers on the list step the view once per gesture (spread = bigger), animated after the change
  const pinch = usePinchStep(bodyRef, {
    enabled: mine && !isHistory && !unavailable,
    levels: BY_SIZE.length,
    level: () => Math.max(0, BY_SIZE.indexOf(settings.peek().libraryView)),
    apply: (i) => updateSettings({ libraryView: BY_SIZE[i] }),
    // the first finger may have started the long press timer on a card
    onStart: () => {
      clearTimeout(press.current.timer);
      press.current.timer = undefined;
    },
    anchorAttr: 'data-anchor',
    // rows and poster cards have different markup: the posters morph between them and the text fades in
    posterAttr: 'data-poster',
    morph: (from, to) => isRowView(BY_SIZE[from]) !== isRowView(BY_SIZE[to]),
    // landscape: the two-row grid fills the screen and a FLIP of every card overlaps them - the step lands at once
    calm: () => window.innerWidth > window.innerHeight,
  });

  const selecting = selected !== null;
  // ads among the cards of «Мои» (not in History, a search, selection mode or a failed list); the same cell size as
  // the cards in every view, only below the screen when it appears
  const ads = useAdSlots({
    section: 'mine',
    count: shown.length,
    perScreen: gridColsNow || PER_SCREEN[view] || PER_SCREEN.list,
    active: mine && !isHistory && !unavailable && !selecting && !query.trim() && loaded,
    listKey: tab + '|' + sort,
    itemEl: (i) => (bodyRef.current ? bodyRef.current.querySelectorAll('[data-anchor]')[i] || null : null),
  });
  const adCell = (pos: number, kind: AdCellKind) => {
    const b = ads.banner(pos);
    return b ? <AdCell key={'ad:mine:' + pos} kind={kind} banner={b} onShown={() => ads.shown(pos)} onClick={() => ads.click(pos)} /> : null;
  };
  // only the torrents still in the list count (a refresh may drop some)
  const chosen = selected ? selected.filter((h) => shownHashes.indexOf(h) >= 0) : [];
  const isChosen = (it: PhoneItem) => hashesOf(it).every((h) => chosen.indexOf(h) >= 0);
  // a series card selects (or clears) all its torrents
  const toggle = (hashes: string[]) =>
    setSelected((cur) => {
      if (!cur) return cur;
      const all = hashes.every((h) => cur.indexOf(h) >= 0);
      return all ? cur.filter((h) => hashes.indexOf(h) < 0) : cur.concat(hashes.filter((h) => cur.indexOf(h) < 0));
    });
  const deleteChosen = async () => {
    if (!c || deleting || !chosen.length) return;
    if (!(await askConfirm(tp('library.deleteAsk', chosen.length), t('common.delete'), { destructive: true, testId: 'PD45' }))) return;
    setDeleting(true);
    try {
      reportDeleted(await deleteTorrents(c, chosen));
    } finally {
      setDeleting(false);
      setSelected(null);
    }
  };
  // long press (500 ms without moving more than 10 px) or contextmenu opens the menu; a tap opens the card or toggles the selection
  const pressProps = (it: PhoneItem) => ({
    onPointerDown: (e: PointerEvent) => {
      const p = press.current;
      clearTimeout(p.timer);
      p.fired = false;
      if (selecting || pinch.active()) return;
      p.x = e.clientX;
      p.y = e.clientY;
      p.timer = setTimeout(() => {
        p.timer = undefined;
        if (pinch.active()) return;
        p.fired = true;
        setMenuFor(it);
      }, LONG_PRESS_MS);
    },
    onPointerMove: (e: PointerEvent) => {
      const p = press.current;
      if (p.timer && Math.hypot(e.clientX - p.x, e.clientY - p.y) > LONG_PRESS_SLOP) {
        clearTimeout(p.timer);
        p.timer = undefined;
      }
    },
    onPointerUp: () => clearTimeout(press.current.timer),
    onPointerCancel: () => clearTimeout(press.current.timer),
    onContextMenu: (e: Event) => {
      e.preventDefault();
      clearTimeout(press.current.timer);
      if (selecting) return;
      press.current.fired = true;
      setMenuFor(it);
    },
    onClick: () => {
      if (press.current.fired) {
        press.current.fired = false;
        return;
      }
      if (selecting) toggle(hashesOf(it));
      else if (it.kind === 'torrent') navigate(routeForTorrent(it.tor));
      // a film with several releases: its screen opens on the one watched last, «Сменить» there picks another
      else if (it.kind === 'film') navigate({ name: 'torrent', hash: it.lead.hash });
      else navigate({ name: 'series', key: it.key });
    },
    'aria-pressed': selecting ? isChosen(it) : undefined,
  });
  const moreBtn = (it: PhoneItem) => (
    <button type="button" class="m-icon-btn m-card-more" aria-label={t('library.actions')} disabled={selecting} onClick={() => setMenuFor(it)}>
      <Icon d={MORE} size={20} />
    </button>
  );
  const mark = (it: PhoneItem) =>
    selecting && isChosen(it) ? (
      <span class="m-check" aria-hidden="true">
        <Icon d={CHECK} size={16} />
      </span>
    ) : null;
  const sel = (it: PhoneItem) => (selecting && isChosen(it) ? ' selected' : '');

  const watchOnTv = (tor: Torrent) => {
    const target = watchTarget(tor.hash, playableFiles(filesOf(tor)));
    if (!target) return;
    void launch.start({
      hash: tor.hash,
      file: target.id,
      at: sharedResume(tor.hash, target.id),
      duration: getLocalProgress(tor.hash, target.id)?.duration || undefined,
      label: [episodeLabel(target.path), stripExt(baseName(target.path))].filter(Boolean).join(' · '),
      files: filesOf(tor),
      season: parseEpisode(target.path).season !== null ? parseEpisode(target.path).season! : undefined,
      onError: setTvError,
    });
  };

  // no TV chosen: «Продолжить» plays on this phone (from the same place)
  const continueOnTv = (hash: string, fileIndex: number, time: number, duration: number, label: string) => {
    if (!tvFirst()) {
      const cached = list.find((x) => x.hash === hash);
      setTvError('');
      // the saved library cache has no file_stats: the files are loaded first, as on the torrent screen
      const withFiles = async (): Promise<Torrent> => {
        if (cached && filesOf(cached).some((f) => f.id === fileIndex)) return cached;
        if (!c) throw new Error(t('torrent.noFiles'));
        return c.loadInfo(hash);
      };
      return withFiles()
        .then((tor) => {
          // the screen closed or the server was switched while the files loaded: nothing plays
          if (!aliveRef.current || client.peek() !== c) return false;
          const file = filesOf(tor).find((f) => f.id === fileIndex);
          if (!file) throw new Error(t('torrent.noFiles'));
          return playOnPhone(tor, file, time).then(() => true);
        })
        .then(
          (played) => played,
          (e) => {
            setTvError(errorMessage(e));
            return false;
          },
        );
    }
    const tor = list.find((x) => x.hash === hash);
    const file = tor ? filesOf(tor).find((f) => f.id === fileIndex) : undefined;
    const season = file ? parseEpisode(file.path).season : null;
    return launch.start({
      hash,
      file: fileIndex,
      at: time,
      duration: duration > 0 ? duration : undefined,
      label,
      files: tor ? filesOf(tor) : undefined,
      season: season !== null ? season : undefined,
      onError: setTvError,
    });
  };

  const pullStyle = pull > 0 || dragging
    ? { transform: 'translateY(' + pull + 'px)', transition: dragging ? 'none' : 'transform .25s ease' }
    : { transition: 'transform .25s ease' };
  const armed = pull >= PULL_TRIGGER || refreshing;
  return (
    <div class="m-screen m-library" data-route="library" data-collapsed="0" ref={rootRef}>
      <div class="m-lib-sticky">
      {selecting && mine && !isHistory ? (
        <div class="m-lib-head m-select-bar">
          <button type="button" class="m-icon-btn tm" data-code="P02.6" aria-label={t('library.selectCancel')} disabled={deleting} onClick={() => setSelected(null)}>
            <Icon d={CLOSE} size={20} />
          </button>
          <span class="m-select-count" role="status">{t('library.selected', { n: chosen.length })}</span>
          <button
            type="button"
            class="m-btn m-btn-secondary m-btn-sm tm"
            data-code="P02.7"
            disabled={deleting}
            onClick={() => setSelected(chosen.length === shownHashes.length ? [] : shownHashes.slice())}
          >
            {chosen.length === shownHashes.length && shownHashes.length > 0 ? t('library.selectNone') : t('library.selectAll')}
          </button>
          <button type="button" class="m-btn m-btn-secondary m-btn-sm m-danger tm" data-code="P02.15" disabled={deleting || !chosen.length} onClick={() => void deleteChosen()}>
            {t('library.deleteN', { n: chosen.length })}
          </button>
        </div>
      ) : (
      <div class={'m-lib-head' + (mode === 'discover' && compactBar ? ' m-lib-head-discover' : '')}>
        {/* compact: the small logo and the «Мои | Обзор» switch share the row with the icon buttons.
            In phone landscape the discover title and its tools join this row; the TV chip stays at the end. */}
        <div class="m-lib-brand">
          <Logo size={24} />
          <span class="m-sr">OMP</span>
        </div>
        <div class="m-seg" role="tablist" aria-label={t('nav.library')}>
          {(['mine', 'discover'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              class={'m-seg-btn tm' + (mode === m ? ' on' : '')}
              data-code={m === 'mine' ? (mode === 'discover' ? 'P34.1' : 'P02.1') : mode === 'discover' ? 'P34.2' : 'P02.2'}
              data-hint-anchor={m === 'mine' ? 'mine' : undefined}
              onClick={() => {
                if (m === mode) return;
                setCatalogMode(m);
                // the other mode starts at the top (one scroll offset for the tab: the mode left is not kept)
                scrollToTop();
              }}
            >
              {m === 'mine' ? t('discover.mine') : t('discover.browse')}
            </button>
          ))}
        </div>
        {mode === 'discover' && compactBar && <div class="m-disc-slot" ref={setDiscoverHeadSlot} />}
        <TvChip />
        {mine && (
          <button
            type="button"
            class={'m-icon-btn tm' + (isHistory ? ' on' : '')}
            data-code="P02.20"
            data-lib-history
            aria-label={t('nav.history')}
            aria-pressed={isHistory}
            onClick={() => {
              libraryTab.value = isHistory ? 'all' : 'history';
              scrollToTop();
            }}
          >
            <Icon d={ICONS.clock} size={20} />
          </button>
        )}
        {mine && !isHistory && (
          <button
            type="button"
            class="m-icon-btn m-sort tm"
            data-code="P02.3"
            aria-label={t('nav.viewSortNow', { sort: sortLabel(sort), view: phoneViewLabel(view) })}
            aria-haspopup="dialog"
            onClick={() => setViewSheet(true)}
          >
            <Icon d={ICONS['view-' + view as keyof typeof ICONS]} size={20} />
          </button>
        )}
        {mine && (
          <button
            type="button"
            class="m-icon-btn tm"
            data-code="P02.5"
            aria-label={t('nav.search')}
            data-hint-anchor="catalog"
            onClick={() => switchTab({ name: 'add', scope: 'mine' })}
          >
            <Icon d={SEARCH} size={20} />
          </button>
        )}
      </div>
      )}
      {mine && (
      <div class="m-tabs" role="tablist">
        {/* «История» is the clock in the header and «Вся история» of «Продолжить просмотр», not a chip */}
        {libraryTabs().filter((x) => x.id !== 'history').map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            class={'m-tab tm' + (tab === t.id ? ' on' : '')}
            data-code={t.id === 'history' ? 'P02.8' : t.id === 'all' ? 'P02.9' : t.id === 'movie' ? 'P02.10' : t.id === 'tv' ? 'P02.11' : t.id === 'music' ? 'P02.12' : t.id === 'audiobook' ? 'P02.13' : 'P02.14'}
            onClick={() => {
              libraryTab.value = t.id as LibraryTab;
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      )}
      </div>
      {mine ? (
      <>
      {/* only the list follows the finger: the header and tabs stay put; history device filter sits in the list */}
      <div class="m-lib-pull">
        {(pull > 0 || refreshing) && (
          <div
            class={'m-ptr' + (armed ? ' armed' : '')}
            role="status"
            style={{
              transform: 'translate(-50%, ' + (pull - 48) + 'px)',
              opacity: Math.min(1, pull / PULL_TRIGGER),
              transition: dragging ? 'none' : 'transform .25s ease, opacity .25s ease',
            }}
          >
            <svg
              class={refreshing ? 'm-spin' : ''}
              style={refreshing ? undefined : { transform: 'rotate(' + Math.round((pull / PULL_TRIGGER) * 300) + 'deg)' }}
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4" />
            </svg>
            {refreshing && <span class="m-sr">{t('library.refreshing')}</span>}
          </div>
        )}
        <div class="m-lib-body" style={pullStyle} ref={bodyRef}>
          {!activeTv.value && <FoundTvs quiet />}
          {donateCard && !unavailable && !supporterActive() && (
            <div class="m-donate-card" role="region" aria-label={t('donate.title')}>
              <span>{t('library.donateText')}</span>
              <div class="m-donate-actions">
                <button
                  type="button"
                  class="m-btn m-btn-primary tm"
                  data-code="P02.17"
                  onClick={() => {
                    dismissDonateCard();
                    setDonateCard(false);
                    openDonate();
                  }}
                >
                  {t('library.donate')}
                </button>
                <button
                  type="button"
                  class="m-btn m-btn-secondary tm"
                  data-code="P02.18"
                  onClick={() => {
                    dismissDonateCard();
                    setDonateCard(false);
                  }}
                >
                  {t('library.dontRemind')}
                </button>
              </div>
            </div>
          )}
          {tvError && <LaunchError message={tvError} class="m-hint-warn" />}
          {error && !unavailable && (
            <div class="m-hint-warn m-warn-row">
              <span>{cachedBanner(cachedAt)}</span>
              <button type="button" class="m-btn m-btn-secondary tm" data-code="P02.16" onClick={() => void loadRef.current()}>{t('common.retry')}</button>
            </div>
          )}
          {unavailable && (
            <CatalogUnavailable
              reason={catalogReason(c ? serverName : null, online)}
              onRetry={c ? () => void loadRef.current() : undefined}
              onChangeServer={() => navigate({ name: 'connect' })}
              onStart={canStartLocal ? () => void startServer() : undefined}
              startLabel={startLabel}
              startNote={startNote}
              starting={starting}
              onFaq={() => navigate({ name: 'faq' })}
            />
          )}
          {canStartLocal && !unavailable && (
            <>
              {startNote && <p class="m-hint-warn" data-local="note">{startNote}</p>}
              <button type="button" class="m-btn m-btn-primary" disabled={starting} onClick={() => void startServer()}>
                {startLabel}
              </button>
            </>
          )}
          {c && !loaded && !list.length && <p class="m-muted m-note">{t('catalog.loading')}</p>}
          {empty && <p class="m-muted m-note m-empty">{empty}</p>}
          {!unavailable && !isHistory && !selecting && resume.length > 0 && (
            <div class="m-resume tm" data-code="P02.19" data-resume role="region" aria-label={t('nav.continueRow')}>
              <div class="m-resume-head">
                <span class="m-resume-title">{t('nav.continueRow')}</span>
                <button
                  type="button"
                  class="m-btn-text tm"
                  data-code="P02.21"
                  onClick={() => {
                    libraryTab.value = 'history';
                    scrollToTop();
                  }}
                >
                  {t('nav.historyAll')}
                </button>
              </div>
              <div class="m-resume-row m-scroll-x">
                {resume.map((e) => {
                  const tor = list.filter((x) => x.hash === e.hash)[0];
                  if (!tor) return null;
                  const label = [e.code, displayTitle(tor)].filter(Boolean).join(' · ');
                  const line2 = e.kind === 'next' ? t('history.nextEp', { code: e.code }) : e.code;
                  const line3 = e.kind === 'resume'
                    ? (phoneRemainingLabel(e.time, e.duration, e.open) || (e.time > 0 ? positionLabel(e.time, e.duration) : ''))
                    : '';
                  const openCard = () => {
                    const key = seriesKey(tor);
                    if (key) navigate({ name: 'series', key });
                    else navigate(routeForTorrent(tor));
                  };
                  return (
                    <div key={e.showKey + ':' + e.fileIndex} class="m-resume-card" data-resume-hash={e.hash}>
                      <button type="button" class="m-resume-poster" aria-label={displayTitle(tor)} onClick={openCard}>
                        <Poster torrent={tor} class="m-poster-mini" />
                        <span class="m-resume-play" aria-hidden="true">
                          <Icon d={ICONS.play} size={18} />
                        </span>
                        {e.kind === 'resume' && e.duration > 0 && (
                          <span class="m-resume-edge">
                            <span style={{ width: Math.min(100, (e.time / e.duration) * 100) + '%' }} />
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        class="m-resume-text"
                        aria-label={(tvFirst() ? t('library.continueOnTv') : t('nav.continueRow')) + ': ' + label}
                        onClick={() => void continueOnTv(e.hash, e.fileIndex, e.time, e.duration, label)}
                        onContextMenu={(ev) => {
                          ev.preventDefault();
                          setResumeMenu(e);
                        }}
                      >
                        <span class="m-resume-name"><TileName tor={tor} /></span>
                        {line2 && <span class="m-muted m-small">{line2}</span>}
                        {line3 && <span class="m-muted m-small">{line3}</span>}
                        <span class="m-resume-src">{continueSourceLine(e.src, e.name, e.updated, Date.now())}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {unavailable ? null : isHistory ? (
            <div class="m-list m-history">
              <div class="m-seg m-hist-seg" role="group" aria-label={t('add.source')}>
                {historyFilters().map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    class={'m-seg-btn' + (hfilter === f.id ? ' on' : '')}
                    aria-pressed={hfilter === f.id}
                    onClick={() => updateSettings({ historyFilter: f.id })}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              {history.map((e) => {
                const tor = e.torrent;
                const files = filesOf(tor);
                const file = files.find((f) => f.id === e.fileIndex);
                const isMovie = tor.category === 'movie' || playableFiles(files).length <= 1;
                const { time, duration } = e.progress;
                const from = resumeFrom(e.progress, MIN_RESUME, WATCHED_RATIO);
                return (
                  <div class="m-hrow" key={tor.hash}>
                    <button type="button" class="m-hrow-main" onClick={() => navigate(routeForTorrent(tor))}>
                      <Poster torrent={tor} class="m-poster-mini" />
                      <span class="m-hrow-text">
                        <span class="m-hrow-title"><ShortTitle tor={tor} /></span>
                        <span class="m-muted m-small">{episodeLine(file ? file.path : '', isMovie)}</span>
                        <span class="m-hrow-pos">
                          <span>{positionLabel(time, duration)}</span>
                          <span class="m-muted">{phoneRemainingLabel(time, duration, e.progress.open)}</span>
                        </span>
                        <span class="m-bar-track">
                          <span class="m-bar-fill" style={{ width: (duration > 0 ? Math.min(100, (time / duration) * 100) : 0) + '%' }} />
                        </span>
                        <span class="m-muted m-small m-hrow-src">{sourceLine(e.source, now)}</span>
                      </span>
                    </button>
                    <button type="button" class="m-play" aria-label={tvFirst() ? t('library.continueOnTv') : t('nav.continueRow')} onClick={() => void continueOnTv(tor.hash, e.fileIndex, from, duration, [file ? episodeLabel(file.path) : '', displayTitle(tor)].filter(Boolean).join(' · '))}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M8 5l11 7-11 7z" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            view === 'list' ? (
              <div class="m-vlist" data-view="list">
                {withAds(shown, ads.admitted).map((e) => {
                  if (e.item === undefined) return adCell(e.ad, 'list');
                  const it = e.item;
                  const k = itemKey(it);
                  if (it.kind === 'series') {
                    return (
                      <div class={'m-row-wrap' + sel(it)} key={k} data-anchor={k}>
                        <button type="button" class="m-vrow m-series-card" {...pressProps(it)}>
                          <Poster torrent={it.lead} class="m-poster-row" morphKey={k} badge={qualityBadge(titleOf(it.lead)) || undefined} />
                          {mark(it)}
                          <span class="m-vrow-text">
                            <span class="m-card-title"><TileName tor={it.named} g={it} /></span>
                            <span class="m-muted m-small m-vrow-meta">
                              <span class="m-tile-meta">{rowBottom(it)}</span>
                              <span class="m-vrow-size">{fmtSize(groupSize(it))}</span>
                            </span>
                          </span>
                        </button>
                        {moreBtn(it)}
                      </div>
                    );
                  }
                  const film = it.kind === 'film' ? it : null;
                  const t = it.kind === 'film' ? it.lead : it.tor;
                  return (
                    <div class={'m-row-wrap' + sel(it)} key={k} data-anchor={k}>
                      <button type="button" class={'m-vrow' + (film ? ' m-film-card' : '')} {...pressProps(it)}>
                        <Poster torrent={t} class="m-poster-row" morphKey={k} badge={qualityBadge(titleOf(t)) || undefined} />
                        {mark(it)}
                        <span class="m-vrow-text">
                          <span class="m-card-title"><TileName tor={t} /></span>
                          <span class="m-muted m-small m-vrow-meta">
                            <span class="m-tile-meta">{rowBottom(it)}</span>
                            <span class="m-vrow-size">{fmtSize(film ? filmSize(film) : t.torrent_size || 0)}</span>
                          </span>
                        </span>
                      </button>
                      {moreBtn(it)}
                    </div>
                  );
                })}
              </div>
            ) : view === 'compact' ? (
              <div class="m-vlist m-clist" data-view="compact">
                {withAds(shown, ads.admitted).map((e) => {
                  if (e.item === undefined) return adCell(e.ad, 'compact');
                  const it = e.item;
                  const k = itemKey(it);
                  const g = it.kind === 'series' ? it : null;
                  const film = it.kind === 'film' ? it : null;
                  const tor = it.kind === 'series' ? it.named : it.kind === 'film' ? it.lead : it.tor;
                  const meta = rowBottom(it);
                  const q = qualityBadge(titleOf(tor));
                  return (
                    <div class={'m-row-wrap' + sel(it)} key={k} data-anchor={k}
                      onTouchStart={(ev) => { (ev.currentTarget as HTMLElement).dataset.x = String(ev.changedTouches[0].clientX); }}
                      onTouchEnd={(ev) => {
                        const start = +((ev.currentTarget as HTMLElement).dataset.x || '0');
                        const dx = ev.changedTouches[0].clientX - start;
                        if (dx < -48) (ev.currentTarget as HTMLElement).dataset.open = '1';
                        else if (dx > 24) delete (ev.currentTarget as HTMLElement).dataset.open;
                      }}
                    >
                      <button type="button" class={'m-crow' + (g ? ' m-series-card' : film ? ' m-film-card' : '')} {...pressProps(it)}>
                        {mark(it)}
                        <span class="m-crow-main">
                          <span class="m-crow-titleline">
                            <span class="m-crow-title"><TileName tor={tor} g={g} /></span>
                            {g ? <SeriesTileBadge group={g} split /> : <SeriesTileBadge tor={tor} split />}
                          </span>
                          <span class="m-crow-sub">
                            {meta && <span class="m-muted m-small m-crow-meta m-tile-meta">{meta}</span>}
                            {q && <span class="m-badge-inline">{q}</span>}
                            <span class="m-muted m-small m-crow-size">{fmtSize(it.kind === 'series' ? groupSize(it) : film ? filmSize(film) : tor.torrent_size || 0)}</span>
                          </span>
                        </span>
                      </button>
                      <span class="m-swipe-actions">
                        <button type="button" onClick={() => { hideHistory(g ? g.key : showKeyOf(tor)); setHideTick((n) => n + 1); }}>{t('history.removeItem')}</button>
                        <button type="button" onClick={() => { const f = filesOf(tor)[0]; if (f) markWatched(tor.hash, f.id); }}>{t('history.markWatched')}</button>
                      </span>
                      {moreBtn(it)}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div class={'m-grid m-view-' + view} style={gridStyle} data-cols={gridColsNow || undefined} data-card-min={gridView && gridWidth > 0 ? String(Math.round(cardWidth(gridWidth, gridMode))) : undefined} data-view={view} ref={gridRef}>
                {withAds(shown, ads.admitted).map((e) => {
                  if (e.item === undefined) return adCell(e.ad, 'grid');
                  const it = e.item;
                  const k = itemKey(it);
                  const g = it.kind === 'series' ? it : null;
                  const film = it.kind === 'film' ? it : null;
                  const tor = it.kind === 'torrent' ? it.tor : it.lead;
                  const meta = g ? '' : tileMeta(tor);
                  return (
                    <button type="button" class={'m-card' + (g ? ' m-series-card' : film ? ' m-film-card' : '') + sel(it)} key={k} data-anchor={k} {...pressProps(it)}>
                      {/* a film with several releases: «2 раздачи» on the poster, as a series card has its count */}
                      <Poster torrent={tor} morphKey={k} badge={g ? groupLabel(g) : film ? tp('series.releases', film.members.length) : undefined} initial />
                      {mark(it)}
                      <span class="m-card-title"><TileName tor={g ? g.named : tor} g={g} /></span>
                      {/* a series card has its count on the poster badge; an empty line keeps the cards of a row one height (QA B15) */}
                      {meta ? <span class="m-muted m-card-meta m-tile-meta">{meta}</span> : <span class="m-card-meta-pad" aria-hidden="true" />}
                      {g ? <SeriesTileBadge group={g} /> : <SeriesTileBadge tor={tor} />}
                      {view === 'large' && <span class="m-muted m-small">{fmtSize(g ? groupSize(g) : film ? filmSize(film) : tor.torrent_size || 0)}</span>}
                    </button>
                  );
                })}
              </div>
            )
          )}
        </div>
      </div>
      </>
      ) : (
        <Discover />
      )}
      {launch.sheet}
      {menuFor && menuFor.kind !== 'series' && (
        <TorrentMenu
          tor={menuFor.kind === 'film' ? menuFor.lead : menuFor.tor}
          onClose={() => setMenuFor(null)}
          onSelect={(h) => setSelected(menuFor.kind === 'film' ? menuFor.members.map((m) => m.hash) : [h])}
          onWatchTv={watchOnTv}
        />
      )}
      {resumeMenu && (
        <Sheet label={t('library.actions')} onClose={() => setResumeMenu(null)}>
          <button type="button" class="m-opt" onClick={() => { hideHistory(resumeMenu.showKey); setHideTick((n) => n + 1); setResumeMenu(null); }}>
            {t('history.removeItem')}
          </button>
          <button type="button" class="m-opt" onClick={() => { markWatched(resumeMenu.hash, resumeMenu.fileIndex); setResumeMenu(null); }}>
            {t('history.markWatched')}
          </button>
          <button type="button" class="m-opt" onClick={() => { saveProgress(resumeMenu.hash, resumeMenu.fileIndex, 0, resumeMenu.duration > 0 ? resumeMenu.duration : 1); setResumeMenu(null); }}>
            {t('history.restart')}
          </button>
        </Sheet>
      )}
      {viewSheet && (
        <Sheet label={t('nav.viewSort')} testId="PD54" onClose={() => setViewSheet(false)}>
          <div class="m-sheet-title">{t('nav.viewSort')}</div>
          <div class="m-section">{t('nav.sortHead')}</div>
          <div class="m-sub-pick" role="radiogroup" aria-label={t('nav.sortHead')} data-sheet-sort>
            {phoneSortOptions().map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={sort === o.value}
                class="m-opt"
                data-sort={o.value}
                onClick={() => updateSettings({ librarySort: o.value })}
              >
                <span class="m-opt-name m-grow">{o.label}</span>
                {sort === o.value && <Icon d={CHECK} size={20} />}
              </button>
            ))}
          </div>
          <div class="m-section">{t('nav.viewHead')}</div>
          <div class="m-sub-pick tm" data-code="P02.4" role="radiogroup" aria-label={t('nav.viewHead')} data-sheet-view>
            {phoneViewOptions().map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={view === o.value}
                class={'m-opt' + (view === o.value ? ' on' : '')}
                data-view={o.value}
                onClick={() => updateSettings({ libraryView: o.value })}
              >
                <Icon d={ICONS[('view-' + o.value) as keyof typeof ICONS]} size={20} />
                <span class="m-opt-name m-grow">{o.label}</span>
                {view === o.value && <Icon d={CHECK} size={20} />}
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {menuFor && menuFor.kind === 'series' && <SeriesMenu group={menuFor} onClose={() => setMenuFor(null)} onSelect={(hs) => setSelected(hs)} />}
    </div>
  );
}
