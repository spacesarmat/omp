// The phone shell (Android and iOS) draws a Yandex native ad over the card. Desktop, TV and the browser have no
// SDK: load fails and the card falls back to our banner. Tests replace the loader.
import { Capacitor, registerPlugin } from '@capacitor/core';

export interface YandexRect {
  x: number;
  y: number;
  width: number;
  height: number;
  viewportWidth: number;
}

interface YandexPlugin {
  load(o: { slotId: string; adUnitId: string }): Promise<void>;
  place(o: { slotId: string } & YandexRect): Promise<void>;
  hide(o: { slotId: string }): Promise<void>;
  hideAll(): Promise<void>;
}

const plugin = registerPlugin<YandexPlugin>('YandexAds');

let forced: 'android' | 'ios' | null | undefined;
let loader: ((slotId: string, adUnitId: string) => Promise<boolean>) | null = null;

/** Tests: 'android' or 'ios' turns the phone path on. undefined uses Capacitor. */
export function setYandexOsForTests(os: 'android' | 'ios' | null | undefined): void {
  forced = os;
}

/** Tests: resolve true when the SDK would return an ad, false for no fill or an error. */
export function setYandexLoaderForTests(fn: ((slotId: string, adUnitId: string) => Promise<boolean>) | null): void {
  loader = fn;
}

export function yandexOs(): 'android' | 'ios' | null {
  if (forced !== undefined) return forced;
  try {
    if (!Capacitor.isNativePlatform()) return null;
    const p = Capacitor.getPlatform();
    if (p === 'ios' || p === 'android') return p;
  } catch (e) {
    /* the harness has no Capacitor bridge */
  }
  return null;
}

export function loadYandexSlot(slotId: string, adUnitId: string): Promise<boolean> {
  if (loader) return loader(slotId, adUnitId);
  if (!yandexOs()) return Promise.resolve(false);
  return plugin.load({ slotId, adUnitId }).then(
    () => true,
    () => false,
  );
}

export function placeYandexSlot(slotId: string, rect: YandexRect): void {
  if (loader || !yandexOs()) return;
  void plugin.place({ slotId, ...rect }).catch(() => undefined);
}

export function hideYandexSlot(slotId: string): void {
  if (loader || !yandexOs()) return;
  void plugin.hide({ slotId }).catch(() => undefined);
}

export function hideAllYandex(): void {
  if (loader || !yandexOs()) return;
  void plugin.hideAll().catch(() => undefined);
}
