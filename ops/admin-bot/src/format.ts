// The bot's answers (Telegram HTML). Pure functions over the GitHub data (unit tested).
import { COMMANDS } from './commandList.mjs';
import { ICON, clipText, monitorTable, moscowTime, when } from '../../../scripts/parser-monitor/telegramTable.mjs';

/** Telegram's message limit is 4096 characters. */
export const MAX_TEXT = 4000;

export function escapeHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function link(url: string, text: string): string {
  return '<a href="' + escapeHtml(url) + '">' + escapeHtml(text) + '</a>';
}

/** Cuts a long message at a line end (never inside an HTML tag of a line). */
export function clipMessage(s: string): string {
  if (s.length <= MAX_TEXT) return s;
  const cut = s.lastIndexOf('\n', MAX_TEXT - 2);
  return s.slice(0, cut > 0 ? cut : MAX_TEXT - 2) + '\n…';
}

export function helpText(): string {
  const lines = COMMANDS.map((c) => '/' + c.command + ' — ' + escapeHtml(c.description));
  return '🤖 <b>OMP admin</b>\n' + lines.join('\n');
}

// ---------- /status ----------

export interface MonitorSourceState {
  status: string;
  streak?: number;
  since?: string;
  detail?: string;
}

export interface MonitorStateFile {
  updated?: string;
  sources?: { [id: string]: MonitorSourceState };
}

export interface RunInfo {
  html_url: string;
  status: string;
  conclusion: string | null;
  created_at: string;
  updated_at?: string;
  run_number?: number;
  event?: string;
  display_title?: string;
}

/** The rows of the monitor table: the known sources in the app's order first, then any others. */
export function stateRows(state: MonitorStateFile, names: { [id: string]: string }): { name: string; status: string; detail: string }[] {
  const sources = (state && state.sources) || {};
  const ids = Object.keys(names).filter((id) => sources[id]);
  Object.keys(sources).forEach((id) => {
    if (ids.indexOf(id) < 0) ids.push(id);
  });
  return ids.map((id) => {
    const s = sources[id];
    let detail = s.detail || '';
    if (s.status !== 'OK' && (s.streak || 0) > 1) detail += ' (' + s.streak + ' проверки подряд, с ' + moscowTime(s.since) + ')';
    return { name: names[id] || id, status: s.status, detail };
  });
}

export function formatStatus(state: MonitorStateFile | null, names: { [id: string]: string }, lastRun: RunInfo | null, now: number): string {
  const parts: string[] = [];
  if (!state) parts.push('🔎 Парсеры\nСостояние монитора ещё не сохранено (ветка monitor-state пуста).');
  else parts.push(escapeHtml(monitorTable(stateRows(state, names), { title: '🔎 Парсеры, последняя проверка', at: state.updated, now })));
  if (lastRun) parts.push('Последний запуск: ' + runIcon(lastRun) + ' ' + when(lastRun.created_at, now) + ' · ' + link(lastRun.html_url, '#' + (lastRun.run_number || '')));
  return clipMessage(parts.join('\n\n'));
}

// ---------- /ci ----------

/** ✅ success, ❌ failure / timed out, ⏳ queued or running, ⚪ cancelled, ⏭ skipped. */
export function runIcon(run: { status: string; conclusion: string | null }): string {
  if (run.status !== 'completed') return '⏳';
  switch (run.conclusion) {
    case 'success':
    case 'neutral':
      return '✅';
    case 'cancelled':
      return '⚪';
    case 'skipped':
      return '⏭';
    default:
      return '❌';
  }
}

export function formatCi(items: { title: string; run: RunInfo | null; error?: string }[], now: number): string {
  const lines = items.map((it) => {
    if (it.error) return '⚠️ <b>' + escapeHtml(it.title) + '</b> — ' + escapeHtml(it.error);
    if (!it.run) return '▫️ <b>' + escapeHtml(it.title) + '</b> — запусков нет';
    const r = it.run;
    const what = r.display_title ? ' · ' + escapeHtml(clipText(r.display_title, 60)) : '';
    return runIcon(r) + ' <b>' + escapeHtml(it.title) + '</b> — ' + when(r.created_at, now) + what + ' · ' + link(r.html_url, '#' + (r.run_number || ''));
  });
  return '⚙️ <b>Последние запуски</b>\n' + lines.join('\n');
}

// ---------- /versions ----------

export interface ReleaseInfo {
  tag_name: string;
  name?: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  created_at?: string;
  assets: { name: string; download_count: number }[];
}

/** «08.10.2026» in Moscow time, or «—». */
export function moscowDate(iso: string | null | undefined): string {
  const t = Date.parse(iso || '');
  if (!isFinite(t)) return '—';
  const d = new Date(t + 3 * 3600 * 1000);
  const p = (n: number) => (n < 10 ? '0' : '') + n;
  return p(d.getUTCDate()) + '.' + p(d.getUTCMonth() + 1) + '.' + d.getUTCFullYear();
}

export const FEEDS: { file: string; title: string }[] = [
  { file: 'update.json', title: 'LG' },
  { file: 'update-android.json', title: 'Android' },
  { file: 'update-beta.json', title: 'LG бета' },
  { file: 'update-android-beta.json', title: 'Android бета' },
];

export function formatVersions(feeds: { file: string; title: string; version: string | null; error?: string }[], releases: ReleaseInfo[]): string {
  const byTag: { [tag: string]: ReleaseInfo } = {};
  releases.forEach((r) => (byTag[r.tag_name] = r));
  const lines = feeds.map((f) => {
    const head = '<b>' + escapeHtml(f.title) + '</b> (' + escapeHtml(f.file) + '): ';
    if (!f.version) return '⚠️ ' + head + escapeHtml(f.error || 'нет версии');
    const rel = byTag['v' + f.version] || byTag[f.version];
    const date = rel ? moscowDate(rel.published_at || rel.created_at) : 'релиз не найден';
    return (f.version.indexOf('-') >= 0 ? '🧪 ' : '📦 ') + head + (rel ? link(rel.html_url, f.version) : escapeHtml(f.version)) + ' — ' + date;
  });
  return '🗂 <b>Версии в фидах обновлений</b>\n' + lines.join('\n');
}

// ---------- /stats ----------

export interface RepoStats {
  releases: ReleaseInfo[];
  stars: number;
  openIssues: number | null;
  monitorIssues: { number: number; title: string; html_url: string }[];
}

export const latestStable = (rs: ReleaseInfo[]): ReleaseInfo | undefined => rs.filter((r) => !r.draft && !r.prerelease)[0];
export const latestBeta = (rs: ReleaseInfo[]): ReleaseInfo | undefined => rs.filter((r) => !r.draft && r.prerelease)[0];
const sum = (r: ReleaseInfo) => r.assets.reduce((n, a) => n + (a.download_count || 0), 0);

function releaseBlock(label: string, r: ReleaseInfo | undefined): string {
  if (!r) return '<b>' + label + '</b>: нет';
  const assets = r.assets
    .slice()
    .sort((a, b) => b.download_count - a.download_count)
    .map((a) => '  • ' + escapeHtml(a.name) + ' — ' + a.download_count);
  return '<b>' + label + '</b> ' + link(r.html_url, r.tag_name) + ' (' + moscowDate(r.published_at) + '): ⬇️ ' + sum(r) + (assets.length ? '\n' + assets.join('\n') : '');
}

export function formatStats(s: RepoStats): string {
  const published = s.releases.filter((r) => !r.draft);
  const total = published.reduce((n, r) => n + sum(r), 0);
  const parts = [
    '📊 <b>Статистика OMP</b>',
    releaseBlock('Стабильная', latestStable(published)),
    releaseBlock('Бета', latestBeta(published)),
    '⬇️ Всего скачиваний: ' + total + ' (' + published.length + ' релизов)\n⭐ Звёзд: ' + s.stars + '\n🐞 Открытых issues: ' + (s.openIssues === null ? '—' : s.openIssues),
  ];
  if (!s.monitorIssues.length) parts.push('🔧 Открытых issues монитора парсеров: 0');
  else parts.push('🔧 Открытых issues монитора парсеров: ' + s.monitorIssues.length + '\n' + s.monitorIssues.map((i) => '  • ' + link(i.html_url, '#' + i.number + ' ' + i.title)).join('\n'));
  return clipMessage(parts.join('\n\n'));
}

// ---------- /check ----------

export function checkStarted(names: string[]): string {
  return '🚀 Запустил проверку' + (names.length ? ': ' + escapeHtml(names.join(', ')) : ' всех парсеров') + '…\nТаблицу пришлю сюда, когда workflow закончится (обычно 3–15 мин).';
}

export function unknownSources(unknown: string[], known: string[]): string {
  return '🤔 Не знаю источник: ' + escapeHtml(unknown.join(', ')) + '\nЕсть: ' + escapeHtml(known.join(', '));
}

export function errorText(e: unknown): string {
  return '⚠️ Не получилось: ' + escapeHtml(e instanceof Error ? e.message : String(e));
}

export { ICON };
