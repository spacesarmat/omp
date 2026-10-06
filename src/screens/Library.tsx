import { t, tp } from '../i18n';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { setFocus, doesFocusableExist } from '@noriginmedia/norigin-spatial-navigation';
import { client, activeServer } from '../store/servers';
import { catalogReason, cachedBanner, catalogHint } from '../lib/catalogState';
import { torrents, libraryTab, libraryQuery, librarySearchOpen, refreshTorrents, torrentsAt, addedTorrents, addedMessage } from '../store/library';
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
import { FocusGroup, Button, Spinner, TextInput } from '../ui/components';
import { KeyDot } from '../ui/icons';
import { restoreFocus } from '../ui/focus';
import { confirmDialog } from '../ui/dialog';
import { toast } from '../ui/toast';
import { useKeys } from '../ui/keys';
import { TopBar } from '../ui/TopBar';
import { TorrentViews } from './library/TorrentViews';
import { HistoryGrid, HistoryEntry, HistoryFilterRow } from './library/HistoryGrid';
import { displayTitle } from '../lib/torrentName';
import type { SeriesGroup } from '../lib/seriesGroups';

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
  const selRef = useRef<{ hash: string; fileIndex?: number; group?: SeriesGroup } | null>(null);
  const setSel = (v: { hash: string; fileIndex?: number; group?: SeriesGroup } | null) => { selRef.current = v; };
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
    const tor = torrents.value.find((x) => x.hash === hash);
    confirmDialog(t('catalog.deleteAsk', { title: tor ? displayTitle(tor) : hash }), t('common.delete')).then((ok) => {
      if (!ok || !c) return;
      c.remove(hash).then(
        () => { torrents.value = torrents.value.filter((x) => x.hash !== hash); setSel(null); toast(t('catalog.torrentDeleted')); },
        (e) => toast(errorMessage(e), 'error'),
      );
    });
  };

  const removeSeries = (g: SeriesGroup) => {
    confirmDialog(tp('series.deleteSeries', g.members.length), t('common.delete')).then((ok) => {
      if (!ok || !c) return;
      const hashes = g.members.map((m) => m.hash);
      Promise.all(hashes.map((h) => c.remove(h))).then(
        () => { torrents.value = torrents.value.filter((x) => hashes.indexOf(x.hash) < 0); setSel(null); toast(t('catalog.torrentDeleted')); },
        (e) => toast(errorMessage(e), 'error'),
      );
    });
  };

  const removeHistory = (hash: string, fileIndex: number) => {
    confirmDialog(t('catalog.removeFromHistoryAsk'), t('catalog.removeFromHistory')).then((ok) => {
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
      else if (sel.group) removeSeries(sel.group);
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
    // with no server the effect above already routes to connect, so c is always set here
    const online = typeof navigator === 'undefined' || navigator.onLine !== false;
    return (
      <div class="screen">
        <div class="catalog-off">
          <svg class="catalog-off-icon" width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M2 8.8a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h.01M3 3l18 18" />
          </svg>
          <div class="catalog-off-title">{t('catalog.unavailable')}</div>
          <div class="catalog-off-reason">{catalogReason(activeServer.value!.name, online)}</div>
          <FocusGroup focusKey="ERROR-ACTIONS" className="actions" autoFocus>
            <Button label={t('common.retry')} onPress={() => load()} />
            <Button label={t('catalog.changeServer')} onPress={() => navigate({ name: 'connect' })} />
          </FocusGroup>
          <div class="catalog-off-hint">{catalogHint()}</div>
        </div>
      </div>
    );
  }

  const count = isHistory ? history.length : list.length;
  const searching = !!query.trim();

  let empty: string | null = null;
  if (loaded && !count) {
    if (searching) empty = t('catalog.nothingFound');
    else if (isHistory && hfilter !== 'all') empty = hfilter === 'phone' ? t('catalog.nothingFromPhone') : t('catalog.nothingFromTv');
    else if (isHistory) empty = t('catalog.historyEmpty');
    else if (!torrents.value.length) empty = t('catalog.noTorrents');
    else empty = t('catalog.categoryEmpty');
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
          <TextInput focusKey="lib-search" value={query} onChange={setQuery} placeholder={t('catalog.searchPlaceholder')} onFocused={() => setSel(null)} />
          <div class="search-count">{searching ? t('catalog.found', { n: count }) : t('catalog.typePart')}</div>
        </FocusGroup>
      )}
      {error && (
        <FocusGroup focusKey="LIB-BANNER" className="banner-error banner-row">
          <span class="banner-text">{cachedBanner(torrentsAt.value)}</span>
          <Button label={t('common.retry')} onPress={() => load()} onFocused={() => setSel(null)} />
        </FocusGroup>
      )}
      {!loaded && <Spinner text={t('catalog.loading')} />}
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
          group={tab === 'all' || tab === 'tv'}
          onOpenSeries={(g) => navigate({ name: 'series', key: g.key })}
          onOpen={(t) => navigate({ name: 'torrent', hash: t.hash })}
          onFocused={(x) => setSel('kind' in x ? { hash: x.lead.hash, group: x } : { hash: x.hash })}
        />
      )}
      {empty && <div class="empty">{empty}</div>}
      <div class="hints">
        {isHistory ? t('catalog.okContinue') : t('catalog.okOpen')} · <KeyDot color="red" /> {isHistory ? t('catalog.removeFromHistoryKey') : t('catalog.deleteKey')} · <KeyDot color="blue" /> {t('catalog.settingsKey')} · {searchOpen ? t('catalog.backCloseSearch') : t('catalog.backExit')}
      </div>
    </FocusGroup>
  );
}
