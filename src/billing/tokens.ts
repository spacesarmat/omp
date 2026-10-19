// Device tokens of the billing server (ops/billing README «Реестр устройств и токены»): the refresh/access pair,
// its rotation and the one-time move off the opaque token of apps before PR-5. Chromium 53 safe: promises, no async.
//
// Android (ctx.billing): the refresh token lives in the app (BillingTokens.kt, Keystore only) and every page renews
// through it, the background check and the TV search server included, one refresh at a time for the process.
// Without it (browser build, tests) only the app's own page rotates (startBillingKeepAlive).
import { billingPost } from './client';
import { rekeyBillingAccess, saveBillingAccess } from './entitlement';
import {
  billingSession,
  deviceId,
  emitBillingChange,
  isLegacySession,
  saveBillingSession,
  sessionKey,
  setBillingNotice,
  type BillingNotice,
  type BillingSession,
} from './session';
import { t } from '../i18n';
import { log } from '../lib/log';
import type { HttpResponse, NativeBilling, SourceContext } from '../sources/types';

/** Keystore key of the refresh token. */
export const REFRESH_SECRET = 'billing.refresh';
/** The access token (24 h) is renewed when less than this is left. */
export const REFRESH_EARLY_MS = 2 * 60 * 60 * 1000;
/** A refresh or upgrade whose answer was lost is sent again once, with the same token, inside the server's 60 s grace. */
export const LOST_RETRY_MS = 3000;
/** After a failed refresh or upgrade (network, 5xx, 429) a token that still works is used without asking again. */
export const RETRY_LATER_MS = 5 * 60 * 1000;
const KEEP_ALIVE_MS = 30 * 60 * 1000;
/** Answers after which this binding is gone for good: a new code is needed. */
const GONE = ['revoked', 'refresh_expired', 'bad_token', 'upgraded'];

export interface TokenPair {
  refreshToken: string;
  accessToken: string;
  accessExpiresAt: number;
  refreshExpiresAt: number;
  paidUntil?: number;
}

let refresher = false;
/** Android (the default): the refresh token lives in the Keystore only. Off in the browser build. */
let keystoreOnly = true;
/** Android, after a refused Keystore write: the refresh token of this binding, in memory only. */
let memoryRefresh: { id: string; token: string } | null = null;
let inflight: Promise<BillingSession> | null = null;
let failedAt = 0;
let wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The app's own page may rotate tokens (the hidden pages may not). */
export function allowBillingRefresh(on: boolean): void {
  refresher = on;
}

/** Tests: no real pause before the lost-answer retry, and a clean state. */
export function resetBillingTokens(pause?: (ms: number) => Promise<void>): void {
  inflight = null;
  failedAt = 0;
  memoryRefresh = null;
  keystoreOnly = true;
  if (pause) wait = pause;
}

/** Android build (true) or browser build (false): only the browser may keep the refresh token in localStorage. */
export function useBillingKeystore(on: boolean): void {
  keystoreOnly = on;
}

function onAndroid(ctx: SourceContext): boolean {
  return keystoreOnly && !!ctx.secrets;
}

/** Android: every page renews through the app (one refresh for the process). Elsewhere only the app's own page. */
function canRefresh(ctx: SourceContext): boolean {
  return !!ctx.billing || (refresher && !ctx.background);
}

/** The one-time move off the legacy token needs to keep a refresh token: the app's page only. */
function canUpgrade(ctx: SourceContext): boolean {
  return ctx.billing ? !!ctx.billing.adopt : refresher && !ctx.background;
}

export function errorOf(text: string): string {
  try {
    const v = JSON.parse(text) as { error?: unknown };
    return v && typeof v.error === 'string' ? v.error : '';
  } catch (e) {
    return '';
  }
}

export function pairOf(text: string): TokenPair | null {
  let v: Partial<TokenPair>;
  try {
    v = JSON.parse(text) as Partial<TokenPair>;
  } catch (e) {
    return null;
  }
  if (!v || typeof v.refreshToken !== 'string' || typeof v.accessToken !== 'string') return null;
  if (!v.refreshToken || !v.accessToken || typeof v.accessExpiresAt !== 'number') return null;
  return {
    refreshToken: v.refreshToken,
    accessToken: v.accessToken,
    accessExpiresAt: v.accessExpiresAt,
    refreshExpiresAt: typeof v.refreshExpiresAt === 'number' ? v.refreshExpiresAt : 0,
    paidUntil: typeof v.paidUntil === 'number' ? v.paidUntil : undefined,
  };
}

function newId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += ('0' + bytes[i].toString(16)).slice(-2);
  return out;
}

/** An error this module made (its text is meant for the user as is); anything else is «сервер не отвечает». */
export function isTokenError(e: unknown): e is Error {
  return e instanceof Error && (e as Error & { billingToken?: boolean }).billingToken === true;
}

function tokenFailure(text: string): Error {
  const e = new Error(text) as Error & { billingToken?: boolean };
  e.billingToken = true;
  return e;
}

function downError(): Error {
  return tokenFailure(t('sources.billing.down'));
}

function goneError(): Error {
  return tokenFailure(t('sources.billing.revoked'));
}

interface Stored {
  /** Browser build: the token to keep in the session. Never set on Android. */
  local?: string;
  /** Android: the Keystore refused it, the token is in memory only. */
  volatile?: boolean;
}

/**
 * Android: the Keystore or nowhere. A refused write keeps the token in memory for this run of the app and logs the
 * failure (never the value); after a restart the code is asked again. The browser build keeps it in the session.
 */
function storeRefresh(ctx: SourceContext, token: string, id: string): Promise<Stored> {
  const store = ctx.secrets;
  if (!store) return Promise.resolve({ local: token });
  if (!onAndroid(ctx)) {
    return store.set(REFRESH_SECRET, token).then(
      () => ({}),
      () => ({ local: token }),
    );
  }
  return store.set(REFRESH_SECRET, token).then(
    () => {
      memoryRefresh = null;
      return {};
    },
    () => {
      memoryRefresh = { id, token };
      log('warn', 'app', t('log.billingKeystoreFailed'));
      return { volatile: true };
    },
  );
}

function readRefresh(ctx: SourceContext, s: BillingSession): Promise<string> {
  const store = ctx.secrets;
  if (store && onAndroid(ctx)) {
    if (memoryRefresh && memoryRefresh.id === s.id) return Promise.resolve(memoryRefresh.token);
    if (s.volatile) return Promise.resolve('');
    // a Keystore error rejects (the caller says the server is unreachable): only a missing token is final
    return store.get(REFRESH_SECRET).then((v) => v || '');
  }
  if (s.refresh) return Promise.resolve(s.refresh);
  if (!store) return Promise.resolve('');
  return store.get(REFRESH_SECRET).then((v) => v || '');
}

/** Android: a session whose refresh token was in memory only, after a restart: nothing is left to renew it with. */
function lostOnRestart(ctx: SourceContext, s: BillingSession): boolean {
  return onAndroid(ctx) && !!s.volatile && !(memoryRefresh && memoryRefresh.id === s.id);
}

/** Saves a fresh pair: the refresh token to the Keystore, the access token to the session. `prev` keeps the binding id. */
export function savePair(ctx: SourceContext, pair: TokenPair, prev: BillingSession | null): Promise<BillingSession> {
  const id = prev && prev.id ? prev.id : newId();
  const native = ctx.billing;
  const keep: Promise<Stored> =
    native && native.adopt
      ? native.adopt(pair.refreshToken).then(
          (r) => (r.volatile ? { volatile: true } : {}),
          () => {
            // the app could not take the token at all: the code works again on this phone, ask for it once more
            throw downError();
          },
        )
      : storeRefresh(ctx, pair.refreshToken, id);
  return keep.then((stored) => {
    if (prev && !prev.id && prev.token) rekeyBillingAccess(prev.token, id);
    const row: BillingSession = {
      token: '',
      paidUntil: typeof pair.paidUntil === 'number' ? pair.paidUntil : prev ? prev.paidUntil : 0,
      id,
      access: pair.accessToken,
      accessExp: pair.accessExpiresAt,
      refreshExp: pair.refreshExpiresAt,
    };
    if (stored.local) row.refresh = stored.local;
    if (stored.volatile) row.volatile = true;
    saveBillingSession(row);
    setBillingNotice('');
    emitBillingChange();
    return row;
  });
}

/** Forgets the binding on this phone (tokens and the cached /v1/me answer). `notice` says why on the code screen. */
export function dropDeviceTokens(ctx: SourceContext | null, notice: BillingNotice): void {
  saveBillingAccess(null);
  saveBillingSession(null);
  setBillingNotice(notice);
  memoryRefresh = null;
  if (ctx && ctx.billing && ctx.billing.forget) ctx.billing.forget().then(undefined, () => undefined);
  else if (ctx && ctx.secrets) ctx.secrets.delete(REFRESH_SECRET).then(undefined, () => undefined);
  emitBillingChange();
}

function single(work: () => Promise<BillingSession>): Promise<BillingSession> {
  if (inflight) return inflight;
  const p: Promise<BillingSession> = Promise.resolve()
    .then(work)
    .then(
      (row) => {
        if (inflight === p) inflight = null;
        return row;
      },
      (e) => {
        if (inflight === p) inflight = null;
        throw e;
      },
    );
  inflight = p;
  return p;
}

/** Longest device name the billing server keeps (ops/billing registry.mjs). */
const NAME_MAX = 40;

/**
 * `{ name }` with this phone's model for /v1/activate, /v1/token/upgrade and /v1/token/refresh (the server keeps it in
 * its device list); `{}` when the app has none (browser build, hidden pages) or it fails. Never blocks the request.
 */
export function deviceNameField(ctx: SourceContext): Promise<{ name?: string }> {
  const ask = ctx.billing && ctx.billing.name;
  if (!ask) return Promise.resolve({});
  return Promise.resolve()
    .then(() => ask.call(ctx.billing))
    .then(
      (raw) => {
        const name = Array.from(
          String(raw || '')
            .replace(/[^\p{L}\p{N} .,()+/-]/gu, ' ')
            .replace(/\s+/g, ' ')
            .trim(),
        )
          .slice(0, NAME_MAX)
          .join('')
          .trim();
        return name ? { name } : {};
      },
      () => ({}),
    );
}

/** One POST; a lost answer (network error, timeout) is sent once more with the same body. */
function postTwice(
  ctx: SourceContext,
  path: string,
  body: { [key: string]: string },
  headers: { [name: string]: string },
): Promise<HttpResponse> {
  const send = () => billingPost(ctx, path, body, { headers, timeoutMs: 15000 });
  return send().then(undefined, () => wait(LOST_RETRY_MS).then(send));
}

function takePair(ctx: SourceContext, s: BillingSession, res: HttpResponse): Promise<BillingSession> {
  if (res.status >= 200 && res.status < 300) {
    const pair = pairOf(res.text);
    const cur = billingSession();
    // the user disconnected or entered another code while this was on the way
    if (!pair || !cur || sessionKey(cur) !== sessionKey(s)) return Promise.reject(downError());
    failedAt = 0;
    return savePair(ctx, pair, cur);
  }
  if (res.status === 401 && GONE.indexOf(errorOf(res.text)) >= 0) {
    dropDeviceTokens(ctx, 'revoked');
    return Promise.reject(goneError());
  }
  failedAt = Date.now();
  if (res.status === 429) return Promise.reject(tokenFailure(t('sources.billing.rate')));
  return Promise.reject(downError());
}

function upgradeLegacy(ctx: SourceContext, s: BillingSession): Promise<BillingSession> {
  const headers = {
    Authorization: 'Bearer ' + s.token,
    'X-Device-Id': deviceId(),
  };
  return deviceNameField(ctx)
    .then((named) => postTwice(ctx, '/v1/token/upgrade', { deviceId: deviceId(), ...named }, headers))
    .then(
      (res) => {
        // an old server without the route, or a blip: the legacy token keeps working, try again later
        if (res.status === 404 || res.status === 429 || res.status >= 500) {
          failedAt = Date.now();
          return s;
        }
        return takePair(ctx, s, res);
      },
      () => {
        failedAt = Date.now();
        return s;
      },
    );
}

/**
 * New access/refresh pair (the refresh token rotates). One at a time: callers that come while one runs share it.
 * A legacy session is moved to the pair instead (once). Rejects with «устройство отключено» when the binding is gone.
 */
export function refreshDeviceTokens(ctx: SourceContext): Promise<BillingSession> {
  return single(() => {
    const s = billingSession();
    if (!s) return Promise.reject(tokenFailure(t('sources.billing.badCode')));
    if (isLegacySession(s)) return canUpgrade(ctx) ? upgradeLegacy(ctx, s) : Promise.resolve(s);
    if (ctx.billing) return nativeRefresh(ctx, ctx.billing, s);
    return readRefresh(ctx, s).then(
      (refreshToken) => {
        if (!refreshToken) {
          const lost = lostOnRestart(ctx, s);
          dropDeviceTokens(ctx, lost ? 'keystore' : 'revoked');
          throw lost ? tokenFailure(t('sources.billing.keystoreLost')) : goneError();
        }
        return deviceNameField(ctx)
          .then((named) =>
            postTwice(ctx, '/v1/token/refresh', { refreshToken, deviceId: deviceId(), ...named }, { 'X-Device-Id': deviceId() }),
          )
          .then(
            (res) => takePair(ctx, s, res),
            () => {
              failedAt = Date.now();
              throw downError();
            },
          );
      },
      () => {
        failedAt = Date.now();
        throw downError();
      },
    );
  });
}

/** Android: the app renews (Keystore, one refresh for every page, a lost answer retried); the page keeps the access token. */
function nativeRefresh(ctx: SourceContext, native: NativeBilling, s: BillingSession): Promise<BillingSession> {
  return native.refresh(deviceId(), s.access || '').then(
    (ans) => {
      if (ans && ans.ok && typeof ans.accessToken === 'string' && ans.accessToken && typeof ans.accessExpiresAt === 'number') {
        const cur = billingSession();
        // the user disconnected or entered another code while this was on the way
        if (!cur || sessionKey(cur) !== sessionKey(s)) throw downError();
        failedAt = 0;
        const row: BillingSession = {
          token: '',
          paidUntil: typeof ans.paidUntil === 'number' ? ans.paidUntil : cur.paidUntil,
          id: cur.id,
          access: ans.accessToken,
          accessExp: ans.accessExpiresAt,
          refreshExp: typeof ans.refreshExpiresAt === 'number' ? ans.refreshExpiresAt : cur.refreshExp,
        };
        if (ans.volatile) row.volatile = true;
        saveBillingSession(row);
        emitBillingChange();
        return row;
      }
      const error = ans && ans.error ? ans.error : 'down';
      if (error === 'gone') {
        dropDeviceTokens(ctx, 'revoked');
        throw goneError();
      }
      if (error === 'missing') {
        // nothing to renew with: the Keystore refused it before a restart, or it was never there
        const lost = !!s.volatile;
        dropDeviceTokens(ctx, lost ? 'keystore' : 'revoked');
        throw lost ? tokenFailure(t('sources.billing.keystoreLost')) : goneError();
      }
      failedAt = Date.now();
      throw error === 'rate' ? tokenFailure(t('sources.billing.rate')) : downError();
    },
    (e) => {
      if (isTokenError(e)) throw e;
      failedAt = Date.now();
      throw downError();
    },
  );
}

/** The bearer token for the next call: renewed ahead of expiry on the app's own page. '' without a session. */
export function deviceBearer(ctx: SourceContext): Promise<string> {
  const s = billingSession();
  if (!s) return Promise.resolve('');
  if (!canRefresh(ctx)) return Promise.resolve(s.access || s.token);
  const now = Date.now();
  const lately = now - failedAt < RETRY_LATER_MS;
  if (isLegacySession(s)) {
    if (lately) return Promise.resolve(s.token);
    return refreshDeviceTokens(ctx).then((row) => row.access || row.token);
  }
  const left = (s.accessExp || 0) - now;
  if (left > REFRESH_EARLY_MS || (left > 0 && lately)) return Promise.resolve(s.access || '');
  return refreshDeviceTokens(ctx).then(
    (row) => row.access || row.token,
    (e) => {
      // an early refresh that failed on the way: the current token still works
      const cur = billingSession();
      if (cur && cur.access && (cur.accessExp || 0) > Date.now()) return cur.access;
      throw e;
    },
  );
}

export function deviceHeaders(bearer: string): { [name: string]: string } {
  const headers: { [name: string]: string } = { 'X-Device-Id': deviceId() };
  if (bearer) headers.Authorization = 'Bearer ' + bearer;
  return headers;
}

/**
 * Runs a call with the device token. A 401 token_expired / bad_token renews the pair once and repeats the call; a
 * hidden page repeats only with a token the app's page has saved meanwhile. 401 revoked forgets the binding.
 */
export function withDeviceToken(
  ctx: SourceContext,
  run: (headers: { [name: string]: string }) => Promise<HttpResponse>,
): Promise<HttpResponse> {
  return deviceBearer(ctx).then((bearer) =>
    run(deviceHeaders(bearer)).then((res) => {
      if (res.status !== 401 || !bearer) return res;
      const code = errorOf(res.text);
      if (code === 'revoked') {
        if (billingSession()) dropDeviceTokens(ctx, 'revoked');
        return res;
      }
      if (code !== 'token_expired' && code !== 'bad_token' && code !== 'legacy_disabled') return res;
      const s = billingSession();
      if (!s) return res;
      if (!canRefresh(ctx)) {
        const next = s.access || s.token;
        return next && next !== bearer ? run(deviceHeaders(next)) : res;
      }
      // an unknown legacy token is not ours to renew; a pair session never gets legacy_disabled
      if (isLegacySession(s) ? code === 'bad_token' : code === 'legacy_disabled') return res;
      return refreshDeviceTokens(ctx).then(
        (row) => {
          const next = row.access || row.token;
          return next && next !== bearer ? run(deviceHeaders(next)) : res;
        },
        (e) => {
          if (!billingSession()) return res;
          throw e;
        },
      );
    }),
  );
}

function needsWork(s: BillingSession, now: number): boolean {
  return isLegacySession(s) || (s.accessExp || 0) - now <= REFRESH_EARLY_MS;
}

/**
 * The app's own page: allows token rotation and keeps the access token fresh (at start, when the app comes back to
 * the foreground and every 30 minutes), so the hidden pages always find a working one. Moves a legacy session once.
 */
export function startBillingKeepAlive(ctxOf: () => SourceContext, opts?: { keystore?: boolean }): () => void {
  refresher = true;
  keystoreOnly = !opts || opts.keystore !== false;
  const tick = () => {
    const s = billingSession();
    if (!s) return;
    const ctx = ctxOf();
    const renew = () => {
      if (needsWork(s, Date.now())) deviceBearer(ctx).then(undefined, () => undefined);
    };
    const native = ctx.billing;
    // the refresh token was in memory only and the app restarted: ask for the code now, saying why
    if (native && native.status && s.volatile) {
      native.status().then(
        (st) => {
          const cur = billingSession();
          if (!st.present && cur && sessionKey(cur) === sessionKey(s)) dropDeviceTokens(ctx, 'keystore');
          else renew();
        },
        () => undefined,
      );
      return;
    }
    if (!native && lostOnRestart(ctx, s)) {
      dropDeviceTokens(ctx, 'keystore');
      return;
    }
    renew();
  };
  tick();
  const timer = setInterval(tick, KEEP_ALIVE_MS);
  const onVisible = () => {
    if (document.visibilityState === 'visible') tick();
  };
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
