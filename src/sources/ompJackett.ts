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
  type BillingAccount,
  type BillingSession,
} from '../billing/session';
import { saveBillingAccess } from '../billing/entitlement';
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
  saveSeenAccount(null);
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

export function fetchBillingAccount(ctx: SourceContext): Promise<BillingAccount | null> {
  return withDeviceToken(ctx, (headers) => billingGet(ctx, '/v1/me', { headers, timeoutMs: 12000 })).then(
    (res) => {
      const session = billingSession();
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
      saveSeenAccount({ paidUntil });
      // Admin/bot may extend paidUntil; keep local session date in sync with the server.
      if (session && typeof paidUntil === 'number' && paidUntil !== session.paidUntil) {
        saveBillingSession({ ...session, paidUntil });
        emitBillingChange();
      }
      const sources = {
        jackett: !!body.sources?.jackett,
        jacred: !!body.sources?.jacred,
      };
      // When /v1/me omits sources (old server), keep both on while the subscription is active.
      const hasSources = !!body.sources;
      // the monitoring limit (src/monitor/limit.ts) reads this in the background page too
      if (session) saveBillingAccess({ active: !!body.active, accessUntil: body.accessUntil || 0 });
      return {
        telegramId: body.telegramId || '',
        paidUntil,
        active: !!body.active,
        inGrace: !!body.inGrace,
        accessUntil: body.accessUntil || 0,
        overLimit: !!body.overLimit,
        deviceLimit: body.deviceLimit || 0,
        sources: hasSources
          ? sources
          : { jackett: !!body.active, jacred: !!body.active },
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

function paidSearch(ctx: SourceContext, id: string, source: OmpIndexerSource, query: string, cat?: string): Promise<SourceResult[]> {
  const body: { [key: string]: string } = { source, q: query, deviceId: deviceId() };
  if (cat) body.cat = cat;
  return withDeviceToken(ctx, (headers) => billingPost(ctx, '/v1/search', body, { headers, timeoutMs: 25000 })).then(
    (res) => {
      const type = (res.text || '').trim();
      if (res.status === 429) throw billingError(res.status, res.text);
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
      return withDeviceToken(ctx, (headers) =>
        billingPost(ctx, '/v1/torrent', { link, deviceId: deviceId() }, { headers, timeoutMs: 30000, responseCharset: 'iso-8859-1' }),
      ).then(
        (res) => {
          const upstream = parseBody<ErrorBody>(res.text);
          // Billing maps a Jackett/JacRed 401/403 on the file itself to 502 upstream, so this is not an expired session.
          if (res.status === 502 && upstream.error === 'upstream') {
            throw new Error(t('torrent.better.failLink', { site: name }));
          }
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
/** Last known server flags; until /v1/me runs, register both when a session exists. */
let lastSources: { jackett: boolean; jacred: boolean } | null = null;

export function syncOmpJackett(sources?: { jackett: boolean; jacred: boolean } | null): void {
  unregisterSource(OMP_JACKETT_ID);
  unregisterSource(OMP_JACRED_ID);
  if (!billingSession()) {
    lastSources = null;
    return;
  }
  if (sources) lastSources = sources;
  const flags = lastSources || { jackett: true, jacred: true };
  if (flags.jackett) registerSource(ompJackettSource());
  if (flags.jacred) registerSource(ompJacredSource());
}

export function startOmpJackett(): void {
  syncOmpJackett();
  if (watching) return;
  watching = true;
  onBillingChange(() => syncOmpJackett());
}

/** Refresh enabled sources from /v1/me (call when the Sources screen opens). */
export function refreshOmpJackettSources(ctx: SourceContext): Promise<void> {
  return fetchBillingAccount(ctx).then(
    (acc) => {
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
