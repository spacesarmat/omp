/**
 * Subscription server. The Jackett address and API key stay there.
 * Local NAS test: http://IP-NAS:8787 (same Wi‑Fi as the phone).
 * Public release: https://… on the VPS / tunnel.
 */
export const BILLING_ORIGIN = 'http://192.168.1.191:8787';

/** Telegram bot for buying and managing the subscription. */
export const BILLING_BOT = 'OMPBILLINGBOT';
export const BILLING_BOT_URL = 'https://t.me/' + BILLING_BOT;
