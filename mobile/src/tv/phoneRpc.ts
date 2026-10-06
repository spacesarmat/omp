// TV search: the switch of the phone's TV search server (PhoneRpcService) and the address the phone hands
// to the TV in its launch params (`phone`). The token is a credential: it is never logged or shown.
import { signal, computed, effect, type ReadonlySignal } from '@preact/signals';
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

function settle(gen: number, info: RpcInfo | null): void {
  if (gen !== generation) return;
  rpcInfo.value = tvSearchOn.value ? info : null;
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
export function initPhoneRpc(): void {
  if (started) return;
  started = true;
  effect(() => {
    const on = tvSearchOn.value;
    if (on === applied) return;
    void apply(on);
    if (on) askNotifications();
  });
  // a new Wi-Fi address while the app was in the background
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });
}

/** The `phone` launch param: where the TV reaches this phone's search; null when off, unknown or without Wi-Fi. */
export function phoneParam(): { url: string; token: string; name: string } | null {
  const info = rpcInfo.value;
  if (!tvSearchOn.value || !info || !info.ip) return null;
  return { url: 'http://' + info.ip + ':' + info.port, token: info.token, name: info.name };
}
