import { setFocus, doesFocusableExist } from '@noriginmedia/norigin-spatial-navigation';
import { takeSavedFocus, screenFocusables, currentRoute } from './nav';
import type { SavedFocus } from './nav';

/** Height of the hint band pinned to the bottom of the screen; a focused element must end above it. */
export const HINTS_HEIGHT = 96;

export function scrollIntoViewSafe(el: Element | null): void {
  if (!el) return;
  const anyEl = el as any;
  if (typeof anyEl.scrollIntoViewIfNeeded === 'function') anyEl.scrollIntoViewIfNeeded(false);
  else el.scrollIntoView(false);
  // the hint band covers the bottom of the scrolling screen: lift the element clear of it
  let box: HTMLElement | null = el.parentElement;
  while (box && !(box.classList && box.classList.contains('screen'))) box = box.parentElement;
  if (!box || !box.querySelector('.hints')) return;
  const over = el.getBoundingClientRect().bottom - (box.getBoundingClientRect().bottom - HINTS_HEIGHT);
  if (over > 0) box.scrollTop += over;
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
    if (currentRoute.value !== route || focusSaved(saved) || Date.now() - started >= FOCUS_RESTORE_MS) {
      cancelPending();
      return;
    }
    timer = setTimeout(tick, RETRY_MS);
  };
  timer = setTimeout(tick, RETRY_MS);
}
