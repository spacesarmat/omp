// Paid Jackett and JacRed via the billing proxy. A subscription unlocks them; keys never leave the VPS.
import { stashFile } from '../api/torrentFiles';
import type { OmpIndexerSource } from '../billing/indexers';
import { billingGet, billingPost } from '../billing/client';
import {
  billingSession,
  deviceId,
  emitBillingChange,
  isLegacySession,
  onBillingChange,
  saveBillingSession,
  saveSeenAccount,
  sessionKey,
  type BillingAccount,
  type BillingSession,
} from '../billing/session';
import { freshPremiumSources, MONITOR_FREE_MAX, ompSubscribed, sameLogin, saveBillingAccess } from '../billing/entitlement';
import { deviceNameField, dropDeviceTokens, errorOf, isTokenError, pairOf, savePair, withDeviceToken } from '../billing/tokens';
import { t } from '../i18n';
import { audiobookSearch, parseTorznab } from './indexer';
import { registerSource, unregisterSource } from './registry';
import type { Source, SourceContext, SourceResult } from './types';

export const OMP_JACKETT_ID = 'omp-jackett';
export const OMP_JACRED_ID = 'omp-jacred';

interface LinkStartBody {
  error?: string;
  deepLink?: string;
  expiresAt?: number;
}

interface MeBody {
  error?: string;
  telegramId?: string;
  paidUntil?: number;
  active?: boolean;
  inGrace?: boolean;
  accessUntil?: number;
  overLimit?: boolean;
  deviceLimit?: number;
  sources?: { jackett?: boolean; jacred?: boolean };
  /** 0: no monitoring cap. Omitted by a server from before this field. */
  monitorMax?: number;
}

interface ErrorBody {
  error?: string;
}

function parseBody<T extends object>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    return {} as T;
  }
}

/** Device token errors (401): the access token ran out on a hidden page, the binding is gone, the old token is off. */
function tokenError(code: string): Error | null {
  if (code === 'token_expired') return new Error(t('sources.billing.reopen'));
  if (code === 'revoked' || code === 'refresh_expired' || code === 'bad_token' || code === 'upgraded') {
    return new Error(t('sources.billing.revoked'));
  }
  if (code === 'legacy_disabled') return new Error(t('sources.billing.legacyDisabled'));
  if (code === 'app_update_required') return new Error(t('sources.billing.appUpdate'));
  return null;
}

/** A failed call: the token module's own message («устройство отключено», …) or «сервер не отвечает». */
function failure(e: unknown): Error {
  return isTokenError(e) ? e : new Error(t('sources.billing.down'));
}

function billingError(status: number, text: string): Error {
  const body = parseBody<ErrorBody>(text);
  const token = tokenError(body.error || '');
  if (token) return token;
  if (body.error === 'disabled') return new Error(t('sources.billing.disabled'));
  if (body.error === 'extra_expired') return new Error(t('sources.billing.extraExpired'));
  if (body.error === 'rate' || status === 429) return new Error(t('sources.billing.rate'));
  if (body.error === 'device_limit') return new Error(t('sources.billing.overLimit'));
  if (body.error === 'expired' || status === 401 || status === 403) return new Error(t('sources.billing.expired'));
  return new Error(t('sources.billing.down'));
}

/** «Отключить» on this phone: forgets the tokens (the Keystore copy too, when `ctx` can write it). */
export function clearBilling(ctx?: SourceContext): void {
  dropDeviceTokens(ctx || null, '');
}

/** What a refused code means. The error code decides; a bare 409 is the old «другое устройство». */
function activateError(status: number, code: string): Error {
  if (code === 'device_limit') return new Error(t('sources.billing.deviceLimit'));
  if (code === 'extra_expired') return new Error(t('sources.billing.extraExpired'));
  if (code === 'other_device') return new Error(t('sources.billing.otherDevice'));
  if (code === 'expired') return new Error(t('sources.billing.expired'));
  if (code === 'app_update_required') return new Error(t('sources.billing.appUpdate'));
  if (code === 'rate' || status === 429) return new Error(t('sources.billing.rate'));
  if (code === 'revoked') return new Error(t('sources.billing.revoked'));
  if (status === 409) return new Error(t('sources.billing.otherDevice'));
  if (status >= 500) return new Error(t('sources.billing.down'));
  return new Error(t('sources.billing.badCode'));
}

/** Binds a code to this phone and keeps the device token pair (refresh in the Keystore). */
export function activateCode(ctx: SourceContext, code: string): Promise<BillingSession> {
  return deviceNameField(ctx)
    .then((named) => billingPost(ctx, '/v1/activate', { code: code, deviceId: deviceId(), tokens: 'pair', ...named }, { timeoutMs: 15000 }))
    .then(
    (res) => {
      const pair = res.status >= 200 && res.status < 300 ? pairOf(res.text) : null;
      if (!pair) throw activateError(res.status, errorOf(res.text));
      return savePair(ctx, pair, null);
    },
    (e) => {
      throw failure(e);
    },
  );
}

/** Opens Telegram with a one-time link token so the bot can bind this install. */
export function startTelegramLink(ctx: SourceContext): Promise<string> {
  return billingPost(ctx, '/v1/link/start', { deviceId: deviceId() }, { timeoutMs: 15000 }).then(
    (res) => {
      const body = parseBody<LinkStartBody>(res.text);
      if (!body.deepLink) throw new Error(t('sources.billing.down'));
      return body.deepLink;
    },
    (e) => {
      throw failure(e);
    },
  );
}

/**
 * Unlinks this install from the Telegram account on the billing server. Sends the device token when there is a
 * session (ready for BILLING_LINK_CLEAR_REQUIRE_TOKEN=1); a phone linked to Telegram without a code has none.
 */
export function clearTelegramLink(ctx: SourceContext): Promise<void> {
  return withDeviceToken(ctx, (headers) => billingPost(ctx, '/v1/link/clear', { deviceId: deviceId() }, { headers, timeoutMs: 12000 })).then(
    (res) => {
      if (res.status === 404) return;
      if (res.status === 401) throw billingError(res.status, res.text);
      if (res.status < 200 || res.status >= 300) throw new Error(t('sources.billing.down'));
    },
    (e) => {
      throw failure(e);
    },
  );
}

/** The binding a request started with ('' without a session): an answer for an older binding is not cached. */
function bindingKey(): string {
  const row = billingSession();
  return row ? sessionKey(row) : '';
}

export function fetchBillingAccount(ctx: SourceContext): Promise<BillingAccount | null> {
  const startedFor = bindingKey();
  return withDeviceToken(ctx, (headers) => billingGet(ctx, '/v1/me', { headers, timeoutMs: 12000 })).then(
    (res) => {
      const session = billingSession();
      // «Отключить» (or a new code) while this request was in flight: its answer must not bring the old account back
      const current = sameLogin(startedFor, bindingKey());
      if (res.status === 401) {
        // revoked: withDeviceToken already forgot the binding; an expired token on a hidden page is not an answer
        const err = tokenError(errorOf(res.text));
        if (session && err) throw err;
        if (session) clearBilling(ctx);
        saveSeenAccount(null);
        return null;
      }
      if (res.status === 403) {
        // an unknown token of an app before PR-5 (the old answer); a token pair never gets 403 here
        if (session && isLegacySession(session)) clearBilling(ctx);
        saveSeenAccount(null);
        return null;
      }
      if (res.status === 404) {
        saveSeenAccount(null);
        return null;
      }
      if (res.status < 200 || res.status >= 300) throw new Error(t('sources.billing.down'));
      const body = parseBody<MeBody>(res.text);
      const paidUntil = body.paidUntil || 0;
      // An answer for a binding that is already gone must not rewrite the session that replaced it.
      // sameLogin still counts the one-time move off a legacy token as this same request.
      if (!current) {
        return {
          telegramId: body.telegramId || '',
          paidUntil,
          active: !!body.active,
          inGrace: !!body.inGrace,
          accessUntil: body.accessUntil || 0,
          overLimit: !!body.overLimit,
          deviceLimit: body.deviceLimit || 0,
          sources: body.sources
            ? { jackett: !!body.sources.jackett, jacred: !!body.sources.jacred }
            : { jackett: !!body.active, jacred: !!body.active },
        };
      }
      saveSeenAccount({ paidUntil });
      const listed = body.sources;
      const flags = listed
        ? { jackett: !!listed.jackett, jacred: !!listed.jacred }
        : { jackett: !!body.active, jacred: !!body.active };
      // the monitoring limit (src/monitor/limit.ts) reads this in the background page too
      let changed = false;
      if (session && typeof paidUntil === 'number' && paidUntil !== session.paidUntil) {
        saveBillingSession({ ...session, paidUntil });
        changed = true;
      }
      if (session) {
        let cap = body.active ? 0 : MONITOR_FREE_MAX;
        if (typeof body.monitorMax === 'number' && isFinite(body.monitorMax) && body.monitorMax >= 0) cap = Math.floor(body.monitorMax);
        saveBillingAccess({
          active: !!body.active,
          accessUntil: body.accessUntil || 0,
          jackett: flags.jackett,
          jacred: flags.jacred,
          monitorMax: cap,
        });
        changed = true;
        // A denial cleared both sources. This answer is the same binding, so put back what the server allows.
        syncOmpJackett(body.active ? flags : { jackett: false, jacred: false });
      }
      if (changed) emitBillingChange();
      return {
        telegramId: body.telegramId || '',
        paidUntil,
        active: !!body.active,
        inGrace: !!body.inGrace,
        accessUntil: body.accessUntil || 0,
        overLimit: !!body.overLimit,
        deviceLimit: body.deviceLimit || 0,
        sources: flags,
      };
    },
    (e) => {
      throw failure(e);
    },
  );
}

function bytesOf(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 255;
  return out;
}

function isProxyLink(link: string): boolean {
  return link.indexOf('omp-fetch:') === 0 || link.indexOf('omp-jacred:') === 0;
}

/** `{ "magnet": "magnet:..." }` from the billing proxy, when Jackett redirected the download. */
function magnetOf(text: string): string {
  if (!text || text.charAt(0) !== '{') return '';
  try {
    const v = JSON.parse(text) as { magnet?: unknown };
    return typeof v.magnet === 'string' && /^magnet:/i.test(v.magnet) ? v.magnet : '';
  } catch (e) {
    return '';
  }
}

/**
 * A 403 that means this device has no subscription access. Ads and the monitoring cap read the cached
 * flag, so the denial has to clear it now instead of waiting for the next /v1/me. `disabled` is an
 * indexer switch, not an ended subscription, and a 502 is the indexer, not the account.
 */
function noteAccessDenied(status: number, text: string, startedFor: string): void {
  // The search started on another code (or after «Отключить»): do not clear the binding that is current now.
  if (status !== 403 || !sameLogin(startedFor, bindingKey())) return;
  const code = errorOf(text);
  if (code !== 'expired' && code !== 'device_limit' && code !== 'extra_expired') return;
  saveBillingAccess({ active: false, accessUntil: 0 });
  syncOmpJackett({ jackett: false, jacred: false });
  emitBillingChange();
}

function paidSearch(ctx: SourceContext, id: string, source: OmpIndexerSource, query: string, cat?: string): Promise<SourceResult[]> {
  const startedFor = bindingKey();
  const body: { [key: string]: string } = { source, q: query, deviceId: deviceId() };
  if (cat) body.cat = cat;
  return withDeviceToken(ctx, (headers) => billingPost(ctx, '/v1/search', body, { headers, timeoutMs: 25000 })).then(
    (res) => {
      const type = (res.text || '').trim();
      if (res.status === 429) throw billingError(res.status, res.text);
      if (res.status === 403) noteAccessDenied(res.status, res.text, startedFor);
      if (res.status === 401 || res.status === 403 || res.status === 502) throw billingError(res.status, res.text);
      if (res.status < 200 || res.status >= 300) throw new Error(t('sources.billing.down'));
      if (type.charAt(0) === '{') throw billingError(res.status, res.text);
      return parseTorznab(res.text, id);
    },
    (e) => {
      throw failure(e);
    },
  );
}

function paidSource(id: string, name: string, source: OmpIndexerSource): Source {
  return {
    id: id,
    name: name,
    kind: 'billing',
    search(query: string, ctx: SourceContext): Promise<SourceResult[]> {
      if (!billingSession()) return Promise.reject(new Error(t('sources.billing.badCode')));
      const load = (cat?: string) => paidSearch(ctx, id, source, query, cat);
      // The proxy used to drop `cat`. Audiobook mode sends 3030 and an open search; the server forwards cat.
      if (ctx.searchMode === 'audiobook') return audiobookSearch(load);
      return load();
    },
    resolve(r: SourceResult, ctx: SourceContext): Promise<string> {
      const link = r.torrentUrl || r.Link || '';
      if (!billingSession() || !isProxyLink(link)) return Promise.reject(new Error(t('sources.billing.down')));
      const startedFor = bindingKey();
      return withDeviceToken(ctx, (headers) =>
        billingPost(ctx, '/v1/torrent', { link, deviceId: deviceId() }, { headers, timeoutMs: 30000, responseCharset: 'iso-8859-1' }),
      ).then(
        (res) => {
          const upstream = parseBody<ErrorBody>(res.text);
          // Billing maps a Jackett/JacRed 401/403 on the file itself to 502 upstream, so this is not an expired session.
          if (res.status === 502 && upstream.error === 'upstream') {
            throw new Error(t('torrent.better.failLink', { site: name }));
          }
          if (res.status === 403) noteAccessDenied(res.status, res.text, startedFor);
          if (res.status === 401 || res.status === 403 || res.status === 502 || res.status === 429) {
            throw billingError(res.status, res.text);
          }
          const magnet = magnetOf(res.text);
          if (magnet) return magnet;
          if (res.status < 200 || res.status >= 300 || res.text.charAt(0) !== 'd') {
            throw new Error(t('sources.billing.down'));
          }
          return stashFile(bytesOf(res.text));
        },
        (e) => {
          throw failure(e);
        },
      );
    },
  };
}

export function ompJackettSource(): Source {
  return paidSource(OMP_JACKETT_ID, t('sources.billing.jackett'), 'jackett');
}

export function ompJacredSource(): Source {
  return paidSource(OMP_JACRED_ID, t('sources.billing.jacred'), 'jacred');
}

let watching = false;
/**
 * Flags already applied in this process. Null until a confirmation: a cold start does not turn both sources on.
 * A /v1/me from the last PREMIUM_FRESH_MS (freshPremiumSources) fills it. While this process is open and the
 * server date is still in the future, a failed recheck keeps these flags (the search itself needs the network).
 */
let lastSources: { jackett: boolean; jacred: boolean } | null = null;

export function syncOmpJackett(sources?: { jackett: boolean; jacred: boolean } | null): void {
  unregisterSource(OMP_JACKETT_ID);
  unregisterSource(OMP_JACRED_ID);
  if (!billingSession()) {
    lastSources = null;
    return;
  }
  if (sources) lastSources = sources;
  else {
    const cached = freshPremiumSources();
    if (cached) lastSources = cached;
    else if (!ompSubscribed()) lastSources = { jackett: false, jacred: false };
  }
  const flags = lastSources;
  if (!flags) return;
  if (flags.jackett) registerSource(ompJackettSource());
  if (flags.jacred) registerSource(ompJacredSource());
}

export function startOmpJackett(): void {
  syncOmpJackett();
  if (watching) return;
  watching = true;
  onBillingChange(() => syncOmpJackett());
}

/** Refresh enabled sources from /v1/me (call when the Sources screen opens, and from the premium recheck). */
export function refreshOmpJackettSources(ctx: SourceContext): Promise<void> {
  const startedFor = bindingKey();
  return fetchBillingAccount(ctx).then(
    (acc) => {
      // The code changed while this was in flight: follow the session that is current, not this answer.
      // sameLogin still treats a legacy-token upgrade as the same login.
      if (!sameLogin(startedFor, bindingKey())) {
        syncOmpJackett();
        return;
      }
      if (!acc || !acc.active) {
        syncOmpJackett({ jackett: false, jacred: false });
        return;
      }
      syncOmpJackett(acc.sources || { jackett: true, jacred: true });
    },
    () => {
      // A timeout or 5xx is not a confirmed inactive account. Keep the last flags.
    },
  );
}
