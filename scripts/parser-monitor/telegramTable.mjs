// The parser monitor table as a short Telegram text (plain text, no markup). Shared by the workflow's «notify» step
// (scripts/parser-monitor/notify.mjs, after a manual run) and the admin bot's /status and /check (ops/admin-bot).
// No imports: the Cloudflare Worker bundles this file as is.

export const ICON = { OK: '✅', PARTIAL: '⚠️', BLOCKED: '🚫', BROKEN: '❌' };

export function clipText(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

const pad = (n) => (n < 10 ? '0' : '') + n;

/** «07.10 21:57 МСК» — Moscow time is UTC+3 all year. Empty for a bad date. */
export function moscowTime(iso) {
  const t = Date.parse(iso || '');
  if (!isFinite(t)) return '';
  const d = new Date(t + 3 * 3600 * 1000);
  return pad(d.getUTCDate()) + '.' + pad(d.getUTCMonth() + 1) + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ' МСК';
}

/** «только что», «5 мин назад», «3 ч назад», «2 дн назад». Empty for a bad date. */
export function ago(iso, now = Date.now()) {
  const t = Date.parse(iso || '');
  if (!isFinite(t)) return '';
  const min = Math.max(0, Math.round((now - t) / 60000));
  if (min < 1) return 'только что';
  if (min < 60) return min + ' мин назад';
  const h = Math.round(min / 60);
  if (h < 48) return h + ' ч назад';
  return Math.round(h / 24) + ' дн назад';
}

/** «07.10 21:57 МСК (3 ч назад)». */
export function when(iso, now = Date.now()) {
  const abs = moscowTime(iso);
  return abs ? abs + ' (' + ago(iso, now) + ')' : '—';
}

/**
 * rows: [{ name, status: OK|PARTIAL|BLOCKED|BROKEN, detail }].
 * «🔎 Парсеры — 07.10 21:57 МСК (3 ч назад)\n✅ Rutor: 100 / 99 / 100 результатов\n…\nИтого: ✅ 5 · ⚠️ 1 · 🚫 1 · ❌ 1».
 */
export function monitorTable(rows, opts = {}) {
  const now = opts.now === undefined ? Date.now() : opts.now;
  const head = (opts.title || '🔎 Парсеры') + (opts.at ? ' — ' + when(opts.at, now) : '');
  if (!rows.length) return head + '\nНет данных о проверках.';
  const lines = rows.map((r) => (ICON[r.status] || '❔') + ' ' + r.name + (r.detail ? ': ' + clipText(r.detail, 110) : ''));
  const counts = ['OK', 'PARTIAL', 'BLOCKED', 'BROKEN']
    .map((s) => [s, rows.filter((r) => r.status === s).length])
    .filter((p) => p[1] > 0)
    .map((p) => ICON[p[0]] + ' ' + p[1]);
  const out = [head, ...lines, 'Итого: ' + counts.join(' · ')];
  if (opts.runUrl) out.push(opts.runUrl);
  return out.join('\n');
}
