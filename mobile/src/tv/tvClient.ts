// SSAP client on top of the native transport: pairing, request/response by id, pointer socket.
import { signal, effect } from '@preact/signals';
import { native, type OmpNativeApi } from '../platform/native';
import { activeTv, saveTv, setActiveTv, type SavedTv } from './tvStore';
import {
  registerMessage,
  requestMessage,
  buttonFrame,
  moveFrame,
  clickFrame,
  launchOmpPayload,
  type RemoteButton,
} from './ssap';

export type TvTransport = Pick<
  OmpNativeApi,
  'tvConnect' | 'tvSend' | 'onTvMessage' | 'onTvClosed' | 'pointerConnect' | 'pointerSend' | 'tvDisconnect'
>;

export type TvState = 'idle' | 'connecting' | 'pairing' | 'connected' | 'error';

export const TV_NOT_CONNECTED = 'Телевизор не подключён';
export const TV_NO_OMP = 'На телевизоре нет OMP';
export const TV_NO_ANSWER = 'Телевизор не отвечает';
export const TV_DECLINED = 'Подключение отклонено на телевизоре';
export const TV_POINTER_DENIED = 'Телевизор не разрешил управление пультом';
const TV_LAUNCH_FAILED = 'Не удалось запустить OMP на телевизоре';

const REQUEST_TIMEOUT = 8000;
/** The native side races ws:3000 and wss:3001 (3 s each; a saved port gets a 2 s head start). */
const SOCKET_OPEN_TIMEOUT = 12000;
/** The user needs time to find the remote and press «Разрешить». */
const PAIRING_TIMEOUT = 60000;
const POINTER_URI = 'ssap://com.webos.service.networkinput/getPointerInputSocket';
const PERMISSION_ERROR = /401|insufficient permissions|not permitted|denied/i;

export const tvState = signal<TvState>('idle');
export const tvError = signal('');
/** True while a background warm-up keeps retrying the connection (the TV may be waking up). */
export const tvWaking = signal(false);

const WARM_RETRY_MS = 1500;
const WARM_LIMIT_MS = 30000;
const QUEUE_MAX = 10;
const QUEUE_TTL_MS = 15000;

/** Error answered by the TV; `raw` keeps its original text. */
class TvAnswerError extends Error {
  constructor(public raw: string) {
    super(`Телевизор ответил ошибкой: ${raw}`);
  }
}

interface Pending {
  resolve: (payload: any) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  /** The TV is expected to drop the socket (turnOff): a close or timeout counts as success. */
  closeOk: boolean;
}

interface Session {
  tv: SavedTv;
  off: Array<() => void>;
  registerId: string;
  signed: boolean;
  /** Set while registration is in progress. */
  reg: { resolve: () => void; reject: (e: Error) => void; timer?: ReturnType<typeof setTimeout> } | null;
}

let transport: TvTransport = native;
let seq = 0;
/** IP of the current or connecting session; null when idle. */
export const sessionIp = signal<string | null>(null);
let session: Session | null = null;
let connecting: Promise<void> | null = null;
let pointer: Promise<void> | null = null;
/** OMP version on the TV of the current session; reset whenever the session ends. */
let versionCache: { ip: string; version: string } | null = null;
/** Last tvDisconnect; a new tvConnect waits for it so the old close cannot hit the new socket. */
let closing: Promise<void> = Promise.resolve();
const pending = new Map<string, Pending>();

const nextId = (prefix: string) => `${prefix}_${++seq}`;
const noop = () => {};

function closeTransport(): Promise<void> {
  closing = transport.tvDisconnect().catch(noop);
  return closing;
}

/** Replaces the transport (tests); drops the current session. */
export function setTransport(t: TvTransport): void {
  cancelWarmUp();
  if (session) {
    endSession(session, TV_NOT_CONNECTED);
    void closeTransport();
  }
  transport = t;
  closing = Promise.resolve();
  tvState.value = 'idle';
  tvError.value = '';
}

function endSession(s: Session, reason: string): void {
  if (session !== s) return;
  session = null;
  sessionIp.value = null;
  connecting = null;
  pointer = null;
  versionCache = null;
  for (const off of s.off) off();
  s.off = [];
  if (s.reg) {
    clearTimeout(s.reg.timer);
    const reg = s.reg;
    s.reg = null;
    reg.reject(new Error(reason));
  }
  for (const [id, p] of pending) {
    clearTimeout(p.timer);
    pending.delete(id);
    if (p.closeOk) p.resolve({});
    else p.reject(new Error(TV_NOT_CONNECTED));
  }
}

function fail(s: Session, message: string): void {
  if (session !== s) return;
  endSession(s, message);
  void closeTransport();
  tvState.value = 'error';
  tvError.value = message;
}

function armRegistration(s: Session, ms: number): void {
  if (!s.reg) return;
  clearTimeout(s.reg.timer);
  s.reg.timer = setTimeout(() => fail(s, TV_NO_ANSWER), ms);
}

function onRegisterMessage(s: Session, m: any): void {
  if (!s.reg) return;
  if (m.type === 'response' && m.payload?.pairingType === 'PROMPT') {
    tvState.value = 'pairing';
    armRegistration(s, PAIRING_TIMEOUT);
  } else if (m.type === 'registered') {
    const key = m.payload?.['client-key'];
    s.tv = {
      ip: s.tv.ip,
      name: s.tv.name,
      clientKey: typeof key === 'string' && key ? key : s.tv.clientKey,
      port: s.tv.port,
    };
    saveTv(s.tv);
    setActiveTv(s.tv.ip);
    clearTimeout(s.reg.timer);
    const reg = s.reg;
    s.reg = null;
    connecting = null;
    tvState.value = 'connected';
    tvError.value = '';
    reg.resolve();
    // Open the pointer socket now so the first press does not wait for it (errors are ignored).
    ensurePointer().catch(noop);
  } else if (m.type === 'error') {
    const text = String(m.error ?? m.payload?.errorText ?? '');
    if (s.signed && /blacklisted certificate/i.test(text)) {
      // Newer firmware rejects the shared signed manifest; lgtv2 retries without `signed`.
      s.signed = false;
      s.registerId = nextId('register');
      armRegistration(s, REQUEST_TIMEOUT);
      transport.tvSend(registerMessage(s.registerId, s.tv.clientKey, false)).catch(() => fail(s, TV_NO_ANSWER));
    } else {
      fail(s, TV_DECLINED);
    }
  }
}

function onMessage(s: Session, m: any): void {
  if (session !== s || !m || typeof m !== 'object') return;
  if (m.id === s.registerId) {
    onRegisterMessage(s, m);
    return;
  }
  const p = typeof m.id === 'string' ? pending.get(m.id) : undefined;
  if (!p) return;
  pending.delete(m.id);
  clearTimeout(p.timer);
  if (m.type === 'error') {
    p.reject(new TvAnswerError(String(m.error ?? m.payload?.errorText ?? '')));
  } else if (m.payload && m.payload.returnValue === false) {
    p.reject(new TvAnswerError(String(m.payload.errorText ?? m.payload.errorCode ?? '')));
  } else {
    p.resolve(m.payload ?? {});
  }
}

function onClosed(s: Session): void {
  if (session !== s) return;
  if (s.reg) {
    fail(s, TV_NO_ANSWER);
    return;
  }
  endSession(s, TV_NOT_CONNECTED);
  tvState.value = 'idle';
}

export function connectTv(tv: SavedTv): Promise<void> {
  if (session && session.tv.ip === tv.ip) {
    if (tvState.value === 'connected') return Promise.resolve();
    if (connecting) return connecting;
  }
  if (session) {
    endSession(session, TV_NOT_CONNECTED);
    void closeTransport();
  }
  const s: Session = { tv, off: [], registerId: nextId('register'), signed: true, reg: null };
  const promise = new Promise<void>((resolve, reject) => {
    s.reg = { resolve, reject };
  });
  session = s;
  sessionIp.value = tv.ip;
  connecting = promise;
  tvState.value = 'connecting';
  tvError.value = '';
  // Listeners must be in place before the socket opens: the TV answers `register` right away.
  s.off.push(transport.onTvMessage((m) => onMessage(s, m)));
  s.off.push(transport.onTvClosed(() => onClosed(s)));
  armRegistration(s, SOCKET_OPEN_TIMEOUT);
  const register = registerMessage(s.registerId, tv.clientKey);
  closing
    .then(() => (session === s ? transport.tvConnect(tv.ip, register, tv.port) : undefined))
    .then(
      (opened) => {
        const port = opened?.port;
        if (session === s && (port === 3000 || port === 3001)) {
          s.tv = { ...s.tv, port };
          // The TV may have answered `register` before this promise settled.
          if (tvState.value === 'connected') saveTv(s.tv);
        }
        // Socket open and `register` sent: now the TV has 8 s to answer (unless it already asked the user).
        if (session === s && tvState.value === 'connecting') armRegistration(s, REQUEST_TIMEOUT);
      },
      () => fail(s, TV_NO_ANSWER),
    );
  return promise;
}

async function ensureConnected(): Promise<void> {
  if (session && tvState.value === 'connected') return;
  if (connecting) return connecting;
  const tv = activeTv.value;
  if (!tv) throw new Error(TV_NOT_CONNECTED);
  return connectTv(tv);
}

function send(uri: string, payload?: object, closeOk = false): Promise<any> {
  if (!session || tvState.value !== 'connected') return Promise.reject(new Error(TV_NOT_CONNECTED));
  const s = session;
  const id = nextId('req');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pending.delete(id)) return;
      if (closeOk) {
        resolve({});
        return;
      }
      reject(new Error(TV_NO_ANSWER));
      // A dead socket may stay "open" for minutes without tvClosed; drop it so the next action reconnects.
      fail(s, TV_NO_ANSWER);
    }, REQUEST_TIMEOUT);
    pending.set(id, { resolve, reject, timer, closeOk });
    transport.tvSend(requestMessage(id, uri, payload)).catch(() => {
      if (!pending.delete(id)) return;
      clearTimeout(timer);
      reject(new Error(TV_NOT_CONNECTED));
    });
  });
}

async function request(uri: string, payload?: object): Promise<any> {
  await ensureConnected();
  return send(uri, payload);
}

function ensurePointer(): Promise<void> {
  if (!pointer) {
    const p: Promise<void> = send(POINTER_URI).then((r) => {
      if (typeof r?.socketPath !== 'string') throw new Error(TV_NO_ANSWER);
      return transport.pointerConnect(r.socketPath);
    });
    pointer = p;
    p.catch(() => {
      if (pointer === p) pointer = null;
    });
  }
  return pointer;
}

interface QueuedFrame {
  frame: string;
  at: number;
  resolve: () => void;
  reject: (e: Error) => void;
}
const outbox: QueuedFrame[] = [];
let draining = false;
let warming: Promise<void> | null = null;

function isBusy(): boolean {
  return tvState.value === 'connecting' || tvState.value === 'pairing' || tvWaking.value;
}

async function drainOutbox(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (outbox.length) {
      try {
        if (tvState.value !== 'connected') {
          if (warming) await warming.catch(noop);
          else if (connecting) await connecting.catch(noop);
          else await ensureConnected();
        }
        if (tvState.value !== 'connected') throw new Error(TV_NO_ANSWER);
      } catch (e) {
        for (const q of outbox.splice(0)) q.reject(e instanceof Error ? e : new Error(TV_NO_ANSWER));
        return;
      }
      const q = outbox.shift()!;
      if (Date.now() - q.at > QUEUE_TTL_MS) {
        q.reject(new Error(TV_NO_ANSWER));
        continue;
      }
      await sendFrameNow(q.frame).then(q.resolve, q.reject);
    }
  } finally {
    draining = false;
  }
}

function sendFrame(frame: string): Promise<void> {
  if (outbox.length === 0 && !draining && !isBusy()) return sendFrameNow(frame);
  // Presses made while connecting wait here and go out in order once the TV is ready.
  return new Promise<void>((resolve, reject) => {
    if (outbox.length >= QUEUE_MAX) outbox.shift()!.reject(new Error(TV_NOT_CONNECTED));
    outbox.push({ frame, at: Date.now(), resolve, reject });
    void drainOutbox();
  });
}

async function sendFrameNow(frame: string): Promise<void> {
  await ensureConnected();
  // One retry: the native pointer socket can close silently (no event reaches JS).
  for (let attempt = 0; ; attempt++) {
    const used = ensurePointer();
    try {
      await used;
    } catch (e) {
      if (e instanceof TvAnswerError) throw new Error(PERMISSION_ERROR.test(e.raw) ? TV_POINTER_DENIED : e.message);
      throw e;
    }
    try {
      await transport.pointerSend(frame);
      return;
    } catch {
      // Keep a fresh pointer another call may have opened meanwhile.
      if (pointer === used) pointer = null;
      if (attempt >= 1) throw new Error(TV_NOT_CONNECTED);
    }
  }
}

/** Stops the background connect retries (app went to background, TV switched). */
let cancelWarm: (() => void) | null = null;
export function cancelWarmUp(): void {
  cancelWarm?.();
}

/**
 * Connects to the active TV in the background and keeps retrying every 1.5 s for up to 30 s while it wakes up.
 * Stops on success, on a pairing prompt, on cancelWarmUp() and when the active TV changes. Never rejects.
 */
export function warmUp(): Promise<void> {
  if (warming) return warming;
  const tv = activeTv.value;
  if (!tv || tvState.value === 'connected' || tvState.value === 'connecting' || tvState.value === 'pairing') {
    return Promise.resolve();
  }
  let stopped = false;
  let wake: (() => void) | null = null;
  const stop = () => {
    stopped = true;
    wake?.();
  };
  cancelWarm = stop;
  let pairing = false;
  const watch = effect(() => {
    if (tvState.value === 'pairing') pairing = true;
    if (activeTv.value?.ip !== tv.ip) stop();
  });
  const started = Date.now();
  let p!: Promise<void>;
  p = (async () => {
    try {
      for (;;) {
        try {
          await connectTv(tv);
          return;
        } catch {
          /* retry below */
        }
        if (stopped || pairing || Date.now() - started + WARM_RETRY_MS > WARM_LIMIT_MS) return;
        tvWaking.value = true;
        await new Promise<void>((r) => {
          const t = setTimeout(r, WARM_RETRY_MS);
          wake = () => {
            clearTimeout(t);
            r();
          };
        });
        wake = null;
        if (stopped) return;
      }
    } finally {
      watch();
      tvWaking.value = false;
      if (cancelWarm === stop) cancelWarm = null;
      if (warming === p) warming = null;
    }
  })();
  warming = p;
  return p;
}

export async function launchOnTv(params: object): Promise<void> {
  try {
    await request('ssap://system.launcher/launch', launchOmpPayload(params));
  } catch (e) {
    if (!(e instanceof TvAnswerError)) throw e;
    throw new Error(/no such app|not found|not exist|404|-101/i.test(e.raw) ? TV_NO_OMP : TV_LAUNCH_FAILED);
  }
}

const OMP_APP_ID = 'com.spacesarmat.torrplayer';

/** Id of the app in the TV foreground; null when unknown or the TV does not answer. */
export async function foregroundAppId(): Promise<string | null> {
  try {
    const r = await request('ssap://com.webos.applicationManager/getForegroundAppInfo');
    return typeof r?.appId === 'string' && r.appId ? r.appId : null;
  } catch {
    return null;
  }
}

/** Installed OMP version on the TV (cached per connection); null when unknown. */
export async function ompVersionOnTv(): Promise<string | null> {
  const ip = sessionIp.value;
  if (versionCache && versionCache.ip === ip) return versionCache.version;
  try {
    const r = await request('ssap://com.webos.applicationManager/listApps');
    const app = Array.isArray(r?.apps) ? r.apps.find((a: any) => a && a.id === OMP_APP_ID) : undefined;
    if (!app || typeof app.version !== 'string' || !app.version) return null;
    if (ip !== null && sessionIp.value === ip && tvState.value === 'connected') versionCache = { ip, version: app.version };
    return app.version;
  } catch {
    return null;
  }
}

export function pressButton(name: RemoteButton): Promise<void> {
  return sendFrame(buttonFrame(name));
}

export function moveCursor(dx: number, dy: number): Promise<void> {
  return sendFrame(moveFrame(dx, dy));
}

export function click(): Promise<void> {
  return sendFrame(clickFrame());
}

export async function volume(dir: 'up' | 'down'): Promise<void> {
  await request(dir === 'up' ? 'ssap://audio/volumeUp' : 'ssap://audio/volumeDown');
}

export async function typeText(text: string): Promise<void> {
  await request('ssap://com.webos.service.ime/insertText', { text, replace: 0 });
}

export async function deleteText(n: number): Promise<void> {
  await request('ssap://com.webos.service.ime/deleteCharacters', { count: n });
}

export async function sendEnter(): Promise<void> {
  await request('ssap://com.webos.service.ime/sendEnterKey');
}

/** The TV may drop the socket before answering: a close or timeout after sending counts as success. */
export async function turnOffTv(): Promise<void> {
  await ensureConnected();
  await send('ssap://system/turnOff', undefined, true);
  await disconnectTv();
}

/** Closes the sockets; the plugin sends no tvClosed for this, so the state is reset here. */
export async function disconnectTv(): Promise<void> {
  const s = session;
  if (s) endSession(s, TV_NOT_CONNECTED);
  tvState.value = 'idle';
  tvError.value = '';
  if (s) await closeTransport();
}
