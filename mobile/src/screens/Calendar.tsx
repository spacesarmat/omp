// «Новое» → «Календарь»: two views of the followed series. «Список» is one row per episode (released first,
// then «Эта неделя», «Следующая», «Позже»). «Месяц» is a grid; a day opens that day's rows under it.
// The view is remembered. «Только мои подписки» hides series that are only in the library.
import { useEffect, useRef, useState } from 'preact/hooks';
import { lang, t } from '../../../src/i18n';
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
  calendarState, dayCountLabel, dayRows, defaultMonthDay, episodesCode, listGroups, loadCalendar, loadCalView, monthCells,
  monthSwipe, monthTitle, rowFinding, rowLine, saveCalView, shiftMonth, subscribedOnly, weekdayHeads, STALE_MS,
  type CalEntry, type CalRow, type CalView,
} from '../lib/calendar';
import { usePullRefresh, PullArea } from '../ui/PullRefresh';

const CHEV_L = 'M15 6l-6 6 6 6';
const CHEV_R = 'M9 6l6 6-6 6';

/** The chip of an episode out already: «вышла», «сегодня»; none for one to come. */
function chipText(r: CalRow): string {
  if (r.status === 'aired') return t('news.calAired');
  if (r.status === 'today') return t('news.calToday');
  return '';
}

function openFinding(f: Finding): void {
  if (f.subId === EPISODES_ID) navigate({ name: 'news', seg: 'subs', finding: f.key });
  else navigate({ name: 'subFindings', id: f.subId, finding: f.key });
}

function Row({ e, findings }: { e: CalRow; findings: Finding[] }) {
  const card = e.show.card;
  const out = e.status !== 'future';
  const found = out ? rowFinding(e, findings) : null;
  const code = episodesCode(e.season, e.episodes);
  const chip = chipText(e);
  return (
    <div class="m-cal-row" data-cal-row={card.id + ':' + e.season + ':' + e.episodes.join(',')}>
      <button type="button" class="m-cal-open" onClick={() => navigate({ name: 'title', kind: 'tv', id: card.id })}>
        {card.poster ? (
          <img class="m-cal-poster" src={card.poster} alt="" width={40} height={60} loading="lazy" />
        ) : (
          <span class={'m-cal-poster m-disc-ph m-disc-ph-' + (card.id % 4)} aria-hidden="true" />
        )}
        <span class="m-cal-text">
          <span class="m-cal-title">{card.title}</span>
          <span class="m-small m-muted m-cal-ep">{rowLine(e)}</span>
          <span class="m-cal-when m-small m-muted">{dayHeader(e.airDate)}</span>
        </span>
      </button>
      {out && (
        <span class="m-cal-side">
          {chip && <span class={'m-cal-chip m-cal-' + e.status}>{chip}</span>}
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
      )}
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

function Month(p: { entries: CalEntry[]; findings: Finding[] }) {
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [picked, setPicked] = useState(() => isoDay(Date.now()));
  const swipe = useRef({ x: 0, y: 0 });
  const go = (delta: number) => {
    const next = shiftMonth(cursor.y, cursor.m, delta);
    setCursor({ y: next.year, m: next.month });
    setPicked(defaultMonthDay(next.year, next.month, p.entries, Date.now()));
  };
  const cells = monthCells(cursor.y, cursor.m, p.entries, Date.now());
  const dayEntries = p.entries.filter((e) => e.airDate === picked);
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
              class={'m-cal-cell tm' + (c.inMonth ? '' : ' out') + (c.today ? ' is-today' : '') + (c.iso === picked ? ' is-on' : '')}
              data-code={c.inMonth ? 'P03.14' : undefined}
              data-cal-cell={c.iso}
              aria-pressed={c.iso === picked}
              aria-label={t('news.calDayAria', { date: dayHeader(c.iso), n: c.count })}
              disabled={!c.inMonth}
              onClick={() => setPicked(c.iso)}
            >
              <span class="m-cal-num">{day}</span>
              {c.count > 0 && c.inMonth && (c.poster ? <img class="m-cal-dotimg" src={c.poster} alt="" /> : <span class="m-cal-dot" />)}
              {c.count > 1 && c.inMonth && <span class="m-cal-more">{dayCountLabel(c.count)}</span>}
            </button>
          );
        })}
      </div>
      <div class="m-cal-picked" data-cal-picked={picked}>
        {rows.length ? rows.map((r) => (
          <Row key={r.show.card.id + ':' + r.season + ':' + r.episodes.join(',')} e={r} findings={p.findings} />
        )) : picked ? <div class="m-muted m-small">{t('news.calDayEmpty')}</div> : null}
      </div>
    </div>
  );
}

export function Calendar() {
  void monitorVersion.value;
  const state = calendarState.value;
  const rootRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<CalView>(loadCalView);
  const [subsOnly, setSubsOnly] = useState(false);
  const reload = (fresh?: boolean) => loadCalendar(torrents.peek(), loadSubs(), fresh);
  useEffect(() => {
    const s = calendarState.peek();
    if (!s.loading && (!s.at || s.lang !== lang.peek() || Date.now() - s.at > STALE_MS)) void reload();
  }, []);
  const pull = usePullRefresh(rootRef, () => reload(true));
  const findings = loadFound();
  const shown = subsOnly ? subscribedOnly(state.entries) : state.entries;
  const filteredOut = subsOnly && !shown.length && state.entries.length > 0;
  const groups = listGroups(shown);
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
        {filteredOut ? empty : <Month entries={shown} findings={findings} />}
        {!shown.length && !filteredOut && empty}
        {state.loading && <div class="m-muted m-small">{t('news.calLoading')}</div>}
      </>
    );
  } else if (!shown.length) body = empty;
  else {
    body = (
      <>
        {groups.map((g) => (
          <section key={g.id} class="m-cal-group" data-cal-group={g.id}>
            <div class="m-set-label">{g.label}</div>
            {g.rows.map((r) => (
              <Row key={r.show.card.id + ':' + r.season + ':' + r.airDate + ':' + r.episodes.join(',')} e={r} findings={findings} />
            ))}
          </section>
        ))}
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
    </div>
  );
}
