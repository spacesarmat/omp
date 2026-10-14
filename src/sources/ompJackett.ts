// Paid Jackett on the OMP server. The phone sends a subscription code once; the server binds it to this
// install and proxies Torznab. The Jackett address and API key never reach the phone or the TV.
import { stashFile } from '../api/torrentFiles';
import { BILLING_ORIGIN } from '../billing/config';
import { billingSession, deviceId, emitBillingChange, onBillingChange, saveBillingSession, type BillingSession } from '../billing/session';
import { t } from '../i18n';
import { parseTorznab } from './indexer';
import { registerSource, unregisterSource } from './registry';
import type { Source, SourceContext, SourceResult } from './types';

export const OMP_JACKETT_ID = 'omp-jackett';

interface ActivateBody {
  error?: string;
  token?: string;
  paidUntil?: number;
}

function parseBody(text: string): ActivateBody {
  try {
    return JSON.parse(text) as ActivateBody;
  } catch (e) {
    return {};
  }
}

export function clearBilling(): void {
  saveBillingSession(null);
  emitBillingChange();
}

export function activateCode(ctx: SourceContext, code: string): Promise<BillingSession> {
  return ctx.http.post(BILLING_ORIGIN + '/v1/activate', { code: code, deviceId: deviceId() }, { timeoutMs: 15000 }).then(
    (res) => {
      const body = parseBody(res.text);
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

function authHeaders(session: BillingSession): { [name: string]: string } {
  return { Authorization: 'Bearer ' + session.token, 'X-Device-Id': deviceId() };
}

function bytesOf(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 255;
  return out;
}

export function ompJackettSource(): Source {
  return {
    id: OMP_JACKETT_ID,
    name: t('sources.billing.title'),
    kind: 'billing',
    search(query: string, ctx: SourceContext): Promise<SourceResult[]> {
      const session = billingSession();
      if (!session) return Promise.reject(new Error(t('sources.billing.badCode')));
      return ctx.http.post(BILLING_ORIGIN + '/v1/search', { q: query }, { headers: authHeaders(session), timeoutMs: 20000 }).then(
        (res) => {
          if (res.status === 403) throw new Error(t('sources.billing.expired'));
          if (res.status < 200 || res.status >= 300) throw new Error(t('sources.billing.down'));
          return parseTorznab(res.text, OMP_JACKETT_ID);
        },
        () => {
          throw new Error(t('sources.billing.down'));
        },
      );
    },
    resolve(r: SourceResult, ctx: SourceContext): Promise<string> {
      const session = billingSession();
      const link = r.Link || '';
      if (!session || link.indexOf('omp-fetch:') !== 0) return Promise.reject(new Error(t('sources.billing.down')));
      return ctx.http
        .post(BILLING_ORIGIN + '/v1/torrent', { link: link }, { headers: authHeaders(session), timeoutMs: 30000, responseCharset: 'iso-8859-1' })
        .then(
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

let watching = false;

export function syncOmpJackett(): void {
  unregisterSource(OMP_JACKETT_ID);
  if (billingSession()) registerSource(ompJackettSource());
}

export function startOmpJackett(): void {
  syncOmpJackett();
  if (watching) return;
  watching = true;
  onBillingChange(syncOmpJackett);
}
