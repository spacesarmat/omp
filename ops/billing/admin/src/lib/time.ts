/** Admin times are Europe/Moscow and labelled МСК. Moscow has no DST. */

export const DISPLAY_TZ = 'Europe/Moscow';
export const DISPLAY_TZ_LABEL = 'МСК';

const MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

export type MoscowParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function pad(n: number) {
  return (n < 10 ? '0' : '') + n;
}

export function moscowParts(ms: number): MoscowParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: DISPLAY_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(new Date(ms))) {
    if (part.type !== 'literal') bag[part.type] = part.value;
  }
  let hour = Number(bag.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour,
    minute: Number(bag.minute),
    second: Number(bag.second),
  };
}

export function dayKey(ms: number) {
  const p = moscowParts(ms);
  return p.year + '-' + pad(p.month) + '-' + pad(p.day);
}

function shiftDayKey(key: string, delta: number) {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + delta));
  return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate());
}

/** HH:MM in Moscow. */
export function clock(ms: number) {
  const p = moscowParts(ms);
  return pad(p.hour) + ':' + pad(p.minute);
}

/** 18.10.2026 14:05 */
export function listStamp(ms: number) {
  const p = moscowParts(ms);
  return pad(p.day) + '.' + pad(p.month) + '.' + p.year + ' ' + pad(p.hour) + ':' + pad(p.minute);
}

/** 18 октября 2026, 14:05:07 МСК */
export function exactStamp(ms: number) {
  const p = moscowParts(ms);
  return (
    p.day +
    ' ' +
    MONTHS[p.month - 1] +
    ' ' +
    p.year +
    ', ' +
    pad(p.hour) +
    ':' +
    pad(p.minute) +
    ':' +
    pad(p.second) +
    ' ' +
    DISPLAY_TZ_LABEL
  );
}

/** Сегодня, Вчера, or «18 октября 2026». */
export function dayTitle(ms: number, now = Date.now()) {
  const key = dayKey(ms);
  const today = dayKey(now);
  if (key === today) return 'Сегодня';
  if (key === shiftDayKey(today, -1)) return 'Вчера';
  const p = moscowParts(ms);
  return p.day + ' ' + MONTHS[p.month - 1] + ' ' + p.year;
}

export function groupByDay<T extends { at?: number }>(items: T[], now = Date.now()) {
  const groups: { key: string; title: string; items: T[] }[] = [];
  for (const item of items) {
    const at = item.at || 0;
    const key = at > 0 ? dayKey(at) : 'none';
    const title = at > 0 ? dayTitle(at, now) : 'Без даты';
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, title, items: [item] });
  }
  return groups;
}
