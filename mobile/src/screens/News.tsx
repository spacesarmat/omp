import { useEffect, useState } from 'preact/hooks';
import { t, tp } from '../../../src/i18n';
import { TvChip } from '../ui/TvChip';
import { showToast } from '../ui/toast';
import { LaunchError } from '../ui/LaunchError';
import { Icon, ICONS } from '../ui/Icon';
import { SubSheet } from '../ui/SubSheet';
import { HeadButton, ScreenHeader } from '../ui/ScreenHeader';
import { ReplaceSheet, libraryTorrentOf } from '../ui/ReplaceSheet';
import { useResultRows } from '../ui/useResultRows';
import { RawTitle, ReleaseChips, ResultThumb } from '../ui/ReleaseRow';
import { navigate } from '../nav';
import { monitorNative } from '../monitor/native';
import { askNotifyOnce, lastCheck, monitorDoneCount, monitorVersion, reloadMonitor, useMonitorStatus } from '../monitor/ui';
import { betterLine, checkedLine, clock, dayWord, episodesLine, freshText, subRule } from '../monitor/text';
import { phoneSourceContext } from '../searchContext';
import { onlyAndroid } from '../platform/native';
import { client } from '../../../src/store/servers';
import { activeTv } from '../tv/tvStore';
import { torrents } from '../../../src/store/library';
import { saveWatch } from '../../../src/store/journal';
import { errorMessage } from '../../../src/api/http';
import { guessCategory } from '../../../src/lib/categoryGuess';
import { shortTitle } from '../../../src/lib/libraryView';
import { feedAll, feedSources } from '../../../src/sources/feed';
import { enabledSources } from '../../../src/sources/store';
import { filterQuality, sortResults, sourceName } from '../../../src/sources/view';
import type { SearchHandle } from '../../../src/sources/search';
import { FEED_CATEGORIES, type FeedCategory, type SourceResult } from '../../../src/sources/types';
import { FEED_FRESH_MS, feedFresh, loadFeed, storeFeedRefresh } from '../../../src/monitor/feedCache';
import { findingsOf, loadSubs, markFindingsSeen, removeFindings, unseenCount } from '../../../src/monitor/subs';
import { libraryRange } from '../../../src/monitor/newEpisodes';
import { loadMonitorSettings } from '../../../src/monitor/settings';
import { BETTER_ID, EPISODES_ID, type Finding } from '../../../src/monitor/types';
import { filterSubs, loadSubsSort, matchFindings, saveSubsSort, sortLabel, sortSubs, SUBS_SORTS, type SubsSort } from '../monitor/subsView';

type Seg = 'feed' | 'subs';

/** «Checking…» ends after this even without monitorDone (the background run is capped at 3 minutes). */
export const RUN_MAX_MS = 3 * 60 * 1000 + 15000;
const POLL_MS = 5000;
const CLEAR = 'M6 6l12 12M18 6L6 18';

const catLabel = (c: FeedCategory): string => (c === 'movie' ? t('category.movie') : c === 'tv' ? t('category.tv') : t('news.anime'));

/** The segment, category and filter outlive the screen (another tab and back keeps them). */
const memo: { seg: Seg; cat: FeedCategory; hd: boolean; q: string } = { seg: 'feed', cat: 'movie', hd: false, q: '' };

// --- feed refresh: one run per category at a time; it fills the shared cache even if the screen is left
const runs: Partial<Record<FeedCategory, SearchHandle>> = {};
const failed: Partial<Record<FeedCategory, boolean>> = {};
/** When a refresh of a category got no answer: not asked again for FEED_FRESH_MS, unless «Refresh». */
const failedAt: Partial<Record<FeedCategory, number>> = {};
const listeners = new Set<() => void>();

function changed(): void {
  listeners.forEach((l) => l());
}

/** Asks the feed sources for `cat` unless the cache is fresh (or `force`); the screen follows through listeners. */
export function refreshFeed(cat: FeedCategory, force = false): void {
  if (runs[cat]) return;
  const now = Date.now();
  if (!force && feedFresh(cat, now)) return;
  const fail = failedAt[cat];
  if (!force && fail !== undefined && now - fail >= 0 && now - fail < FEED_FRESH_MS) return;
  const h = feedAll(phoneSourceContext(), cat, { onResult: changed });
  if (!h.sourceIds.length) return;
  runs[cat] = h;
  failed[cat] = false;
  changed();
  void h.done.then(() => {
    if (runs[cat] !== h) return;
    delete runs[cat];
    if (storeFeedRefresh(cat, h.results(), h.answered(), Date.now())) delete failedAt[cat];
    else {
      failed[cat] = true;
      failedAt[cat] = Date.now();
    }
    changed();
  });
}

/** Forgets the screen state and stops feed runs (tests). */
export function resetNews(): void {
  FEED_CATEGORIES.forEach((c) => {
    const h = runs[c];
    if (h) h.cancel();
    delete runs[c];
    delete failed[c];
    delete failedAt[c];
  });
  memo.seg = 'feed';
  memo.cat = 'movie';
  memo.hd = false;
  memo.q = '';
}

function feedCategoryOf(cat: FeedCategory): (r: SourceResult) => string {
  return (r) => (cat === 'movie' ? 'movie' : cat === 'tv' ? 'tv' : guessCategory(r.Title));
}

function Feed() {
  const [cat, setCatState] = useState<FeedCategory>(memo.cat);
  const [hd, setHdState] = useState(memo.hd);
  const [, setTick] = useState(0);
  const rows = useResultRows({ category: feedCategoryOf(cat) });
  void monitorVersion.value;

  useEffect(() => {
    const l = () => setTick((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  useEffect(() => {
    refreshFeed(cat);
  }, [cat]);

  const setCat = (c: FeedCategory) => {
    memo.cat = c;
    setCatState(c);
  };
  const setHd = (v: boolean) => {
    memo.hd = v;
    setHdState(v);
  };

  const names = enabledSources(feedSources()).map((s) => s.name);
  const cache = loadFeed(cat);
  const h = runs[cat];
  // while refreshing, the saved rows stay on screen; with nothing saved the answers stream in
  const list = cache && cache.results.length ? cache.results : h ? sortResults(h.results(), 'date') : [];
  const shown = filterQuality(list, hd ? '1080' : '');
  const now = Date.now();
  const status: string[] = [];
  // the sites the saved rows came from; before the first answer, the switched-on ones
  const from = cache && cache.sources && cache.sources.length ? cache.sources.map(sourceName) : names;
  if (names.length) status.push(t('news.freshFrom', { sites: from.join(', ') }));
  if (cache) {
    const day = dayWord(cache.at, now);
    status.push(day ? t('news.updatedDayAt', { day: day, time: clock(cache.at) }) : t('news.updatedAt', { time: clock(cache.at) }));
  }
  if (h) status.push(t('news.updating'));
  else if (failed[cat]) status.push(t('news.noAnswer'));

  return (
    <>
      <div class="m-chips" style={{ flexWrap: 'wrap' }}>
        {FEED_CATEGORIES.map((c) => (
          <button key={c} type="button" class={'m-chip' + (cat === c ? ' on' : '')} aria-pressed={cat === c} onClick={() => setCat(c)}>
            {catLabel(c)}
          </button>
        ))}
        <button type="button" class={'m-chip' + (hd ? ' on' : '')} aria-pressed={hd} onClick={() => setHd(!hd)}>
          1080p+
        </button>
      </div>
      {names.length === 0 ? (
        <div class="m-hint-warn">{t('news.enableSites')}</div>
      ) : (
        <div class="m-news-status m-muted m-small" role="status">
          <span class="m-grow">{status.join(' · ')}</span>
          <button type="button" class="m-btn-text" disabled={!!h} onClick={() => refreshFeed(cat, true)}>
            {t('news.refresh')}
          </button>
        </div>
      )}
      {rows.error && <LaunchError message={rows.error} />}
      {names.length > 0 && !h && shown.length === 0 && (
        <div class="m-muted">{list.length ? t('news.noHd') : failed[cat] ? t('news.noAnswerLater') : t('news.empty')}</div>
      )}
      <div class="m-results">{shown.map((r) => rows.card(r))}</div>
      {rows.sheets}
    </>
  );
}

/** «Watch on TV?» for a finding opened from a notification: playback starts only with this tap. */
export function WatchPrompt({ title, onWatch, onDismiss }: { title: string; onWatch: () => void; onDismiss: () => void }) {
  return (
    <div class="m-hint-warn m-watch-prompt" role="group" aria-label={t('news.watchOnTv')}>
      <div>{t('news.watchAsk', { title: title })}</div>
      <div class="m-result-actions">
        <span class="m-grow" />
        <button type="button" class="m-btn m-btn-secondary m-btn-sm" onClick={onDismiss}>
          {t('news.notNow')}
        </button>
        <button type="button" class="m-btn m-btn-primary m-btn-sm" onClick={onWatch}>
          {t('news.watchOnTv')}
        </button>
      </div>
    </div>
  );
}

function scrollToHighlight(): void {
  const el = document.querySelector('[data-highlight]') as HTMLElement | null;
  if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' });
}

function Subs({ finding, watch, running }: { finding?: string; watch?: boolean; running: boolean }) {
  void monitorVersion.value;
  const [polling, setPolling] = useState(false);
  // while «Checking…» shows, Android's state is asked again every few seconds (a stale «running» never sticks)
  const status = useMonitorStatus(polling ? POLL_MS : 0);
  const [editing, setEditing] = useState(false);
  const [replace, setReplace] = useState<{ f: Finding; watch: boolean } | null>(null);
  const [prompt, setPrompt] = useState(!!watch);
  const rows = useResultRows();
  const [query, setQueryState] = useState(memo.q);
  const [sort, setSort] = useState<SubsSort>(loadSubsSort);
  const setQuery = (q: string) => {
    memo.q = q;
    setQueryState(q);
  };
  const pickSort = (m: SubsSort) => {
    saveSubsSort(m);
    setSort(m);
  };
  const subs = loadSubs();
  const searching = !!query.trim();
  const shownSubs = filterSubs(sortSubs(subs, sort), query);
  const found = matchFindings(query);
  const eps = findingsOf(EPISODES_ID);
  const better = findingsOf(BETTER_ID);
  const settings = loadMonitorSettings();

  // the cards are on screen: new episodes and better releases count as looked at
  useEffect(() => {
    if (unseenCount(EPISODES_ID) > 0 || unseenCount(BETTER_ID) > 0) {
      markFindingsSeen(EPISODES_ID);
      markFindingsSeen(BETTER_ID);
      reloadMonitor();
    }
  }, [monitorVersion.value]);
  useEffect(() => {
    if (finding) scrollToHighlight();
  }, [finding]);
  useEffect(() => setPrompt(!!watch), [finding, watch]);

  const last = lastCheck(status);
  const checking = running || !!(status && status.running);
  useEffect(() => setPolling(checking), [checking]);
  const line = checking
    ? t('news.checking')
    : checkedLine({ last: last ? last.at : null, next: status && status.nextRun ? status.nextRun : null, enabled: settings.enabled, now: Date.now() });

  // «Watch on TV» on a new-episodes card: replace first (history and settings move), then watch the new torrent
  const replaceAndWatch = (f: Finding) => {
    if (!activeTv.value) return navigate({ name: 'tv' });
    setReplace({ f, watch: true });
  };
  const watchReplaced = (hash: string, title: string) => void rows.watch(hash, title);

  const unwatch = async (f: Finding) => {
    const c = client.value;
    if (!c) return showToast(t('errors.noServerSelected'));
    const tor = libraryTorrentOf(f);
    try {
      if (!tor) {
        // not in the loaded list: when the server really has no such torrent, nothing is left to switch off
        const all = await c.list();
        const hash = f.episodes!.torrentHash.toLowerCase();
        if (!all.some((x) => x.hash.toLowerCase() === hash)) {
          removeFindings(EPISODES_ID, f.key);
          reloadMonitor();
          return;
        }
      }
      await saveWatch(c, { hash: tor ? tor.hash : f.episodes!.torrentHash }, false);
      removeFindings(EPISODES_ID, f.key);
      reloadMonitor();
      showToast(t('news.unwatched', { title: shortTitle(f.episodes!.torrentTitle) }));
    } catch (e) {
      showToast(errorMessage(e));
    }
  };

  // «Скрыть»: the card goes; its rank stays seen, so only a higher rank of the film is reported again
  const hide = (f: Finding) => {
    removeFindings(BETTER_ID, f.key);
    reloadMonitor();
  };

  return (
    <>
      <div class="m-muted m-small" role="status" data-monitor-status>
        {line}
      </div>
      <div class="m-set-label">{t('news.subs')}</div>
      {subs.length === 0 && <div class="m-muted m-small">{t('news.noSubs')}</div>}
      {subs.length > 0 && (
        <div class="m-subs-search">
          <input
            class="m-input m-lib-search m-grow"
            type="search"
            data-subs-search
            aria-label={t('news.subsSearch')}
            placeholder={t('news.subsSearch')}
            value={query}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          />
          {query && (
            <button type="button" class="m-icon-btn" data-subs-clear aria-label={t('news.clearSearch')} onClick={() => setQuery('')}>
              <Icon d={CLEAR} size={18} />
            </button>
          )}
        </div>
      )}
      {subs.length > 1 && (
        <div class="m-chips m-subs-sort" role="group" aria-label={t('add.sort')} style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <span class="m-muted m-small">{t('add.sort') + ':'}</span>
          {SUBS_SORTS.map((m) => (
            <button key={m} type="button" class={'m-chip' + (sort === m ? ' on' : '')} aria-pressed={sort === m} onClick={() => pickSort(m)}>
              {sortLabel(m)}
            </button>
          ))}
        </div>
      )}
      {searching && shownSubs.length === 0 && subs.length > 0 && <div class="m-muted m-small">{t('news.noSubsMatch')}</div>}
      {shownSubs.map((s) => {
        const n = unseenCount(s.id);
        return (
          <button key={s.id} type="button" class="m-sub-row" onClick={() => navigate({ name: 'subFindings', id: s.id })}>
            <span class="m-sub-text">
              <span class="m-sub-q">{s.query}</span>
              <span class="m-muted m-small">{subRule(s)}</span>
            </span>
            {n > 0 && <span class="m-fresh">{freshText(n)}</span>}
          </button>
        );
      })}
      {searching && (
        <div data-found-releases>
          <div class="m-set-label">{t('news.foundReleases')}</div>
          {found.shown.length === 0 && <div class="m-muted m-small">{t('news.noFindingsMatch')}</div>}
          <div class="m-results">{found.shown.map((f) => rows.card(f.result))}</div>
          {found.more > 0 && <div class="m-muted m-small">{tp('news.moreFindings', found.more)}</div>}
        </div>
      )}
      <button type="button" class="m-sub-new" onClick={() => setEditing(true)}>
        {t('news.newSub')}
      </button>
      <div class="m-set-label">{t('news.episodesHead')}</div>
      {rows.error && <LaunchError message={rows.error} />}
      {eps.map((f) => {
        const e = f.episodes!;
        const tor = libraryTorrentOf(f);
        const have = tor ? libraryRange(tor) : null;
        const hl = !!finding && f.key === finding;
        return (
          <div key={f.key} class={'m-ep-card' + (hl ? ' m-hl' : '')} data-highlight={hl ? '' : undefined}>
            <div class="m-rel-top">
              <ResultThumb title={e.torrentTitle} poster={tor ? tor.poster : undefined} />
              <div class="m-rel-text">
                <div class="m-ep-card-title">{shortTitle(e.torrentTitle) + ' · ' + t('library.season', { n: e.season })}</div>
                <div class="m-accent m-small">{episodesLine(e, have && have.from !== undefined ? have.from : 1)}</div>
                <ReleaseChips raw={f.result.Title} />
                <RawTitle raw={f.result.Title} />
              </div>
            </div>
            {hl && prompt && (
              <WatchPrompt title={shortTitle(f.result.Title)} onDismiss={() => setPrompt(false)} onWatch={() => replaceAndWatch(f)} />
            )}
            <div class="m-result-actions">
              <button
                type="button"
                class="m-btn m-btn-primary m-btn-sm"
                aria-label={t('news.replaceAria', { title: shortTitle(e.torrentTitle) })}
                onClick={() => setReplace({ f, watch: false })}
              >
                {t('news.replace')}
              </button>
              <button
                type="button"
                class="m-btn m-btn-secondary m-btn-sm"
                aria-label={t('news.unwatchAria', { title: shortTitle(e.torrentTitle) })}
                onClick={() => void unwatch(f)}
              >
                {t('news.unwatch')}
              </button>
            </div>
          </div>
        );
      })}
      <div class="m-muted m-small">
        {settings.episodes
          ? t('news.epsOn')
          : t('news.epsOff')}
      </div>
      <div class="m-set-label">{t('news.betterHead')}</div>
      {better.map((f) => {
        const name = shortTitle(f.better!.torrentTitle);
        const hl = !!finding && f.key === finding;
        const tor = libraryTorrentOf(f);
        return (
          <div key={f.key} class={'m-ep-card' + (hl ? ' m-hl' : '')} data-better="" data-highlight={hl ? '' : undefined}>
            <div class="m-rel-top">
              <ResultThumb title={f.better!.torrentTitle} poster={tor ? tor.poster : undefined} />
              <div class="m-rel-text">
                <div class="m-ep-card-title">{name}</div>
                <div class="m-accent m-small">{betterLine(f.better!)}</div>
                <RawTitle raw={f.result.Title} />
              </div>
            </div>
            {hl && prompt && (
              <WatchPrompt title={shortTitle(f.result.Title)} onDismiss={() => setPrompt(false)} onWatch={() => replaceAndWatch(f)} />
            )}
            <div class="m-result-actions">
              <button
                type="button"
                class="m-btn m-btn-primary m-btn-sm"
                aria-label={t('news.replaceAria', { title: name })}
                onClick={() => setReplace({ f, watch: false })}
              >
                {t('news.replace')}
              </button>
              <button type="button" class="m-btn m-btn-secondary m-btn-sm" aria-label={t('news.hideAria', { title: name })} onClick={() => hide(f)}>
                {t('common.hide')}
              </button>
            </div>
          </div>
        );
      })}
      <div class="m-muted m-small">{settings.better ? t('news.betterOn') : t('news.betterOff')}</div>
      <button type="button" class="m-set-row m-set-pick m-news-monitor" data-monitor-row onClick={() => navigate({ name: 'monitor' })}>
        <span class="m-news-monitor-l">
          <Icon d={ICONS.monitor} size={20} />
          <span>{t('news.monitorSettings')}</span>
        </span>
        <span class="m-muted" aria-hidden="true">›</span>
      </button>
      {editing && <SubSheet onClose={() => setEditing(false)} />}
      {replace && (
        <ReplaceSheet
          finding={replace.f}
          thenWatch={replace.watch}
          onReplaced={replace.watch ? watchReplaced : undefined}
          onClose={() => setReplace(null)}
        />
      )}
      {rows.sheets}
    </>
  );
}

export function News({ seg, finding, watch }: { seg?: Seg; finding?: string; watch?: boolean }) {
  const [current, setCurrent] = useState<Seg>(seg || memo.seg);
  const [running, setRunning] = useState(false);
  const done = monitorDoneCount.value;
  useEffect(() => {
    // monitoring is on by default: the first visit here counts as switching it on (asked once)
    if (loadMonitorSettings().enabled) void askNotifyOnce().catch(() => {});
  }, []);
  useEffect(() => {
    if (seg) {
      memo.seg = seg;
      setCurrent(seg);
    }
  }, [seg, finding, watch]);
  // a finished background run ends «Проверяю…»; so does a run that never reports back (Android's 3-minute cap)
  useEffect(() => setRunning(false), [done]);
  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(() => setRunning(false), RUN_MAX_MS);
    return () => clearTimeout(timer);
  }, [running]);

  const pick = (s: Seg) => {
    memo.seg = s;
    setCurrent(s);
  };
  const fresh = unseenCount();

  const runNow = () => {
    if (!monitorNative.available) return showToast(onlyAndroid());
    setRunning(true);
    monitorNative.runNow().then(
      () => showToast(t('news.runToast')),
      (e) => {
        setRunning(false);
        showToast(errorMessage(e));
      },
    );
  };

  return (
    <div class="m-screen" data-route="news">
      <ScreenHeader title={t('news.title')}>
        {current === 'subs' ? (
          <HeadButton d={ICONS.refresh} label={t('news.checkNow')} disabled={running} spin={running} data={{ 'data-check-now': '' }} onClick={runNow} />
        ) : (
          <TvChip />
        )}
        <HeadButton d={ICONS.monitor} label={t('news.monitorSettings')} data={{ 'data-monitor-gear': '' }} onClick={() => navigate({ name: 'monitor' })} />
      </ScreenHeader>
      <div class="m-seg" role="tablist" aria-label={t('news.title')}>
        <button type="button" role="tab" aria-selected={current === 'feed'} class={current === 'feed' ? 'on' : ''} onClick={() => pick('feed')}>
          {t('news.feed')}
        </button>
        <button type="button" role="tab" aria-selected={current === 'subs'} class={current === 'subs' ? 'on' : ''} onClick={() => pick('subs')}>
          {fresh > 0 ? t('news.subsFresh', { fresh: freshText(fresh) }) : t('news.subs')}
        </button>
      </div>
      {current === 'feed' ? <Feed /> : <Subs finding={finding} watch={watch} running={running} />}
    </div>
  );
}
