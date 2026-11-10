// Crash reports: last log lines, breadcrumbs, offline queue. Secrets are scrubbed before they are stored.
import { billingPost } from '../billing/client';
import { withDeviceToken } from '../billing/tokens';
import { logEntries, scrub } from '../lib/log';
import { loadJson, saveJson, isObject } from '../store/storage';
import { settings } from '../store/settings';
import { APP_VERSION } from '../version';
import type { SourceContext } from '../sources/types';

const KEY = 'omp.crashQueue';
const MAX_QUEUE = 20;
const HOUR = 60 * 60 * 1000;

export type CrashReport = {
  kind: string;
  message: string;
  stack: string;
  logs: string;
  crumbs: string[];
  comment: string;
  screenshot: string;
  version: string;
  platform: string;
  at: number;
  fingerprint: string;
};

const crumbs: string[] = [];
const seen = new Map<string, number>();

export function crumb(text: string): void {
  const line = scrub(String(text || '')).slice(0, 160);
  if (!line) return;
  crumbs.push(line);
  if (crumbs.length > 40) crumbs.shift();
}

export function crashFingerprint(message: string, stack: string): string {
  const src = (stack || message || '').split('\n').slice(0, 8).join('\n').replace(/:\d+:\d+/g, '').replace(/\d+/g, '#');
  let h = 2166136261;
  for (let i = 0; i < src.length; i++) h = Math.imul(h ^ src.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16);
}

export function buildCrash(part: { kind: string; message: string; stack?: string; comment?: string; screenshot?: string; platform: string }): CrashReport {
  const message = scrub(part.message || '').slice(0, 500);
  const stack = scrub(part.stack || '').slice(0, 4000);
  const logs = logEntries()
    .slice(-500)
    .map((e) => e.l + ' ' + e.a + ' ' + e.x)
    .join('\n')
    .slice(0, 60000);
  return {
    kind: part.kind,
    message,
    stack,
    logs,
    crumbs: crumbs.slice(),
    comment: scrub(part.comment || '').slice(0, 1000),
    screenshot: part.screenshot && part.screenshot.length <= 120000 ? part.screenshot : '',
    version: APP_VERSION,
    platform: part.platform,
    at: Date.now(),
    fingerprint: crashFingerprint(message, stack),
  };
}

function readQueue(): CrashReport[] {
  const raw = loadJson<unknown>(KEY, [], Array.isArray);
  if (!Array.isArray(raw)) return [];
  return raw.filter((r) => isObject(r) && typeof r.message === 'string') as CrashReport[];
}

export function queueCrash(part: { kind: string; message: string; stack?: string; comment?: string; screenshot?: string; platform: string }, now = Date.now()): CrashReport | null {
  if (settings.value.diagnostics === false) return null;
  const report = buildCrash(part);
  const last = seen.get(report.fingerprint) || 0;
  if (now - last < HOUR && part.kind !== 'manual') return null;
  seen.set(report.fingerprint, now);
  const next = readQueue().concat([report]).slice(-MAX_QUEUE);
  saveJson(KEY, next);
  return report;
}

export function crashBody(report: CrashReport, diagnostics: boolean): { [key: string]: string } {
  return {
    diagnostics: diagnostics ? '1' : '0',
    payload: JSON.stringify({
      kind: report.kind,
      message: report.message,
      stack: report.stack,
      logs: report.logs,
      crumbs: report.crumbs,
      comment: report.comment,
      screenshot: report.screenshot,
      version: report.version,
      platform: report.platform,
    }),
  };
}

let boundCrash: (() => SourceContext) | null = null;
let crashChain: Promise<boolean> = Promise.resolve(false);

function dropReport(report: CrashReport): void {
  saveJson(
    KEY,
    readQueue().filter((r) => !(r.at === report.at && r.fingerprint === report.fingerprint)),
  );
}

function drain(ctx: () => SourceContext): Promise<boolean> {
  if (settings.value.diagnostics === false) return Promise.resolve(false);
  const queued = readQueue();
  if (!queued.length) return Promise.resolve(true);
  const report = queued[0];
  return withDeviceToken(ctx(), (headers) => billingPost(ctx(), '/v1/crash', crashBody(report, true), { headers, timeoutMs: 12000 }))
    .then((res) => {
      if (res.status !== 200) return false;
      dropReport(report);
      return drain(ctx);
    })
    .catch(() => false);
}

/** Sends queued reports now and again when the network returns. A failed send stays queued. */
export function flushCrashes(ctx: () => SourceContext): Promise<boolean> {
  boundCrash = ctx;
  crashChain = crashChain.then(() => drain(ctx)).catch(() => false);
  return crashChain;
}

export function installCrashHooks(platform: string, ctx?: () => SourceContext): void {
  if (ctx) boundCrash = ctx;
  if (typeof window === 'undefined') return;
  window.addEventListener('online', () => {
    if (boundCrash) void flushCrashes(boundCrash);
  });
  const keep = (part: { kind: string; message: string; stack?: string }) => {
    if (!queueCrash({ ...part, platform })) return;
    if (boundCrash) void flushCrashes(boundCrash);
  };
  window.addEventListener('error', (ev: ErrorEvent) => {
    keep({ kind: 'window', message: ev && ev.message ? ev.message : 'error', stack: ev && ev.error && ev.error.stack ? String(ev.error.stack) : '' });
  });
  window.addEventListener('unhandledrejection', (ev: PromiseRejectionEvent) => {
    const reason = ev ? ev.reason : null;
    const message = reason && typeof reason === 'object' && typeof (reason as { message?: string }).message === 'string' ? (reason as { message: string }).message : String(reason || 'rejection');
    const stack = reason && typeof reason === 'object' && typeof (reason as { stack?: string }).stack === 'string' ? (reason as { stack: string }).stack : '';
    keep({ kind: 'rejection', message, stack });
  });
}

export function sendManualReport(ctx: () => SourceContext, platform: string, comment: string, screenshot: string): Promise<boolean> {
  if (settings.value.diagnostics === false) return Promise.resolve(false);
  const report = queueCrash({ kind: 'manual', message: comment || 'user report', comment, screenshot, platform }, Date.now());
  if (!report) return Promise.resolve(false);
  return flushCrashes(ctx);
}
