import { signal } from '@preact/signals';
import { APP_VERSION } from '../version';
import { Cmd, PlayerState, POST_INTERVAL_MS, LINK_DROP_MS, sanitizeCmd } from './protocol';

export interface PlayerBridge { snapshot(): PlayerState | null; exec(cmd: Cmd): void }
type Transport = (url: string, body: string) => Promise<string>;

export const phoneAttached = signal(false);

let bridge: PlayerBridge | null = null;
let transportOverride: Transport | null = null;
let url: string | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let soonTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;
let lastOk = 0;
let generation = 0;

function xhrTransport(u: string, body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', u);
    x.setRequestHeader('Content-Type', 'text/plain');
    x.timeout = 3000;
    x.onload = () => (x.status >= 200 && x.status < 300 ? resolve(x.responseText) : reject(new Error('http ' + x.status)));
    x.onerror = () => reject(new Error('network'));
    x.ontimeout = () => reject(new Error('timeout'));
    x.send(body);
  });
}

/** Test seam: replaces XHR transport; null restores. */
export function setLinkTransport(t: Transport | null): void {
  transportOverride = t;
}

/** The active player registers itself; returns unregister. Only one bridge at a time (last wins). */
export function setPlayerBridge(b: PlayerBridge): () => void {
  bridge = b;
  return () => {
    if (bridge === b) bridge = null;
  };
}

function clearTimers(): void {
  if (timer !== null) clearInterval(timer);
  if (soonTimer !== null) clearTimeout(soonTimer);
  timer = null;
  soonTimer = null;
}

function fail(): void {
  if (Date.now() - lastOk >= LINK_DROP_MS) detachPhone();
}

function post(): void {
  if (!url || inFlight) return;
  const gen = generation;
  let body: string;
  try {
    body = JSON.stringify({ v: 1, app: APP_VERSION, state: bridge ? bridge.snapshot() : null });
  } catch (e) {
    return;
  }
  inFlight = true;
  const send = transportOverride || xhrTransport;
  send(url, body).then(
    (text) => {
      if (gen !== generation) return;
      inFlight = false;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        fail();
        return;
      }
      lastOk = Date.now();
      const cmds = parsed && typeof parsed === 'object' ? (parsed as { cmds?: unknown }).cmds : null;
      let ran = false;
      if (Array.isArray(cmds)) {
        for (let i = 0; i < cmds.length; i++) {
          const c = sanitizeCmd(cmds[i]);
          if (!c) continue;
          ran = true;
          if (bridge) {
            try {
              bridge.exec(c);
            } catch (e) {
              /* a failing command must not break the link */
            }
          }
        }
      }
      if (ran) postSoon();
    },
    () => {
      if (gen !== generation) return;
      inFlight = false;
      fail();
    },
  );
}

/** Starts (or retargets) posting to the phone. */
export function attachPhone(u: string): void {
  clearTimers();
  generation++;
  inFlight = false;
  url = u;
  lastOk = Date.now();
  phoneAttached.value = true;
  timer = setInterval(post, POST_INTERVAL_MS);
}

export function detachPhone(): void {
  clearTimers();
  generation++;
  inFlight = false;
  url = null;
  phoneAttached.value = false;
}

/** Posts now instead of waiting for the interval (after a command or a state jump). */
export function postSoon(): void {
  if (!url || soonTimer !== null) return;
  soonTimer = setTimeout(() => {
    soonTimer = null;
    post();
  }, 0);
}
