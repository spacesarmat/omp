// TV client. LG webOS: SSAP on top of the native transport (pairing, request/response by id, pointer socket).
// Android TV with OMP (`kind: 'atv'`): HTTP to its control server (`/omp/*`, bearer token from code pairing).
import { signal, effect } from '@preact/signals';
import { native, type OmpNativeApi, type FoundOmpTv } from '../platform/native';
import { activeTv, saveTv, setActiveTv, clearTvToken, normalizeMac, updateAtvPorts, ATV_PORT, type SavedTv, type TvKind } from './tvStore';
import { showToast } from '../ui/toast';
import { phoneParam, markPhoneSent } from './phoneRpc';
import { log } from '../../../src/lib/log';
import { lang, t } from '../../../src/i18n';
import { isRutrackerResult, TRANSFER_PATH, type RutrackerResult, type TransferPayload } from '../../../src/sources/transfer';
import {
  registerMessage,
  requestMessage,
  buttonFrame,
  moveFrame,
  clickFrame,
  scrollFrame,
  launchOmpPayload,
  type RemoteButton,
} from './ssap';

export type TvTransport = Pick<
  OmpNativeApi,
  'tvConnect' | 'tvSend' | 'onTvMessage' | 'onTvClosed' | 'pointerConnect' | 'pointerSend' | 'tvDisconnect'
>;

export type TvState = 'idle' | 'connecting' | 'pairing' | 'connected' | 'error';

export const tvNotConnected = () => t('tvLink.notConnected');
export const tvNoOmp = () => t('tvLink.noOmp');
export const tvNoAnswer = () => t('remote.mini.noAnswer');
export const tvDeclined = () => t('tvLink.declined');
export const tvPointerDenied = () => t('tvLink.pointerDenied');
const tvLaunchFailed = () => t('tvLink.launchFailed');
export const tvForgot = () => t('tvLink.forgot');
export const atvBackground = () => t('tvLink.atvBackground');
export const atvUnsupported = () => t('tvLink.atvUnsupported');
export const pairBadCode = () => t('tvLink.badCode');
/** OMP control server answered 4xx (bad request, unknown route, unsupported body…). */
export const atvRejected = () => t('tvLink.rejected');
/** Any other unexpected answer of the OMP control server. */
export const atvError = () => t('tvLink.atvError');
export const pairExpired = () => t('tvLink.codeExpired');

const REQUEST_TIMEOUT = 8000;
/** The native side races ws:3000 and wss:3001 (3 s each; a saved port gets a 2 s head start). */
const SOCKET_OPEN_TIMEOUT = 12000;
/** The user needs time to find the remote and press «Разрешить». */
const PAIRING_TIMEOUT = 60000;
const POINTER_URI = 'ssap://com.webos.service.networkinput/getPointerInputSocket';
const GETINFO_URI = 'ssap://com.webos.service.connectionmanager/getinfo';
const PERMISSION_ERROR = /401|insufficient permissions|not permitted|denied/i;

export const tvState = signal<TvState>('idle');
export const tvError = signal('');
/** True while a background warm-up keeps retrying the connection (the TV may be waking up). */
export const tvWaking = signal(false);

const WARM_RETRY_MS = 1500;
const WARM_LIMIT_MS = 30000;
/** How long a warm-up looks for an Android TV that moved to another port. */
const REDISCOVER_MS = 3000;

let rediscoverAtv: (ms: number) => Promise<FoundOmpTv[]> = (ms) => native.discoverOmpTvs(ms);

/** Replaces the NSD look of the warm-up (tests); null restores the native one. */
export function setAtvRediscover(fn: ((ms: number) => Promise<FoundOmpTv[]>) | null): void {
  rediscoverAtv = fn || ((ms) => native.discoverOmpTvs(ms));
}
const QUEUE_MAX = 10;
const QUEUE_TTL_MS = 15000;

/** Error answered by the TV; `raw` keeps its original text. */
class TvAnswerError extends Error {
  constructor(public raw: string) {
    super(t('tvLink.answerError', { raw: raw }));
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
  /** Install assistant: pairing saves the TV but leaves the active TV as it is. */
  keepActive: boolean;
  /** Set while registration is in progress. */
  reg: { resolve: () => void; reject: (e: Error) => void; timer?: ReturnType<typeof setTimeout> } | null;
}

let warmActive = false;
let warmError = '';
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
    endSession(session, tvNotConnected());
    void closeTransport();
  }
  endAtv();
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
    else p.reject(new Error(tvNotConnected()));
  }
}

function fail(s: Session, message: string): void {
  if (session !== s) return;
  endSession(s, message);
  void closeTransport();
  log('warn', 'tv', 'LG: ' + message);
  tvState.value = 'error';
  // While a warm-up retries, its failures stay silent until it gives up.
  if (warmActive) warmError = message;
  else tvError.value = message;
}

function armRegistration(s: Session, ms: number): void {
  if (!s.reg) return;
  clearTimeout(s.reg.timer);
  s.reg.timer = setTimeout(() => fail(s, tvNoAnswer()), ms);
}

function onRegisterMessage(s: Session, m: any): void {
  if (!s.reg) return;
  if (m.type === 'response' && m.payload?.pairingType === 'PROMPT') {
    tvState.value = 'pairing';
    armRegistration(s, PAIRING_TIMEOUT);
  } else if (m.type === 'registered') {
    const key = m.payload?.['client-key'];
    // kind 'lg' explicitly: the IP may belong to an Android TV saved earlier (DHCP reuse)
    s.tv = {
      ip: s.tv.ip,
      name: s.tv.name,
      kind: 'lg',
      clientKey: typeof key === 'string' && key ? key : s.tv.clientKey,
      port: s.tv.port,
    };
    saveTv(s.tv, { keepActive: s.keepActive });
    if (!s.keepActive) setActiveTv(s.tv.ip);
    clearTimeout(s.reg.timer);
    const reg = s.reg;
    s.reg = null;
    connecting = null;
    tvState.value = 'connected';
    tvError.value = '';
    reg.resolve();
    // Open the pointer socket now so the first press does not wait for it (errors are ignored).
    ensurePointer(true).catch(noop);
    // Learn the MAC for Wake-on-LAN (soft: a failure never touches the session).
    const mySession = s;
    send(GETINFO_URI, undefined, false, true).then((info) => {
      const mac = macFromInfo(info, mySession.tv.ip);
      if (mac && session === mySession) {
        mySession.tv = { ...mySession.tv, mac };
        saveTv(mySession.tv, { keepActive: mySession.keepActive });
      }
    }, noop);
  } else if (m.type === 'error') {
    const text = String(m.error ?? m.payload?.errorText ?? '');
    if (s.signed && /blacklisted certificate/i.test(text)) {
      // Newer firmware rejects the shared signed manifest; lgtv2 retries without `signed`.
      s.signed = false;
      s.registerId = nextId('register');
      armRegistration(s, REQUEST_TIMEOUT);
      transport.tvSend(registerMessage(s.registerId, s.tv.clientKey, false)).catch(() => fail(s, tvNoAnswer()));
    } else {
      fail(s, tvDeclined());
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
    fail(s, tvNoAnswer());
    return;
  }
  endSession(s, tvNotConnected());
  tvState.value = 'idle';
}

/** MAC from a connectionmanager/getinfo answer: wired when it is connected (or has this IP), else Wi-Fi. */
export function macFromInfo(info: any, ip: string): string | undefined {
  const wired = info?.wiredInfo;
  const wifi = info?.wifiInfo;
  const wiredMac = normalizeMac(wired?.macAddress);
  const wifiMac = normalizeMac(wifi?.macAddress);
  const isWired = !!wired && (wired.state === 'connected' || wired.ipAddress === ip);
  const isWifi = !!wifi && wifi.ipAddress === ip;
  if (isWired && wiredMac) return wiredMac;
  if (isWifi && wifiMac) return wifiMac;
  return wifiMac ?? wiredMac;
}

export interface ConnectOptions {
  /** Do not make this TV the active one (install assistant inspecting another TV). */
  keepActive?: boolean;
}

export function connectTv(tv: SavedTv, opts: ConnectOptions = {}): Promise<void> {
  if (tv.kind === 'atv') return connectAtv(tv, opts);
  endAtv();
  if (session && session.tv.ip === tv.ip) {
    if (tvState.value === 'connected') return Promise.resolve();
    if (connecting) return connecting;
  }
  if (session) {
    endSession(session, tvNotConnected());
    void closeTransport();
  }
  const s: Session = {
    tv: { ...tv, kind: 'lg' },
    off: [],
    registerId: nextId('register'),
    signed: true,
    keepActive: !!opts.keepActive,
    reg: null,
  };
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
          if (tvState.value === 'connected') saveTv(s.tv, { keepActive: s.keepActive });
        }
        // Socket open and `register` sent: now the TV has 8 s to answer (unless it already asked the user).
        if (session === s && tvState.value === 'connecting') armRegistration(s, REQUEST_TIMEOUT);
      },
      () => fail(s, tvNoAnswer()),
    );
  return promise;
}

async function ensureConnected(): Promise<void> {
  if (session && tvState.value === 'connected') return;
  if (connecting) return connecting;
  if (atv && tvState.value === 'connected') return;
  if (atvConnecting) return atvConnecting;
  const tv = activeTv.value;
  if (!tv) throw new Error(tvNotConnected());
  return connectTv(tv);
}

/** `soft`: a timeout rejects without dropping the session (background requests). */
function send(uri: string, payload?: object, closeOk = false, soft = false): Promise<any> {
  if (!session || tvState.value !== 'connected') return Promise.reject(new Error(tvNotConnected()));
  const s = session;
  const id = nextId('req');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pending.delete(id)) return;
      if (closeOk) {
        resolve({});
        return;
      }
      reject(new Error(tvNoAnswer()));
      if (soft) return;
      // A dead socket may stay "open" for minutes without tvClosed; drop it so the next action reconnects.
      fail(s, tvNoAnswer());
    }, REQUEST_TIMEOUT);
    pending.set(id, { resolve, reject, timer, closeOk });
    transport.tvSend(requestMessage(id, uri, payload)).catch(() => {
      if (!pending.delete(id)) return;
      clearTimeout(timer);
      reject(new Error(tvNotConnected()));
    });
  });
}

async function request(uri: string, payload?: object): Promise<any> {
  await ensureConnected();
  return send(uri, payload);
}

function ensurePointer(soft = false): Promise<void> {
  if (!pointer) {
    const p: Promise<void> = send(POINTER_URI, undefined, false, soft).then((r) => {
      if (typeof r?.socketPath !== 'string') throw new Error(tvNoAnswer());
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
  timer: ReturnType<typeof setTimeout>;
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
        if (tvState.value !== 'connected') throw new Error(tvError.value || tvNoAnswer());
      } catch (e) {
        const err = new Error(tvError.value || (e instanceof Error ? e.message : tvNoAnswer()));
        for (const q of outbox.splice(0)) {
          clearTimeout(q.timer);
          q.reject(err);
        }
        return;
      }
      const q = outbox.shift();
      if (!q) break; // everything expired while waiting
      clearTimeout(q.timer);
      await sendFrameNow(q.frame).then(q.resolve, q.reject);
    }
  } finally {
    draining = false;
  }
}

function sendFrame(frame: string, droppable = false): Promise<void> {
  if (outbox.length === 0 && !draining && !isBusy()) return sendFrameNow(frame);
  // Pointer moves made while connecting would replay as a cursor jump later: drop them.
  if (droppable && isBusy()) return Promise.resolve();
  // Presses made while connecting wait here and go out in order once the TV is ready.
  return new Promise<void>((resolve, reject) => {
    // Overflowing and expired presses are dropped silently (no toast per press).
    if (outbox.length >= QUEUE_MAX) {
      const old = outbox.shift()!;
      clearTimeout(old.timer);
      old.resolve();
    }
    const q: QueuedFrame = {
      frame,
      resolve,
      reject,
      timer: setTimeout(() => {
        const i = outbox.indexOf(q);
        if (i >= 0) outbox.splice(i, 1);
        resolve();
      }, QUEUE_TTL_MS),
    };
    outbox.push(q);
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
      if (e instanceof TvAnswerError) throw new Error(PERMISSION_ERROR.test(e.raw) ? tvPointerDenied() : e.message);
      // The soft prefetch may have timed out; retry once with a fresh (hard) request.
      if (pointer === used) pointer = null;
      if (attempt >= 1) throw e;
      continue;
    }
    try {
      await transport.pointerSend(frame);
      return;
    } catch {
      // Keep a fresh pointer another call may have opened meanwhile.
      if (pointer === used) pointer = null;
      if (attempt >= 1) throw new Error(tvNotConnected());
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
  const first = activeTv.value;
  if (!first || tvState.value === 'connected' || tvState.value === 'connecting' || tvState.value === 'pairing') {
    return Promise.resolve();
  }
  let tv: SavedTv = first;
  let stopped = false;
  let wake: (() => void) | null = null;
  const stop = () => {
    stopped = true;
    // a later warmUp() may start a new run
    warming = null;
    wake?.();
  };
  cancelWarm = stop;
  let pairing = false;
  warmActive = true;
  warmError = '';
  const watch = effect(() => {
    if (tvState.value === 'pairing') pairing = true;
    if (activeTv.value?.ip !== tv.ip) stop();
    // another session (a user connect to a different TV) took over: do not fight it
    const ip = sessionIp.value;
    if (ip && ip !== tv.ip) stop();
  });
  const started = Date.now();
  // an Android TV that does not answer may have moved to another port (8095 taken): one NSD look, then retry
  let rediscovered = false;
  let p!: Promise<void>;
  p = (async () => {
    try {
      for (;;) {
        try {
          await connectTv(tv);
          return;
        } catch (e) {
          // only a new pairing code helps
          if (e instanceof Error && e.message === tvForgot()) return;
        }
        if (tv.kind === 'atv' && !rediscovered && !stopped) {
          rediscovered = true;
          try {
            if (updateAtvPorts(await rediscoverAtv(REDISCOVER_MS))) {
              const cur = activeTv.value;
              if (cur && cur.ip === tv.ip) {
                tv = cur;
                continue;
              }
            }
          } catch {
            // no NSD: retry on the saved port
          }
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
        if (stopped || pairing) return;
      }
    } finally {
      watch();
      tvWaking.value = false;
      if (cancelWarm === stop) warmActive = false;
      if (!stopped && tvState.value === 'error' && !tvError.value) tvError.value = warmError;
      if (cancelWarm === stop) cancelWarm = null;
      if (warming === p) warming = null;
    }
  })();
  warming = p;
  return p;
}

/**
 * Opens OMP on the TV with launch params (LG: system.launcher, Android TV: /omp/launch). Every launch carries the
 * phone's resolved UI language as `lang`: the TV stores it as its own language (an older OMP ignores it). An LG launch
 * also carries `phone`, the address of this phone's search server, while the TV search switch is on; Android TV
 * searches with its own sources, so it does not get it.
 */
export async function launchOnTv(params: object): Promise<void> {
  params = { ...params, lang: lang.value };
  if (tvKind() === 'atv') {
    await atvPost('/omp/launch', { params });
    checkForeground();
    return;
  }
  const phone = phoneParam();
  try {
    const tv = session ? session.tv.ip : null;
    await request('ssap://system.launcher/launch', launchOmpPayload(phone ? { ...params, phone } : params));
    if (tv) markPhoneSent(tv, phone);
  } catch (e) {
    if (!(e instanceof TvAnswerError)) throw e;
    throw new Error(/no such app|not found|not exist|404|-101/i.test(e.raw) ? tvNoOmp() : tvLaunchFailed());
  }
}

const OMP_APP_ID = 'com.spacesarmat.torrplayer';

/** Id of the app in the TV foreground; null when unknown or the TV does not answer. */
export async function foregroundAppId(): Promise<string | null> {
  if (tvKind() === 'atv') {
    const info = await atvInfo();
    return info?.foreground ? OMP_APP_ID : null;
  }
  try {
    const r = await request('ssap://com.webos.applicationManager/getForegroundAppInfo');
    return typeof r?.appId === 'string' && r.appId ? r.appId : null;
  } catch {
    return null;
  }
}

/** Installed OMP version on the TV (cached per connection); null when unknown. */
export async function ompVersionOnTv(): Promise<string | null> {
  if (tvKind() === 'atv') {
    const cached = atv && tvState.value === 'connected' ? atv.info : null;
    const info = cached || (await atvInfo());
    return info?.version || null;
  }
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

/** What the install assistant learns from a paired LG TV; each field is missing when the TV did not answer it. */
export interface LgInstallInfo {
  /** getSystemInfo `modelName`, e.g. «OLED55C1RLA». */
  model?: string;
  /** getCurrentSWInformation `product_name`, e.g. «webOSTV 6.0». */
  productName?: string;
  /** getCurrentSWInformation `model_name` (firmware code), e.g. «HE_DTV_W21O_AFABATAA». */
  swModel?: string;
  /** Installed apps (listApps); null when the list is unavailable. */
  apps: Array<{ id: string; version?: string }> | null;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : undefined);

/**
 * LG only, on the connected session: model, webOS version and installed apps for the install assistant. Every
 * request is soft (a silent TV never drops the session); the TV's other fields (device id, MAC…) are not kept.
 */
export async function lgInstallInfo(): Promise<LgInstallInfo> {
  if (!session || tvState.value !== 'connected') throw new Error(tvNotConnected());
  const ip = sessionIp.value;
  const soft = (uri: string) => send(uri, undefined, false, true).catch(() => null);
  const [sys, sw, list] = await Promise.all([
    soft('ssap://system/getSystemInfo'),
    soft('ssap://com.webos.service.update/getCurrentSWInformation'),
    soft('ssap://com.webos.applicationManager/listApps'),
  ]);
  const info: LgInstallInfo = { apps: null };
  const model = str(sys?.modelName);
  const productName = str(sw?.product_name);
  const swModel = str(sw?.model_name);
  if (model) info.model = model;
  if (productName) info.productName = productName;
  if (swModel) info.swModel = swModel;
  const apps = parseApps(list);
  if (apps) {
    info.apps = apps;
    const omp = apps.find((a) => a.id === OMP_APP_ID);
    if (omp?.version && ip !== null && sessionIp.value === ip && tvState.value === 'connected') {
      versionCache = { ip, version: omp.version };
    }
  }
  return info;
}

function parseApps(list: any): Array<{ id: string; version?: string }> | null {
  if (!Array.isArray(list?.apps)) return null;
  const apps: Array<{ id: string; version?: string }> = [];
  for (const a of list.apps) {
    if (!a || typeof a.id !== 'string' || !a.id) continue;
    const version = str(a.version);
    apps.push(version ? { id: a.id, version } : { id: a.id });
  }
  return apps;
}

/** LG only, on the connected session: installed app ids (one soft listApps); null when unknown. */
export async function lgAppIds(): Promise<string[] | null> {
  if (!session || tvState.value !== 'connected') return null;
  const list = await send('ssap://com.webos.applicationManager/listApps', undefined, false, true).catch(() => null);
  const apps = parseApps(list);
  return apps ? apps.map((a) => a.id) : null;
}

/** LG only: launches an app on the TV (e.g. Homebrew Channel with its addRepository params). */
export async function launchLgApp(id: string, params: object = {}): Promise<void> {
  if (tvKind() === 'atv') throw new Error(atvUnsupported());
  try {
    await request('ssap://system.launcher/launch', { id, params });
  } catch (e) {
    if (!(e instanceof TvAnswerError)) throw e;
    throw new Error(t('tvLink.openAppFailed'));
  }
}

export function pressButton(name: RemoteButton): Promise<void> {
  if (tvKind() === 'atv') {
    if (ATV_KEYS.indexOf(name) < 0) return Promise.reject(new Error(atvUnsupported()));
    return atvPost('/omp/key', { name }).then(noop);
  }
  return sendFrame(buttonFrame(name));
}

/** Android TV only: «Каталог» / «Сейчас играет» in OMP. */
export function pressAtvKey(name: 'CATALOG' | 'NOWPLAYING'): Promise<void> {
  if (tvKind() !== 'atv') return Promise.reject(new Error(tvNotConnected()));
  return atvPost('/omp/key', { name }).then(noop);
}

export function moveCursor(dx: number, dy: number): Promise<void> {
  if (tvKind() === 'atv') return Promise.reject(new Error(atvUnsupported()));
  return sendFrame(moveFrame(dx, dy), true);
}

/** LG only: two-finger scroll on the touchpad; dropped while the TV is busy, like cursor moves. */
export function scroll(dx: number, dy: number): Promise<void> {
  if (tvKind() === 'atv') return Promise.reject(new Error(atvUnsupported()));
  return sendFrame(scrollFrame(dx, dy), true);
}

export function click(): Promise<void> {
  if (tvKind() === 'atv') return Promise.reject(new Error(atvUnsupported()));
  return sendFrame(clickFrame());
}

export async function volume(dir: 'up' | 'down'): Promise<void> {
  if (tvKind() === 'atv') {
    await atvPost('/omp/volume', { dir });
    return;
  }
  await request(dir === 'up' ? 'ssap://audio/volumeUp' : 'ssap://audio/volumeDown');
}

export async function typeText(text: string): Promise<void> {
  if (tvKind() === 'atv') {
    await atvPost('/omp/text', { text });
    return;
  }
  await request('ssap://com.webos.service.ime/insertText', { text, replace: 0 });
}

export async function deleteText(n: number): Promise<void> {
  if (tvKind() === 'atv') {
    await atvPost('/omp/text', { delete: n });
    return;
  }
  await request('ssap://com.webos.service.ime/deleteCharacters', { count: n });
}

export async function sendEnter(): Promise<void> {
  if (tvKind() === 'atv') {
    await atvPost('/omp/text', { enter: true });
    return;
  }
  await request('ssap://com.webos.service.ime/sendEnterKey');
}

/** The TV may drop the socket before answering: a close or timeout after sending counts as success. */
export async function turnOffTv(): Promise<void> {
  if (tvKind() === 'atv') throw new Error(atvUnsupported());
  await ensureConnected();
  await send('ssap://system/turnOff', undefined, true);
  await disconnectTv();
}

/** Closes the sockets; the plugin sends no tvClosed for this, so the state is reset here. */
export async function disconnectTv(): Promise<void> {
  const s = session;
  if (s) endSession(s, tvNotConnected());
  endAtv();
  tvState.value = 'idle';
  tvError.value = '';
  if (s) await closeTransport();
}

// ---- Android TV with OMP: HTTP control server ----

interface AtvInfo {
  name: string;
  version: string;
  paired: boolean;
  foreground: boolean;
}

interface AtvSession {
  tv: SavedTv;
  info: AtvInfo | null;
}

/** Keys the OMP control server accepts from the shared remote buttons. */
// the colour keys and «Меню» reach OMP on the box as the LG codes 403–406 and 457 (src/platform/androidRemote.ts)
const ATV_KEYS: RemoteButton[] = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'ENTER', 'BACK', 'MENU', 'RED', 'GREEN', 'YELLOW', 'BLUE'];
const ATV_TIMEOUT = 5000;
/** Android brings OMP to the front asynchronously (and may refuse to from the background). */
const ATV_FOREGROUND_CHECK_MS = 2500;
const TOKEN = /^[0-9a-f]{32}$/;

let atv: AtvSession | null = null;
let atvConnecting: Promise<void> | null = null;

/** Kind of the TV the client talks to: the current session's, else the active TV's. */
export function tvKind(): TvKind {
  if (atv) return 'atv';
  if (session) return 'lg';
  return activeTv.value?.kind === 'atv' ? 'atv' : 'lg';
}

function endAtv(): void {
  if (!atv) return;
  atv = null;
  atvConnecting = null;
  sessionIp.value = null;
}

function atvFail(s: AtvSession, message: string): void {
  if (atv !== s) return;
  // the token is dead: the next tap on the TV asks for a code right away
  if (message === tvForgot()) clearTvToken(s.tv.ip, s.tv.token);
  endAtv();
  log('warn', 'tv', 'Android TV: ' + message);
  tvState.value = 'error';
  // While a warm-up retries, its failures stay silent until it gives up.
  if (warmActive) warmError = message;
  else tvError.value = message;
}

interface AtvAnswer {
  status: number;
  data: any;
}

/** Russian text for an unexpected status of the control server (never a raw code like «bad_request» or «400»). */
export function atvErrorText(status: number): string {
  return status >= 400 && status < 500 ? atvRejected() : atvError();
}

/** tvNoAnswer() after the request timed out (the TV may be alive, only slow), as opposed to a network failure. */
function timeoutError(): Error {
  const e = new Error(tvNoAnswer());
  (e as Error & { timeout?: boolean }).timeout = true;
  return e;
}

function isTimeout(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { timeout?: unknown }).timeout === true;
}

/** One request to the control server; a network failure or 5 s of silence -> tvNoAnswer(). */
function atvFetch(tv: SavedTv, method: 'GET' | 'POST', path: string, body?: object, timeoutMs = ATV_TIMEOUT): Promise<AtvAnswer> {
  const headers: Record<string, string> = {};
  if (tv.token) headers.Authorization = 'Bearer ' + tv.token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort();
      reject(timeoutError());
    }, timeoutMs);
  });
  const url = 'http://' + tv.ip + ':' + (tv.ctlPort || ATV_PORT) + path;
  const run = (async (): Promise<AtvAnswer> => {
    let r: Response;
    try {
      r = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch {
      throw new Error(tvNoAnswer());
    }
    const text = await r.text().catch(() => '');
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    return { status: r.status, data };
  })();
  return Promise.race([run, timeout]).finally(() => clearTimeout(timer));
}

function parseInfo(d: any): AtvInfo | null {
  if (!d || typeof d !== 'object') return null;
  return {
    name: typeof d.name === 'string' ? d.name : '',
    version: typeof d.version === 'string' ? d.version : '',
    paired: d.paired === true,
    foreground: d.foreground === true,
  };
}

function connectAtv(tv: SavedTv, opts: ConnectOptions = {}): Promise<void> {
  if (atv && atv.tv.ip === tv.ip && atv.tv.token === tv.token) {
    if (tvState.value === 'connected') return Promise.resolve();
    if (atvConnecting) return atvConnecting;
  }
  if (session) {
    endSession(session, tvNotConnected());
    void closeTransport();
  }
  endAtv();
  const s: AtvSession = { tv, info: null };
  atv = s;
  sessionIp.value = tv.ip;
  tvState.value = 'connecting';
  tvError.value = '';
  const p = (async () => {
    let r: AtvAnswer;
    try {
      r = await atvFetch(tv, 'GET', '/omp/info');
    } catch {
      atvFail(s, tvNoAnswer());
      throw new Error(tvNoAnswer());
    }
    if (atv !== s) throw new Error(tvNotConnected());
    const info = r.status === 200 ? parseInfo(r.data) : null;
    if (!info) {
      atvFail(s, tvNoAnswer());
      throw new Error(tvNoAnswer());
    }
    if (!info.paired) {
      atvFail(s, tvForgot());
      throw new Error(tvForgot());
    }
    s.info = info;
    atvConnecting = null;
    tvState.value = 'connected';
    tvError.value = '';
    saveTv(s.tv, opts);
    if (!opts.keepActive) setActiveTv(s.tv.ip);
  })();
  atvConnecting = p;
  return p;
}

/** Authorised POST to the Android TV (connecting first); a 401 means the TV forgot this phone. */
async function atvPost(path: string, body: object): Promise<any> {
  await ensureConnected();
  const s = atv;
  if (!s || tvState.value !== 'connected') throw new Error(tvNotConnected());
  let r: AtvAnswer;
  try {
    r = await atvFetch(s.tv, 'POST', path, body);
  } catch (e) {
    // the next action reconnects
    atvFail(s, tvNoAnswer());
    throw e;
  }
  if (r.status === 401) {
    atvFail(s, tvForgot());
    throw new Error(tvForgot());
  }
  if (r.status < 200 || r.status >= 300) {
    throw new Error(atvErrorText(r.status));
  }
  return r.data;
}

/** Fresh `/omp/info` of the Android TV (connecting first); null when unknown. */
async function atvInfo(): Promise<AtvInfo | null> {
  try {
    await ensureConnected();
  } catch {
    return null;
  }
  const s = atv;
  if (!s) return null;
  try {
    const r = await atvFetch(s.tv, 'GET', '/omp/info');
    const info = r.status === 200 ? parseInfo(r.data) : null;
    if (!info) return null;
    if (!info.paired) {
      atvFail(s, tvForgot());
      return null;
    }
    if (atv === s) s.info = info;
    return info;
  } catch {
    return null;
  }
}

/** After a launch: Android may keep OMP in the background; then the user opens it with the TV remote. */
function checkForeground(): void {
  const s = atv;
  setTimeout(() => {
    if (!s || atv !== s || tvState.value !== 'connected') return;
    atvInfo().then((info) => {
      if (info && !info.foreground) showToast(atvBackground(), 6000);
    }, noop);
  }, ATV_FOREGROUND_CHECK_MS);
}

/** Android TV: links «Сейчас играет» to `report` and sets the TV's language to the phone's (`lang`). */
export async function attachOnTv(report: string): Promise<void> {
  await atvPost('/omp/attach', { report, lang: lang.value });
}

export const sourcesAtvOnly = () => t('tvLink.sourcesAtvOnly');
export const sourcesBusy = () => t('tvLink.sourcesBusy');
export const sourcesNoAnswer = () => t('tvLink.sourcesNoAnswer');
export const sourcesFailed = () => t('tvLink.sourcesFailed');
export const sourcesSecrets = () => t('sources.browser.tvErrors.storeFailed');
/** 400 / 413: the TV did not accept the payload (an older OMP there does not know the Jackett / Prowlarr part). */
export const sourcesRejected = () => t('tvLink.sourcesRejected');
/** The TV may sign in to rutracker before it answers (its own wait is 35 s). */
const SOURCES_TIMEOUT = 45000;

/**
 * «Передать на телевизор»: POST /omp/sources with the switches and, when given, the rutracker login (only to the
 * paired Android TV, over its token). Resolves the TV's rutracker result (undefined without a login); rejects in
 * Russian. The body is never logged. `sessions` (sites signed in through the browser → their hosts): the request goes
 * through the native side, which adds each site's session cookies and User-Agent (they never pass through the page).
 */
export async function sendSourcesToTv(
  payload: TransferPayload,
  sessions?: { [id: string]: string[] },
  send: Pick<OmpNativeApi, 'siteSessionSend' | 'pairedTv'> = native,
): Promise<SourcesSent> {
  if (tvKind() !== 'atv') throw new Error(sourcesAtvOnly());
  await ensureConnected();
  const s = atv;
  if (!s || tvState.value !== 'connected') throw new Error(tvNotConnected());
  const withSessions = !!sessions && Object.keys(sessions).length > 0;
  let r: AtvAnswer;
  let missing: string[] = [];
  try {
    if (withSessions && s.tv.token) {
      // the native side posts only to the TV registered as paired (this one), never to an address in the call
      await send.pairedTv({ url: 'http://' + s.tv.ip + ':' + (s.tv.ctlPort || ATV_PORT), token: s.tv.token });
      const n = await send.siteSessionSend({
        payload,
        sessions: sessions!,
        timeoutMs: SOURCES_TIMEOUT,
      });
      r = { status: n.status, data: n.data };
      missing = n.missing;
    } else r = await atvFetch(s.tv, 'POST', TRANSFER_PATH, payload, SOURCES_TIMEOUT);
  } catch (e) {
    // a slow sign-in on the TV is not a dead TV: only a network failure ends the session
    if (!isTimeout(e)) atvFail(s, tvNoAnswer());
    throw new Error(sourcesNoAnswer());
  }
  if (r.status === 401) {
    atvFail(s, tvForgot());
    throw new Error(tvForgot());
  }
  // 400: an older OMP does not know a field; 413: its body limit was 8 KB (v0.14)
  if (r.status === 400 || r.status === 413) throw new Error(sourcesRejected());
  if (r.status === 409) throw new Error(sourcesBusy());
  if (r.status === 503) throw new Error(sourcesNoAnswer());
  if (r.status === 500) throw new Error(r.data?.error === 'secrets' ? sourcesSecrets() : sourcesFailed());
  if (r.status !== 200 || !r.data || r.data.ok !== true) throw new Error(r.status === 200 ? atvError() : atvErrorText(r.status));
  const out: SourcesSent = {};
  if (payload.indexers && payload.indexers.length) {
    const n = r.data.indexers;
    out.indexers = typeof n === 'number' && n >= 0 && n <= payload.indexers.length ? Math.floor(n) : 0;
  }
  if (payload.rutracker) out.rutracker = isRutrackerResult(r.data.rutracker) ? r.data.rutracker : 'error';
  // the TV verified the rutracker login but could not write it (the site results still hold)
  if (payload.rutracker && r.data.rutrackerNotStored === true) out.rutrackerNotStored = true;
  if (payload.logins) {
    // per site that was sent; anything else from the TV is ignored
    const got = r.data.logins && typeof r.data.logins === 'object' ? (r.data.logins as { [k: string]: unknown }) : {};
    const logins: { [site: string]: RutrackerResult } = {};
    Object.keys(payload.logins).forEach((site) => {
      const v = got[site];
      logins[site] = isRutrackerResult(v) ? v : 'error';
    });
    out.logins = logins;
  }
  if (withSessions) {
    // per site that was asked for; a site whose session the phone had not (any more) is «missing»
    const got = r.data.sessions && typeof r.data.sessions === 'object' ? (r.data.sessions as { [k: string]: unknown }) : {};
    const res: { [site: string]: 'ok' | 'error' | 'missing' } = {};
    Object.keys(sessions!).forEach((site) => {
      res[site] = missing.indexOf(site) >= 0 ? 'missing' : got[site] === 'ok' ? 'ok' : 'error';
    });
    out.sessions = res;
  }
  return out;
}

/** What the TV said about a transfer: the rutracker login, how many connections it saved, each site login. */
export interface SourcesSent {
  rutracker?: RutrackerResult;
  indexers?: number;
  logins?: { [site: string]: RutrackerResult };
  rutrackerNotStored?: boolean;
  /** Browser sessions: ok (the TV verified and kept it) | error | missing (the phone had no session to send). */
  sessions?: { [site: string]: 'ok' | 'error' | 'missing' };
}

/**
 * Pairs with an Android TV by the code on its screen, saves it with the token, makes it active and connects.
 * Rejects only when pairing fails; a failed connect after it shows in tvState / tvError (the TV is saved).
 */
export async function pairAtv(found: FoundOmpTv, code: string): Promise<void> {
  const tv: SavedTv = { ip: found.ip, name: found.name, kind: 'atv', ctlPort: found.port || ATV_PORT };
  const phone = await native.phoneName().catch(() => t('history.phone'));
  const r = await atvFetch(tv, 'POST', '/omp/pair', { code, phone });
  if (r.status === 403) throw new Error(r.data?.error === 'expired' ? pairExpired() : pairBadCode());
  const token = r.data?.token;
  if (r.status !== 200 || typeof token !== 'string' || !TOKEN.test(token)) {
    throw new Error(r.status === 200 ? atvError() : atvErrorText(r.status));
  }
  cancelWarmUp();
  saveTv({ ...tv, token });
  setActiveTv(tv.ip);
  await connectTv(activeTv.value || { ...tv, token }).catch(noop);
}
