import { getCurrentFocusKey, setFocus, doesFocusableExist } from '@noriginmedia/norigin-spatial-navigation';
import { takeSavedFocus, screenFocusables, currentRoute } from './nav';
import type { SavedFocus } from './nav';

/** Height of the hint band pinned to the bottom of the screen; a focused element must end above it. */
export const HINTS_HEIGHT = 96;
/** Extra room around a focused element so a focus scale stays inside the screen edge. */
export const SCROLL_BLOCK_MARGIN = 36;
/** A focused row stays out of the bottom 5% band (120px at 1080p), hints included. */
export const FOCUS_BOTTOM_CLEAR = 120;

/**
 * How far above the footer (or the screen edge, when there is no footer) a focused row must end.
 * The hint band is subtracted separately by the scroller, so this stays 120px even when a footer is open.
 */
export function focusBottomMargin(_hasHints: boolean, keypad: boolean): number {
  return FOCUS_BOTTOM_CLEAR + (keypad ? 72 : 0);
}

/**
 * Pixels a focused button grows below its unscaled box (scale 1.06 from the center).
 * Focus is measured before that class is painted, so the scroller has to reserve it.
 * The extra pixel covers a scrollTop that lands on a whole pixel.
 */
export function focusZoomOverhang(el: Element): number {
  const node = el as HTMLElement;
  if (!node.classList || !node.classList.contains('button')) return 0;
  const h = node.getBoundingClientRect().height;
  if (!(h > 0)) return 0;
  return Math.ceil(h * 0.03) + 1;
}

/** A dialog or the tour is covering the screen, so the screen underneath must not take focus. */
export function modalCovering(): boolean {
  return typeof document !== 'undefined' && !!document.querySelector('.onboarding-host, .dialog-backdrop, .better-backdrop, .marks-backdrop');
}

/** scrollIntoView also moves scrollLeft. The page never scrolls sideways; only the tab strip does. */
export function clearPageScroll(from: Element | null): void {
  const root = typeof document !== 'undefined' ? document.documentElement : null;
  if (root && root.scrollLeft) root.scrollLeft = 0;
  if (typeof document !== 'undefined' && document.body && document.body.scrollLeft) document.body.scrollLeft = 0;
  let node: HTMLElement | null = from ? from.parentElement : null;
  while (node) {
    if (!(node.classList && node.classList.contains('topbar-tabs')) && node.scrollLeft) node.scrollLeft = 0;
    node = node.parentElement;
  }
}

export function scrollIntoViewSafe(el: Element | null): void {
  if (!el) return;
  const anyEl = el as any;
  if (typeof anyEl.scrollIntoViewIfNeeded === 'function') anyEl.scrollIntoViewIfNeeded(false);
  else el.scrollIntoView(false);
  clearPageScroll(el);
  let box: HTMLElement | null = el.parentElement;
  while (box && !(box.classList && box.classList.contains('screen'))) box = box.parentElement;
  if (!box) return;
  // the address keypad's hint sits under the last key; keep that hint above the footer
  const keypad = typeof (el as HTMLElement).closest === 'function' && (el as HTMLElement).closest('.keypad');
  const hints = !!box.querySelector('.hints');
  const margin = focusBottomMargin(hints, !!keypad);
  const over = el.getBoundingClientRect().bottom + focusZoomOverhang(el) + margin - (box.getBoundingClientRect().bottom - (hints ? HINTS_HEIGHT : 0));
  if (over > 0) box.scrollTop += Math.ceil(over);
  const topOver = box.getBoundingClientRect().top + margin - el.getBoundingClientRect().top;
  if (topOver > 0) box.scrollTop -= topOver;
  if (box.scrollLeft) box.scrollLeft = 0;
}

/**
 * Where D-pad up/down/left/right goes inside an ordered list of rows.
 * A string is the next key; null means stay; undefined means the spatial library decides (past either end).
 */
export function nextRowKey(rows: string[][], key: string, dir: string): string | null | undefined {
  let ri = -1;
  let ci = -1;
  for (let r = 0; r < rows.length; r++) {
    const c = rows[r].indexOf(key);
    if (c >= 0) {
      ri = r;
      ci = c;
      break;
    }
  }
  if (ri < 0) return undefined;
  if (dir === 'left' || dir === 'right') {
    const row = rows[ri];
    if (row.length < 2) return null;
    const n = ci + (dir === 'right' ? 1 : -1);
    if (n < 0 || n >= row.length) return null;
    return row[n];
  }
  if (dir !== 'up' && dir !== 'down') return undefined;
  const n = ri + (dir === 'down' ? 1 : -1);
  if (n < 0 || n >= rows.length) return undefined;
  const row = rows[n];
  return row[Math.min(ci, row.length - 1)];
}

/**
 * The next enabled key in a flat row, or null at the end. Disabled and missing keys are skipped,
 * so a D-pad walks every real control in order.
 */
export function stepKey(keys: string[], key: string, dir: 1 | -1, ok: (k: string) => boolean): string | null {
  const i = keys.indexOf(key);
  if (i < 0) return null;
  for (let n = i + dir; n >= 0 && n < keys.length; n += dir) {
    if (ok(keys[n])) return keys[n];
  }
  return null;
}

/**
 * Left/right walk `keys` in order and never jump by geometry. Up stays. Down leaves the row only
 * when something below can take the focus, otherwise the focus stays put.
 * `hasBelow` runs on the key press: the row under the bar changes after this handler is built.
 */
export function barArrow(keys: string[], key: string, hasBelow: () => boolean, ok: (k: string) => boolean): (dir: string) => boolean {
  return (dir: string) => {
    if (dir === 'left' || dir === 'right') {
      const next = stepKey(keys, key, dir === 'right' ? 1 : -1, ok);
      if (next) setFocus(next);
      return false;
    }
    if (dir === 'up') return false;
    if (dir === 'down') {
      if (!hasBelow()) {
        setFocus(key);
        return false;
      }
      return true;
    }
    return true;
  };
}

/** onArrow for a key in `rows`: explicit neighbours, so a short button is not skipped. */
export function rowArrow(rows: string[][], key: string): (dir: string) => boolean {
  return (dir: string) => {
    const next = nextRowKey(rows, key, dir);
    if (next === undefined) return true;
    if (next && doesFocusableExist(next)) setFocus(next);
    return false;
  };
}

function enabledScreenKey(k: string | null | undefined): boolean {
  if (!k || !doesFocusableExist(k)) return false;
  const els = screenFocusables();
  for (let i = 0; i < els.length; i++) {
    if (els[i].getAttribute('data-fk') === k && !els[i].classList.contains('disabled')) return true;
  }
  return false;
}

/** A library tab that is not the one on screen. Focusing it would switch the library. */
function inactiveTab(k: string): boolean {
  if (k.indexOf('tab-') !== 0) return false;
  const el = document.querySelector('[data-fk="' + k + '"]');
  return !el || !el.classList.contains('active');
}

/**
 * Where to put focus after a dialog closes.
 * The remembered key wins when it still exists and is not some other library tab.
 * Otherwise the first focusable under the bar (a tile), otherwise the tab that is already active.
 */
export function dialogRestoreKey(preferred?: string | null): string | null {
  const ok = (k: string | null | undefined): k is string => !!k && doesFocusableExist(k) && !inactiveTab(k);
  if (ok(preferred)) return preferred;
  const els = screenFocusables();
  for (let i = 0; i < els.length; i++) {
    const el = els[i];
    if (el.classList.contains('disabled')) continue;
    if (typeof el.closest === 'function' && el.closest('.topbar')) continue;
    const k = el.getAttribute('data-fk');
    if (ok(k)) return k;
  }
  const active = document.querySelector('.topbar .tab.active');
  const ak = active ? active.getAttribute('data-fk') : null;
  if (ok(ak)) return ak;
  return null;
}

let focusAfterTimers: ReturnType<typeof setTimeout>[] = [];
let focusAfterGen = 0;

/**
 * After an overlay unmounts, focus `preferred`, else the first focusable on the screen.
 * Norigin restores the removed dialog's parent about 300ms later and that can leave nothing focused,
 * so a second pass puts the home screen back in focus if the first one was stolen.
 */
export function focusAfterClose(preferred?: string): void {
  const route = currentRoute.value;
  const want = preferred;
  const gen = ++focusAfterGen;
  focusAfterTimers.forEach((t) => clearTimeout(t));
  focusAfterTimers = [];
  const place = (prefer: boolean) => {
    if (gen !== focusAfterGen) return;
    if (currentRoute.value !== route) return;
    if (document.querySelector('.onboarding-host, .dialog-backdrop, .better-backdrop, .marks-backdrop')) return;
    const go = (k: string | null | undefined): boolean => {
      if (!k || !doesFocusableExist(k) || inactiveTab(k)) return false;
      setFocus(k);
      return true;
    };
    let cur = '';
    try {
      cur = getCurrentFocusKey() || '';
    } catch (e) {
      cur = '';
    }
    // a late restore from the dialog's parent lands on «История» (the first tab) and would open that tab
    if (!inactiveTab(cur) && enabledScreenKey(cur) && (!prefer || cur === want)) return;
    if (prefer && go(want)) return;
    if (!inactiveTab(cur) && enabledScreenKey(cur)) return;
    if (go(want)) return;
    if (go(dialogRestoreKey(null))) return;
  };
  // 0 can still see the dialog node. 40 lands before norigin's 300ms restore of the first tab.
  focusAfterTimers.push(setTimeout(() => place(true), 0));
  focusAfterTimers.push(setTimeout(() => place(true), 40));
  focusAfterTimers.push(setTimeout(() => place(false), 500));
}

/** The screen that scrolls around an element (`.screen`), or null. */
function screenOf(el: Element | null): HTMLElement | null {
  let box: HTMLElement | null = el ? el.parentElement : null;
  while (box && !(box.classList && box.classList.contains('screen'))) box = box.parentElement;
  return box;
}

/** The first row of buttons under a header took the focus: show the whole header too (the screen back at the top). */
export function scrollScreenToTop(el: Element | null): void {
  setTimeout(() => {
    const box = screenOf(el);
    if (box) box.scrollTop = 0;
  }, 0);
}

/**
 * The scroll offset of a container that shows a whole item (start, size along the axis) with `pad` around it, or the
 * current offset when it is already fully visible; an item at the start (within `pad`) gives 0.
 */
export function scrollToShow(scroll: number, view: number, start: number, size: number, pad: number): number {
  const from = start - pad;
  if (from <= 0) return 0;
  if (from < scroll) return from;
  const end = start + size + pad;
  if (end > scroll + view) return Math.max(0, end - view);
  return scroll;
}

function inOverlay(el: Element): boolean {
  const node = el as HTMLElement;
  return typeof node.closest === 'function' && !!node.closest('.dialog, .dialog-backdrop, .onboarding-host, .better-backdrop, .marks-backdrop');
}

interface AboveCand {
  key: string;
  gap: number;
  dx: number;
  overlap: boolean;
}

function boxOf(el: Element): { top: number; bottom: number; left: number; right: number } | null {
  if (typeof el.getBoundingClientRect !== 'function') return null;
  const b = el.getBoundingClientRect();
  if (!(b.bottom > b.top) || !(b.right > b.left)) return null;
  return b;
}

/**
 * The focusable directly above (`dir` up) or below (`dir` down) `from`, by viewport rectangles.
 * The library measures with offsetTop, and that coordinate does not line up between the flex hero (the Watch
 * button, which wraps onto a second row) and a row in a `position: relative` scroller (the cast, the seasons),
 * so Up from the cast and Down from Watch never leave those rows. The nearest row wins (a wrapped second row of
 * buttons sits closer to the cast than the first, and still counts when its box overlaps the cast a little).
 * On one row, horizontal overlap wins, then the closest item, which for the leftmost cast item is Watch.
 */
export function focusBesideKey(from: Element | null, dir: 'up' | 'down'): string | null {
  if (!from) return null;
  const cur = boxOf(from);
  if (!cur) return null;
  const screen = screenOf(from);
  const root: ParentNode = screen || document;
  const nodes = root.querySelectorAll('[data-fk]');
  const found: AboveCand[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i] as HTMLElement;
    if (el === from) continue;
    if (el.classList.contains('disabled')) continue;
    if (inOverlay(el)) continue;
    const key = el.getAttribute('data-fk');
    if (!key) continue;
    const b = boxOf(el);
    if (!b) continue;
    if (b.top <= cur.top && b.bottom >= cur.bottom) continue;
    const mid = (b.top + b.bottom) / 2;
    if (dir === 'up') {
      if (mid >= cur.top - 1) continue;
    } else if (mid <= cur.bottom + 1) continue;
    found.push({
      key: key,
      gap: dir === 'up' ? cur.top - b.bottom : b.top - cur.bottom,
      dx: Math.abs((cur.left + cur.right) / 2 - (b.left + b.right) / 2),
      overlap: b.left < cur.right && b.right > cur.left,
    });
  }
  let best: AboveCand | null = null;
  for (let i = 0; i < found.length; i++) {
    const c = found[i];
    if (!best || c.gap < best.gap - 0.5) best = c;
    else if (Math.abs(c.gap - best.gap) <= 0.5) {
      if (c.overlap && !best.overlap) best = c;
      else if (c.overlap === best.overlap && c.dx < best.dx) best = c;
    }
  }
  return best ? best.key : null;
}

/** The focusable directly above `from`. */
export function focusAboveKey(from: Element | null): string | null {
  return focusBesideKey(from, 'up');
}

/** The focusable directly below `from`. */
export function focusBelowKey(from: Element | null): string | null {
  return focusBesideKey(from, 'down');
}

/**
 * Up from the cast found nothing by rectangles. On Chromium 53 a wrapped button row is reported on top of the
 * cast, and a cast item inside the sideways scroller can report an empty box once the page is scrolled (a
 * posterless card, two button rows). The last action button is the wrapped row, the one nearest the cast.
 */
function actionButtonFallback(from: Element): string | null {
  const node = from as HTMLElement;
  if (typeof node.closest !== 'function' || !node.closest('.tc-cast-row')) return null;
  const screen = screenOf(from);
  if (!screen) return null;
  const nodes = screen.querySelectorAll('.torrent-actions [data-fk], .series-actions [data-fk]');
  const cur = boxOf(from);
  let bestKey = '';
  let bestTop = -Infinity;
  let last = '';
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i] as HTMLElement;
    if (el.classList.contains('disabled')) continue;
    const key = el.getAttribute('data-fk');
    if (!key) continue;
    last = key;
    if (!cur) continue;
    const b = boxOf(el);
    if (!b) continue;
    if ((b.top + b.bottom) / 2 >= cur.top - 1) continue;
    if (b.top >= bestTop) {
      bestTop = b.top;
      bestKey = key;
    }
  }
  return bestKey || last || null;
}

/** The key Up or Down should move to, or null when this row cannot tell. */
export function verticalTarget(el: Element, dir: 'up' | 'down'): string | null {
  const r = el.getBoundingClientRect();
  const measurable = !!(r && r.bottom > r.top && r.right > r.left);
  const next = measurable ? (dir === 'up' ? focusAboveKey(el) : focusBelowKey(el)) : null;
  return next || (dir === 'up' ? actionButtonFallback(el) : null);
}

/**
 * Scrolls `key` into the screen when its viewport box is missing or off screen.
 * offsetTop still works on Chromium 53 when getBoundingClientRect of a scrolled flex item comes back empty.
 */
function revealKey(key: string): void {
  const el = document.querySelector('[data-fk="' + key + '"]') as HTMLElement | null;
  if (!el) return;
  const screen = screenOf(el);
  if (!screen) return;
  const view = screen.getBoundingClientRect();
  const b = boxOf(el);
  if (b && b.top >= view.top && b.bottom <= view.bottom - HINTS_HEIGHT) return;
  let top = 0;
  let node: HTMLElement | null = el;
  let n = 0;
  while (node && node !== screen && n < 12) {
    top += node.offsetTop;
    const next = node.offsetParent as HTMLElement | null;
    if (!next) break;
    node = next;
    n++;
  }
  if (node === screen) screen.scrollTop = Math.max(0, top - 48);
  else if (typeof el.closest === 'function' && el.closest('.torrent-actions, .series-actions')) screen.scrollTop = 0;
}

/**
 * Up and Down leave a row the library cannot measure, onto the focusable above or below it.
 * Left and Right stay with the library (they work inside one flex row).
 */
export function arrowVertical(key: string): (dir: string) => boolean {
  return (dir: string) => {
    if (dir !== 'up' && dir !== 'down') return true;
    const el = document.querySelector('[data-fk="' + key + '"]');
    if (!el) return true;
    const go = verticalTarget(el, dir);
    if (go && doesFocusableExist(go)) {
      setFocus(go);
      revealKey(go);
      return false;
    }
    const r = el.getBoundingClientRect();
    // an empty box used to fall through to the library, which cannot leave this row: Up did nothing
    if (!(r.bottom > r.top)) return !go;
    return false;
  };
}

/** Up leaves a row the library cannot measure onto the focusable above it. Down uses the same rectangles. */
export function arrowUpToAbove(key: string): (dir: string) => boolean {
  return arrowVertical(key);
}

/** How long a screen whose rows arrive later still gets the remembered focus. */
export const FOCUS_RESTORE_MS = 1500;
const RETRY_MS = 100;

/** Keys the spatial-navigation library makes up for focusables without one: they change on every mount. */
function isMadeUp(key: string): boolean {
  return key.indexOf('sn:') === 0;
}

/** Focuses the saved element: by its own key, or by its place on the screen when the key was made up. */
function focusSaved(s: SavedFocus): boolean {
  if (!isMadeUp(s.key)) {
    if (!doesFocusableExist(s.key)) return false;
    setFocus(s.key);
    return true;
  }
  if (s.index < 0) return false;
  const el = screenFocusables()[s.index];
  const k = el ? el.getAttribute('data-fk') : null;
  if (!k || !doesFocusableExist(k)) return false;
  setFocus(k);
  return true;
}

let stopPending: (() => void) | null = null;

function cancelPending(): void {
  if (stopPending) stopPending();
  stopPending = null;
}

/**
 * Restores focus saved when the user left this screen (focusing the element scrolls it into view), otherwise focuses
 * fallbackKey. A screen whose rows arrive later gets the fallback first and the saved element as soon as it appears,
 * for up to FOCUS_RESTORE_MS, unless the user presses a key or the screen changes first.
 */
export function restoreFocus(fallbackKey: string): void {
  cancelPending();
  if (modalCovering()) return;
  const saved = takeSavedFocus();
  if (saved && focusSaved(saved)) return;
  if (doesFocusableExist(fallbackKey)) setFocus(fallbackKey);
  if (!saved) return;
  const route = currentRoute.value;
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const onUser = () => cancelPending();
  window.addEventListener('keydown', onUser, true);
  window.addEventListener('mousedown', onUser, true);
  stopPending = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    window.removeEventListener('keydown', onUser, true);
    window.removeEventListener('mousedown', onUser, true);
  };
  const tick = () => {
    timer = null;
    if (modalCovering() || currentRoute.value !== route || focusSaved(saved) || Date.now() - started >= FOCUS_RESTORE_MS) {
      cancelPending();
      return;
    }
    timer = setTimeout(tick, RETRY_MS);
  };
  timer = setTimeout(tick, RETRY_MS);
}
