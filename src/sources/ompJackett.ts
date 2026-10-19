// Paid Jackett and JacRed via the billing proxy. A subscription unlocks them; keys never leave the VPS.
import { stashFile } from '../api/torrentFiles';
import type { OmpIndexerSource } from '../billing/indexers';
import { billingGet, billingPost } from '../billing/client';
import {
  billingSession,
  deviceId,
  emitBillingChange,
  onBillingChange,
  saveBillingSession,
  type BillingAccount,
  type BillingSession,
} from '../billing/session';
import { t } from '../i18n';
import { audiobookSearch, parseTorznab } from './indexer';
import { registerSource, unregisterSource } from './registry';
import type { Source, SourceContext, SourceResult } from './types';

export const OMP_JACKETT_ID = 'omp-jackett';
export const OMP_JACRED_ID = 'omp-jacred';

interface ActivateBody {
  error?: string;
  token?: string;
  paidUntil?: number;
}

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

function authHeaders(): { [name: string]: string } {
  const session = billingSession();
  const headers: { [name: string]: string } = { 'X-Device-Id': deviceId() };
  if (session) headers.Authorization = 'Bearer ' + session.token;
  return headers;
}

function billingError(status: number, text: string): Error {
  const body = parseBody<ErrorBody>(text);
  if (body.error === 'disabled') return new Error(t('sources.billing.disabled'));
  if (body.error === 'rate' || status === 429) return new Error(t('sources.billing.rate'));
  if (body.error === 'device_limit') return new Error(t('sources.billing.overLimit'));
  if (body.error === 'expired' || status === 401 || status === 403) return new Error(t('sources.billing.expired'));
  return new Error(t('sources.billing.down'));
}

export function clearBilling(): void {
  saveBillingSession(null);
  emitBillingChange();
}

export function activateCode(ctx: SourceContext, code: string): Promise<BillingSession> {
  return billingPost(ctx, '/v1/activate', { code: code, deviceId: deviceId() }, { timeoutMs: 15000 }).then(
    (res) => {
      const body = parseBody<ActivateBody>(res.text);
      if (body.error === 'device_limit') throw new Error(t('sources.billing.deviceLimit'));
      if (res.status === 409 || body.error === 'other_device') throw new Error(t('sources.billing.otherDevice'));
      if (body.error === 'expired') throw new Error(t('sources.billing.expired'));
      if (!body.token) throw new Error(t('sources.billing.badCode'));
      const row = { token: body.token, paidUntil: body.paidUntil || 0 };
      saveBillingSession(row);
      emitBillingChange();
      return row;
    },
    () => {
      throw new Error(t('sources.billing.down'));
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
    () => {
      throw new Error(t('sources.billing.down'));
    },
  );
}

/** Unlinks this install from the Telegram account on the billing server. */
export function clearTelegramLink(ctx: SourceContext): Promise<void> {
  return billingPost(ctx, '/v1/link/clear', { deviceId: deviceId() }, {
    headers: { 'X-Device-Id': deviceId() },
    timeoutMs: 12000,
  }).then(
    (res) => {
      if (res.status === 404) return;
      if (res.status < 200 || res.status >= 300) throw new Error(t('sources.billing.down'));
    },
    () => {
      throw new Error(t('sources.billing.down'));
    },
  );
}

export function fetchBillingAccount(ctx: SourceContext): Promise<BillingAccount | null> {
  const session = billingSession();
  return billingGet(ctx, '/v1/me', { headers: authHeaders(), timeoutMs: 12000 }).then(
    (res) => {
      if (res.status === 403 || res.status === 401) {
        if (session) clearBilling();
        return null;
      }
      if (res.status === 404) return null;
      if (res.status < 200 || res.status >= 300) throw new Error(t('sources.billing.down'));
      const body = parseBody<MeBody>(res.text);
      const paidUntil = body.paidUntil || 0;
      // Admin/bot may extend paidUntil; keep local session date in sync with the server.
      if (session && typeof paidUntil === 'number' && paidUntil !== session.paidUntil) {
        saveBillingSession({ token: session.token, paidUntil });
        emitBillingChange();
      }
      const sources = {
        jackett: !!body.sources?.jackett,
        jacred: !!body.sources?.jacred,
      };
      // When /v1/me omits sources (old server), keep both on while the subscription is active.
      const hasSources = !!body.sources;
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
    () => {
      throw new Error(t('sources.billing.down'));
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
  return billingPost(ctx, '/v1/search', body, { headers: authHeaders(), timeoutMs: 25000 }).then(
    (res) => {
      const type = (res.text || '').trim();
      if (res.status === 429) throw billingError(res.status, res.text);
      if (res.status === 401 || res.status === 403 || res.status === 502) throw billingError(res.status, res.text);
      if (res.status < 200 || res.status >= 300) throw new Error(t('sources.billing.down'));
      if (type.charAt(0) === '{') throw billingError(res.status, res.text);
      return parseTorznab(res.text, id);
    },
    () => {
      throw new Error(t('sources.billing.down'));
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
      return billingPost(
        ctx,
        '/v1/torrent',
        { link, deviceId: deviceId() },
        { headers: authHeaders(), timeoutMs: 30000, responseCharset: 'iso-8859-1' },
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
        () => {
          throw new Error(t('sources.billing.down'));
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
