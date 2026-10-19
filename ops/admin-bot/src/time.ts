// Small text helpers of the admin bot's answers: Moscow time, «how long ago», clipping.

export function clipText(s: string, n: number): string {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

const pad = (n: number) => (n < 10 ? '0' : '') + n;

/** «07.10 21:57 МСК» - Moscow time is UTC+3 all year. Empty for a bad date. */
export function moscowTime(iso: string | null | undefined): string {
  const t = Date.parse(iso || '');
  if (!isFinite(t)) return '';
  const d = new Date(t + 3 * 3600 * 1000);
  return pad(d.getUTCDate()) + '.' + pad(d.getUTCMonth() + 1) + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ' МСК';
}

/** «только что», «5 мин назад», «3 ч назад», «2 дн назад». Empty for a bad date. */
export function ago(iso: string | null | undefined, now: number = Date.now()): string {
  const t = Date.parse(iso || '');
  if (!isFinite(t)) return '';
  const min = Math.max(0, Math.round((now - t) / 60000));
  if (min < 1) return 'только что';
  if (min < 60) return min + ' мин назад';
  const h = Math.round(min / 60);
  if (h < 48) return h + ' ч назад';
  return Math.round(h / 24) + ' дн назад';
}

/** «07.10 21:57 МСК (3 ч назад)», or «-» for a bad date. */
export function when(iso: string | null | undefined, now: number = Date.now()): string {
  const abs = moscowTime(iso);
  return abs ? abs + ' (' + ago(iso, now) + ')' : '-';
}
