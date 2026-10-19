// Impressions and clicks for POST /v1/ads/event: summed in memory per banner, section and platform, sent at most
// every 30 seconds (and when the app goes to the background). No device id goes with them. A failed send (offline,
// 503 while the server is read-only) is dropped: the counters are statistics, not billing.
import type { AdPlatform, AdSection } from './ads';

export interface AdEventSender {
  (form: { events: string }): Promise<unknown>;
}

const FLUSH_MS = 30000;
const MAX_ROWS = 50;
const MAX_N = 20;

type Row = { b: string; s: AdSection; p: AdPlatform; t: 'i' | 'c'; n: number };

let queue: Row[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let sender: AdEventSender | null = null;

/** Who sends the batches (the phone: billingPost through the native http). */
export function setAdEventSender(s: AdEventSender | null): void {
  sender = s;
}

export function adEvent(banner: string, section: AdSection, platform: AdPlatform, type: 'i' | 'c'): void {
  for (let i = 0; i < queue.length; i++) {
    const r = queue[i];
    if (r.b === banner && r.s === section && r.p === platform && r.t === type && r.n < MAX_N) {
      r.n++;
      schedule(type === 'c');
      return;
    }
  }
  if (queue.length >= MAX_ROWS) return;
  queue.push({ b: banner, s: section, p: platform, t: type, n: 1 });
  schedule(type === 'c');
}

function schedule(soon: boolean): void {
  if (timer !== undefined && !soon) return;
  if (timer !== undefined) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    void flushAdEvents();
  }, soon ? 2000 : FLUSH_MS);
}

/** Sends what is queued now (never rejects). */
export function flushAdEvents(): Promise<void> {
  if (timer !== undefined) {
    clearTimeout(timer);
    timer = undefined;
  }
  const rows = queue;
  queue = [];
  if (!rows.length || !sender) return Promise.resolve();
  return sender({ events: JSON.stringify(rows) }).then(
    () => undefined,
    () => undefined,
  );
}

/** Tests: what is waiting. */
export function pendingAdEvents(): Row[] {
  return queue.slice();
}

export function resetAdEvents(): void {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  queue = [];
}
