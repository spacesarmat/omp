import { useEffect, useState } from 'preact/hooks';
import { TvChip } from '../ui/TvChip';
import { showToast } from '../ui/toast';
import { LaunchError } from '../ui/LaunchError';
import { SubSheet } from '../ui/SubSheet';
import { ReplaceSheet, libraryTorrentOf } from '../ui/ReplaceSheet';
import { useResultRows } from '../ui/useResultRows';
import { navigate } from '../nav';
import { monitorNative } from '../monitor/native';
import { lastCheck, monitorVersion, reloadMonitor, useMonitorStatus } from '../monitor/ui';
import { checkedLine, clock, dayWord, episodesLine, freshText, subRule } from '../monitor/text';
import { phoneSourceContext } from '../searchContext';
import { ONLY_ANDROID } from '../platform/native';
import { client } from '../../../src/store/servers';
import { torrents } from '../../../src/store/library';
import { saveWatch } from '../../../src/store/journal';
import { errorMessage } from '../../../src/api/http';
import { guessCategory } from '../../../src/lib/categoryGuess';
import { shortTitle } from '../../../src/lib/libraryView';
import { feedAll, feedSources } from '../../../src/sources/feed';
import { enabledSources } from '../../../src/sources/store';
import { filterQuality, sortResults } from '../../../src/sources/view';
import type { SearchHandle } from '../../../src/sources/search';
import { FEED_CATEGORIES, type FeedCategory, type SourceResult } from '../../../src/sources/types';
import { feedFresh, loadFeed, saveFeed } from '../../../src/monitor/feedCache';
import { findingsOf, loadSubs, markFindingsSeen, removeFindings, unseenCount } from '../../../src/monitor/subs';
import { libraryRange } from '../../../src/monitor/newEpisodes';
import { loadMonitorSettings } from '../../../src/monitor/settings';
import { EPISODES_ID, type Finding } from '../../../src/monitor/types';

type Seg = 'feed' | 'subs';

const CAT_LABELS: Record<FeedCategory, string> = { movie: 'Фильмы', tv: 'Сериалы', anime: 'Аниме' };

/** The segment, category and filter outlive the screen (another tab and back keeps them). */
const memo: { seg: Seg; cat: FeedCategory; hd: boolean } = { seg: 'feed', cat: 'movie', hd: false };

// --- feed refresh: one run per category at a time; it fills the shared cache even if the screen is left
const runs: Partial<Record<FeedCategory, SearchHandle>> = {};
const failed: Partial<Record<FeedCategory, boolean>> = {};
const listeners = new Set<() => void>();

function changed(): void {
  listeners.forEach((l) => l());
}

/** Asks the feed sources for `cat` unless the cache is fresh (or `force`); the screen follows through listeners. */
export function refreshFeed(cat: FeedCategory, force = false): void {
  if (runs[cat]) return;
  if (!force && feedFresh(cat, Date.now())) return;
  const h = feedAll(phoneSourceContext(), cat, { onResult: changed });
  if (!h.sourceIds.length) return;
  runs[cat] = h;
  failed[cat] = false;
  changed();
  void h.done.then(() => {
    if (runs[cat] !== h) return;
    delete runs[cat];
    if (h.answered().length) saveFeed(cat, sortResults(h.results(), 'date'), Date.now());
    else failed[cat] = true;
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
  });
  memo.seg = 'feed';
  memo.cat = 'movie';
  memo.hd = false;
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
  if (names.length) status.push('Свежее с ' + names.join(', '));
  if (cache) {
    const day = dayWord(cache.at, now);
    status.push('обновлено ' + (day ? day + ' ' : '') + 'в ' + clock(cache.at));
  }
  if (h) status.push('обновляю…');
  else if (failed[cat]) status.push('сайты не ответили');

  return (
    <>
      <div class="m-chips" style={{ flexWrap: 'wrap' }}>
        {FEED_CATEGORIES.map((c) => (
          <button key={c} type="button" class={'m-chip' + (cat === c ? ' on' : '')} aria-pressed={cat === c} onClick={() => setCat(c)}>
            {CAT_LABELS[c]}
          </button>
        ))}
        <button type="button" class={'m-chip' + (hd ? ' on' : '')} aria-pressed={hd} onClick={() => setHd(!hd)}>
          1080p+
        </button>
      </div>
      {names.length === 0 ? (
        <div class="m-hint-warn">Лента берётся с rutor, nnmclub и torrent.by — включите их в «Источниках поиска».</div>
      ) : (
        <div class="m-news-status m-muted m-small" role="status">
          <span class="m-grow">{status.join(' · ')}</span>
          <button type="button" class="m-btn-text" disabled={!!h} onClick={() => refreshFeed(cat, true)}>
            Обновить
          </button>
        </div>
      )}
      {rows.error && <LaunchError message={rows.error} />}
      {names.length > 0 && !h && shown.length === 0 && (
        <div class="m-muted">{list.length ? 'Нет раздач 1080p и выше' : failed[cat] ? 'Сайты не ответили — попробуйте позже' : 'Пока пусто'}</div>
      )}
      <div class="m-results">{shown.map((r) => rows.card(r))}</div>
      {rows.sheets}
    </>
  );
}

/** «Смотреть на ТВ?» for a finding opened from a notification: playback starts only with this tap. */
export function WatchPrompt({ title, onWatch, onDismiss }: { title: string; onWatch: () => void; onDismiss: () => void }) {
  return (
    <div class="m-hint-warn m-watch-prompt" role="group" aria-label="Смотреть на ТВ">
      <div>{'Смотреть на ТВ: ' + title + '?'}</div>
      <div class="m-result-actions">
        <span class="m-grow" />
        <button type="button" class="m-btn m-btn-secondary m-btn-sm" onClick={onDismiss}>
          Не сейчас
        </button>
        <button type="button" class="m-btn m-btn-primary m-btn-sm" onClick={onWatch}>
          Смотреть на ТВ
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
  const status = useMonitorStatus();
  const [editing, setEditing] = useState(false);
  const [replace, setReplace] = useState<Finding | null>(null);
  const [prompt, setPrompt] = useState(!!watch);
  const rows = useResultRows();
  const subs = loadSubs();
  const eps = findingsOf(EPISODES_ID);
  const settings = loadMonitorSettings();

  // the cards are on screen: the new episodes count as looked at
  useEffect(() => {
    if (unseenCount(EPISODES_ID) > 0) {
      markFindingsSeen(EPISODES_ID);
      reloadMonitor();
    }
  }, [monitorVersion.value]);
  useEffect(() => {
    if (finding) scrollToHighlight();
  }, [finding]);
  useEffect(() => setPrompt(!!watch), [finding, watch]);

  const last = lastCheck(status);
  const line =
    running || (status && status.running)
      ? 'Проверяю…'
      : checkedLine({ last: last ? last.at : null, next: status && status.nextRun ? status.nextRun : null, enabled: settings.enabled, now: Date.now() });

  const unwatch = async (f: Finding) => {
    const c = client.value;
    if (!c) return showToast('Сервер не выбран');
    const t = libraryTorrentOf(f);
    try {
      await saveWatch(c, { hash: t ? t.hash : f.episodes!.torrentHash }, false);
      removeFindings(EPISODES_ID, f.key);
      reloadMonitor();
      showToast('Больше не слежу за новыми сериями «' + shortTitle(f.episodes!.torrentTitle) + '»');
    } catch (e) {
      showToast(errorMessage(e));
    }
  };

  return (
    <>
      <div class="m-muted m-small" role="status" data-monitor-status>
        {line}
      </div>
      <div class="m-set-label">Подписки</div>
      {subs.length === 0 && <div class="m-muted m-small">Подписок пока нет. OMP сообщит, когда по запросу появятся новые раздачи.</div>}
      {subs.map((s) => {
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
      <button type="button" class="m-sub-new" onClick={() => setEditing(true)}>
        + Новая подписка
      </button>
      <div class="m-set-label">Новые серии сериалов из каталога</div>
      {rows.error && <LaunchError message={rows.error} />}
      {eps.map((f) => {
        const e = f.episodes!;
        const t = libraryTorrentOf(f);
        const have = t ? libraryRange(t) : null;
        const hl = !!finding && f.key === finding;
        return (
          <div key={f.key} class={'m-ep-card' + (hl ? ' m-hl' : '')} data-highlight={hl ? '' : undefined}>
            <div class="m-ep-card-title">{shortTitle(e.torrentTitle) + ' · Сезон ' + e.season}</div>
            <div class="m-accent m-small">{episodesLine(e, have && have.from !== undefined ? have.from : 1)}</div>
            <div class="m-muted m-small">{f.result.Title}</div>
            {hl && prompt && (
              <WatchPrompt title={shortTitle(f.result.Title)} onDismiss={() => setPrompt(false)} onWatch={() => void rows.add(f.result, true)} />
            )}
            <div class="m-result-actions">
              <button type="button" class="m-btn m-btn-primary m-btn-sm" onClick={() => setReplace(f)}>
                Заменить…
              </button>
              <button type="button" class="m-btn m-btn-secondary m-btn-sm" onClick={() => void unwatch(f)}>
                Не следить
              </button>
            </div>
          </div>
        );
      })}
      <div class="m-muted m-small">
        {settings.episodes
          ? 'Сериалы из каталога проверяются сами; выключить можно в карточке сериала или здесь.'
          : 'Слежение за новыми сериями выключено в настройках мониторинга.'}
      </div>
      <button type="button" class="m-link" onClick={() => navigate({ name: 'monitor' })}>
        Настройки мониторинга
      </button>
      {editing && <SubSheet onClose={() => setEditing(false)} />}
      {replace && <ReplaceSheet finding={replace} onClose={() => setReplace(null)} />}
      {rows.sheets}
    </>
  );
}

export function News({ seg, finding, watch }: { seg?: Seg; finding?: string; watch?: boolean }) {
  const [current, setCurrent] = useState<Seg>(seg || memo.seg);
  const [running, setRunning] = useState(false);
  const v = monitorVersion.value;
  useEffect(() => {
    if (seg) {
      memo.seg = seg;
      setCurrent(seg);
    }
  }, [seg, finding, watch]);
  // a finished background run (or any store change) ends «Проверяю…»
  useEffect(() => setRunning(false), [v]);

  const pick = (s: Seg) => {
    memo.seg = s;
    setCurrent(s);
  };
  const fresh = unseenCount();

  const runNow = () => {
    if (!monitorNative.available) return showToast(ONLY_ANDROID);
    setRunning(true);
    monitorNative.runNow().then(
      () => showToast('Проверяю подписки и сериалы'),
      (e) => {
        setRunning(false);
        showToast(errorMessage(e));
      },
    );
  };

  return (
    <div class="m-screen" data-route="news">
      <div class="m-lib-head">
        <h1 class="m-lib-brand">Новое</h1>
        {current === 'subs' ? (
          <button type="button" class="m-btn m-btn-secondary m-btn-sm" disabled={running} onClick={runNow}>
            Проверить сейчас
          </button>
        ) : (
          <TvChip />
        )}
      </div>
      <div class="m-seg" role="tablist" aria-label="Новое">
        <button type="button" role="tab" aria-selected={current === 'feed'} class={current === 'feed' ? 'on' : ''} onClick={() => pick('feed')}>
          Лента
        </button>
        <button type="button" role="tab" aria-selected={current === 'subs'} class={current === 'subs' ? 'on' : ''} onClick={() => pick('subs')}>
          {fresh > 0 ? 'Подписки · ' + freshText(fresh) : 'Подписки'}
        </button>
      </div>
      {current === 'feed' ? <Feed /> : <Subs finding={finding} watch={watch} running={running} />}
    </div>
  );
}
