/**
 * Billing state shape and its normalization (every read runs the one-time migrations). Used by the Postgres
 * store (db/pg/store.mjs) and the logic; no storage code here.
 */
import {
  BASE_DEVICES_DEFAULT,
  DEVICE_BASE,
  enrichActors,
  GRACE_DAYS_DEFAULT,
  migrateDeviceBase,
  migrateExtraSlots,
  migrateLimitModel,
  migrateRowIds,
  migrateTruncatedIps,
} from './logic.mjs';

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
      /** Telegram notices to adminTelegramIds: payment, payment error, service down, support. */
      adminNotify: true,
      yoomoneyWallet: '',
      yoomoneySecret: '',
      jackettUrl: '',
      jackettApiKey: '',
      /** When false, /v1/search for Jackett returns disabled for subscribers. */
      jackettEnabled: true,
      jacredUrl: '',
      jacredApiKey: '',
      jacredEnabled: true,
      /** Optional Torznab indexer. Off until an admin sets the URL and the switch. */
      bitmagnetUrl: '',
      bitmagnetApiKey: '',
      bitmagnetEnabled: false,
      /**
       * Popular-release cache nodes. Off until an admin turns it on.
       * prefix is megabytes, or a percent when megabytes are 0.
       */
      cacheNodesEnabled: false,
      /**
       * Community ranking of search results. On by default.
       * With no playback samples the feed order is unchanged. Pins, bans and learned scores apply when present.
       */
      watchRankEnabled: true,
      cachePrefixMb: 512,
      cachePrefixPercent: 0,
      /** Internal docker URL of VPS TorrServer (ops health only, never sent to phones). */
      torrserverUrl: '',
      /** Shared basic-auth for Jackett and JacRed when they sit behind the panel proxy. */
      indexerUser: '',
      indexerPass: '',
      smtpHost: '',
      smtpPort: 587,
      smtpUser: '',
      smtpPass: '',
      smtpFrom: '',
      priceRub: 0,
      periodDays: 30,
      /** Monthly price of one extra device slot; renewed together with the subscription. */
      extraDeviceRub: 0,
      /** Telegram Stars. Off until an admin turns it on. Prices are whole stars, with no fee on top. */
      starsEnabled: false,
      starsPrice: 0,
      starsExtra: 0,
      /** Crypto Pay (@CryptoBot). Off until an admin turns it on. Tokens are env secrets, not stored here. */
      cryptoEnabled: false,
      cryptoTestnet: false,
      /** When true, crypto is offered only when the country code is present and is not RU. */
      cryptoNonRu: false,
      cryptoUsdt: 0,
      cryptoExtraUsdt: 0,
      cryptoRateUsdt: 0,
      cryptoTon: 0,
      cryptoExtraTon: 0,
      cryptoRateTon: 0,
      cryptoBtc: 0,
      cryptoExtraBtc: 0,
      cryptoRateBtc: 0,
      cryptoPayToken: '',
      /** CRYPTO_PAY_TESTNET_TOKEN. Empty while cryptoTestnet is on means crypto stays disabled. */
      cryptoPayTestnetToken: '',
      /**
       * Donations. Off until an admin turns the flag on. A donation does not extend a subscription.
       * Method switches are separate from the subscription switches and also start off.
       */
      donate: {
        enabled: false,
        amounts: '100,300,500,1000',
        minRub: 50,
        maxRub: 100000,
        commentMax: 200,
        thanksText: 'Спасибо! Вы поддержали проект OMP.',
        yoomoney: false,
        stars: false,
        crypto: false,
        rubPerStar: 0,
        notifyAll: false,
        notifyMin: 0,
        showAmounts: false,
      },
      /** Devices every subscription includes (1-20) unless an admin set an individual limit (limitOverride). */
      baseDevices: BASE_DEVICES_DEFAULT,
      /** Days of access after paidUntil (search keeps working, the bot says «льготный период»). */
      graceDays: GRACE_DAYS_DEFAULT,
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
    /** Pending Telegram logins for the admin web panel. */
    adminLogins: [],
    /** One-time shell login links. Only the token hash is stored. */
    adminCliLogins: [],
    /** User ↔ admin support thread. */
    supportMessages: [],
    /** adminChatId:messageId → user telegram id, so a reply in Telegram reaches that user. */
    supportReplies: [],
    /** telegramId → ms when the admin closed the thread. A later user message reopens it. */
    supportClosed: {},
    /** Admin panel action log. */
    audit: [],
    outbox: [],
    /** Quoted YooMoney checkouts. The label is buy:<id>; the price is the one quoted, not a later settings change. */
    purchases: [],
    /** Donation quotes and settled gifts. Label don:<id>. Not a subscription payment. */
    donations: [],
    /**
     * Data-shape markers. deviceBase: devices included in a base subscription when deviceLimit was stored.
     * extraMonthly: extra devices are monthly slots (extraSlots/extraUntil), not part of deviceLimit.
     * limitModel: the limit is settings.baseDevices (or limitOverride) + bonusSlots + extra slots.
     * rowIds: every row has a stable `id` (payments, attempts, webhooks, audit, swaps, promo uses, …).
     */
    meta: { deviceBase: DEVICE_BASE, extraMonthly: 1, limitModel: 1, rowIds: 1 },
  };
}

export function normalizeState(parsed) {
  const base = emptyState();
  if (!parsed || typeof parsed !== 'object') return migrateRowIds(migrateTruncatedIps(migrateExtraSlots(migrateDeviceBase(enrichActors(base)))));
  const next = {
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
    adminLogins: Array.isArray(parsed.adminLogins) ? parsed.adminLogins : [],
    adminCliLogins: Array.isArray(parsed.adminCliLogins) ? parsed.adminCliLogins : [],
    supportMessages: Array.isArray(parsed.supportMessages) ? parsed.supportMessages : [],
    supportReplies: Array.isArray(parsed.supportReplies) ? parsed.supportReplies : [],
    supportClosed:
      parsed.supportClosed && typeof parsed.supportClosed === 'object' && !Array.isArray(parsed.supportClosed)
        ? parsed.supportClosed
        : {},
    audit: Array.isArray(parsed.audit) ? parsed.audit : [],
    outbox: Array.isArray(parsed.outbox) ? parsed.outbox : [],
    purchases: Array.isArray(parsed.purchases) ? parsed.purchases : [],
    donations: Array.isArray(parsed.donations) ? parsed.donations : [],
    // A snapshot without meta predates DEVICE_BASE: its limits were counted from 1.
    meta: parsed.meta && typeof parsed.meta === 'object' && !Array.isArray(parsed.meta) ? parsed.meta : {},
  };
  const keys = Object.keys(parsed);
  for (let i = 0; i < keys.length; i++) {
    if (!Object.prototype.hasOwnProperty.call(next, keys[i])) next[keys[i]] = parsed[keys[i]];
  }
  return migrateRowIds(migrateTruncatedIps(migrateLimitModel(migrateExtraSlots(migrateDeviceBase(enrichActors(next))))));
}
