// The phone shell (Android and iOS) draws a Yandex native ad over the card. Desktop, TV and the browser have no
// SDK: load fails and the card falls back to our banner. Tests replace the loader.
import { Capacitor, registerPlugin } from '@capacitor/core';

export interface YandexRect {
  x: number;
  y: number;
  width: number;
  height: number;
  viewportWidth: number;
  /** The native view stays the full card. The host clips it to this window. */
  clipTop: number;
  clipBottom: number;
}

/** Full card box when enough of it is inside the clip. Null means conceal. */
export function yandexVisiblePlace(
  card: { left: number; top: number; width: number; height: number },
  clip: { top: number; bottom: number; blocked: boolean },
): { x: number; y: number; width: number; height: number; clipTop: number; clipBottom: number } | null {
  if (clip.blocked || card.width < 8 || card.height < 8) return null;
  const visTop = Math.max(card.top, clip.top);
  const visBottom = Math.min(card.top + card.height, clip.bottom);
  if (visBottom - visTop < 8) return null;
  return {
    x: card.left,
    y: card.top,
    width: card.width,
    height: card.height,
    clipTop: clip.top,
    clipBottom: clip.bottom,
  };
}

interface YandexPlugin {
  load(o: { slotId: string; adUnitId: string; layout: string }): Promise<void>;
  place(o: { slotId: string } & YandexRect): Promise<void>;
  /** Take the view off screen without dropping the loaded ad. */
  conceal(o: { slotId: string }): Promise<void>;
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

export type YandexLayout = 'card' | 'row';

/** The catalog strip that may show an ad: under the sticky bar, above the tab bar, and never over a sheet. */
export function yandexClip(): { top: number; bottom: number; blocked: boolean } {
  const sheet = document.querySelector('.m-sheet-host, .m-dialog-host, [role="dialog"]');
  if (sheet) return { top: 0, bottom: 0, blocked: true };
  let top = 0;
  let bottom = window.innerHeight || document.documentElement.clientHeight || 0;
  const sticky = document.querySelector('.m-lib-sticky');
  if (sticky) top = Math.max(top, sticky.getBoundingClientRect().bottom);
  // .m-tabs is the category row inside the sticky header. The bottom bar is .m-nav.
  const nav = document.querySelector('.m-nav');
  if (nav) {
    const t = nav.getBoundingClientRect().top;
    if (t > top) bottom = Math.min(bottom, t);
  }
  return { top, bottom, blocked: false };
}

export function loadYandexSlot(slotId: string, adUnitId: string, layout: YandexLayout): Promise<boolean> {
  if (loader) return loader(slotId, adUnitId);
  if (!yandexOs()) return Promise.resolve(false);
  return plugin.load({ slotId, adUnitId, layout }).then(
    () => true,
    () => false,
  );
}

export function placeYandexSlot(slotId: string, rect: YandexRect): void {
  if (loader || !yandexOs()) return;
  void plugin.place({ slotId, ...rect }).catch(() => undefined);
}

export function concealYandexSlot(slotId: string): void {
  if (loader || !yandexOs()) return;
  void plugin.conceal({ slotId }).catch(() => undefined);
}

export function hideYandexSlot(slotId: string): void {
  if (loader || !yandexOs()) return;
  void plugin.hide({ slotId }).catch(() => undefined);
}

export function hideAllYandex(): void {
  if (loader || !yandexOs()) return;
  void plugin.hideAll().catch(() => undefined);
}
