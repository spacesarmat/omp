import { useEffect, useMemo, useState } from 'preact/hooks';
import { Icon, ICONS } from '../ui/Icon';
import { Poster, qualityBadge } from '../ui/Poster';
import { Logo } from '../../../src/ui/Logo';
import { TvChip } from '../ui/TvChip';
import { LaunchError } from '../ui/LaunchError';
import { navigate } from '../nav';
import { filesOf, useTvLaunch } from '../watch';
import { client } from '../../../src/store/servers';
import { torrents, libraryTab, libraryQuery, librarySearchOpen, refreshTorrents } from '../../../src/store/library';
import { continueWatching, refreshViewed, progressVersion, serverViewed } from '../../../src/store/progress';
import { settings, updateSettings } from '../../../src/store/settings';
import { filterTorrents, sortTorrents, nextSort, sortLabel } from '../../../src/lib/librarySearch';
import { LIBRARY_TABS, nextView, viewLabel, episodeLine, positionLabel, remainingLabel, type LibraryTab } from '../../../src/lib/libraryView';
import { categoryOf } from '../../../src/lib/category';
import { formatBytes } from '../../../src/lib/format';
import { episodeLabel, playableFiles } from '../../../src/lib/episodes';
import type { Torrent } from '../../../src/api/types';
import { errorMessage } from '../../../src/api/http';

const POLL_MS = 15000;
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
  const sort = settings.value.librarySort;
  const view = settings.value.libraryView;
  const [loaded, setLoaded] = useState(list.length > 0);
  const [error, setError] = useState('');
  const [tvError, setTvError] = useState('');
  const launch = useTvLaunch();
  progressVersion.value; // re-render when local progress changes
  serverViewed.value;

  useEffect(() => {
    if (!c) return;
    let alive = true;
    const load = () => {
      refreshTorrents(c).then(
        () => {
          if (!alive) return;
          setError('');
          setLoaded(true);
        },
        (e) => {
          if (!alive) return;
          setError(errorMessage(e));
          setLoaded(true);
        },
      );
      void refreshViewed(c);
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [c]);

  const isHistory = tab === 'history';
  const shown = useMemo(() => {
    if (isHistory) return [];
    const inTab = list.filter((t) => tab === 'all' || categoryOf(t.category) === tab);
    return sortTorrents(filterTorrents(inTab, query), sort);
  }, [list, tab, query, isHistory, sort]);
  const history = isHistory
    ? (() => {
        const all = continueWatching(list, 40);
        const match = filterTorrents(all.map((e) => e.torrent), query);
        return all.filter((e) => match.indexOf(e.torrent) >= 0);
      })()
    : [];

  const count = isHistory ? history.length : shown.length;
  let empty = '';
  if (loaded && !count) {
    if (query.trim()) empty = 'Ничего не найдено';
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

  return (
    <div class="m-screen m-library" data-route="library">
      <div class="m-lib-head">
        <div class="m-lib-brand">
          <Logo size={28} />
          <span class="m-brand-name">OMP</span>
        </div>
        <TvChip />
        {!isHistory && (
          <button
            type="button"
            class="m-chip m-sort"
            aria-label={'Сортировка: ' + sortLabel(sort)}
            onClick={() => updateSettings({ librarySort: nextSort(sort) })}
          >
            {sortLabel(sort)}
          </button>
        )}
        {!isHistory && (
          <button
            type="button"
            class="m-chip m-view"
            aria-label={'Вид: ' + viewLabel(view)}
            onClick={() => updateSettings({ libraryView: nextView(view) })}
          >
            <Icon d={ICONS['view-' + view as keyof typeof ICONS]} size={16} />
            <span>{viewLabel(view)}</span>
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
      {tvError && <LaunchError message={tvError} class="m-hint-warn" />}
      {error && <div class="m-hint-warn">{error} — показан сохранённый список</div>}
      {!loaded && !list.length && <p class="m-muted m-note">Загрузка…</p>}
      {empty && <p class="m-muted m-note m-empty">{empty}</p>}
      {isHistory ? (
        <div class="m-list m-history">
          {history.map((e) => {
            const t = e.torrent;
            const files = filesOf(t);
            const file = files.find((f) => f.id === e.fileIndex);
            const isMovie = t.category === 'movie' || playableFiles(files).length <= 1;
            const { time, duration } = e.progress;
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
                  </span>
                </button>
                <button type="button" class="m-play" aria-label="Продолжить на ТВ" onClick={() => void continueOnTv(t.hash, e.fileIndex, time, duration, [file ? episodeLabel(file.path) : '', t.title || t.name || t.hash].filter(Boolean).join(' · '))}>
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
      {launch.sheet}
    </div>
  );
}
