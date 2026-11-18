// External check of the public OMP endpoints from GitHub Actions.
// Tells a change of state to Telegram with @OMPBILLINGBOT, sendMessage only
// (it never polls the bot and never touches its webhook).
// Usage: node scripts/billing-watchdog.mjs
// Env: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID (secrets; without them nothing is sent and the run
// fails on a problem, so GitHub still mails about the failed run). GH_TOKEN or GITHUB_TOKEN lets
// `gh` open and close the outage issue that remembers the state.
// The bot token is never printed: errors are logged by name only.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeIssueBody, issueAction, ISSUE_LABEL, runWatchdog } from './billing-watchdog-lib.mjs';

const CLOSE_COMMENT = 'Снова в порядке. Внешняя проверка из GitHub Actions.';

function gh(args) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const err = e && e.stderr ? String(e.stderr).trim().split('\n')[0] : 'failed';
    throw new Error('gh ' + args.slice(0, 2).join(' ') + ': ' + err);
  }
}

function findOpenIssue() {
  const raw = gh(['issue', 'list', '--label', ISSUE_LABEL, '--state', 'open', '--limit', '20', '--json', 'number,body']);
  const rows = JSON.parse(raw || '[]');
  return (Array.isArray(rows) ? rows : []).find((row) => decodeIssueBody(row && row.body)) || null;
}

function applyIssue(openIssue, next) {
  const plan = issueAction(openIssue, next);
  if (plan.action === 'noop') return;
  if (plan.action === 'close') {
    gh(['issue', 'close', String(plan.number), '--reason', 'completed', '--comment', CLOSE_COMMENT]);
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'omp-uptime-'));
  const file = join(dir, 'issue.md');
  writeFileSync(file, plan.body);
  if (plan.action === 'create') {
    gh(['label', 'create', ISSUE_LABEL, '--color', 'B60205', '--description', 'Публичный адрес OMP не отвечает', '--force']);
    gh(['issue', 'create', '--label', ISSUE_LABEL, '--title', plan.title, '--body-file', file]);
    return;
  }
  gh(['issue', 'edit', String(plan.number), '--body-file', file]);
}

async function probe(url) {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': 'omp-watchdog' },
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    });
    if (!String(url).endsWith('/health')) {
      if (res.body) await res.body.cancel();
      return { status: res.status, body: null };
    }
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } catch (e) {
    return { error: String((e && e.name) || 'error') };
  }
}

async function send(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  const chat = process.env.TELEGRAM_CHAT_ID || '';
  if (!token || !chat) {
    console.log('::warning::TELEGRAM_BOT_TOKEN or WATCHDOG_TELEGRAM_CHAT_ID secret is missing, nothing sent');
    return false;
  }
  try {
    const res = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) console.log('::warning::Telegram sendMessage answered HTTP ' + res.status);
    return res.ok;
  } catch (e) {
    console.log('::warning::Telegram sendMessage failed: ' + String((e && e.name) || 'error'));
    return false;
  }
}

let openIssue = null;

process.exitCode = await runWatchdog({
  probe,
  send,
  readState: async () => {
    openIssue = findOpenIssue();
    return openIssue ? decodeIssueBody(openIssue.body) : null;
  },
  writeState: async (state) => {
    applyIssue(openIssue, state);
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  log: (line) => console.log(line),
  now: () => Date.now(),
});
