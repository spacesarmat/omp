import { useEffect, useMemo, useState } from 'preact/hooks';
import { Icon } from '../ui/Icon';
import { Poster } from '../ui/Poster';
import { TvChip } from '../ui/TvChip';
import { showToast } from '../ui/toast';
import { navigate } from '../nav';
import { activeTv } from '../tv/tvStore';
import { actions, filesOf, openRemoteSoon, watchOnTvParams } from '../watch';
import { client } from '../../../src/store/servers';
import { torrents, libraryTab, libraryQuery, librarySearchOpen, refreshTorrents } from '../../../src/store/library';
import { continueWatching, refreshViewed, progressVersion, serverViewed } from '../../../src/store/progress';
import { filterTorrents, sortTorrents } from '../../../src/lib/librarySearch';
import { LIBRARY_TABS, episodeLine, positionLabel, remainingLabel, type LibraryTab } from '../../../src/lib/libraryView';
import { categoryOf } from '../../../src/lib/category';
import { formatBytes } from '../../../src/lib/format';
import { playableFiles } from '../../../src/lib/episodes';
import { errorMessage } from '../../../src/api/http';

const POLL_MS = 15000;
const SEARCH = 'M5 11a6 6 0 1 0 12 0 6 6 0 0 0-12 0zM21 21l-5-5';

export function Library() {
  const c = client.value;
  const tab = libraryTab.value;
  const query = libraryQuery.value;
  const searchOpen = librarySearchOpen.value;
  const list = torrents.value;
  const [loaded, setLoaded] = useState(list.length > 0);
  const [error, setError] = useState('');
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
    return sortTorrents(filterTorrents(inTab, query), 'new');
  }, [list, tab, query, isHistory]);
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

  const continueOnTv = async (hash: string, fileIndex: number, time: number) => {
    const tv = activeTv.value;
    if (!c) return;
    if (!tv) {
      navigate({ name: 'tv' });
      return;
    }
    try {
      await actions.launchOnTv(watchOnTvParams(c.baseUrl, hash, fileIndex, time));
      showToast('Запустил на ' + tv.name + ' — пульт уже открыт');
      openRemoteSoon('library');
    } catch (e) {
      showToast(errorMessage(e));
    }
  };

  return (
    <div class="m-screen m-library" data-route="library">
      <div class="m-lib-head">
        <span class="m-brand-name m-lib-brand">OMP</span>
        <TvChip />
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
                <button type="button" class="m-play" aria-label="Продолжить на ТВ" onClick={() => continueOnTv(t.hash, e.fileIndex, time)}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M8 5l11 7-11 7z" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div class="m-grid">
          {shown.map((t) => (
            <button type="button" class="m-card" key={t.hash} onClick={() => navigate({ name: 'torrent', hash: t.hash })}>
              <Poster torrent={t} />
              <span class="m-card-title">{t.title || t.name || t.hash}</span>
              <span class="m-muted m-small">{formatBytes(t.torrent_size || 0)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
