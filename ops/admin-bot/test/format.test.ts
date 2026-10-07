import { describe, expect, it } from 'vitest';
import {
  MAX_TEXT,
  escapeHtml,
  formatCi,
  formatStats,
  formatStatus,
  formatVersions,
  helpText,
  moscowDate,
  runIcon,
  stateRows,
  type ReleaseInfo,
  type RunInfo,
} from '../src/format';
import { ago, monitorTable, moscowTime, when } from '../../../scripts/parser-monitor/telegramTable.mjs';
import { notifyText } from '../../../scripts/parser-monitor/notify.mjs';

const NOW = Date.parse('2026-10-08T12:00:00Z');
const NAMES = { rutor: 'Rutor', nnmclub: 'NNM-Club', torrentby: 'torrent.by' };

const run = (over: Partial<RunInfo> = {}): RunInfo => ({
  html_url: 'https://github.com/spacesarmat/omp/actions/runs/1',
  status: 'completed',
  conclusion: 'success',
  created_at: '2026-10-08T09:00:00Z',
  run_number: 42,
  ...over,
});

const rel = (tag: string, prerelease: boolean, published: string, assets: [string, number][]): ReleaseInfo => ({
  tag_name: tag,
  html_url: 'https://github.com/spacesarmat/omp/releases/tag/' + tag,
  draft: false,
  prerelease,
  published_at: published,
  assets: assets.map(([name, download_count]) => ({ name, download_count })),
});

describe('time', () => {
  it('shows Moscow time and how long ago', () => {
    expect(moscowTime('2026-10-07T21:57:02.151Z')).toBe('08.10 00:57 МСК');
    expect(ago('2026-10-08T11:59:40Z', NOW)).toBe('только что');
    expect(ago('2026-10-08T11:15:00Z', NOW)).toBe('45 мин назад');
    expect(ago('2026-10-08T09:00:00Z', NOW)).toBe('3 ч назад');
    expect(ago('2026-10-05T12:00:00Z', NOW)).toBe('3 дн назад');
    expect(when('nonsense', NOW)).toBe('—');
    expect(moscowDate('2026-10-07T22:30:00Z')).toBe('08.10.2026');
  });
});

describe('monitor table', () => {
  it('one line per source with its icon, then the totals', () => {
    const text = monitorTable(
      [
        { name: 'Rutor', status: 'OK', detail: '100 / 99 / 100 результатов' },
        { name: 'torrent.by', status: 'BROKEN', detail: 'Поиск: не нашёл таблицу' },
        { name: 'NNM-Club', status: 'BLOCKED', detail: 'бан IP' },
      ],
      { title: '🔎 Парсеры', at: '2026-10-08T09:00:00Z', now: NOW },
    );
    expect(text.split('\n')).toEqual([
      '🔎 Парсеры — 08.10 12:00 МСК (3 ч назад)',
      '✅ Rutor: 100 / 99 / 100 результатов',
      '❌ torrent.by: Поиск: не нашёл таблицу',
      '🚫 NNM-Club: бан IP',
      'Итого: ✅ 1 · 🚫 1 · ❌ 1',
    ]);
  });

  it('/status: known sources in the app order, a long failure says since when', () => {
    const rows = stateRows(
      {
        updated: '2026-10-08T09:00:00Z',
        sources: {
          extra: { status: 'OK', detail: '1 результат' },
          torrentby: { status: 'BROKEN', streak: 3, since: '2026-10-07T09:00:00Z', detail: 'сломан' },
          rutor: { status: 'OK', streak: 5, detail: '100' },
        },
      },
      NAMES,
    );
    expect(rows).toEqual([
      { name: 'Rutor', status: 'OK', detail: '100' },
      { name: 'torrent.by', status: 'BROKEN', detail: 'сломан (3 проверки подряд, с 07.10 12:00 МСК)' },
      { name: 'extra', status: 'OK', detail: '1 результат' },
    ]);
  });

  it('/status escapes the details and links the last run', () => {
    const text = formatStatus({ updated: '2026-10-08T09:00:00Z', sources: { rutor: { status: 'OK', detail: '<b>' } } }, NAMES, run(), NOW);
    expect(text).toContain('✅ Rutor: &lt;b&gt;');
    expect(text).toContain('Последний запуск: ✅ 08.10 12:00 МСК (3 ч назад) · <a href="https://github.com/spacesarmat/omp/actions/runs/1">#42</a>');
    expect(formatStatus(null, NAMES, null, NOW)).toContain('ещё не сохранено');
  });

  it('notify: the finished run table, or «failed» without a report', () => {
    const report = { at: '2026-10-08T11:00:00Z', reports: [{ id: 'rutor', name: 'Rutor', status: 'OK', detail: '100' }] };
    const text = notifyText(report, { runUrl: 'https://github.com/x/runs/5' });
    expect(text.split('\n')[0]).toMatch(/^🔎 Проверка парсеров готова — /);
    expect(text).toContain('✅ Rutor: 100');
    expect(text.endsWith('https://github.com/x/runs/5')).toBe(true);
    expect(notifyText(null, { runUrl: 'https://github.com/x/runs/5' })).toBe('❌ Проверка парсеров не дошла до конца — отчёта нет.\nhttps://github.com/x/runs/5');
    expect(notifyText(report, { dryRun: true })).toContain('(без сохранения)');
  });
});

describe('/ci', () => {
  it('maps a run to ✅ ❌ ⏳ ⚪', () => {
    expect(runIcon({ status: 'completed', conclusion: 'success' })).toBe('✅');
    expect(runIcon({ status: 'completed', conclusion: 'failure' })).toBe('❌');
    expect(runIcon({ status: 'completed', conclusion: 'timed_out' })).toBe('❌');
    expect(runIcon({ status: 'in_progress', conclusion: null })).toBe('⏳');
    expect(runIcon({ status: 'queued', conclusion: null })).toBe('⏳');
    expect(runIcon({ status: 'completed', conclusion: 'cancelled' })).toBe('⚪');
  });

  it('one line per workflow with when and the link', () => {
    const text = formatCi(
      [
        { title: 'CI (main)', run: run({ display_title: 'Merge pull request #67' }) },
        { title: 'Release', run: run({ status: 'in_progress', conclusion: null, run_number: 7 }) },
        { title: 'Parser monitor', run: null, error: 'GitHub /x: HTTP 403' },
      ],
      NOW,
    );
    expect(text.split('\n')).toEqual([
      '⚙️ <b>Последние запуски</b>',
      '✅ <b>CI (main)</b> — 08.10 12:00 МСК (3 ч назад) · Merge pull request #67 · <a href="https://github.com/spacesarmat/omp/actions/runs/1">#42</a>',
      '⏳ <b>Release</b> — 08.10 12:00 МСК (3 ч назад) · <a href="https://github.com/spacesarmat/omp/actions/runs/1">#7</a>',
      '⚠️ <b>Parser monitor</b> — GitHub /x: HTTP 403',
    ]);
  });
});

describe('/versions', () => {
  it('each feed with its version, release link and date', () => {
    const text = formatVersions(
      [
        { file: 'update.json', title: 'LG', version: '0.18.2' },
        { file: 'update-beta.json', title: 'LG бета', version: '0.19.0-beta.6' },
        { file: 'update-android.json', title: 'Android', version: '0.17.0' },
        { file: 'update-android-beta.json', title: 'Android бета', version: null, error: 'файла нет' },
      ],
      [rel('v0.19.0-beta.6', true, '2026-10-07T20:00:00Z', []), rel('v0.18.2', false, '2026-10-01T10:00:00Z', [])],
    );
    const lines = text.split('\n');
    expect(lines[1]).toBe('📦 <b>LG</b> (update.json): <a href="https://github.com/spacesarmat/omp/releases/tag/v0.18.2">0.18.2</a> — 01.10.2026');
    expect(lines[2]).toBe('🧪 <b>LG бета</b> (update-beta.json): <a href="https://github.com/spacesarmat/omp/releases/tag/v0.19.0-beta.6">0.19.0-beta.6</a> — 07.10.2026');
    expect(lines[3]).toBe('📦 <b>Android</b> (update-android.json): 0.17.0 — релиз не найден');
    expect(lines[4]).toBe('⚠️ <b>Android бета</b> (update-android-beta.json): файла нет');
  });
});

describe('/stats', () => {
  it('downloads of the latest stable and beta, totals, stars, issues', () => {
    const text = formatStats({
      releases: [
        rel('v0.19.0-beta.6', true, '2026-10-07T20:00:00Z', [['OMP-0.19.0-beta.6.apk', 5], ['OMP-0.19.0-beta.6-arm64.apk', 12]]),
        rel('v0.18.2', false, '2026-10-01T10:00:00Z', [['OMP-0.18.2-webOS.ipk', 30], ['OMP-0.18.2-arm64.apk', 40]]),
        { ...rel('v0.18.1', false, '2026-09-20T10:00:00Z', [['x', 100]]) },
        { ...rel('v9.9.9', false, '2026-10-08T10:00:00Z', [['draft', 1000]]), draft: true },
      ],
      stars: 12,
      openIssues: 3,
      monitorIssues: [{ number: 70, title: 'Парсер torrent.by сломан', html_url: 'https://github.com/spacesarmat/omp/issues/70' }],
    });
    expect(text).toContain('<b>Стабильная</b> <a href="https://github.com/spacesarmat/omp/releases/tag/v0.18.2">v0.18.2</a> (01.10.2026): ⬇️ 70\n  • OMP-0.18.2-arm64.apk — 40\n  • OMP-0.18.2-webOS.ipk — 30');
    expect(text).toContain('<b>Бета</b> <a href="https://github.com/spacesarmat/omp/releases/tag/v0.19.0-beta.6">v0.19.0-beta.6</a> (07.10.2026): ⬇️ 17');
    expect(text).toContain('⬇️ Всего скачиваний: 187 (3 релизов)');
    expect(text).toContain('⭐ Звёзд: 12');
    expect(text).toContain('🐞 Открытых issues: 3');
    expect(text).toContain('🔧 Открытых issues монитора парсеров: 1\n  • <a href="https://github.com/spacesarmat/omp/issues/70">#70 Парсер torrent.by сломан</a>');
  });

  it('stays under the Telegram limit', () => {
    const many = Array.from({ length: 400 }, (_, i) => ['asset-with-a-long-name-' + i + '.apk', i] as [string, number]);
    const text = formatStats({ releases: [rel('v1.0.0', false, '2026-10-01T10:00:00Z', many)], stars: 1, openIssues: null, monitorIssues: [] });
    expect(text.length).toBeLessThanOrEqual(MAX_TEXT);
  });
});

describe('help', () => {
  it('lists every command', () => {
    const text = helpText();
    ['/status', '/check', '/versions', '/stats', '/ci', '/help'].forEach((c) => expect(text).toContain(c));
    expect(escapeHtml('<a & "b">')).toBe('&lt;a &amp; &quot;b&quot;&gt;');
  });
});
