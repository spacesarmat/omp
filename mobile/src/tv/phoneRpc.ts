// TV search: the switch of the phone's TV search server (PhoneRpcService) and the address the phone hands
// to the TV in its launch params (`phone`). The token is a credential: it is never logged or shown.
import { signal, computed, effect, untracked, type ReadonlySignal } from '@preact/signals';
import { native, type RpcInfo } from '../platform/native';
import { monitorNative } from '../monitor/native';
import { tvs } from './tvStore';
import { loadJson, saveJson } from '../../../src/store/storage';

export const TV_SEARCH_KEY = 'tsp.tvSearchService';

const stored = signal<boolean | null>(loadJson<boolean | null>(TV_SEARCH_KEY, null, (v) => typeof v === 'boolean'));

/** The stored choice; while there is none, on as soon as an LG TV is saved (Android TV searches with its own sources). */
export const tvSearchOn: ReadonlySignal<boolean> = computed(() =>
  stored.value === null ? tvs.value.some((t) => t.kind !== 'atv') : stored.value,
);

/** What the service reported last; null while off or unknown. */
export const rpcInfo = signal<RpcInfo | null>(null);

/** The state last sent to the native side (null: nothing sent yet). */
let applied: boolean | null = null;
/** Grows on every apply, so a late answer of an older one is dropped. */
let generation = 0;
let started = false;

/** How the address reaches an LG that already shows OMP (injected by main.tsx; keeps this module out of an import cycle). */
export interface PhoneRpcDeps {
  /**
   * The LG TV connected now (its IP), null while none is (or the active TV is an Android TV). Read inside an effect:
   * a switch of the active TV to an LG and an LG reconnect hand the address over again.
   */
  connectedLg: () => string | null;
  /** Re-sends the launch params (with `phone`) when OMP is in the TV foreground; never rejects. */
  reattach: () => Promise<void>;
}

const noDeps: PhoneRpcDeps = { connectedLg: () => null, reattach: () => Promise.resolve() };
let deps: PhoneRpcDeps = noDeps;

/** A service that is not up yet is asked again this often, at most [STARTING_TRIES] times. */
export const STARTING_RETRY_MS = 2000;
const STARTING_TRIES = 5;
let startingTimer: ReturnType<typeof setTimeout> | null = null;
let startingTries = 0;

function settle(gen: number, info: RpcInfo | null): void {
  if (gen !== generation) return;
  rpcInfo.value = tvSearchOn.value ? info : null;
  if (startingTimer !== null) clearTimeout(startingTimer);
  startingTimer = null;
  if (!rpcInfo.value || rpcInfo.value.running) {
    startingTries = 0;
    return;
  }
  // bound late (after the plugin's wait) or on a fallback port: read it again until it runs
  if (startingTries >= STARTING_TRIES) return;
  startingTries++;
  startingTimer = setTimeout(() => {
    startingTimer = null;
    refresh();
  }, STARTING_RETRY_MS);
}

const keyOf = (p: { url: string; token: string }): string => p.url + ' ' + p.token;

/** The address the last launch of each LG carried (by the TV's IP, set by launchOnTv), so it is handed over once. */
const sentKeys: { [tv: string]: string } = {};
/** The TV and address a hand-over was tried for, and how many times (an attach in flight can launch with the old one). */
let triedKey: string | null = null;
let tries = 0;
let delivering = false;
/** The LG connected when the hand-over last looked; a new one (or a reconnect) gets fresh tries. */
let lastLg: string | null = null;

/** launchOnTv reports the `phone` a launch of the LG at `tv` carried (null: none). */
export function markPhoneSent(tv: string, p: { url: string; token: string } | null): void {
  if (p) sentKeys[tv] = keyOf(p);
  else delete sentKeys[tv];
}

/**
 * Hands the address to the connected LG when it shows OMP and has not got this one yet: a changed address (new
 * token, port or Wi-Fi IP), a switch of the active TV to an LG, an LG reconnect.
 */
function deliver(): void {
  const p = phoneParam();
  if (!p) return;
  const tv = deps.connectedLg();
  if (!tv) return;
  const addr = keyOf(p);
  if (sentKeys[tv] === addr) return;
  const key = tv + ' ' + addr;
  if (key !== triedKey) {
    triedKey = key;
    tries = 0;
  }
  // two tries: the first may share an attach that was already on its way with the old address
  if (delivering || tries >= 2) return;
  tries++;
  delivering = true;
  const done = () => {
    delivering = false;
    deliver();
  };
  deps.reattach().then(done, done);
}

/** Android 13+: the foreground notification is only shown with POST_NOTIFICATIONS, so ask for it on every turn-on. */
function askNotifications(): void {
  void monitorNative.notifyPermission().then((before) => {
    if (before === 'granted') return;
    return monitorNative.requestNotifyPermission().then((now) => {
      // the running service posts its notification again on a repeat start
      if (now === 'granted' && applied === true) void apply(true);
    });
  });
}

function apply(on: boolean): Promise<void> {
  applied = on;
  const gen = ++generation;
  if (!on) rpcInfo.value = null;
  return native.rpcSetEnabled(on).then(
    (info) => settle(gen, on ? info : null),
    () => settle(gen, null),
  );
}

/** Stores the choice, switches the service and refreshes [rpcInfo]. */
export function setTvSearch(on: boolean): Promise<void> {
  saveJson(TV_SEARCH_KEY, on);
  applied = on; // the effect sees no change and does not apply it a second time
  stored.value = on;
  const p = apply(on);
  if (on) askNotifications();
  return p;
}

function refresh(): void {
  if (!tvSearchOn.value) return;
  const gen = generation;
  native.rpcInfo().then(
    (info) => settle(gen, info),
    () => {},
  );
}

/** Applies [tvSearchOn] now and whenever it flips (a first TV saved turns it on); re-reads the address on resume. */
export function initPhoneRpc(d?: PhoneRpcDeps): void {
  if (started) return;
  started = true;
  deps = d || noDeps;
  effect(() => {
    const on = tvSearchOn.value;
    if (on === applied) return;
    void apply(on);
    if (on) askNotifications();
  });
  // the TV keeps the address of the last launch: a new token (switch off and on), port or IP is handed over again,
  // and so is the address to an LG that becomes the connected TV (a switch in «Пульт», a reconnect) without it
  effect(() => {
    const info = rpcInfo.value;
    const tv = deps.connectedLg();
    if (tv !== lastLg) {
      lastLg = tv;
      triedKey = null;
    }
    if (!info || !tv) return;
    untracked(deliver);
  });
  // a new Wi-Fi address while the app was in the background
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });
}

/**
 * The `phone` launch param: where the TV reaches this phone's search; null when off, unknown, not running yet or
 * without Wi-Fi.
 */
export function phoneParam(): { url: string; token: string; name: string } | null {
  const info = rpcInfo.value;
  if (!tvSearchOn.value || !info || !info.running || !info.ip) return null;
  return { url: 'http://' + info.ip + ':' + info.port, token: info.token, name: info.name };
}
