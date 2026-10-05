// Texts of the monitoring screens (Russian / English): times, subscription conditions, episode ranges, the last check.
import { fmtDate, fmtNumber, t, tp } from '../../../src/i18n';
import { sourceName } from '../../../src/sources/view';
import { parseEpisodeRange } from '../../../src/monitor/episodes';
import type { MonitorSummary } from '../../../src/monitor/settings';
import type { BetterInfo, EpisodesInfo, SubQuality, Subscription } from '../../../src/monitor/types';

function pad(n: number): string {
  return (n < 10 ? '0' : '') + n;
}

/** «14:20». */
export function clock(ms: number): string {
  const d = new Date(ms);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function dayStart(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** '' today, «вчера», else «3 окт.». */
export function dayWord(ms: number, now: number): string {
  const diff = Math.round((dayStart(now) - dayStart(ms)) / 86400000);
  if (diff === 0) return '';
  if (diff === 1) return t('monitor.yesterday');
  if (diff === -1) return t('monitor.tomorrow');
  return fmtDate(ms, 'day');
}

/** «сегодня 14:20», «вчера 14:20», «3 окт. 14:20». */
export function whenText(ms: number, now: number): string {
  return (dayWord(ms, now) || t('monitor.today')) + ' ' + clock(ms);
}

/** «Проверено в 14:20 · следующая проверка около 17:20». */
export function checkedLine(o: { last: number | null; next: number | null; enabled: boolean; now: number }): string {
  const parts: string[] = [];
  if (o.last) {
    const day = dayWord(o.last, o.now);
    parts.push(day ? t('monitor.checkedDayAt', { day: day, time: clock(o.last) }) : t('monitor.checkedAt', { time: clock(o.last) }));
  } else {
    parts.push(t('monitor.notChecked'));
  }
  const n = nextLine(o.next, o.enabled, o.now);
  if (n) parts.push(n);
  return parts.join(' · ');
}

/** «следующая проверка около 17:20», «фоновая проверка выключена» or '' (unknown). */
export function nextLine(next: number | null, enabled: boolean, now: number): string {
  if (!enabled) return t('monitor.bgOff');
  if (!next || next <= now) return '';
  const day = dayWord(next, now);
  return day ? t('monitor.nextDayAt', { day: day, time: clock(next) }) : t('monitor.nextAt', { time: clock(next) });
}

/** «Как часто»: «раз в час», «раз в 3 часа», «раз в 12 часов». */
export function hoursText(h: number): string {
  return h === 1 ? t('monitor.everyHour') : tp('monitor.everyHours', h);
}

export function qualityLabels(): { id: SubQuality; label: string }[] {
  return [
    { id: '', label: t('monitor.anyQuality') },
    { id: '720', label: '720p+' },
    { id: '1080', label: '1080p+' },
    { id: '2160', label: '2160p' },
  ];
}

function qualityRule(q: SubQuality): string {
  return q === '' ? t('monitor.anyQualityRule') : q === '2160' ? '2160p' : t('monitor.fromQuality', { q: q });
}

/** «8,5». */
export function gbText(n: number): string {
  return fmtNumber(Math.round(n * 10) / 10);
}

/** Sources of a subscription: «Все источники» or «rutor, nnmclub». */
export function subSources(s: Pick<Subscription, 'sources'>): string {
  if (s.sources === null) return t('monitor.allSources');
  if (!s.sources.length) return t('monitor.noSources');
  return s.sources.map(sourceName).join(', ');
}

/** The conditions under the query: «Все источники · от 1080p · от 20 сидов · до 30 ГБ». */
export function subRule(s: Subscription): string {
  const parts = [subSources(s), qualityRule(s.quality)];
  if (s.better) parts.push(t('monitor.betterRule'));
  if (s.minSeeds) parts.push(tp('monitor.minSeeds', s.minSeeds));
  if (s.maxSizeGb) parts.push(t('monitor.maxSize', { size: gbText(s.maxSizeGb) }));
  if (!s.notify) parts.push(t('monitor.noNotify'));
  return parts.join(' · ');
}

/** «2 новых», «1 новая». */
export function freshText(n: number): string {
  return tp('monitor.fresh', n);
}

/** «1–8», «5». */
export function rangeOf(from: number | undefined, to: number): string {
  return from !== undefined && from < to ? from + '–' + to : String(to);
}

/** «Вышли серии 9–10 · у вас 1–8» (or «Вышла серия 10 · у вас 1–9»). */
export function episodesLine(e: EpisodesInfo, haveFrom = 1): string {
  const first = e.haveTo + 1;
  const news = first >= e.to ? t('monitor.episodeOut', { to: e.to }) : t('monitor.episodesOut', { from: first, to: e.to });
  return t('monitor.youHave', { news: news, range: rangeOf(Math.min(haveFrom, e.haveTo), e.haveTo) });
}

/** A quality label, or «качество не указано» when the title said nothing. */
export function qualityText(label: string): string {
  return label || t('monitor.qualityUnknown');
}

/** «4K WEB-DL · у вас 1080p WEB-DL». */
export function betterLine(b: BetterInfo): string {
  return t('monitor.youHave', { news: qualityText(b.got), range: qualityText(b.have) });
}

/** «Серии 1–10 из 10» from a release title; '' when it has no episode numbers. */
export function rangeText(title: string): string {
  const r = parseEpisodeRange(title);
  if (r.to === undefined) return '';
  const head = r.from !== undefined && r.from < r.to ? t('monitor.episodesRange', { from: r.from, to: r.to }) : t('monitor.episodeOne', { to: r.to });
  return r.total ? t('monitor.rangeOfTotal', { head: head, total: r.total }) : head;
}

/** The last check, line by line: «Последняя проверка: сегодня 14:20», «Найдено новых: 3», «Источники: 7 из 8 ответили». */
export function summaryLines(s: MonitorSummary, now: number): string[] {
  const out = [t('monitor.lastCheck', { when: whenText(s.at, now) })];
  out.push(s.found ? t('monitor.foundNew', { n: s.found }) : t('monitor.noNew'));
  if (s.asked) out.push(t('monitor.sourcesAnswered', { answered: s.answered, asked: s.asked }));
  if (s.skipped) out.push(tp('monitor.skipped', s.skipped));
  if (s.notifyBlocked) out.push(t('monitor.notifyBlocked'));
  if (s.error) out.push(s.error);
  return out;
}
