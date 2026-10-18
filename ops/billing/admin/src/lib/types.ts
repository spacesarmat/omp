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
  active: boolean;
  status: string;
  overLimit?: boolean;
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

export type HomeData = {
  csrf: string;
  sessionId: string;
  flash?: Flash;
  stats?: { accounts: number; activeSubs: number; payments30: number; revenue30: number };
  alerts?: { level: string; text: string; accountId?: string }[];
  events?: FeedEvent[];
  finance?: {
    summary?: { day?: { sum: number; count: number }; week?: { sum: number; count: number }; month?: { sum: number; count: number } };
    payments?: PaymentRow[];
    problems?: ProblemRow[];
  };
  subscriptions?: SubRow[];
  promos?: { id: string; code: string; days: number; uses: number; maxUses: number; revoked: boolean; createdAt?: number }[];
  fails?: { at?: number; atText: string; reason: string; deviceId: string }[];
  sessions?: { id: string; lastSeen?: number; createdAt?: number; actor?: FeedActor }[];
  support?: SupportThread[];
  audit?: { at?: number; action: string; detail: string; actor?: FeedActor }[];
  series?: SeriesPoint[];
  settings?: Record<string, string | number | boolean>;
  storage?: { engine: string; path: string; bytes: number };
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
  subscription?: { paidUntilText: string; active: boolean; deviceLimit: number; paidUntil?: number };
  codes?: UserCode[];
  payments?: PaymentRow[];
};
