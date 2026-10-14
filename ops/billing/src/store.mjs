import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function emptyState() {
  return {
    settings: {
      adminHash: '',
      adminSalt: '',
      botToken: '',
      botUsername: 'OMPBILLINGBOT',
      /** Public base URL of this server (for /go/… links in Telegram). */
      publicOrigin: '',
      /** Comma-separated Telegram chat ids that get the admin cabinet. */
      adminTelegramIds: '',
      yoomoneyWallet: '',
      yoomoneySecret: '',
      jackettUrl: '',
      jackettApiKey: '',
      smtpHost: '',
      smtpPort: 587,
      smtpUser: '',
      smtpPass: '',
      smtpFrom: '',
      priceRub: 0,
      periodDays: 30,
      extraDeviceRub: 0,
    },
    accounts: [],
    subscriptions: [],
    codes: [],
    sessions: [],
    attempts: [],
    payments: [],
    /** Rejected / problem YooMoney notifications (signature, duplicate, …). */
    webhooks: [],
    promos: [],
    /** Pending phone↔Telegram link tokens from the app. */
    links: [],
    outbox: [],
  };
}

export function readState(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    const base = emptyState();
    if (!parsed || typeof parsed !== 'object') return base;
    return {
      settings: { ...base.settings, ...(parsed.settings || {}) },
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
      subscriptions: Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [],
      codes: Array.isArray(parsed.codes) ? parsed.codes : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      attempts: Array.isArray(parsed.attempts) ? parsed.attempts : [],
      payments: Array.isArray(parsed.payments) ? parsed.payments : [],
      webhooks: Array.isArray(parsed.webhooks) ? parsed.webhooks : [],
      promos: Array.isArray(parsed.promos) ? parsed.promos : [],
      links: Array.isArray(parsed.links) ? parsed.links : [],
      outbox: Array.isArray(parsed.outbox) ? parsed.outbox : [],
    };
  } catch (e) {
    return emptyState();
  }
}

export function writeState(file, state) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, file);
}

let chain = Promise.resolve();

/** Reads, lets `fn` return the next state, writes it, and returns `fn`'s result. */
export function updateState(file, fn) {
  const run = chain.then(() => {
    const state = readState(file);
    const out = fn(state);
    const next = out && out.state ? out.state : state;
    writeState(file, next);
    return out ? out.result : undefined;
  });
  chain = run.then(
    () => {},
    () => {},
  );
  return run;
}
