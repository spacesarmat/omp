/**
 * Subscription server. The Jackett address and API key stay there.
 *
 * Public only: Caddy on the VPS, Cloudflare proxied (Full strict) → https://billing.omp-player.online.
 * The old LAN fallback (http://NAS:8787) is gone: services are reached by domain only.
 */

export const BILLING_ORIGIN_PUBLIC = 'https://billing.omp-player.online';

/** Canonical public origin (bot /go links, production). */
export const BILLING_ORIGIN = BILLING_ORIGIN_PUBLIC;

/** Telegram bot for buying and managing the subscription. */
export const BILLING_BOT = 'OMPBILLINGBOT';
export const BILLING_BOT_URL = 'https://t.me/' + BILLING_BOT;
