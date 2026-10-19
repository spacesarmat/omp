import { adminBroadcast } from './bot.mjs';

/** Stderr line for a stolen getUpdates lock. At most once a minute. */
export const BOT_POLL_LOG_EVERY_MS = 60 * 1000;
/** Admin Telegram notice. At most once an hour. */
export const BOT_POLL_ALERT_EVERY_MS = 60 * 60 * 1000;
/** Panel treats a conflict as recent inside this window. */
export const BOT_POLL_CONFLICT_RECENT_MS = 15 * 60 * 1000;

/** Stderr line for failed getUpdates (timeout, network, HTTP error). At most once a minute. */
export const BOT_POLL_ERROR_LOG_EVERY_MS = 60 * 1000;

const poll = {
  lastOkAt: 0,
  conflictAt: 0,
  lastLogAt: 0,
  lastAlertAt: 0,
  errorAt: 0,
  errorLogAt: 0,
  errorsQuiet: 0,
};

export function resetBotPollState() {
  poll.lastOkAt = 0;
  poll.conflictAt = 0;
  poll.lastLogAt = 0;
  poll.lastAlertAt = 0;
  poll.errorAt = 0;
  poll.errorLogAt = 0;
  poll.errorsQuiet = 0;
}

/**
 * A failed poll (`kind`: timeout, network, http 502, loop). Returns the stderr line when one is due
 * (at most once a minute, with how many failures were not logged since), else ''. Only the kind
 * goes into the line: the request URL and error text can contain the bot token.
 */
export function notePollError(kind, now) {
  const at = now || Date.now();
  poll.errorAt = at;
  if (!due(poll.errorLogAt, at, BOT_POLL_ERROR_LOG_EVERY_MS)) {
    poll.errorsQuiet += 1;
    return '';
  }
  const quiet = poll.errorsQuiet;
  poll.errorLogAt = at;
  poll.errorsQuiet = 0;
  const safe = String(kind || 'error').replace(/[^a-z0-9 ]/gi, '').slice(0, 40);
  return 'telegram getUpdates failed: ' + safe + (quiet ? ' (+' + quiet + ' more since the last line)' : '') + '\n';
}

/**
 * BILLING_BOT_POLL defaults to on. Only 0 / false / off / no stop polling,
 * so a typo cannot silence the live instance.
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export function botPollEnabled(env) {
  const src = env || process.env;
  const raw = src.BILLING_BOT_POLL;
  if (raw === undefined || raw === null) return true;
  const v = String(raw).trim().toLowerCase();
  if (v === '' || v === '1' || v === 'true' || v === 'on' || v === 'yes') return true;
  if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
  return true;
}

export function botPollDisabledLine() {
  return 'telegram bot poll off (BILLING_BOT_POLL=0); this instance will not call getUpdates\n';
}

export function conflictLogLine() {
  return 'telegram getUpdates 409: another instance is polling this bot (terminated by other getUpdates request)\n';
}

export function conflictAlertText() {
  return (
    'Другой экземпляр опрашивает этого Telegram-бота (getUpdates 409: terminated by other getUpdates request). ' +
    'Вход в панель через Telegram может отвечать «ссылка устарела». ' +
    'Оставьте BILLING_BOT_POLL=1 только на одном сервере.'
  );
}

/**
 * Telegram returns HTTP 409 when a second getUpdates client holds the bot.
 * A webhook 409 uses a different description and is not this conflict.
 * @param {{ status?: number } | null | undefined} res
 * @param {{ error_code?: number, description?: string } | null | undefined} data
 */
export function isGetUpdatesConflict(res, data) {
  const status = Number(res && res.status) || 0;
  const code = Number(data && data.error_code) || 0;
  if (status !== 409 && code !== 409) return false;
  const desc = String((data && data.description) || '').toLowerCase();
  return desc.indexOf('terminated by other getupdates request') >= 0;
}

export function noteBotPollOk(now) {
  poll.lastOkAt = now || Date.now();
}

function due(prev, at, gap) {
  if (!prev) return true;
  return at - prev >= gap;
}

/**
 * Remember a stolen getUpdates lock.
 * Log slot and alert slot are independent. No admin chats means no alert,
 * and the alert slot stays open until a notice is actually produced.
 * @returns {{ log: boolean, messages: { chatId: string, text: string, keyboard?: object }[] }}
 */
export function noteGetUpdatesConflict(settings, now) {
  const at = now || Date.now();
  poll.conflictAt = at;
  let log = false;
  if (due(poll.lastLogAt, at, BOT_POLL_LOG_EVERY_MS)) {
    poll.lastLogAt = at;
    log = true;
  }
  let messages = [];
  if (due(poll.lastAlertAt, at, BOT_POLL_ALERT_EVERY_MS)) {
    messages = adminBroadcast(settings, conflictAlertText());
    if (messages.length) poll.lastAlertAt = at;
  }
  return { log, messages };
}

/** Status for the admin panel. `enabled` follows BILLING_BOT_POLL. */
export function botPollSnapshot(now) {
  const at = now || Date.now();
  return {
    enabled: botPollEnabled(),
    lastOkAt: poll.lastOkAt,
    conflictAt: poll.conflictAt,
    conflictRecent: poll.conflictAt > 0 && at - poll.conflictAt <= BOT_POLL_CONFLICT_RECENT_MS,
    errorAt: poll.errorAt,
  };
}
