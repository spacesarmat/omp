// «Новое» → «Календарь»: two views of the followed series. «Список» is one row per episode (released first,
// then «Эта неделя», «Следующая», «Позже»). «Месяц» is a grid; a day opens that day's rows under it.
// The view is remembered. «Только мои подписки» hides series that are only in the library.
import { useEffect, useRef, useState } from 'preact/hooks';
import { lang, t, tp } from '../../../src/i18n';
import { torrentQuery } from '../../../src/catalog/tmdb';
import { isoDay } from '../../../src/lib/seriesStatus';
import { torrents } from '../../../src/store/library';
import { loadFound, loadSubs } from '../../../src/monitor/subs';
import { EPISODES_ID, type Finding } from '../../../src/monitor/types';
import { navigate } from '../nav';
import { monitorVersion } from '../monitor/ui';
import { Icon } from '../ui/Icon';
import { CatalogError } from './catalog/CatalogError';
import { dayHeader } from '../lib/releaseDates';
import {
  calendarState, dayCountLabel, dayRows, defaultMonthDay, ensureCalendarSpan, entriesForMonth, episodeActions, humanEpisodes, listDaySections, loadCalendar,
  loadCalView, monthBounds, monthCells, monthRev, monthSwipe, monthTitle, realEpisodeName, rowFinding, rowLine, saveCalView, shiftMonth, subscribedOnly,
  weekdayHeads, STALE_MS, type CalGo, type CalRow, type CalView,
} from '../lib/calendar';
import { usePullRefresh, PullArea } from '../ui/PullRefresh';
import { Sheet } from '../ui/Sheet';

const CHEV_L = 'M15 6l-6 6 6 6';
const CHEV_R = 'M9 6l6 6-6 6';

function openFinding(f: Finding): void {
  if (f.subId === EPISODES_ID) navigate({ name: 'news', seg: 'subs', finding: f.key });
  else navigate({ name: 'subFindings', id: f.subId, finding: f.key });
}

function goEpisode(action: CalGo): void {
  if (action.name === 'seasonCard') navigate({ name: 'seasonCard', id: action.id, season: action.season });
  else navigate(action);
}

function Row({ e, findings, onOpen }: { e: CalRow; findings: Finding[]; onOpen: (e: CalRow) => void }) {
  const card = e.show.card;
  const found = rowFinding(e, findings);
  const multi = card.seasons.length > 1;
  const code = humanEpisodes(e.season, e.episodes, multi);
  return (
    <div class="m-cal-row" data-cal-row={card.id + ':' + e.season + ':' + e.episodes.join(',')}>
      <button type="button" class="m-cal-open" onClick={() => onOpen(e)}>
        {card.poster ? (
          <img class="m-cal-poster" src={card.poster} alt="" width={40} height={60} loading="lazy" />
        ) : (
          <span class={'m-cal-poster m-disc-ph m-disc-ph-' + (card.id % 4)} aria-hidden="true" />
        )}
        <span class="m-cal-text">
          <span class="m-cal-title">{card.title}</span>
          <span class="m-small m-muted m-cal-ep">{rowLine(e, { withSeason: multi })}</span>
        </span>
      </button>
      <span class="m-cal-side">
        {found ? (
          <button
            type="button"
            class="m-btn m-btn-primary m-btn-sm"
            aria-label={t('news.calWatchAria', { title: card.title + ' ' + code })}
            onClick={() => openFinding(found)}
          >
            {t('news.calWatch')}
          </button>
        ) : (
          <button
            type="button"
            class="m-btn m-btn-secondary m-btn-sm"
            aria-label={t('news.calFindAria', { title: card.title + ' ' + code })}
            onClick={() => navigate({ name: 'add', query: torrentQuery(card, e.season), run: true })}
          >
            {t('news.calFind')}
          </button>
        )}
      </span>
    </div>
  );
}

function Tools(p: { view: CalView; subsOnly: boolean; onView: (v: CalView) => void; onSubs: (v: boolean) => void }) {
  return (
    <div class="m-cal-tools">
      <div class="m-seg" role="group" aria-label={t('news.calView')}>
        <button type="button" class={'m-seg-btn tm' + (p.view === 'list' ? ' on' : '')} data-code="P03.8" aria-pressed={p.view === 'list'} onClick={() => p.onView('list')}>
          {t('news.calList')}
        </button>
        <button type="button" class={'m-seg-btn tm' + (p.view === 'month' ? ' on' : '')} data-code="P03.9" aria-pressed={p.view === 'month'} onClick={() => p.onView('month')}>
          {t('news.calMonth')}
        </button>
      </div>
      <div class="m-seg" role="group" aria-label={t('news.calFilter')}>
        <button type="button" class={'m-seg-btn tm' + (!p.subsOnly ? ' on' : '')} data-code="P03.10" aria-pressed={!p.subsOnly} onClick={() => p.onSubs(false)}>
          {t('news.calAll')}
        </button>
        <button type="button" class={'m-seg-btn tm' + (p.subsOnly ? ' on' : '')} data-code="P03.11" aria-pressed={p.subsOnly} onClick={() => p.onSubs(true)}>
          {t('news.calSubsOnly')}
        </button>
      </div>
    </div>
  );
}

function Month(p: { subsOnly: boolean; findings: Finding[]; stamp: number; onOpen: (e: CalRow) => void }) {
  void monthRev.value;
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [picked, setPicked] = useState(() => isoDay(Date.now()));
  const swipe = useRef({ x: 0, y: 0 });
  const list = p.subsOnly ? subscribedOnly(entriesForMonth(cursor.y, cursor.m)) : entriesForMonth(cursor.y, cursor.m);
  useEffect(() => {
    const b = monthBounds(cursor.y, cursor.m);
    void ensureCalendarSpan(b.from, b.to);
  }, [cursor.y, cursor.m, p.stamp]);
  useEffect(() => {
    if (picked) return;
    const day = defaultMonthDay(cursor.y, cursor.m, list, Date.now());
    if (day) setPicked(day);
  }, [picked, cursor.y, cursor.m, list]);
  const go = (delta: number) => {
    const next = shiftMonth(cursor.y, cursor.m, delta);
    const nextList = p.subsOnly ? subscribedOnly(entriesForMonth(next.year, next.month)) : entriesForMonth(next.year, next.month);
    setCursor({ y: next.year, m: next.month });
    setPicked(defaultMonthDay(next.year, next.month, nextList, Date.now()));
  };
  const cells = monthCells(cursor.y, cursor.m, list, Date.now());
  const dayEntries = list.filter((e) => e.airDate === picked);
  const rows = dayRows(dayEntries);
  const heads = weekdayHeads();
  return (
    <div class="m-cal-month" data-cal-month="">
      <div class="m-cal-head">
        <button type="button" class="m-icon-btn tm" data-code="P03.12" aria-label={t('news.calPrev')} onClick={() => go(-1)}>
          <Icon d={CHEV_L} />
        </button>
        <div class="m-cal-month-name">{monthTitle(cursor.y, cursor.m)}</div>
        <button type="button" class="m-icon-btn tm" data-code="P03.13" aria-label={t('news.calNextMonth')} onClick={() => go(1)}>
          <Icon d={CHEV_R} />
        </button>
      </div>
      <div class="m-cal-wd" aria-hidden="true">
        {heads.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div
        class="m-cal-grid"
        onTouchStart={(e) => {
          const touch = e.changedTouches[0];
          if (touch) swipe.current = { x: touch.clientX, y: touch.clientY };
        }}
        onTouchEnd={(e) => {
          const touch = e.changedTouches[0];
          if (!touch) return;
          const dir = monthSwipe(touch.clientX - swipe.current.x, touch.clientY - swipe.current.y);
          if (dir) go(dir);
        }}
      >
        {cells.map((c) => {
          const day = parseInt(c.iso.slice(8), 10);
          return (
            <button
              key={c.iso}
              type="button"
              class={'m-cal-cell tm' + (c.inMonth ? '' : ' out') + (c.past && c.inMonth ? ' is-past' : '') + (c.today ? ' is-today' : '') + (c.iso === picked ? ' is-on' : '')}
              data-code={c.inMonth ? 'P03.14' : undefined}
              data-cal-cell={c.iso}
              aria-pressed={c.iso === picked}
              aria-label={t('news.calDayAria', { date: dayHeader(c.iso), n: c.count })}
              disabled={!c.inMonth}
              onClick={() => setPicked(c.iso)}
            >
              <span class="m-cal-num">{day}</span>
              {c.count > 0 && c.inMonth && (
                <span class="m-cal-dots">
                  {Array.from({ length: Math.min(3, c.count) }, (_, i) => (
                    <span key={i} class={'m-cal-dot' + (c.mine ? ' mine' : '')} />
                  ))}
                </span>
              )}
              {c.inMonth && dayCountLabel(c.count) && <span class="m-cal-more">{dayCountLabel(c.count)}</span>}
            </button>
          );
        })}
      </div>
      <button type="button" class="m-btn m-btn-secondary m-btn-sm m-cal-today" onClick={() => {
        const n = new Date();
        setCursor({ y: n.getFullYear(), m: n.getMonth() });
        setPicked(isoDay(Date.now()));
      }}>{t('date.today')}</button>
      <div class="m-cal-picked" data-cal-picked={picked}>
        {picked && <div class="m-cal-dayhead">{dayHeader(picked) + (dayEntries.length ? ' · ' + tp('news.calReleases', dayEntries.length) : '')}</div>}
        {rows.length ? rows.map((r) => (
          <Row key={r.show.card.id + ':' + r.season + ':' + r.episodes.join(',')} e={r} findings={p.findings} onOpen={p.onOpen} />
        )) : picked ? <div class="m-muted m-small">{t('news.calDayEmpty')}</div> : null}
      </div>
    </div>
  );
}

function Ask({ e, onClose }: { e: CalRow; onClose: () => void }) {
  const card = e.show.card;
  const [picked, setPicked] = useState(e.episodes[0]);
  const several = e.episodes.length > 1;
  const plan = episodeActions({ show: e.show, season: e.season, episode: picked });
  const hit = e.entries.filter((x) => x.episode === picked)[0];
  const pickedName = hit ? realEpisodeName(hit.name) : '';
  const multi = card.seasons.length > 1;
  const code = several
    ? humanEpisodes(e.season, [picked], multi) + (pickedName ? ' · ' + pickedName : '')
    : humanEpisodes(e.season, e.episodes, multi);
  const episode = plan.episode;
  const run = (action: CalGo) => {
    onClose();
    goEpisode(action);
  };
  return (
    <Sheet label={t('news.calSheet')} onClose={onClose}>
      <div class="m-cal-ask" data-cal-ask="">
        <div class="m-cal-ask-head">
          {card.poster ? (
            <img class="m-cal-poster" src={card.poster} alt="" width={40} height={60} />
          ) : (
            <span class={'m-cal-poster m-disc-ph m-disc-ph-' + (card.id % 4)} aria-hidden="true" />
          )}
          <span class="m-cal-text">
            <span class="m-cal-title">{card.title}</span>
            <span class="m-small m-muted">{code}</span>
          </span>
        </div>
        {several && (
          <div class="m-cal-eps" role="group" aria-label={t('news.calPickEpisode')}>
            {e.episodes.map((n) => (
              <button
                key={n}
                type="button"
                class={'m-chip tm' + (n === picked ? ' on' : '')}
                data-code="P03.19"
                aria-pressed={n === picked}
                onClick={() => setPicked(n)}
              >
                {humanEpisodes(e.season, [n], card.seasons.length > 1)}
              </button>
            ))}
          </div>
        )}
        <button type="button" class="m-btn m-btn-primary tm" data-code={plan.inCatalog ? 'P03.15' : 'P03.16'} onClick={() => run(plan.primary)}>
          {plan.inCatalog ? t('news.calOpenCatalog') : t('news.calSearchTorrents')}
        </button>
        {episode && (
          <button type="button" class="m-btn m-btn-secondary tm" data-code="P03.17" onClick={() => run(episode)}>
            {t('news.calFindEpisode')}
          </button>
        )}
        <button type="button" class="m-btn m-btn-secondary tm" data-code="P03.18" onClick={onClose}>
          {t('common.cancel')}
        </button>
      </div>
    </Sheet>
  );
}

export function Calendar() {
  void monitorVersion.value;
  const state = calendarState.value;
  const rootRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<CalView>(loadCalView);
  const [subsOnly, setSubsOnly] = useState(false);
  const [ask, setAsk] = useState<CalRow | null>(null);
  const [earlierOpen, setEarlierOpen] = useState(false);
  const reload = (fresh?: boolean) => loadCalendar(torrents.peek(), loadSubs(), fresh);
  useEffect(() => {
    const s = calendarState.peek();
    if (!s.loading && (!s.at || s.lang !== lang.peek() || Date.now() - s.at > STALE_MS)) void reload();
  }, []);
  const pull = usePullRefresh(rootRef, () => reload(true));
  const findings = loadFound();
  const shown = subsOnly ? subscribedOnly(state.entries) : state.entries;
  const filteredOut = subsOnly && !shown.length && state.entries.length > 0;
  const groups = listDaySections(shown);
  const pickView = (v: CalView) => {
    saveCalView(v);
    setView(v);
  };
  const empty = filteredOut ? (
    <div class="m-cal-empty"><div class="m-muted">{t('news.calEmptySubs')}</div></div>
  ) : (
    <div class="m-cal-empty">
      <div class="m-muted">{t('news.calEmpty')}</div>
      <div class="m-muted m-small">{t('news.calHint')}</div>
    </div>
  );
  let body;
  if (state.error && !state.loading) body = <CatalogError code={state.error} onRetry={() => void reload(true)} />;
  else if (!state.entries.length && state.loading) body = <div class="m-muted m-small" aria-busy="true">{t('news.calLoading')}</div>;
  else if (view === 'month') {
    body = (
      <>
        {filteredOut ? empty : <Month subsOnly={subsOnly} findings={findings} stamp={state.at} onOpen={setAsk} />}
        {state.loading && <div class="m-muted m-small">{t('news.calLoading')}</div>}
      </>
    );
  } else if (!shown.length) body = empty;
  else {
    body = (
      <>
        {groups.map((g) => {
          const closed = g.collapsed && !earlierOpen;
          return (
            <section key={g.id} class="m-cal-group" data-cal-group={g.id}>
              {g.collapsed ? (
                <button type="button" class="m-set-label m-cal-earlier" data-cal-earlier aria-expanded={!closed} onClick={() => setEarlierOpen(!earlierOpen)}>
                  {g.label}
                </button>
              ) : (
                <div class="m-set-label m-cal-dayhead">{g.label}</div>
              )}
              {closed ? null : g.rows.map((r) => (
                <Row key={r.show.card.id + ':' + r.season + ':' + r.airDate + ':' + r.episodes.join(',')} e={r} findings={findings} onOpen={setAsk} />
              ))}
            </section>
          );
        })}
        {state.loading && <div class="m-muted m-small">{t('news.calLoading')}</div>}
      </>
    );
  }
  return (
    <div class="m-cal" ref={rootRef}>
      <Tools view={view} subsOnly={subsOnly} onView={pickView} onSubs={setSubsOnly} />
      <PullArea state={pull} label={t('news.calRefreshing')}>
        {body}
      </PullArea>
      {ask && <Ask e={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
