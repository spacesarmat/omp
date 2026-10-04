import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Icon, ICONS } from '../ui/Icon';
import { Poster, qualityBadge } from '../ui/Poster';
import { Logo } from '../../../src/ui/Logo';
import { TvChip } from '../ui/TvChip';
import { LaunchError } from '../ui/LaunchError';
import { CatalogUnavailable } from '../ui/CatalogUnavailable';
import { navigate } from '../nav';
import { filesOf, useTvLaunch } from '../watch';
import { client, activeServer } from '../../../src/store/servers';
import { catalogReason, cachedBanner } from '../../../src/lib/catalogState';
import { torrents, libraryTab, libraryQuery, librarySearchOpen, refreshTorrents, torrentsAt, autoFillPosters } from '../../../src/store/library';
import { continueWatching, refreshViewed, progressVersion, serverViewed, getLocalProgress, MIN_RESUME, WATCHED_RATIO } from '../../../src/store/progress';
import { buildHistory, resumeFrom, sourceLine, HISTORY_FILTERS } from '../../../src/lib/history';
import { settings, updateSettings } from '../../../src/store/settings';
import { filterTorrents, sortTorrents, nextSort, sortLabel } from '../../../src/lib/librarySearch';
import { LIBRARY_TABS, nextView, viewLabel, episodeLine, positionLabel, remainingLabel, type LibraryTab } from '../../../src/lib/libraryView';
import { categoryOf } from '../../../src/lib/category';
import { formatBytes } from '../../../src/lib/format';
import { episodeLabel, playableFiles } from '../../../src/lib/episodes';
import type { Torrent } from '../../../src/api/types';
import { errorMessage } from '../../../src/api/http';
import { native } from '../platform/native';
import { donateCardDue, dismissDonateCard, openDonate } from '../donate';
import { localServer, startLocal, refreshLocalServer, LOCAL_URL } from '../server/localServer';

const POLL_MS = 15000;
// pull-to-refresh: the list follows the finger at half speed; release past TRIGGER refreshes
const PULL_DAMP = 0.5;
const PULL_MAX = 110;
const PULL_TRIGGER = 64;
const PULL_HOLD = 56;
const pullOf = (dy: number) => (dy > 0 ? Math.min(PULL_MAX, dy * PULL_DAMP) : 0);
const titleOf = (t: Torrent) => t.title || t.name || t.hash;

function episodesText(t: Torrent): string {
  const n = playableFiles(filesOf(t)).length;
  if (n < 2) return '';
  const m10 = n % 10;
  const m100 = n % 100;
  const word = m10 === 1 && m100 !== 11 ? 'серия' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'серии' : 'серий';
  return n + ' ' + word;
}

const SEARCH = 'M5 11a6 6 0 1 0 12 0 6 6 0 0 0-12 0zM21 21l-5-5';

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
  const [loaded, setLoaded] = useState(list.length > 0);
  const [error, setError] = useState('');
  const [tvError, setTvError] = useState('');
  const [reload, setReload] = useState(0);
  const [starting, setStarting] = useState(false);
  const [phoneName, setPhoneName] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [donateCard, setDonateCard] = useState(() => donateCardDue());
  const [pull, setPull] = useState(0);
  const [dragging, setDragging] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
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
      if (busy || e.touches.length !== 1 || !atTop()) return;
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

  // the active server is the phone's own one and it is stopped: offer to start it right here
  const local = localServer.value;
  const canStartLocal = !!error && !!c && c.baseUrl === LOCAL_URL && local.supported && !local.running;
  async function startServer() {
    if (starting) return;
    setStarting(true);
    try {
      await startLocal();
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
    if (query.trim()) empty = 'Ничего не найдено';
    else if (isHistory && hfilter !== 'all') empty = hfilter === 'phone' ? 'С телефона пока ничего не смотрели' : 'С телевизора пока ничего не смотрели';
    else if (isHistory) empty = 'История пуста. Здесь появится то, что вы начали смотреть';
    else if (!list.length) empty = 'Нет торрентов. Добавьте через «Добавить» или веб-интерфейс TorrServer.';
    else empty = 'В этой категории пока ничего нет';
  }

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
      <div class="m-lib-head">
        <div class="m-lib-brand">
          <Logo size={28} />
          <span class="m-brand-name">OMP</span>
        </div>
        <TvChip />
        {!isHistory && (
          <button
            type="button"
            class="m-icon-btn m-sort"
            aria-label={'Сортировка: ' + sortLabel(sort)}
            onClick={() => updateSettings({ librarySort: nextSort(sort) })}
          >
            <Icon d={ICONS.sort} size={20} />
          </button>
        )}
        {!isHistory && (
          <button
            type="button"
            class="m-icon-btn m-view"
            aria-label={'Вид: ' + viewLabel(view)}
            onClick={() => updateSettings({ libraryView: nextView(view) })}
          >
            <Icon d={ICONS['view-' + view as keyof typeof ICONS]} size={20} />
          </button>
        )}
        <button
          type="button"
          class="m-icon-btn"
          aria-label="Поиск"
          aria-pressed={searchOpen}
          onClick={() => (librarySearchOpen.value = !searchOpen)}
        >
          <Icon d={SEARCH} size={20} />
        </button>
      </div>
      {searchOpen && (
        <input
          class="m-input m-lib-search"
          type="search"
          aria-label="Поиск по названию"
          placeholder="Поиск по названию"
          value={query}
          onInput={(e) => (libraryQuery.value = (e.target as HTMLInputElement).value)}
        />
      )}
      <div class="m-tabs" role="tablist">
        {LIBRARY_TABS.map((t) => (
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
        <div class="m-hfilters" role="group" aria-label="Источник">
          {HISTORY_FILTERS.map((f) => (
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
            {refreshing && <span class="m-sr">Обновляю…</span>}
          </div>
        )}
        <div class="m-lib-body" style={pullStyle}>
          {donateCard && !unavailable && (
            <div class="m-donate-card" role="region" aria-label="Поддержать OMP">
              <span>OMP бесплатный и без рекламы. Если он вам полезен, можно поддержать разработку.</span>
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
                  Поддержать
                </button>
                <button
                  type="button"
                  class="m-btn m-btn-secondary"
                  onClick={() => {
                    dismissDonateCard();
                    setDonateCard(false);
                  }}
                >
                  Не напоминать
                </button>
              </div>
            </div>
          )}
          {tvError && <LaunchError message={tvError} class="m-hint-warn" />}
          {error && !unavailable && (
            <div class="m-hint-warn m-warn-row">
              <span>{cachedBanner(cachedAt)}</span>
              <button type="button" class="m-btn m-btn-secondary" onClick={() => void loadRef.current()}>Повторить</button>
            </div>
          )}
          {unavailable && (
            <CatalogUnavailable
              reason={catalogReason(c ? serverName : null, online)}
              onRetry={c ? () => void loadRef.current() : undefined}
              onChangeServer={() => navigate({ name: 'connect' })}
              onStart={canStartLocal ? () => void startServer() : undefined}
              starting={starting}
              onFaq={() => navigate({ name: 'faq' })}
            />
          )}
          {canStartLocal && !unavailable && (
            <button type="button" class="m-btn m-btn-primary" disabled={starting} onClick={() => void startServer()}>
              Запустить сервер
            </button>
          )}
          {c && !loaded && !list.length && <p class="m-muted m-note">Загрузка…</p>}
          {empty && <p class="m-muted m-note m-empty">{empty}</p>}
          {unavailable ? null : isHistory ? (
            <div class="m-list m-history">
              {history.map((e) => {
                const t = e.torrent;
                const files = filesOf(t);
                const file = files.find((f) => f.id === e.fileIndex);
                const isMovie = t.category === 'movie' || playableFiles(files).length <= 1;
                const { time, duration } = e.progress;
                const from = resumeFrom(e.progress, MIN_RESUME, WATCHED_RATIO);
                return (
                  <div class="m-hrow" key={t.hash}>
                    <button type="button" class="m-hrow-main" onClick={() => navigate({ name: 'torrent', hash: t.hash })}>
                      <Poster torrent={t} class="m-poster-mini" />
                      <span class="m-hrow-text">
                        <span class="m-hrow-title">{t.title || t.name || t.hash}</span>
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
                    <button type="button" class="m-play" aria-label="Продолжить на ТВ" onClick={() => void continueOnTv(t.hash, e.fileIndex, from, duration, [file ? episodeLabel(file.path) : '', t.title || t.name || t.hash].filter(Boolean).join(' · '))}>
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
                    <button type="button" class="m-vrow" key={t.hash} onClick={() => navigate({ name: 'torrent', hash: t.hash })}>
                      <Poster torrent={t} class="m-poster-row" />
                      <span class="m-vrow-text">
                        <span class="m-card-title">{titleOf(t)}</span>
                        <span class="m-muted m-small m-vrow-meta">
                          <span>{formatBytes(t.torrent_size || 0)}</span>
                          {q && <span class="m-badge-inline">{q}</span>}
                          {eps && <span>{eps}</span>}
                        </span>
                      </span>
                      <Icon d="M9 6l6 6-6 6" size={18} />
                    </button>
                  );
                })}
              </div>
            ) : view === 'compact' ? (
              <div class="m-vlist m-clist">
                {shown.map((t) => (
                  <button type="button" class="m-crow" key={t.hash} onClick={() => navigate({ name: 'torrent', hash: t.hash })}>
                    <span class="m-crow-title">{titleOf(t)}</span>
                    <span class="m-muted m-small m-crow-size">{formatBytes(t.torrent_size || 0)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div class={'m-grid m-view-' + view}>
                {shown.map((t) => (
                  <button type="button" class="m-card" key={t.hash} onClick={() => navigate({ name: 'torrent', hash: t.hash })}>
                    <Poster torrent={t} />
                    <span class="m-card-title">{titleOf(t)}</span>
                    {view === 'large' && <span class="m-muted m-small">{formatBytes(t.torrent_size || 0)}</span>}
                  </button>
                ))}
              </div>
            )
          )}
        </div>
      </div>
      {launch.sheet}
    </div>
  );
}
