// Parser monitor, a manual run with «notify» (the admin bot's /check starts one): sends this run's table to the
// admin's Telegram chat when the workflow finishes. A Cloudflare Worker cannot wait for a 5–40 minute run, so the
// workflow reports itself.
// Usage: node scripts/parser-monitor/notify.mjs monitor-out/report.json
// Env: TELEGRAM_BOT_TOKEN, MONITOR_TG_CHAT, MONITOR_RUN_URL, MONITOR_DRY_RUN=true (says so in the title). Without the
// token or the chat it does nothing. Never prints the token.
import { existsSync, readFileSync } from 'node:fs';
import { monitorTable } from './telegramTable.mjs';

/** The message for a finished run: the table of report.json, or «the run failed» when there is no report. */
export function notifyText(report, { runUrl = '', dryRun = false } = {}) {
  if (!report || !Array.isArray(report.reports)) {
    return '❌ Проверка парсеров не дошла до конца — отчёта нет.' + (runUrl ? '\n' + runUrl : '');
  }
  const rows = report.reports.map((r) => ({ name: r.name || r.id, status: r.status, detail: r.detail }));
  return monitorTable(rows, { title: '🔎 Проверка парсеров готова' + (dryRun ? ' (без сохранения)' : ''), at: report.at, runUrl });
}

async function main(file) {
  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  const chat = process.env.MONITOR_TG_CHAT || '';
  if (!token || !chat) {
    console.log('Telegram: skipped (no bot token or chat)');
    return;
  }
  let report = null;
  try {
    if (existsSync(file)) report = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    report = null;
  }
  const text = notifyText(report, { runUrl: process.env.MONITOR_RUN_URL || '', dryRun: process.env.MONITOR_DRY_RUN === 'true' });
  const res = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, link_preview_options: { is_disabled: true } }),
  }).catch(() => null);
  if (!res || !res.ok) {
    let desc = '';
    try {
      desc = res ? (await res.json()).description || '' : 'network error';
    } catch (e) {
      /* no body */
    }
    console.error('Telegram: HTTP ' + (res ? res.status : '-') + ' ' + desc);
    process.exitCode = 1;
    return;
  }
  console.log('Telegram: sent the table');
}

if (process.argv[1] && /notify\.mjs$/.test(process.argv[1])) main(process.argv[2] || 'monitor-out/report.json');
