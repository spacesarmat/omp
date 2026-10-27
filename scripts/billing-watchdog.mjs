// External watchdog: checks https://billing.omp-player.online/health from GitHub Actions and tells a change of
// state to Telegram with @OMPBILLINGBOT, sendMessage only (it never polls the bot and never touches its webhook).
// Usage: node scripts/billing-watchdog.mjs <state.json>
// Env: WATCHDOG_URL (default the billing /health), TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID (secrets; without them
// nothing is sent and the run fails on a problem, so GitHub still mails about the failed run).
// The bot token is never printed: errors are logged by name only.
import { readFileSync, writeFileSync } from 'node:fs';
import { runWatchdog } from './billing-watchdog-lib.mjs';

const URL_ = process.env.WATCHDOG_URL || 'https://billing.omp-player.online/health';
const statePath = process.argv[2] || 'watchdog-state.json';

async function probe() {
  try {
    const res = await fetch(URL_, { headers: { 'user-agent': 'omp-watchdog' }, signal: AbortSignal.timeout(20_000) });
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

function readState() {
  try {
    return JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    return null;
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

process.exitCode = await runWatchdog({
  probe,
  send,
  readState,
  writeState: (state) => writeFileSync(statePath, JSON.stringify(state) + '\n'),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  log: (line) => console.log(line),
  now: () => Date.now(),
});
