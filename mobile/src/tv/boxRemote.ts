// «Управлять приставкой»: the phone remote drives the whole Android TV box (system navigation, Home, other apps,
// volume), not only OMP. Two transports, picked automatically: the Google TV remote service (Android TV Remote
// protocol v2, TLS 6466/6467, pairing by a 6-hex-digit code on the TV) and adb over the network (port 5555, the TV
// asks «Разрешить отладку?» once). The native side is android/.../box/*; OMP's own channel (tvClient) keeps text,
// «Сейчас играет» and player commands.
import { signal } from '@preact/signals';
import type { PluginListenerHandle } from '@capacitor/core';
import { rawPlugin, onlyAndroid } from '../platform/native';
import { t } from '../../../src/i18n';
import { setTvBox, type SavedTv } from './tvStore';
import { log } from '../../../src/lib/log';

export type BoxVia = 'google' | 'adb';

/** Keys the box channel can send: the remote's button names plus the box-only ones. */
export type BoxKey =
  | 'UP'
  | 'DOWN'
  | 'LEFT'
  | 'RIGHT'
  | 'ENTER'
  | 'BACK'
  | 'HOME'
  | 'MENU'
  | 'SETTINGS'
  | 'VOLUMEUP'
  | 'VOLUMEDOWN'
  | 'MUTE'
  | 'PLAYPAUSE'
  | 'PLAY'
  | 'PAUSE'
  | 'NEXT'
  | 'PREV'
  | 'REWIND'
  | 'FASTFORWARD'
  | 'RED'
  | 'GREEN'
  | 'YELLOW'
  | 'BLUE'
  | 'CHANNELUP'
  | 'CHANNELDOWN'
  | 'DEL'
  | 'RETURN';

/** Android KeyEvent codes (the Google protocol's key codes are the same numbers). */
export const BOX_KEYCODES: Readonly<Record<BoxKey, number>> = {
  UP: 19,
  DOWN: 20,
  LEFT: 21,
  RIGHT: 22,
  ENTER: 23,
  BACK: 4,
  HOME: 3,
  MENU: 82,
  SETTINGS: 176,
  VOLUMEUP: 24,
  VOLUMEDOWN: 25,
  MUTE: 164,
  PLAYPAUSE: 85,
  PLAY: 126,
  PAUSE: 127,
  NEXT: 87,
  PREV: 88,
  REWIND: 89,
  FASTFORWARD: 90,
  RED: 183,
  GREEN: 184,
  YELLOW: 185,
  BLUE: 186,
  CHANNELUP: 166,
  CHANNELDOWN: 167,
  /** Text field keys (typing over adb): backspace and Enter. */
  DEL: 67,
  RETURN: 66,
};

/** The KeyEvent code of a key name; null for a name the box channel does not send. */
export function boxKeyCode(name: string): number | null {
  return Object.prototype.hasOwnProperty.call(BOX_KEYCODES, name) ? BOX_KEYCODES[name as BoxKey] : null;
}

export interface BoxProbeResult {
  google: boolean;
  adb: boolean;
  /** A channel to this box is already up. */
  via?: BoxVia;
}

/**
 * The transports to try, in order: the one that worked for this TV before (when it answers now), then the Google
 * TV remote service (no developer settings needed), then adb.
 */
export function transportOrder(saved: BoxVia | undefined, probe: BoxProbeResult): BoxVia[] {
  const open = (['google', 'adb'] as BoxVia[]).filter((v) => probe[v]);
  if (saved && open.indexOf(saved) >= 0) return [saved].concat(open.filter((v) => v !== saved));
  return open;
}

/** Native error codes (BoxCodes in Kotlin). */
export const BOX = {
  UNREACHABLE: 'box-unreachable',
  NO_SERVICE: 'box-no-service',
  NEED_PAIRING: 'box-need-pairing',
  BAD_CODE: 'box-bad-code',
  REJECTED: 'box-rejected',
  ADB_CLOSED: 'box-adb-closed',
  AUTH_TIMEOUT: 'box-auth-timeout',
  NOT_CONNECTED: 'box-not-connected',
  FAILED: 'box-failed',
} as const;

export function boxErrorText(code: string): string {
  switch (code) {
    case BOX.UNREACHABLE:
      return t('remote.box.err.unreachable');
    case BOX.NO_SERVICE:
      return t('remote.box.err.noService');
    case BOX.NEED_PAIRING:
      return t('remote.box.err.needPairing');
    case BOX.BAD_CODE:
      return t('remote.box.err.badCode');
    case BOX.REJECTED:
      return t('remote.box.err.rejected');
    case BOX.ADB_CLOSED:
      return t('remote.box.err.adbClosed');
    case BOX.AUTH_TIMEOUT:
      return t('remote.box.err.authTimeout');
    case BOX.NOT_CONNECTED:
      return t('remote.box.err.notConnected');
    default:
      return t('remote.box.err.failed');
  }
}

/** A failed box call: `code` from the plugin, the message is the text for the user. */
export class BoxError extends Error {
  constructor(public code: string) {
    super(boxErrorText(code));
  }
}

function codeOf(e: unknown): string {
  if (e instanceof BoxError) return e.code;
  const c = e && typeof e === 'object' ? (e as { code?: unknown; message?: unknown }) : null;
  if (c && typeof c.code === 'string' && c.code.indexOf('box-') === 0) return c.code;
  if (c && typeof c.message === 'string' && c.message.indexOf('box-') === 0) return c.message;
  return BOX.FAILED;
}

export interface BoxNative {
  available: boolean;
  probe(ip: string): Promise<BoxProbeResult>;
  connect(ip: string, via: BoxVia): Promise<BoxVia>;
  pairStart(ip: string): Promise<void>;
  pairFinish(ip: string, code: string): Promise<BoxVia>;
  pairCancel(): Promise<void>;
  key(code: number, long: boolean): Promise<void>;
  /** Types into the box's focused field; false when the channel cannot (Google). */
  text(text: string): Promise<boolean>;
  disconnect(): Promise<void>;
  onClosed(cb: (via: BoxVia) => void): () => void;
}

interface BoxPlugin {
  boxProbe(o: { ip: string }): Promise<{ google?: unknown; adb?: unknown; via?: unknown }>;
  boxConnect(o: { ip: string; via: string }): Promise<{ via?: unknown }>;
  boxPairStart(o: { ip: string }): Promise<unknown>;
  boxPairFinish(o: { ip: string; code: string }): Promise<{ via?: unknown }>;
  boxPairCancel(): Promise<unknown>;
  boxKey(o: { code: number; long: boolean }): Promise<unknown>;
  boxText(o: { text: string }): Promise<{ typed?: unknown }>;
  boxDisconnect(): Promise<unknown>;
  addListener(event: 'boxClosed', cb: (e: { via?: unknown }) => void): Promise<PluginListenerHandle>;
}

const via = (v: unknown, fallback: BoxVia): BoxVia => (v === 'google' || v === 'adb' ? v : fallback);

export function createBoxNative(plugin: BoxPlugin | null): BoxNative {
  const call = async <T>(f: (p: BoxPlugin) => Promise<T>): Promise<T> => {
    if (!plugin) throw new Error(onlyAndroid());
    try {
      return await f(plugin);
    } catch (e) {
      throw new BoxError(codeOf(e));
    }
  };
  return {
    available: !!plugin,
    probe: (ip) =>
      call(async (p) => {
        const r = await p.boxProbe({ ip });
        const out: BoxProbeResult = { google: r?.google === true, adb: r?.adb === true };
        if (r?.via === 'google' || r?.via === 'adb') out.via = r.via;
        return out;
      }),
    connect: (ip, v) => call(async (p) => via((await p.boxConnect({ ip, via: v }))?.via, v)),
    pairStart: (ip) => call(async (p) => void (await p.boxPairStart({ ip }))),
    pairFinish: (ip, code) => call(async (p) => via((await p.boxPairFinish({ ip, code }))?.via, 'google')),
    pairCancel: () => (plugin ? plugin.boxPairCancel().then(() => undefined, () => undefined) : Promise.resolve()),
    key: (code, long) => call(async (p) => void (await p.boxKey({ code, long }))),
    text: (text) => call(async (p) => (await p.boxText({ text }))?.typed === true),
    disconnect: () => (plugin ? plugin.boxDisconnect().then(() => undefined, () => undefined) : Promise.resolve()),
    onClosed(cb) {
      if (!plugin) return () => {};
      let handle: PluginListenerHandle | null = null;
      let removed = false;
      plugin.addListener('boxClosed', (e) => cb(via(e?.via, 'google'))).then(
        (h) => {
          handle = h;
          if (removed) void h.remove();
        },
        () => {},
      );
      return () => {
        removed = true;
        if (handle) void handle.remove();
      };
    },
  };
}

/**
 * off — the switch is off; idle — on, not connected; connecting; code — the TV shows a pairing code; confirm — adb is
 * connecting and the TV may ask «Разрешить отладку?»; adbHelp — nothing answers, network debugging must be turned on;
 * connected; error — [boxError] says why.
 */
export type BoxState = 'off' | 'idle' | 'connecting' | 'code' | 'confirm' | 'adbHelp' | 'connected' | 'error';

export const boxState = signal<BoxState>('off');
export const boxVia = signal<BoxVia | null>(null);
export const boxError = signal('');
/** The box the state above is about. */
export const boxIp = signal<string | null>(null);

let nat: BoxNative = createBoxNative(rawPlugin() as BoxPlugin | null);
let unlisten: () => void = () => {};
let flow = 0;
let running: Promise<void> | null = null;

function listen(): void {
  unlisten();
  unlisten = nat.onClosed(() => {
    if (boxState.value !== 'connected') return;
    // the next press reconnects
    boxState.value = 'idle';
    boxVia.value = null;
  });
}
listen();

/** Replaces the native side (tests); null restores the real one. Resets the state. */
export function setBoxNative(n: BoxNative | null): void {
  nat = n || createBoxNative(rawPlugin() as BoxPlugin | null);
  flow++;
  running = null;
  boxState.value = 'off';
  boxVia.value = null;
  boxError.value = '';
  boxIp.value = null;
  listen();
}

/** The box channel is up for this TV: remote keys go through it. */
export function boxActive(tv: SavedTv | null | undefined): boolean {
  return !!tv && tv.kind === 'atv' && !!tv.box?.on && boxIp.value === tv.ip && boxState.value === 'connected';
}

function connected(tv: SavedTv, v: BoxVia): void {
  boxVia.value = v;
  boxError.value = '';
  boxState.value = 'connected';
  setTvBox(tv.ip, { on: true, via: v });
}

function failed(code: string): void {
  boxVia.value = null;
  boxError.value = boxErrorText(code);
  boxState.value = code === BOX.ADB_CLOSED || code === BOX.NO_SERVICE ? 'adbHelp' : 'error';
}

/**
 * Connects the box channel of [tv]: probes both transports, tries them in [transportOrder]. A Google TV that does
 * not know this phone shows a pairing code when `setup` (the user turned the switch on or tapped «Подключить»),
 * otherwise the state says pairing is needed. adb may wait for «Разрешить отладку?» on the TV.
 */
export function connectBox(tv: SavedTv, opts: { setup?: boolean } = {}): Promise<void> {
  const my = ++flow;
  const stale = () => my !== flow;
  boxIp.value = tv.ip;
  boxVia.value = null;
  boxError.value = '';
  boxState.value = 'connecting';
  const run = (async () => {
    let probe: BoxProbeResult;
    try {
      probe = await nat.probe(tv.ip);
    } catch (e) {
      if (!stale()) failed(codeOf(e));
      return;
    }
    if (stale()) return;
    if (probe.via) {
      connected(tv, probe.via);
      return;
    }
    const order = transportOrder(tv.box?.via, probe);
    if (!order.length) {
      failed(BOX.NO_SERVICE);
      return;
    }
    let last: string = BOX.FAILED;
    for (const v of order) {
      if (v === 'adb') boxState.value = 'confirm';
      try {
        const got = await nat.connect(tv.ip, v);
        if (stale()) return;
        connected(tv, got);
        return;
      } catch (e) {
        if (stale()) return;
        const code = codeOf(e);
        log('warn', 'tv', 'box connect ' + v + ': ' + code);
        if (v === 'google' && code === BOX.NEED_PAIRING) {
          if (!opts.setup) {
            failed(BOX.NEED_PAIRING);
            return;
          }
          try {
            await nat.pairStart(tv.ip);
            if (stale()) return;
            boxState.value = 'code';
            return;
          } catch (e2) {
            if (stale()) return;
            last = codeOf(e2);
            if (last === BOX.REJECTED) break;
            continue;
          }
        }
        last = code;
        // the user's answer on the TV: do not try the other transport behind their back
        if (code === BOX.REJECTED || code === BOX.AUTH_TIMEOUT) break;
      }
    }
    if (!stale()) failed(last);
  })();
  running = run;
  return run.finally(() => {
    if (running === run) running = null;
  });
}

/** The code from the TV screen: pairs and connects. A wrong code throws and keeps the code entry open. */
export async function submitBoxCode(tv: SavedTv, code: string): Promise<void> {
  const my = ++flow;
  try {
    const v = await nat.pairFinish(tv.ip, code.replace(/\s+/g, '').toUpperCase());
    if (my === flow) connected(tv, v);
  } catch (e) {
    const c = codeOf(e);
    if (c !== BOX.BAD_CODE && my === flow) failed(c);
    throw e instanceof BoxError ? e : new BoxError(c);
  }
}

/** «Отмена» on the code sheet. */
export function cancelBoxCode(): void {
  flow++;
  void nat.pairCancel();
  boxState.value = 'idle';
}

/** The switch on: remembered for this TV, then the setup flow. */
export function enableBox(tv: SavedTv): Promise<void> {
  setTvBox(tv.ip, { on: true, via: tv.box?.via });
  return connectBox({ ...tv, box: { on: true, via: tv.box?.via } }, { setup: true });
}

/** The switch off: the channel is closed, the transport that worked is kept for next time. */
export function disableBox(tv: SavedTv): void {
  flow++;
  setTvBox(tv.ip, { on: false, via: tv.box?.via });
  void nat.pairCancel();
  void nat.disconnect();
  boxState.value = 'off';
  boxVia.value = null;
  boxError.value = '';
}

/** The remote opened or the TV changed: reconnects a switched-on box quietly (never shows a pairing code). */
export function syncBox(tv: SavedTv | null): void {
  if (!tv || tv.kind !== 'atv' || !tv.box?.on) {
    if (boxState.value !== 'off') {
      flow++;
      void nat.pairCancel();
      void nat.disconnect();
      boxState.value = 'off';
      boxVia.value = null;
      boxError.value = '';
    }
    boxIp.value = tv ? tv.ip : null;
    return;
  }
  if (boxIp.value === tv.ip && (boxState.value === 'connected' || running || boxState.value === 'code')) return;
  void connectBox(tv);
}

/** Sends a key through the box channel; a dropped channel is reconnected once and the key sent again. */
export async function sendBoxKey(tv: SavedTv, name: BoxKey, long = false): Promise<void> {
  const code = BOX_KEYCODES[name];
  if (!boxActive(tv)) {
    if (running) await running;
    if (!boxActive(tv)) await connectBox(tv);
    if (!boxActive(tv)) throw new BoxError(BOX.NOT_CONNECTED);
  }
  try {
    await nat.key(code, long);
  } catch (e) {
    if (codeOf(e) !== BOX.NOT_CONNECTED) throw e;
    await connectBox(tv);
    if (!boxActive(tv)) throw new BoxError(BOX.NOT_CONNECTED);
    await nat.key(code, long);
  }
}

/** Types into the box's focused field (adb only): false when the box channel cannot. */
export function sendBoxText(tv: SavedTv, text: string): Promise<boolean> {
  if (!boxActive(tv)) return Promise.resolve(false);
  return nat.text(text);
}
