import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { setFocus, doesFocusableExist } from '@noriginmedia/norigin-spatial-navigation';
import { client } from '../store/servers';
import { torrents, libraryTab, libraryQuery, librarySearchOpen, refreshTorrents, addedTorrents, addedMessage } from '../store/library';
import { continueWatching, refreshViewed, progressVersion, serverViewed, clearProgress, getLocalProgress, MIN_RESUME, WATCHED_RATIO } from '../store/progress';
import { forgetWatch } from '../store/journal';
import { buildHistory, resumeFrom } from '../lib/history';
import { settings, updateSettings } from '../store/settings';
import type { Torrent } from '../api/types';
import { errorMessage } from '../api/http';
import { categoryOf } from '../lib/category';
import { filterTorrents, sortTorrents, nextSort } from '../lib/librarySearch';
import { LibraryTab, nextView } from '../lib/libraryView';
import { buildTorrentQueue } from '../player/queue';
import { navigate, resetTo } from '../ui/nav';
import { FocusGroup, ErrorView, Spinner, TextInput } from '../ui/components';
import { KeyDot } from '../ui/icons';
import { restoreFocus } from '../ui/focus';
import { confirmDialog } from '../ui/dialog';
import { toast } from '../ui/toast';
import { useKeys } from '../ui/keys';
import { TopBar } from '../ui/TopBar';
import { TorrentViews } from './library/TorrentViews';
import { HistoryGrid, HistoryEntry, HistoryFilterRow } from './library/HistoryGrid';

export function LibraryScreen() {
  const c = client.value;
  const s = settings.value;
  const tab = libraryTab.value;
  const query = libraryQuery.value;
  const searchOpen = librarySearchOpen.value;
  const setTab = (t: LibraryTab) => { libraryTab.value = t; };
  const setQuery = (q: string) => { libraryQuery.value = q; };
  const setSearchOpen = (o: boolean) => { librarySearchOpen.value = o; };
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(torrents.value.length > 0);
  // card under focus: a torrent, or a history entry when fileIndex is set
  // (a ref: focus moves must not re-render the whole catalog)
  const selRef = useRef<{ hash: string; fileIndex?: number } | null>(null);
  const setSel = (v: { hash: string; fileIndex?: number } | null) => { selRef.current = v; };
  progressVersion.value; // re-render when progress changes
  serverViewed.value;

  const load = (isDead?: () => boolean) => {
    if (!c) return;
    const before = torrents.value;
    refreshTorrents(c).then(
      (list) => {
        if (isDead?.()) return;
        const msg = addedMessage(addedTorrents(before, list));
        if (msg) toast(msg);
        setError(null);
        setLoaded(true);
      },
      (e) => { if (isDead?.()) return; setError(errorMessage(e)); setLoaded(true); },
    );
    refreshViewed(c);
  };

  useEffect(() => {
    if (!c) {
      resetTo({ name: 'connect' });
      return;
    }
    let dead = false;
    load(() => dead);
    // picks up torrents added from a phone via the TorrServer web UI
    const timer = setInterval(() => load(() => dead), 10000);
    return () => {
      dead = true;
      clearInterval(timer);
    };
  }, [c]);

  const showingError = !!error && !torrents.value.length;
  useEffect(() => {
    if (loaded && !showingError) restoreFocus(torrents.value.length ? 'LIB-GRID' : 'tab-' + libraryTab.value);
  }, [loaded, showingError]);

  useEffect(() => {
    if (searchOpen && doesFocusableExist('lib-search')) setFocus('lib-search');
  }, [searchOpen]);

  const closeSearch = () => {
    setQuery('');
    setSearchOpen(false);
    if (doesFocusableExist('lib-btn-search')) setFocus('lib-btn-search');
  };

  const removeTorrent = (hash: string) => {
    const t = torrents.value.find((x) => x.hash === hash);
    confirmDialog('Удалить «' + (t ? t.title : hash) + '»?', 'Удалить').then((ok) => {
      if (!ok || !c) return;
      c.remove(hash).then(
        () => { torrents.value = torrents.value.filter((x) => x.hash !== hash); setSel(null); toast('Торрент удалён'); },
        (e) => toast(errorMessage(e), 'error'),
      );
    });
  };

  const removeHistory = (hash: string, fileIndex: number) => {
    confirmDialog('Убрать из истории?', 'Убрать').then((ok) => {
      if (!ok || !c) return;
      clearProgress(hash, fileIndex);
      // drop the server mark too, otherwise the entry comes back from /viewed
      serverViewed.value = serverViewed.value.filter((e) => !(e.hash === hash && e.file_index === fileIndex));
      c.removeViewed(hash, fileIndex).then(() => undefined, (e) => toast(errorMessage(e), 'error'));
      // and the journal entries of the file (TorrServer `data`), else it comes back from there
      void forgetWatch(c, hash, fileIndex);
      setSel(null);
    });
  };

  useKeys((a) => {
    if (a === 'back' && searchOpen) { closeSearch(); return true; }
    const sel = selRef.current;
    if (a === 'red' && sel) {
      if (sel.fileIndex !== undefined) removeHistory(sel.hash, sel.fileIndex);
      else removeTorrent(sel.hash);
      return true;
    }
    if (a === 'blue') { navigate({ name: 'settings' }); return true; }
    return false;
  });

  const isHistory = tab === 'history';
  const sort = s.librarySort;
  const hfilter = s.historyFilter;
  const tv = torrents.value;
  const { list, history } = useMemo(() => {
    if (isHistory) {
      const all = buildHistory(tv, hfilter, continueWatching(tv, 40), getLocalProgress, 40, { src: 'tv' });
      const match = filterTorrents(all.map((e) => e.torrent), query);
      return { list: [] as Torrent[], history: all.filter((e) => match.indexOf(e.torrent) >= 0) };
    }
    const inTab = tv.filter((t) => tab === 'all' || categoryOf(t.category) === tab);
    return { list: sortTorrents(filterTorrents(inTab, query), sort), history: [] as HistoryEntry[] };
  }, [tv, tab, query, sort, isHistory, hfilter, progressVersion.value, serverViewed.value]);

  if (!c) return null;

  const resume = (e: HistoryEntry) => {
    const queue = buildTorrentQueue(c, e.torrent, c.files(e.torrent));
    const index = queue.findIndex((q) => q.fileIndex === e.fileIndex);
    if (index < 0) navigate({ name: 'torrent', hash: e.torrent.hash });
    else navigate({ name: 'player', queue, index, startAt: resumeFrom(e.progress, MIN_RESUME, WATCHED_RATIO) });
  };

  if (showingError) {
    return (
      <div class="screen">
        <ErrorView
          message={'Не удалось загрузить список торрентов\n' + error}
          actions={[
            { label: 'Повторить', onPress: () => load() },
            { label: 'Сменить сервер', onPress: () => navigate({ name: 'connect' }) },
          ]}
        />
      </div>
    );
  }

  const count = isHistory ? history.length : list.length;
  const searching = !!query.trim();

  let empty: string | null = null;
  if (loaded && !count) {
    if (searching) empty = 'Ничего не найдено';
    else if (isHistory && hfilter !== 'all') empty = hfilter === 'phone' ? 'С телефона пока ничего не смотрели' : 'С телевизора пока ничего не смотрели';
    else if (isHistory) empty = 'История пуста. Здесь появится то, что вы начали смотреть';
    else if (!torrents.value.length) empty = 'Нет торрентов. Добавьте через «Добавить» или веб-интерфейс TorrServer на телефоне.';
    else empty = 'В этой категории пока ничего нет';
  }

  return (
    <FocusGroup focusKey="LIBRARY" className="screen library">
      <TopBar
        tab={tab}
        onTab={(t) => { setTab(t); setSel(null); }}
        view={s.libraryView}
        sort={s.librarySort}
        searchOpen={searchOpen}
        onSearch={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
        onView={() => updateSettings({ libraryView: nextView(s.libraryView) })}
        onSort={() => updateSettings({ librarySort: nextSort(s.librarySort) })}
        onFocused={() => setSel(null)}
      />
      {searchOpen && (
        <FocusGroup focusKey="LIB-SEARCH" className="search-row">
          <TextInput focusKey="lib-search" value={query} onChange={setQuery} placeholder="Поиск по названию" onFocused={() => setSel(null)} />
          <div class="search-count">{searching ? 'Найдено: ' + count : 'Введите часть названия'}</div>
        </FocusGroup>
      )}
      {error && <div class="banner-error">{error} — показан сохранённый список</div>}
      {!loaded && <Spinner text="Загрузка…" />}
      {isHistory && <HistoryFilterRow value={hfilter} onChange={(f) => updateSettings({ historyFilter: f })} onFocused={() => setSel(null)} />}
      {isHistory ? (
        <HistoryGrid
          entries={history}
          filePath={(e) => {
            const f = c.files(e.torrent).find((x) => x.id === e.fileIndex);
            return f ? f.path : '';
          }}
          onOpen={resume}
          onFocused={(e) => setSel({ hash: e.torrent.hash, fileIndex: e.fileIndex })}
        />
      ) : (
        <TorrentViews
          view={s.libraryView}
          list={list}
          onOpen={(t) => navigate({ name: 'torrent', hash: t.hash })}
          onFocused={(t) => setSel({ hash: t.hash })}
        />
      )}
      {empty && <div class="empty">{empty}</div>}
      <div class="hints">
        OK — {isHistory ? 'продолжить' : 'открыть'} · <KeyDot color="red" /> {isHistory ? 'убрать из истории' : 'удалить'} · <KeyDot color="blue" /> настройки · Назад — {searchOpen ? 'закрыть поиск' : 'выход'}
      </div>
    </FocusGroup>
  );
}
