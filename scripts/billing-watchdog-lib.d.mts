export const BOT_POLL_MAX_AGE_SEC: number;
export const WATCHDOG_ATTEMPTS: number;
export const WATCHDOG_GAP_MS: number;
export const ISSUE_TITLE: string;
export const ISSUE_LABEL: string;
export const ISSUE_LOOKUP_ATTEMPTS: number;
export const ISSUE_LOOKUP_GAP_MS: number;

export interface PublicEndpoint {
  id: string;
  url: string;
  kind: string;
  label: string;
}
export const PUBLIC_ENDPOINTS: PublicEndpoint[];

export function monitorMaxAgeSec(intervalMin: unknown): number;

export interface WatchdogVerdict {
  ok: boolean;
  reason: string;
}
export interface ProbeResult {
  status?: number;
  body?: unknown;
  error?: string;
}
export function evaluateHealth(res: ProbeResult | null): WatchdogVerdict;
export function evaluateHttp(res: ProbeResult | null): WatchdogVerdict;
export function verdictFor(endpoint: PublicEndpoint, res: ProbeResult | null): WatchdogVerdict;
export function shouldRetry(endpoint: PublicEndpoint, res: ProbeResult | null): boolean;

export interface WatchdogCheck {
  ok: boolean;
  since: number;
  reason: string;
}
/** Legacy single /health verdict, or the per-check map written after a run. */
export interface WatchdogState {
  ok?: boolean;
  since?: number;
  reason?: string;
  checks?: Record<string, WatchdogCheck>;
}
export interface CheckVerdict {
  id: string;
  label: string;
  ok: boolean;
  reason: string;
}
export function transitionChecks(
  prev: WatchdogState | null,
  verdicts: CheckVerdict[],
  now?: number,
): { text: string; next: { checks: Record<string, WatchdogCheck> } };
export function transition(prev: WatchdogState | null, verdict: WatchdogVerdict, now?: number): { text: string; next: WatchdogCheck };

export function summaryFor(state: WatchdogState | null): string;
export function encodeIssueBody(state: WatchdogState): string;
export function decodeIssueBody(body: string | null): WatchdogState | null;

export interface OpenIssue {
  number: number;
  body: string;
}
export type IssuePlan =
  | { action: 'noop' }
  | { action: 'skip' }
  | { action: 'close'; number: number }
  | { action: 'create'; title: string; body: string }
  | { action: 'update'; number: number; body: string };
export function issueAction(openIssue: OpenIssue | null, nextState: WatchdogState, opts?: { lookupFailed?: boolean }): IssuePlan;
export function retryCall<T>(
  fn: () => Promise<T>,
  attempts: number,
  gapMs: number,
  sleep: (ms: number) => Promise<void>,
): Promise<{ ok: true; value: T } | { ok: false }>;

export interface WatchdogDeps {
  probe(url: string): Promise<ProbeResult>;
  send(text: string): Promise<boolean>;
  readState(): WatchdogState | null | Promise<WatchdogState | null>;
  writeState(state: { checks: Record<string, WatchdogCheck> }): void | Promise<void>;
  sleep(ms: number): Promise<void>;
  log(line: string): void;
  now(): number;
  endpoints?: PublicEndpoint[];
}
export function runWatchdog(deps: WatchdogDeps, attempts?: number, gapMs?: number): Promise<number>;
