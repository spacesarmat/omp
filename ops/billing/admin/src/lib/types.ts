import type { Flash } from '@/lib/api';

export type SupportThread = {
  telegramId: string;
  username?: string;
  name?: string;
  count: number;
  lastText: string;
  lastAt: number;
  lastDirection: string;
};

export type SupportMsg = { id: string; text: string; direction: string; at: number; via?: string };

export type SeriesPoint = { day: string; revenue: number; subs: number };

export type PaymentRow = {
  at?: number;
  amount?: string;
  who?: string;
  accountId?: string;
  label?: string;
  operationId?: string;
  error?: string;
  provider?: string;
  asset?: string;
  rub?: number;
  /** Charged sum before the YooMoney fee, when the notice had it. */
  charged?: number | null;
  /** Fee kept by YooMoney: charged minus the amount that landed. */
  fee?: number | null;
};

export type MethodSplit = {
  count: number;
  rub: number;
  stars: number;
  usdt: number;
  ton: number;
  btc: number;
};

export type ProblemRow = {
  kind: string;
  text?: string;
  amount?: string;
  label?: string;
  operationId?: string;
  at?: number;
};

export type SubRow = {
  id: string;
  accountId: string;
  who: string;
  telegramId?: string;
  paidUntilText: string;
  paidUntil?: number;
  createdAt?: number;
  bound: number;
  deviceLimit: number;
  /** «2 базовых + 1 бонусный (навсегда) + 1 купленный» */
  limitText?: string;
  limitOverride?: number | null;
  active: boolean;
  status: string;
  overLimit?: boolean;
  /** Rubles credited toward the next renewal (late extra-slot payments). */
  creditRub?: number;
};

export type FeedActor = { kind: string; id?: string; label?: string };

export type FeedEvent = {
  kind: string;
  text: string;
  accountId?: string;
  at?: number;
  deviceId?: string;
  actor?: FeedActor;
};

export type PendingPayment = {
  operationId: string;
  amount: string;
  at: number;
  label?: string;
  kind?: string;
  price?: number;
  accountId?: string;
  who?: string;
};

export type DeviceRow = {
  /** Registry row id; revoke sends it. Empty only for payloads without the registry. */
  id?: string;
  codeId: string;
  deviceId: string;
  /** Model the phone sent («Xiaomi 2201117TY»), '' for older apps. */
  name?: string;
  boundAt?: number;
  lastSeenAt?: number;
  /** Masked on the server: «95.24.113.*». */
  lastIp?: string;
  /** 'refresh': the app already uses refresh/access tokens; 'legacy': the old long-lived token. */
  auth?: 'refresh' | 'legacy';
  /** Last time a used refresh token of this device came back (suspected copy), 0 if never. */
  cloneAt?: number;
  cloneCount?: number;
  overLimit?: boolean;
};

export type BonusRow = {
  id: string;
  count: number;
  /** ms, or null = forever */
  until: number | null;
  reason: string;
  grantedAt: number;
  source: 'promo' | 'admin';
  active: boolean;
};

export type SwapInfo = { used: number; left: number; limit: number; nextAt?: number; resetAt?: number };

/** A secret from the server's .env, as the panel may show it: never the value. */
export type SecretView = { key: string; env: string; label: string; text: string; source: 'env' | 'db' | '' };

export type HomeData = {
  csrf: string;
  sessionId: string;
  flash?: Flash;
  stats?: {
    accounts: number;
    activeSubs: number;
    payments30: number;
    revenue30: number;
    /** Active devices with a live refresh token (new apps). */
    devicesRefresh?: number | null;
    /** Active devices still on the old opaque token. */
    devicesLegacy?: number | null;
    devicesBound?: number | null;
  };
  alerts?: { level: string; text: string; accountId?: string }[];
  events?: FeedEvent[];
  finance?: {
    summary?: {
      day?: { sum: number; count: number; byMethod?: Record<string, MethodSplit> };
      week?: { sum: number; count: number; byMethod?: Record<string, MethodSplit> };
      month?: { sum: number; count: number; byMethod?: Record<string, MethodSplit> };
    };
    payments?: PaymentRow[];
    problems?: ProblemRow[];
  };
  subscriptions?: SubRow[];
  pending?: PendingPayment[];
  promos?: {
    id: string;
    code: string;
    days: number;
    /** Free device slots the promo adds; bonusDays 0 = forever. */
    bonusSlots?: number;
    bonusDays?: number;
    uses: number;
    maxUses: number;
    revoked: boolean;
    createdAt?: number;
    expiresAt?: number;
    discountPercent?: number;
  }[];
  fails?: { at?: number; atText: string; reason: string; deviceId: string }[];
  sessions?: { id: string; lastSeen?: number; createdAt?: number; actor?: FeedActor }[];
  support?: SupportThread[];
  audit?: { at?: number; action: string; detail: string; actor?: FeedActor }[];
  series?: SeriesPoint[];
  secrets?: SecretView[];
  settings?: Record<string, string | number | boolean> & {
    donate?: {
      enabled?: boolean;
      amounts?: string;
      minRub?: number;
      maxRub?: number;
      commentMax?: number;
      thanksText?: string;
      yoomoney?: boolean;
      stars?: boolean;
      crypto?: boolean;
      rubPerStar?: number;
      notifyAll?: boolean;
      notifyMin?: number;
      showAmounts?: boolean;
    };
    referral?: {
      enabled?: boolean;
      referrerDays?: number;
      friendDays?: number;
      balance?: boolean;
      balancePercent?: number;
      balanceMax?: number;
      balanceMonthlyCap?: number;
      tiers?: boolean;
      tierList?: { friends: number; days: number; percent: number }[];
      friendDiscount?: boolean;
      friendDiscountPercent?: number;
      friendDiscountRub?: number;
      friendDiscountDays?: number;
      retention?: boolean;
      retentionMonths?: number;
      retentionDays?: number;
      delayDays?: number;
      yearlyCap?: number;
    };
  };
  referralJournal?: { id: string; friendId?: string; status: string; days: number; reason?: string; variant?: string; credit?: number; shortfall?: string }[];
  donations?: {
    rows?: { id: string; atText: string; who: string; telegramId: string; amountRub: number; method: string; comment: string; commentHidden: boolean; nameHidden: boolean; status: string }[];
    summary?: { day: { sum: number; count: number; average: number }; week: { sum: number; count: number; average: number }; month: { sum: number; count: number; average: number } };
    chart?: { day: string; rub: number }[];
    top?: { who: string; sum: number; count: number }[];
  };
  storage?: { engine: string; path: string; bytes: number };
  /** Postgres dumps; null when backups are not configured on the server. */
  backup?: BackupStatus | null;
  readOnly?: boolean;
};

export type BackupStatus = {
  enabled: boolean;
  everyHours: number;
  keepDays: number;
  last: { name: string; at: number; size: number } | null;
  ageSec: number | null;
  count: number;
  totalBytes: number;
  stale: boolean;
  lastError: string;
  verify?: { ok: boolean; at?: number; error?: string; name?: string } | null;
};

export type UserCode = {
  id: string;
  hasPlain?: boolean;
  bound: boolean;
  deviceId?: string;
  createdAt?: number;
  boundAt?: number;
};

export type UserData = {
  csrf: string;
  flash?: Flash;
  account: {
    id: string;
    email: string;
    telegramId: string;
    telegramUsername?: string;
    telegramName?: string;
    createdAt?: number;
    createdText: string;
  };
  subscription?: {
    paidUntilText: string;
    active: boolean;
    deviceLimit: number;
    paidUntil?: number;
    inGrace?: boolean;
    accessUntil?: number;
    baseLimit?: number;
    /** «2 базовых + 1 бонусный (навсегда) + 1 купленный» */
    limitText?: string;
    /** «Индивидуальный лимит»: replaces the global base; null = the global base. */
    limitOverride?: number | null;
    globalBase?: number;
    /** Active bonus slots now. */
    bonusSlots?: number;
    bonus?: BonusRow[];
    extraSlots?: number;
    extraUntil?: number;
    /** Rubles credited toward the next renewal. */
    creditRub?: number;
    bound?: number;
    overLimit?: boolean;
    swaps?: SwapInfo | null;
  };
  codes?: UserCode[];
  devices?: DeviceRow[];
  pending?: PendingPayment[];
  payments?: PaymentRow[];
  watch?: { name: string; at: number; version?: string; platform?: string }[];
};
