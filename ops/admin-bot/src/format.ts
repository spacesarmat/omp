// The bot's answers (Telegram HTML). Pure functions over the GitHub data (unit tested).
import { COMMANDS } from './commandList.mjs';
import { clipText, when } from './time';

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
  const lines = COMMANDS.map((c) => '/' + c.command + ' - ' + escapeHtml(c.description));
  return '🤖 <b>OMP admin</b>\n' + lines.join('\n');
}

// ---------- /ci ----------

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
    if (it.error) return '⚠️ <b>' + escapeHtml(it.title) + '</b> - ' + escapeHtml(it.error);
    if (!it.run) return '▫️ <b>' + escapeHtml(it.title) + '</b> - запусков нет';
    const r = it.run;
    const what = r.display_title ? ' · ' + escapeHtml(clipText(r.display_title, 60)) : '';
    return runIcon(r) + ' <b>' + escapeHtml(it.title) + '</b> - ' + when(r.created_at, now) + what + ' · ' + link(r.html_url, '#' + (r.run_number || ''));
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
  if (!isFinite(t)) return '-';
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
    return (f.version.indexOf('-') >= 0 ? '🧪 ' : '📦 ') + head + (rel ? link(rel.html_url, f.version) : escapeHtml(f.version)) + ' - ' + date;
  });
  return '🗂 <b>Версии в фидах обновлений</b>\n' + lines.join('\n');
}

// ---------- /stats ----------

export interface RepoStats {
  releases: ReleaseInfo[];
  stars: number;
  openIssues: number | null;
}

export const latestStable = (rs: ReleaseInfo[]): ReleaseInfo | undefined => rs.filter((r) => !r.draft && !r.prerelease)[0];
export const latestBeta = (rs: ReleaseInfo[]): ReleaseInfo | undefined => rs.filter((r) => !r.draft && r.prerelease)[0];
const sum = (r: ReleaseInfo) => r.assets.reduce((n, a) => n + (a.download_count || 0), 0);

function releaseBlock(label: string, r: ReleaseInfo | undefined): string {
  if (!r) return '<b>' + label + '</b>: нет';
  const assets = r.assets
    .slice()
    .sort((a, b) => b.download_count - a.download_count)
    .map((a) => '  • ' + escapeHtml(a.name) + ' - ' + a.download_count);
  return '<b>' + label + '</b> ' + link(r.html_url, r.tag_name) + ' (' + moscowDate(r.published_at) + '): ⬇️ ' + sum(r) + (assets.length ? '\n' + assets.join('\n') : '');
}

export function formatStats(s: RepoStats): string {
  const published = s.releases.filter((r) => !r.draft);
  const total = published.reduce((n, r) => n + sum(r), 0);
  const parts = [
    '📊 <b>Статистика OMP</b>',
    releaseBlock('Стабильная', latestStable(published)),
    releaseBlock('Бета', latestBeta(published)),
    '⬇️ Всего скачиваний: ' + total + ' (' + published.length + ' релизов)\n⭐ Звёзд: ' + s.stars + '\n🐞 Открытых issues: ' + (s.openIssues === null ? '-' : s.openIssues),
  ];
  return clipMessage(parts.join('\n\n'));
}

export function errorText(e: unknown): string {
  return '⚠️ Не получилось: ' + escapeHtml(e instanceof Error ? e.message : String(e));
}

