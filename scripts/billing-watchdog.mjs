// External watchdog: checks https://billing.omp-player.online/health from GitHub Actions and tells a change of
// state to Telegram with @OMPBILLINGBOT, sendMessage only (it never polls the bot and never touches its webhook).
// Usage: node scripts/billing-watchdog.mjs <state.json>
// Env: WATCHDOG_URL (default the billing /health), TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID (secrets; without them
// nothing is sent and the run fails on a problem, so GitHub still mails about the failed run).
// The bot token is never printed: errors are logged by name only.
import { readFileSync, writeFileSync } from 'node:fs';
import { evaluateHealth, transition } from './billing-watchdog-lib.mjs';

const URL_ = process.env.WATCHDOG_URL || 'https://billing.omp-player.online/health';
const statePath = process.argv[2] || 'watchdog-state.json';
const ATTEMPTS = 3;
const GAP_MS = 30_000;

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

let verdict = { ok: false, reason: '' };
for (let i = 0; i < ATTEMPTS; i++) {
  if (i) await new Promise((r) => setTimeout(r, GAP_MS));
  verdict = evaluateHealth(await probe());
  if (verdict.ok) break;
  console.log('attempt ' + (i + 1) + ': ' + verdict.reason);
}
const prev = readState();
const plan = transition(prev, verdict, Date.now());
let next = plan.next;
let unsent = false;
if (plan.text) {
  unsent = !(await send(plan.text));
  // not sent: keep the old state, so the next run tries again (no state yet: as if it was fine)
  if (unsent) next = prev || { ok: true, since: 0, reason: '' };
}
writeFileSync(statePath, JSON.stringify(next) + '\n');
console.log(verdict.ok ? 'billing ok' : 'billing problem: ' + verdict.reason);
// A red run only when Telegram could not be told, so a down billing does not mail every 15 minutes.
if (unsent && !verdict.ok) process.exitCode = 1;
