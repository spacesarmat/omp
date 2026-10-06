// «Новое» → «Календарь»: the coming episodes of the followed series by day, with «Смотреть» (a monitoring finding has
// the episode) or «Найти» (the tracker search of the season) for the ones already out.
import { useEffect, useRef } from 'preact/hooks';
import { lang, t } from '../../../src/i18n';
import { torrentQuery } from '../../../src/catalog/tmdb';
import { torrents } from '../../../src/store/library';
import { loadFound, loadSubs } from '../../../src/monitor/subs';
import { EPISODES_ID, type Finding } from '../../../src/monitor/types';
import { navigate } from '../nav';
import { monitorVersion } from '../monitor/ui';
import { CatalogError } from './catalog/CatalogError';
import { airDateText } from '../lib/seriesStatus';
import { episodeCode } from '../lib/releaseDates';
import { calendarState, findingFor, groupByDay, loadCalendar, STALE_MS, type CalEntry } from '../lib/calendar';
import { usePullRefresh, PullArea } from '../ui/PullRefresh';

function chipText(e: CalEntry): string {
  if (e.status === 'aired') return t('news.calAired');
  if (e.status === 'today') return t('news.calToday');
  return airDateText(e.airDate);
}

function openFinding(f: Finding): void {
  if (f.subId === EPISODES_ID) navigate({ name: 'news', seg: 'subs', finding: f.key });
  else navigate({ name: 'subFindings', id: f.subId, finding: f.key });
}

function Row({ e, findings }: { e: CalEntry; findings: Finding[] }) {
  const card = e.show.card;
  const out = e.status !== 'future';
  const found = out ? findingFor(e, findings) : null;
  const line = episodeCode(e.season, e.episode) + (e.name ? ' · ' + e.name : '');
  return (
    <div class="m-cal-row" data-cal-row={card.id + ':' + e.season + ':' + e.episode}>
      <button type="button" class="m-cal-open" onClick={() => navigate({ name: 'title', kind: 'tv', id: card.id })}>
        {card.poster ? (
          <img class="m-cal-poster" src={card.poster} alt="" width={40} height={60} loading="lazy" />
        ) : (
          <span class={'m-cal-poster m-disc-ph m-disc-ph-' + (card.id % 4)} aria-hidden="true" />
        )}
        <span class="m-cal-text">
          <span class="m-cal-title">{card.title}</span>
          <span class="m-small m-muted m-cal-ep">{line}</span>
        </span>
      </button>
      <span class="m-cal-side">
        <span class={'m-cal-chip m-cal-' + e.status}>{chipText(e)}</span>
        {out &&
          (found ? (
            <button
              type="button"
              class="m-btn m-btn-primary m-btn-sm"
              aria-label={t('news.calWatchAria', { title: card.title + ' ' + episodeCode(e.season, e.episode) })}
              onClick={() => openFinding(found)}
            >
              {t('news.calWatch')}
            </button>
          ) : (
            <button
              type="button"
              class="m-btn m-btn-secondary m-btn-sm"
              aria-label={t('news.calFindAria', { title: card.title + ' ' + episodeCode(e.season, e.episode) })}
              onClick={() => navigate({ name: 'add', query: torrentQuery(card, e.season), run: true })}
            >
              {t('news.calFind')}
            </button>
          ))}
      </span>
    </div>
  );
}

export function Calendar() {
  void monitorVersion.value;
  const state = calendarState.value;
  const rootRef = useRef<HTMLDivElement>(null);
  const reload = (fresh?: boolean) => loadCalendar(torrents.peek(), loadSubs(), fresh);
  useEffect(() => {
    const s = calendarState.peek();
    if (!s.loading && (!s.at || s.lang !== lang.peek() || Date.now() - s.at > STALE_MS)) void reload();
  }, []);
  const pull = usePullRefresh(rootRef, () => reload(true));
  const findings = loadFound();
  const days = groupByDay(state.entries);
  let body;
  if (state.error && !state.loading) body = <CatalogError code={state.error} onRetry={() => void reload(true)} />;
  else if (!days.length && state.loading) body = <div class="m-muted m-small" aria-busy="true">{t('news.calLoading')}</div>;
  else if (!days.length) {
    body = (
      <div class="m-cal-empty">
        <div class="m-muted">{t('news.calEmpty')}</div>
        <div class="m-muted m-small">{t('news.calHint')}</div>
      </div>
    );
  } else {
    body = (
      <>
        {days.map((d) => (
          <section key={d.iso} class="m-cal-day" data-cal-day={d.iso}>
            <div class="m-set-label">{d.label}</div>
            {d.entries.map((e) => (
              <Row key={e.show.card.id + ':' + e.season + ':' + e.episode} e={e} findings={findings} />
            ))}
          </section>
        ))}
        {state.loading && <div class="m-muted m-small">{t('news.calLoading')}</div>}
      </>
    );
  }
  return (
    <div class="m-cal" ref={rootRef}>
      <PullArea state={pull} label={t('news.calRefreshing')}>
        {body}
      </PullArea>
    </div>
  );
}
