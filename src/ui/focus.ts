import { setFocus, doesFocusableExist } from '@noriginmedia/norigin-spatial-navigation';
import { takeSavedFocus } from './nav';

export function scrollIntoViewSafe(el: Element | null): void {
  if (!el) return;
  const anyEl = el as any;
  if (typeof anyEl.scrollIntoViewIfNeeded === 'function') anyEl.scrollIntoViewIfNeeded(false);
  else el.scrollIntoView(false);
}

/** Restores focus saved when the user left this screen, otherwise focuses fallbackKey. */
export function restoreFocus(fallbackKey: string): void {
  const k = takeSavedFocus();
  if (k && doesFocusableExist(k)) setFocus(k);
  else if (doesFocusableExist(fallbackKey)) setFocus(fallbackKey);
}
