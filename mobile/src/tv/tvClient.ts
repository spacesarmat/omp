// SSAP client on top of the native transport: pairing, request/response by id, pointer socket.
import { signal } from '@preact/signals';
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
const TV_LAUNCH_FAILED = 'Не удалось запустить OMP на телевизоре';

const REQUEST_TIMEOUT = 8000;
/** The user needs time to find the remote and press «Разрешить». */
const PAIRING_TIMEOUT = 60000;
const POINTER_URI = 'ssap://com.webos.service.networkinput/getPointerInputSocket';

export const tvState = signal<TvState>('idle');
export const tvError = signal('');

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
let session: Session | null = null;
let connecting: Promise<void> | null = null;
let pointer: Promise<void> | null = null;
const pending = new Map<string, Pending>();

const nextId = (prefix: string) => `${prefix}_${++seq}`;
const noop = () => {};

/** Replaces the transport (tests); drops the current session. */
export function setTransport(t: TvTransport): void {
  if (session) {
    endSession(session, TV_NOT_CONNECTED);
    void transport.tvDisconnect().catch(noop);
  }
  transport = t;
  tvState.value = 'idle';
  tvError.value = '';
}

function endSession(s: Session, reason: string): void {
  if (session !== s) return;
  session = null;
  connecting = null;
  pointer = null;
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
    p.reject(new Error(TV_NOT_CONNECTED));
  }
}

function fail(s: Session, message: string): void {
  if (session !== s) return;
  endSession(s, message);
  void transport.tvDisconnect().catch(noop);
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
    s.tv = { ip: s.tv.ip, name: s.tv.name, clientKey: typeof key === 'string' && key ? key : s.tv.clientKey };
    saveTv(s.tv);
    setActiveTv(s.tv.ip);
    clearTimeout(s.reg.timer);
    const reg = s.reg;
    s.reg = null;
    connecting = null;
    tvState.value = 'connected';
    tvError.value = '';
    reg.resolve();
  } else if (m.type === 'error') {
    const text = String(m.error ?? m.payload?.errorText ?? '');
    if (s.signed && /blacklisted certificate/i.test(text)) {
      // Newer firmware rejects the shared signed manifest; lgtv2 retries unsigned.
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
    void transport.tvDisconnect().catch(noop);
  }
  const s: Session = { tv, off: [], registerId: nextId('register'), signed: true, reg: null };
  const promise = new Promise<void>((resolve, reject) => {
    s.reg = { resolve, reject };
  });
  session = s;
  connecting = promise;
  tvState.value = 'connecting';
  tvError.value = '';
  // Listeners must be in place before the socket opens: the TV answers `register` right away.
  s.off.push(transport.onTvMessage((m) => onMessage(s, m)));
  s.off.push(transport.onTvClosed(() => onClosed(s)));
  armRegistration(s, REQUEST_TIMEOUT);
  transport.tvConnect(tv.ip, registerMessage(s.registerId, tv.clientKey)).catch(() => fail(s, TV_NO_ANSWER));
  return promise;
}

async function ensureConnected(): Promise<void> {
  if (session && tvState.value === 'connected') return;
  if (connecting) return connecting;
  const tv = activeTv.value;
  if (!tv) throw new Error(TV_NOT_CONNECTED);
  return connectTv(tv);
}

function send(uri: string, payload?: object): Promise<any> {
  if (!session || tvState.value !== 'connected') return Promise.reject(new Error(TV_NOT_CONNECTED));
  const s = session;
  const id = nextId('req');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pending.delete(id)) return;
      reject(new Error(TV_NO_ANSWER));
      // A dead socket may stay "open" for minutes without tvClosed; drop it so the next action reconnects.
      fail(s, TV_NO_ANSWER);
    }, REQUEST_TIMEOUT);
    pending.set(id, { resolve, reject, timer });
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

async function sendFrame(frame: string): Promise<void> {
  await ensureConnected();
  // One retry: the pointer socket may have been closed by the TV (e.g. after an app switch).
  for (let attempt = 0; ; attempt++) {
    try {
      await ensurePointer();
    } catch (e) {
      throw e instanceof TvAnswerError ? new Error(TV_NO_ANSWER) : e;
    }
    try {
      await transport.pointerSend(frame);
      return;
    } catch {
      pointer = null;
      if (attempt >= 1) throw new Error(TV_NOT_CONNECTED);
    }
  }
}

export async function launchOnTv(params: object): Promise<void> {
  try {
    await request('ssap://system.launcher/launch', launchOmpPayload(params));
  } catch (e) {
    if (!(e instanceof TvAnswerError)) throw e;
    throw new Error(/no such app|not found|not exist|404|-101/i.test(e.raw) ? TV_NO_OMP : TV_LAUNCH_FAILED);
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

export async function turnOffTv(): Promise<void> {
  await request('ssap://system/turnOff');
}

/** Closes the sockets; the plugin sends no tvClosed for this, so the state is reset here. */
export async function disconnectTv(): Promise<void> {
  const s = session;
  if (s) endSession(s, TV_NOT_CONNECTED);
  tvState.value = 'idle';
  tvError.value = '';
  if (s) await transport.tvDisconnect().catch(noop);
}
