export const BOT_POLL_MAX_AGE_SEC: number;
export function monitorMaxAgeSec(intervalMin: unknown): number;
export interface WatchdogVerdict {
  ok: boolean;
  reason: string;
}
export function evaluateHealth(res: { status?: number; body?: unknown; error?: string } | null): WatchdogVerdict;
export interface WatchdogState {
  ok: boolean;
  since: number;
  reason: string;
}
export function transition(prev: WatchdogState | null, verdict: WatchdogVerdict, now?: number): { text: string; next: WatchdogState };
export interface WatchdogDeps {
  probe(): Promise<{ status?: number; body?: unknown; error?: string }>;
  send(text: string): Promise<boolean>;
  readState(): WatchdogState | null;
  writeState(state: WatchdogState): void;
  sleep(ms: number): Promise<void>;
  log(line: string): void;
  now(): number;
}
export function runWatchdog(deps: WatchdogDeps, attempts?: number, gapMs?: number): Promise<number>;
