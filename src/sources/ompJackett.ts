// Paid Jackett and JacRed. A subscription code unlocks them. Their addresses and API keys are built in.
import { stashFile } from '../api/torrentFiles';
import { OMP_JACRED, OMP_JACKETT, indexerAuthHeader } from '../billing/indexers';
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
import { parseTorznab } from './indexer';
import { registerSource, unregisterSource } from './registry';
import type { Source, SourceContext, SourceResult } from './types';

export const OMP_JACKETT_ID = 'omp-jackett';
export const OMP_JACRED_ID = 'omp-jacred';

interface BuiltIndexer {
  url: string;
  apiKey: string;
}

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
  deviceLimit?: number;
}

function parseBody<T extends object>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    return {} as T;
  }
}

export function clearBilling(): void {
  saveBillingSession(null);
  emitBillingChange();
}

export function activateCode(ctx: SourceContext, code: string): Promise<BillingSession> {
  return billingPost(ctx, '/v1/activate', { code: code, deviceId: deviceId() }, { timeoutMs: 15000 }).then(
    (res) => {
      const body = parseBody<ActivateBody>(res.text);
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
  const headers: { [name: string]: string } = { 'X-Device-Id': deviceId() };
  if (session) headers.Authorization = 'Bearer ' + session.token;
  return billingGet(ctx, '/v1/me', { headers, timeoutMs: 12000 }).then(
    (res) => {
      if (res.status === 403 || res.status === 401) {
        if (session) clearBilling();
        return null;
      }
      if (res.status === 404) return null;
      const body = parseBody<MeBody>(res.text);
      if (res.status < 200 || res.status >= 300) return null;
      const paidUntil = body.paidUntil || 0;
      // Admin/bot may extend paidUntil; keep local session date in sync with the server.
      if (session && typeof paidUntil === 'number' && paidUntil !== session.paidUntil) {
        saveBillingSession({ token: session.token, paidUntil });
        emitBillingChange();
      }
      return {
        telegramId: body.telegramId || '',
        paidUntil,
        active: !!body.active,
        deviceLimit: body.deviceLimit || 0,
      };
    },
    () => null,
  );
}

function bytesOf(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 255;
  return out;
}

function searchUrl(indexer: BuiltIndexer, query: string): string {
  return (
    indexer.url +
    '/api/v2.0/indexers/all/results/torznab/api?apikey=' +
    encodeURIComponent(indexer.apiKey) +
    '&t=search&q=' +
    encodeURIComponent(query)
  );
}

function downloadUrl(indexer: BuiltIndexer, link: string): string {
  return link + (link.indexOf('?') < 0 ? '?' : '&') + 'apikey=' + encodeURIComponent(indexer.apiKey);
}

function paidSource(id: string, name: string, indexer: BuiltIndexer): Source {
  return {
    id: id,
    name: name,
    kind: 'billing',
    search(query: string, ctx: SourceContext): Promise<SourceResult[]> {
      if (!billingSession()) return Promise.reject(new Error(t('sources.billing.badCode')));
      return ctx.http.get(searchUrl(indexer, query), { headers: { Authorization: indexerAuthHeader() }, timeoutMs: 25000 }).then(
        (res) => {
          if (res.status === 401 || res.status === 403) throw new Error(t('sources.billing.expired'));
          if (res.status < 200 || res.status >= 300) throw new Error(t('sources.billing.down'));
          return parseTorznab(res.text, id);
        },
        () => {
          throw new Error(t('sources.billing.down'));
        },
      );
    },
    resolve(r: SourceResult, ctx: SourceContext): Promise<string> {
      const link = r.Link || '';
      if (!billingSession() || link.indexOf(indexer.url) !== 0) return Promise.reject(new Error(t('sources.billing.down')));
      return ctx.http.get(downloadUrl(indexer, link), {
        headers: { Authorization: indexerAuthHeader() },
        timeoutMs: 30000,
        responseCharset: 'iso-8859-1',
      }).then(
        (res) => {
          if (res.status < 200 || res.status >= 300 || res.text.charAt(0) !== 'd') throw new Error(t('sources.billing.down'));
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
  return paidSource(OMP_JACKETT_ID, t('sources.billing.jackett'), OMP_JACKETT);
}

export function ompJacredSource(): Source {
  return paidSource(OMP_JACRED_ID, t('sources.billing.jacred'), OMP_JACRED);
}

let watching = false;

export function syncOmpJackett(): void {
  unregisterSource(OMP_JACKETT_ID);
  unregisterSource(OMP_JACRED_ID);
  if (!billingSession()) return;
  registerSource(ompJackettSource());
  registerSource(ompJacredSource());
}

export function startOmpJackett(): void {
  syncOmpJackett();
  if (watching) return;
  watching = true;
  onBillingChange(syncOmpJackett);
}
