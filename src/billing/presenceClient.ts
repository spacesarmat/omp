import { BILLING_ORIGIN } from './config';
import { billingSession, deviceId } from './session';
import { withDeviceToken } from './tokens';
import { syncEnabled } from '../store/deviceDb';
import { loadJson, saveJson } from '../store/storage';
import type { SourceContext } from '../sources/types';

const SEQ_KEY = 'omp.playbackPresenceSeq';
const INTERVAL_MS = 15000;

export type PresenceState = 'playing' | 'paused' | 'finished';
export type PresencePlatform = 'lg' | 'androidtv' | 'phone' | 'desktop';
export interface PresenceReport {
  state: PresenceState;
  hash: string;
  fileId: number;
  title: string;
  episode: string;
  positionSec: number;
  durationSec: number;
  deviceName: string;
  platform: PresencePlatform;
}
export interface PresenceInput extends PresenceReport {
  sessionId: string;
  sessionSeq: number;
}
export interface PlaybackPresence extends PresenceInput {
  deviceId: string;
  updatedAt: number;
}

let contextOf: (() => SourceContext | null) | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let clock = 0;
let active = 0;

export function setPresenceContext(fn: (() => SourceContext | null) | null): void {
  contextOf = fn;
}

function accessToken(): string {
  const session = billingSession();
  return session ? session.access || session.token : '';
}

function accountOwner(): string {
  const session = billingSession();
  return session ? session.id || session.access || session.token : '';
}

function parseRows(text: string): PlaybackPresence[] {
  try {
    const data = JSON.parse(text || '{}');
    return data && Array.isArray(data.presences) ? data.presences : [];
  } catch (e) {
    return [];
  }
}

export function sendPresence(input: PresenceInput | null): Promise<boolean> {
  if (!syncEnabled() || !accessToken()) return Promise.resolve(false);
  const body = JSON.stringify({ presence: input });
  const ctx = contextOf && contextOf();
  if (ctx && ctx.http.postJson) {
    const postJson = ctx.http.postJson;
    return withDeviceToken(ctx, (headers) => postJson(BILLING_ORIGIN + '/v2/sync/presence', body, { headers, timeoutMs: 8000 })).then(
      (res) => res.status === 200,
      () => false,
    );
  }
  return fetch(BILLING_ORIGIN + '/v2/sync/presence', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + accessToken(), 'x-device-id': deviceId() },
    body,
  }).then((res) => res.status === 200, () => false);
}

export function fetchPresence(): Promise<PlaybackPresence[]> {
  if (!syncEnabled() || !accessToken()) return Promise.resolve([]);
  const ctx = contextOf && contextOf();
  if (ctx) {
    return withDeviceToken(ctx, (headers) => ctx.http.get(BILLING_ORIGIN + '/v2/sync/presence', { headers, timeoutMs: 12000 })).then(
      (res) => res.status === 200 ? parseRows(res.text) : [],
      () => [],
    );
  }
  return fetch(BILLING_ORIGIN + '/v2/sync/presence', {
    headers: { authorization: 'Bearer ' + accessToken(), 'x-device-id': deviceId() },
  }).then(
    (res) => res.status === 200 ? res.json().then((data) => data && Array.isArray(data.presences) ? data.presences : [], () => []) : [],
    () => [],
  );
}

function nextSessionSeq(): number {
  const previous = loadJson<number>(SEQ_KEY, 0, (value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
  const next = Math.max(Math.floor(Date.now()), previous + 1);
  saveJson(SEQ_KEY, next);
  return next;
}

function sessionId(seq: number): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let random = '';
  for (const byte of bytes) random += ('0' + byte.toString(16)).slice(-2);
  return seq.toString(36) + '-' + random;
}

function adjustedPosition(current: PresenceReport, previous: PresenceReport | null, previousPosition: number, elapsedMs: number): number {
  let position = current.positionSec;
  if (current.state === 'playing' && previous && previous.state === 'playing' && previous.positionSec === current.positionSec) {
    position = previousPosition + Math.max(0, elapsedMs) / 1000;
  }
  if (current.durationSec > 0) position = Math.min(current.durationSec, position);
  return position;
}

export function startPresenceReporting(source: () => PresenceReport | null, sessionKey: string): (final?: PresenceReport | null) => void {
  if (timer) clearInterval(timer);
  const id = ++clock;
  active = id;
  const sessionSeq = nextSessionSeq();
  const session = sessionId(sessionSeq) + ':' + sessionKey.slice(0, 60);
  const owner = accountOwner();
  let previous: PresenceReport | null = null;
  let previousPosition = 0;
  let previousAt = Date.now();

  function payload(current: PresenceReport, positionSec: number): PresenceInput {
    return { ...current, positionSec, sessionId: session, sessionSeq };
  }

  function tick(): void {
    if (active !== id) return;
    if (owner && accountOwner() !== owner) {
      if (timer) clearInterval(timer);
      timer = null;
      active = 0;
      return;
    }
    const current = source();
    if (!current) return;
    const at = Date.now();
    const positionSec = adjustedPosition(current, previous, previousPosition, at - previousAt);
    previous = current;
    previousPosition = positionSec;
    previousAt = at;
    void sendPresence(payload(current, positionSec));
  }

  tick();
  timer = setInterval(tick, INTERVAL_MS);
  return (final?: PresenceReport | null) => {
    if (active !== id) return;
    if (timer) clearInterval(timer);
    timer = null;
    active = 0;
    if (owner && accountOwner() !== owner) return;
    if (final) void sendPresence(payload(final, final.positionSec));
    else void sendPresence(null);
  };
}

export function resetPresenceClient(): void {
  if (timer) clearInterval(timer);
  timer = null;
  clock++;
  active = 0;
  contextOf = null;
}
