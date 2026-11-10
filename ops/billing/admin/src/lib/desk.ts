import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type HealthRow = {
  name: string;
  ok: boolean | null;
  latencyMs: number;
  success: number | null;
  lastError: string;
  enabled?: boolean;
  configured?: boolean;
};

export type Spark = { t: string | number; v: number; n?: number };

export type DeskDevice = {
  id: string;
  deviceId: string;
  name: string;
  accountId: string;
  who: string;
  lastSeenAt: number;
  online: boolean;
  version: string;
  platform: string;
};

export type DeskUser = {
  id: string;
  who: string;
  telegramId: string;
  email: string;
  paidUntil: number;
  active: boolean;
};

export type DeskData = {
  ok?: boolean;
  auth?: boolean;
  role?: string;
  asOf?: number;
  health?: HealthRow[];
  online?: number;
  devices?: DeskDevice[];
  users?: DeskUser[];
  errors?: number;
  spark24?: Spark[];
  spark7?: Spark[];
  sources?: (HealthRow & { samples?: number; checkedAt?: number; url?: string })[];
  ranking?: { available: boolean; note: string; rows: { title: string; infohash: string; watches: number; winner: string; why: string; pinned: boolean; banned: boolean }[] };
  cache?: { enabled: boolean; note: string };
  funnel?: {
    steps: { name: string; label: string; users: number; conversion: number | null }[];
    estimated: { note: string; install: number; login: number; trial: number; payment: number; renewal: number };
  };
  revenue?: {
    monthSum: number;
    monthN: number;
    byDay: Spark[];
    byMonth: { month: string; sum: number; n: number }[];
    churn: { expired: number; active: number; rate: number };
    forecast: { due: number; sum: number; price: number };
  };
  disk?: { path: string; free: number; total: number; ratio: number } | null;
  rollbacks?: { id: string; at: number }[];
};

export function useDesk(enabled: boolean, paused: boolean) {
  return useQuery({
    queryKey: ['desk'],
    enabled,
    refetchInterval: paused ? false : 12000,
    queryFn: () => api<DeskData>('/admin/api/desk'),
  });
}
