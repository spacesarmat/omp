// The live parser monitor run (npm run monitor:parsers, and the «Parser monitor» workflow). Checks every built-in
// site parser against its live site, prints a table, and writes into MONITOR_OUT (default monitor-out/):
//   report.json   — every check of this run
//   actions.json  — the alerts to send (alerts.mjs sends them: GitHub issues, Telegram)
//   summary.md    — the table (the workflow's job summary)
// and the next state into MONITOR_STATE (default monitor-out/parser-monitor.json; the workflow keeps it on the
// monitor-state branch). Never fails because a site is broken: only a crash of the monitor itself fails the run.
// Environment: RUTRACKER_LOGIN / RUTRACKER_PASSWORD, KINOZAL_LOGIN / KINOZAL_PASSWORD, RUSTORKA_LOGIN / RUSTORKA_PASSWORD
// (optional), MONITOR_SOURCES=rutor,anidub (only these), MONITOR_SUMMARY=true (send the weekly summary now),
// MONITOR_RUN_URL (link to the run in the issues).
import { test } from 'vitest';
// @ts-ignore node builtins (the project has no node types, like tests/i18n)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
// @ts-ignore
import { dirname, join } from 'node:path';
import { applyLanguageSetting } from '../../src/i18n';
import { decide, parseState, runTable, type SourceReport } from './logic';
import { probes, runProbe } from './probes';

declare const process: { env: { [k: string]: string | undefined } };

test('parser monitor', async () => {
  // the parsers' messages, and the monitor's comparisons with them, are Russian
  applyLanguageSetting('ru');
  const env = process.env;
  const out = env.MONITOR_OUT || 'monitor-out';
  const statePath = env.MONITOR_STATE || join(out, 'parser-monitor.json');
  mkdirSync(out, { recursive: true });
  mkdirSync(dirname(statePath), { recursive: true });

  const only = (env.MONITOR_SOURCES || '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean);
  const list = probes().filter((p) => !only.length || only.indexOf(p.source.id) >= 0);
  const log = (line: string) => console.log('[monitor] ' + line);

  // sites one after another: each gets a polite pace and its own cookies
  const reports: SourceReport[] = [];
  for (const p of list) {
    log(p.source.name + ': проверка…');
    const r = await runProbe(p, { env, log });
    log(p.source.name + ': ' + r.status + ' — ' + r.detail);
    reports.push(r);
  }

  let prevRaw: unknown = null;
  if (existsSync(statePath)) {
    try {
      prevRaw = JSON.parse(readFileSync(statePath, 'utf8'));
    } catch (e) {
      log('состояние не прочитано, начинаю заново');
    }
  }
  const prev = parseState(prevRaw);
  // a partial run (MONITOR_SOURCES) keeps the other sources' records as they were
  const { state, actions } = decide(prev, reports, {
    now: new Date(),
    runUrl: env.MONITOR_RUN_URL || undefined,
    forceSummary: env.MONITOR_SUMMARY === 'true',
  });
  if (only.length) Object.keys(prev.sources).forEach((id) => (state.sources[id] = state.sources[id] || prev.sources[id]));

  const table = runTable(reports);
  writeFileSync(join(out, 'report.json'), JSON.stringify({ at: new Date().toISOString(), reports }, null, 2));
  writeFileSync(join(out, 'actions.json'), JSON.stringify(actions, null, 2));
  writeFileSync(join(out, 'summary.md'), '## Монитор парсеров\n\n' + table + '\n\nДействий: ' + actions.length + '\n');
  writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');

  console.log('\n' + table + '\n');
  actions.forEach((a) => log('действие: ' + a.kind + ('source' in a ? ' ' + a.source : '')));
});
