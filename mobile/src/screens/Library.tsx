import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { t, tp } from '../../../src/i18n';
import { Icon, ICONS } from '../ui/Icon';
import { Poster, qualityBadge } from '../ui/Poster';
import { Logo } from '../../../src/ui/Logo';
import { TvChip } from '../ui/TvChip';
import { TorrentMenu } from '../ui/TorrentMenu';
import { useBackHandler } from '../ui/backStack';
import { deleteTorrents, reportDeleted, watchTarget } from '../lib/torrentActions';
import { LaunchError } from '../ui/LaunchError';
import { CatalogUnavailable } from '../ui/CatalogUnavailable';
import { navigate, scrollToTop } from '../nav';
import { filesOf, useTvLaunch } from '../watch';
import { client, activeServer } from '../../../src/store/servers';
import { catalogReason, cachedBanner } from '../../../src/lib/catalogState';
import { torrents, libraryTab, libraryQuery, librarySearchOpen, refreshTorrents, torrentsAt, autoFillPosters } from '../../../src/store/library';
import { continueWatching, refreshViewed, progressVersion, serverViewed, getLocalProgress, resumePosition, MIN_RESUME, WATCHED_RATIO } from '../../../src/store/progress';
import { buildHistory, resumeFrom, sourceLine, historyFilters } from '../../../src/lib/history';
import { settings, updateSettings } from '../../../src/store/settings';
import { filterTorrents, sortTorrents, nextSort, sortLabel } from '../../../src/lib/librarySearch';
import { libraryTabs, nextView, zoomView, viewLabel, episodeLine, positionLabel, remainingLabel, type LibraryTab } from '../../../src/lib/libraryView';
import { categoryOf } from '../../../src/lib/category';
import { formatBytes } from '../../../src/lib/format';
import { baseName, episodeLabel, playableFiles, stripExt } from '../../../src/lib/episodes';
import type { Torrent } from '../../../src/api/types';
import { errorMessage } from '../../../src/api/http';
import { native } from '../platform/native';
import { donateCardDue, dismissDonateCard, openDonate, supporterActive } from '../donate';
import { localServer, startLocal, refreshLocalServer, LOCAL_URL, canRun, downloadSize } from '../server/localServer';
import { displayTitle } from '../../../src/lib/torrentName';
import { catalogMode, setCatalogMode } from '../catalog/phoneCatalog';
import { Discover } from './catalog/Discover';
import { usePinchStep } from '../ui/usePinchStep';

const POLL_MS = 15000;
// pull-to-refresh: the list follows the finger at half speed; release past TRIGGER refreshes
const PULL_DAMP = 0.5;
const PULL_MAX = 110;
const PULL_TRIGGER = 64;
const PULL_HOLD = 56;
const pullOf = (dy: number) => (dy > 0 ? Math.min(PULL_MAX, dy * PULL_DAMP) : 0);
const titleOf = (t: Torrent) => displayTitle(t);

function episodesText(tor: Torrent): string {
  const n = playableFiles(filesOf(tor)).length;
  if (n < 2) return '';
  return tp('library.episodes', n);
}

const SEARCH = 'M5 11a6 6 0 1 0 12 0 6 6 0 0 0-12 0zM21 21l-5-5';
const CLOSE = 'M6 6l12 12M18 6L6 18';
const MORE = 'M5 12h.01M12 12h.01M19 12h.01';
const CHECK = 'M5 12.5l4.5 4.5L19 7';
const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP = 10;

export function Library() {
  const c = client.value;
  const tab = libraryTab.value;
  const query = libraryQuery.value;
  const searchOpen = librarySearchOpen.value;
  const list = torrents.value;
  const cachedAt = torrentsAt.value;
  const sort = settings.value.librarySort;
  const view = settings.value.libraryView;
  const hfilter = settings.value.historyFilter;
  const mode = catalogMode.value;
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
  // selection mode (null = off) and the torrent whose menu is open; a long press that fired swallows the click after it
  const [selected, setSelected] = useState<string[] | null>(null);
  const [menuFor, setMenuFor] = useState<Torrent | null>(null);
  const [deleting, setDeleting] = useState(false);
  const press = useRef<{ timer: ReturnType<typeof setTimeout> | undefined; x: number; y: number; fired: boolean }>({ timer: undefined, x: 0, y: 0, fired: false });
  const loadRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const launch = useTvLaunch();
  progressVersion.value; // re-render when local progress changes
  serverViewed.value;

  useEffect(() => {
    native.phoneName().then((n) => setPhoneName(n), () => undefined);
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
      if (target && target.closest && target.closest('.m-tabs, .m-hfilters')) return;
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
  const shown = useMemo(() => {
    if (isHistory) return [];
    const inTab = list.filter((t) => tab === 'all' || categoryOf(t.category) === tab);
    return sortTorrents(filterTorrents(inTab, query), sort);
  }, [list, tab, query, isHistory, sort]);
  const pv = progressVersion.value;
  const sv = serverViewed.value;
  const history = useMemo(() => {
    if (!isHistory) return [];
    const all = buildHistory(list, hfilter, continueWatching(list, 40), getLocalProgress, 40, { src: 'phone', name: phoneName });
    const match = filterTorrents(all.map((e) => e.torrent), query);
    return all.filter((e) => match.indexOf(e.torrent) >= 0);
  }, [list, isHistory, hfilter, query, pv, sv, phoneName]);

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

  // two fingers on the list step the view like the header button, one notch per gesture (spread = bigger)
  const pinch = usePinchStep(bodyRef, {
    enabled: mine && !isHistory && !unavailable,
    onStep: (dir) => {
      const cur = settings.peek().libraryView;
      const next = zoomView(cur, dir);
      if (next === cur) return false;
      updateSettings({ libraryView: next });
      return true;
    },
    // the first finger may have started the long press timer on a card
    onStart: () => {
      clearTimeout(press.current.timer);
      press.current.timer = undefined;
    },
    anchorAttr: 'data-anchor',
  });

  const selecting = selected !== null;
  // only the torrents still in the list count (a refresh may drop some)
  const chosen = selected ? selected.filter((h) => shown.some((x) => x.hash === h)) : [];
  const toggle = (hash: string) =>
    setSelected((cur) => (cur ? (cur.indexOf(hash) >= 0 ? cur.filter((h) => h !== hash) : cur.concat(hash)) : cur));
  const deleteChosen = async () => {
    if (!c || deleting || !chosen.length) return;
    if (!window.confirm(tp('library.deleteAsk', chosen.length))) return;
    setDeleting(true);
    try {
      reportDeleted(await deleteTorrents(c, chosen));
    } finally {
      setDeleting(false);
      setSelected(null);
    }
  };
  // long press (500 ms without moving more than 10 px) or contextmenu opens the menu; a tap opens the card or toggles the selection
  const pressProps = (tor: Torrent) => ({
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
        setMenuFor(tor);
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
      setMenuFor(tor);
    },
    onClick: () => {
      if (press.current.fired) {
        press.current.fired = false;
        return;
      }
      if (selecting) toggle(tor.hash);
      else navigate({ name: 'torrent', hash: tor.hash });
    },
    'aria-pressed': selecting ? chosen.indexOf(tor.hash) >= 0 : undefined,
  });
  const moreBtn = (tor: Torrent) => (
    <button type="button" class="m-icon-btn m-card-more" aria-label={t('library.actions')} disabled={selecting} onClick={() => setMenuFor(tor)}>
      <Icon d={MORE} size={20} />
    </button>
  );
  const mark = (tor: Torrent) =>
    selecting && chosen.indexOf(tor.hash) >= 0 ? (
      <span class="m-check" aria-hidden="true">
        <Icon d={CHECK} size={16} />
      </span>
    ) : null;
  const sel = (tor: Torrent) => (selecting && chosen.indexOf(tor.hash) >= 0 ? ' selected' : '');

  const watchOnTv = (tor: Torrent) => {
    const target = watchTarget(tor.hash, playableFiles(filesOf(tor)));
    if (!target) return;
    void launch.start({
      hash: tor.hash,
      file: target.id,
      at: resumePosition(tor.hash, target.id),
      duration: getLocalProgress(tor.hash, target.id)?.duration || undefined,
      label: [episodeLabel(target.path), stripExt(baseName(target.path))].filter(Boolean).join(' · '),
      onError: setTvError,
    });
  };

  const continueOnTv = (hash: string, fileIndex: number, time: number, duration: number, label: string) =>
    launch.start({
      hash,
      file: fileIndex,
      at: time,
      duration: duration > 0 ? duration : undefined,
      label,
      onError: setTvError,
    });

  const pullStyle = pull > 0 || dragging
    ? { transform: 'translateY(' + pull + 'px)', transition: dragging ? 'none' : 'transform .25s ease' }
    : { transition: 'transform .25s ease' };
  const armed = pull >= PULL_TRIGGER || refreshing;
  return (
    <div class="m-screen m-library" data-route="library" ref={rootRef}>
      {selecting && mine && !isHistory ? (
        <div class="m-lib-head m-select-bar">
          <button type="button" class="m-icon-btn" aria-label={t('library.selectCancel')} disabled={deleting} onClick={() => setSelected(null)}>
            <Icon d={CLOSE} size={20} />
          </button>
          <span class="m-select-count" role="status">{t('library.selected', { n: chosen.length })}</span>
          <button
            type="button"
            class="m-btn m-btn-secondary m-btn-sm"
            disabled={deleting}
            onClick={() => setSelected(chosen.length === shown.length ? [] : shown.map((x) => x.hash))}
          >
            {chosen.length === shown.length && shown.length > 0 ? t('library.selectNone') : t('library.selectAll')}
          </button>
          <button type="button" class="m-btn m-btn-secondary m-btn-sm m-danger" disabled={deleting || !chosen.length} onClick={() => void deleteChosen()}>
            {t('library.deleteN', { n: chosen.length })}
          </button>
        </div>
      ) : (
      <div class="m-lib-head">
        <div class="m-lib-brand">
          <Logo size={28} />
          <span class="m-brand-name">OMP</span>
        </div>
        <TvChip />
        {mine && !isHistory && (
          <button
            type="button"
            class="m-icon-btn m-sort"
            aria-label={t('tv.topbar.sort', { name: sortLabel(sort) })}
            onClick={() => updateSettings({ librarySort: nextSort(sort) })}
          >
            <Icon d={ICONS.sort} size={20} />
          </button>
        )}
        {mine && !isHistory && (
          <button
            type="button"
            class="m-icon-btn m-view"
            aria-label={t('tv.topbar.view', { name: viewLabel(view) })}
            onClick={() => updateSettings({ libraryView: nextView(view) })}
          >
            <Icon d={ICONS['view-' + view as keyof typeof ICONS]} size={20} />
          </button>
        )}
        {mine && (
          <button
            type="button"
            class="m-icon-btn"
            aria-label={t('add.search')}
            aria-pressed={searchOpen}
            onClick={() => (librarySearchOpen.value = !searchOpen)}
          >
            <Icon d={SEARCH} size={20} />
          </button>
        )}
      </div>
      )}
      <div class="m-seg" role="tablist" aria-label={t('nav.library')}>
        {(['mine', 'discover'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            class={'m-seg-btn' + (mode === m ? ' on' : '')}
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
      {mine ? (
      <>
      {searchOpen && (
        <input
          class="m-input m-lib-search"
          type="search"
          aria-label={t('catalog.searchPlaceholder')}
          placeholder={t('catalog.searchPlaceholder')}
          value={query}
          onInput={(e) => (libraryQuery.value = (e.target as HTMLInputElement).value)}
        />
      )}
      <div class="m-tabs" role="tablist">
        {libraryTabs().map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            class={'m-tab' + (tab === t.id ? ' on' : '')}
            onClick={() => (libraryTab.value = t.id as LibraryTab)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {isHistory && (
        <div class="m-hfilters" role="group" aria-label={t('add.source')}>
          {historyFilters().map((f) => (
            <button
              key={f.id}
              type="button"
              class={'m-hfilter' + (hfilter === f.id ? ' on' : '')}
              aria-pressed={hfilter === f.id}
              onClick={() => updateSettings({ historyFilter: f.id })}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
      {/* only the list follows the finger: the header, tabs and filters stay put */}
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
          {donateCard && !unavailable && !supporterActive() && (
            <div class="m-donate-card" role="region" aria-label={t('donate.title')}>
              <span>{t('library.donateText')}</span>
              <div class="m-donate-actions">
                <button
                  type="button"
                  class="m-btn m-btn-primary"
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
                  class="m-btn m-btn-secondary"
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
              <button type="button" class="m-btn m-btn-secondary" onClick={() => void loadRef.current()}>{t('common.retry')}</button>
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
          {unavailable ? null : isHistory ? (
            <div class="m-list m-history">
              {history.map((e) => {
                const tor = e.torrent;
                const files = filesOf(tor);
                const file = files.find((f) => f.id === e.fileIndex);
                const isMovie = tor.category === 'movie' || playableFiles(files).length <= 1;
                const { time, duration } = e.progress;
                const from = resumeFrom(e.progress, MIN_RESUME, WATCHED_RATIO);
                return (
                  <div class="m-hrow" key={tor.hash}>
                    <button type="button" class="m-hrow-main" onClick={() => navigate({ name: 'torrent', hash: tor.hash })}>
                      <Poster torrent={tor} class="m-poster-mini" />
                      <span class="m-hrow-text">
                        <span class="m-hrow-title">{displayTitle(tor)}</span>
                        <span class="m-muted m-small">{episodeLine(file ? file.path : '', isMovie)}</span>
                        <span class="m-hrow-pos">
                          <span>{positionLabel(time, duration)}</span>
                          <span class="m-muted">{remainingLabel(time, duration)}</span>
                        </span>
                        <span class="m-bar-track">
                          <span class="m-bar-fill" style={{ width: (duration > 0 ? Math.min(100, (time / duration) * 100) : 0) + '%' }} />
                        </span>
                        <span class="m-muted m-small m-hrow-src">{sourceLine(e.source, now)}</span>
                      </span>
                    </button>
                    <button type="button" class="m-play" aria-label={t('library.continueOnTv')} onClick={() => void continueOnTv(tor.hash, e.fileIndex, from, duration, [file ? episodeLabel(file.path) : '', displayTitle(tor)].filter(Boolean).join(' · '))}>
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
              <div class="m-vlist">
                {shown.map((t) => {
                  const eps = episodesText(t);
                  const q = qualityBadge(titleOf(t));
                  return (
                    <div class={'m-row-wrap' + sel(t)} key={t.hash} data-anchor={t.hash}>
                      <button type="button" class="m-vrow" {...pressProps(t)}>
                        <Poster torrent={t} class="m-poster-row" />
                        {mark(t)}
                        <span class="m-vrow-text">
                          <span class="m-card-title">{titleOf(t)}</span>
                          <span class="m-muted m-small m-vrow-meta">
                            <span>{formatBytes(t.torrent_size || 0)}</span>
                            {q && <span class="m-badge-inline">{q}</span>}
                            {eps && <span>{eps}</span>}
                          </span>
                        </span>
                      </button>
                      {moreBtn(t)}
                    </div>
                  );
                })}
              </div>
            ) : view === 'compact' ? (
              <div class="m-vlist m-clist">
                {shown.map((t) => (
                  <div class={'m-row-wrap' + sel(t)} key={t.hash} data-anchor={t.hash}>
                    <button type="button" class="m-crow" {...pressProps(t)}>
                      {mark(t)}
                      <span class="m-crow-title">{titleOf(t)}</span>
                      <span class="m-muted m-small m-crow-size">{formatBytes(t.torrent_size || 0)}</span>
                    </button>
                    {moreBtn(t)}
                  </div>
                ))}
              </div>
            ) : (
              <div class={'m-grid m-view-' + view}>
                {shown.map((t) => (
                  <button type="button" class={'m-card' + sel(t)} key={t.hash} data-anchor={t.hash} {...pressProps(t)}>
                    <Poster torrent={t} />
                    {mark(t)}
                    <span class="m-card-title">{titleOf(t)}</span>
                    {view === 'large' && <span class="m-muted m-small">{formatBytes(t.torrent_size || 0)}</span>}
                  </button>
                ))}
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
      {menuFor && <TorrentMenu tor={menuFor} onClose={() => setMenuFor(null)} onSelect={(h) => setSelected([h])} onWatchTv={watchOnTv} />}
    </div>
  );
}
