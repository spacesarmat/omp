/**
 * Subscription server. The Jackett address and API key stay there.
 *
 * Public: Caddy on the VPS, Cloudflare proxied (Full strict) → https://billing.omp-player.online
 * LAN fallback: http://NAS:8787 on the same Wi‑Fi.
 */
import { loadJson, saveJson } from '../store/storage';

export const BILLING_ORIGIN_PUBLIC = 'https://billing.omp-player.online';
export const BILLING_ORIGIN_LAN = 'http://192.168.1.191:8787';

/** Canonical public origin (bot /go links, production). */
export const BILLING_ORIGIN = BILLING_ORIGIN_PUBLIC;

const ORIGIN_PREF_KEY = 'tsp.billingOrigin';

function isKnownOrigin(v: string): boolean {
  return v === BILLING_ORIGIN_PUBLIC || v === BILLING_ORIGIN_LAN;
}

/** Origins to try: last successful first, then the other. */
export function billingOrigins(): string[] {
  const last = loadJson<string>(ORIGIN_PREF_KEY, '', (v) => typeof v === 'string' && isKnownOrigin(v));
  if (last === BILLING_ORIGIN_LAN) return [BILLING_ORIGIN_LAN, BILLING_ORIGIN_PUBLIC];
  return [BILLING_ORIGIN_PUBLIC, BILLING_ORIGIN_LAN];
}

export function rememberBillingOrigin(origin: string): void {
  if (!isKnownOrigin(origin)) return;
  saveJson(ORIGIN_PREF_KEY, origin);
}

/** Telegram bot for buying and managing the subscription. */
export const BILLING_BOT = 'OMPBILLINGBOT';
export const BILLING_BOT_URL = 'https://t.me/' + BILLING_BOT;
