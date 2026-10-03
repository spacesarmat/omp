// Russian texts of the monitoring screens: times, subscription conditions, episode ranges, the last check.
import { sourceName } from '../../../src/sources/view';
import { parseEpisodeRange } from '../../../src/monitor/episodes';
import type { MonitorSummary } from '../../../src/monitor/settings';
import type { EpisodesInfo, SubQuality, Subscription } from '../../../src/monitor/types';

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

const MONTHS = ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];

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
  if (diff === 1) return 'вчера';
  if (diff === -1) return 'завтра';
  const d = new Date(ms);
  return d.getDate() + ' ' + MONTHS[d.getMonth()];
}

/** «сегодня 14:20», «вчера 14:20», «3 окт. 14:20». */
export function whenText(ms: number, now: number): string {
  return (dayWord(ms, now) || 'сегодня') + ' ' + clock(ms);
}

/** «Проверено в 14:20 · следующая проверка около 17:20». */
export function checkedLine(o: { last: number | null; next: number | null; enabled: boolean; now: number }): string {
  const parts: string[] = [];
  if (o.last) {
    const day = dayWord(o.last, o.now);
    parts.push('Проверено ' + (day ? day + ' ' : '') + 'в ' + clock(o.last));
  } else {
    parts.push('Ещё не проверялось');
  }
  const n = nextLine(o.next, o.enabled, o.now);
  if (n) parts.push(n);
  return parts.join(' · ');
}

/** «следующая проверка около 17:20», «фоновая проверка выключена» or '' (unknown). */
export function nextLine(next: number | null, enabled: boolean, now: number): string {
  if (!enabled) return 'фоновая проверка выключена';
  if (!next || next <= now) return '';
  const day = dayWord(next, now);
  return 'следующая проверка около ' + (day ? day + ' ' : '') + clock(next);
}

/** «Как часто»: «раз в час», «раз в 3 часа», «раз в 12 часов». */
export function hoursText(h: number): string {
  return h === 1 ? 'раз в час' : 'раз в ' + h + ' ' + plural(h, 'час', 'часа', 'часов');
}

export const QUALITY_LABELS: { id: SubQuality; label: string }[] = [
  { id: '', label: 'Любое' },
  { id: '720', label: '720p+' },
  { id: '1080', label: '1080p+' },
  { id: '2160', label: '2160p' },
];

function qualityRule(q: SubQuality): string {
  return q === '' ? 'любое качество' : q === '2160' ? '2160p' : 'от ' + q + 'p';
}

/** «8,5». */
export function gbText(n: number): string {
  return String(Math.round(n * 10) / 10).replace('.', ',');
}

/** Sources of a subscription: «Все источники» or «rutor, nnmclub». */
export function subSources(s: Pick<Subscription, 'sources'>): string {
  if (s.sources === null) return 'Все источники';
  if (!s.sources.length) return 'Нет источников';
  return s.sources.map(sourceName).join(', ');
}

/** The conditions under the query: «Все источники · от 1080p · от 20 сидов · до 30 ГБ». */
export function subRule(s: Subscription): string {
  const parts = [subSources(s), qualityRule(s.quality)];
  if (s.minSeeds) parts.push('от ' + s.minSeeds + ' ' + plural(s.minSeeds, 'сида', 'сидов', 'сидов'));
  if (s.maxSizeGb) parts.push('до ' + gbText(s.maxSizeGb) + ' ГБ');
  if (!s.notify) parts.push('без уведомлений');
  return parts.join(' · ');
}

/** «2 новых», «1 новая». */
export function freshText(n: number): string {
  return n + ' ' + plural(n, 'новая', 'новых', 'новых');
}

/** «1–8», «5». */
export function rangeOf(from: number | undefined, to: number): string {
  return from !== undefined && from < to ? from + '–' + to : String(to);
}

/** «Вышли серии 9–10 · у вас 1–8» (or «Вышла серия 10 · у вас 1–9»). */
export function episodesLine(e: EpisodesInfo, haveFrom = 1): string {
  const first = e.haveTo + 1;
  const news = first >= e.to ? 'Вышла серия ' + e.to : 'Вышли серии ' + first + '–' + e.to;
  return news + ' · у вас ' + rangeOf(Math.min(haveFrom, e.haveTo), e.haveTo);
}

/** «Серии 1–10 из 10» from a release title; '' when it has no episode numbers. */
export function rangeText(title: string): string {
  const r = parseEpisodeRange(title);
  if (r.to === undefined) return '';
  const head = r.from !== undefined && r.from < r.to ? 'Серии ' + r.from + '–' + r.to : 'Серия ' + r.to;
  return head + (r.total ? ' из ' + r.total : '');
}

/** The last check, line by line: «Последняя проверка: сегодня 14:20», «Найдено новых: 3», «Источники: 7 из 8 ответили». */
export function summaryLines(s: MonitorSummary, now: number): string[] {
  const out = ['Последняя проверка: ' + whenText(s.at, now)];
  out.push(s.found ? 'Найдено новых: ' + s.found : 'Новых раздач нет');
  if (s.asked) out.push('Источники: ' + s.answered + ' из ' + s.asked + ' ответили');
  if (s.skipped) out.push('Не успели проверить: ' + s.skipped + ' ' + plural(s.skipped, 'подписку', 'подписки', 'подписок'));
  if (s.notifyBlocked) out.push('Уведомления не показаны: они выключены для OMP');
  if (s.error) out.push(s.error);
  return out;
}
