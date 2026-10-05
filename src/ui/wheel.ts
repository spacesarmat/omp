import { dialogOpen } from './dialog';

/** Pixels to scroll for a wheel event (deltaMode 0 = px, 1 = lines, 2 = pages). */
export function wheelDelta(e: { deltaY: number; deltaMode?: number }, pageHeight: number): number {
  if (e.deltaMode === 1) return e.deltaY * 40;
  if (e.deltaMode === 2) return e.deltaY * pageHeight;
  return e.deltaY;
}

function canScroll(el: Element, dy: number): boolean {
  const h = el as HTMLElement;
  if (h.scrollHeight <= h.clientHeight) return false;
  const oy = (window.getComputedStyle(el) as any).overflowY;
  if (oy !== 'auto' && oy !== 'scroll') return false;
  return dy < 0 ? h.scrollTop > 0 : h.scrollTop + h.clientHeight < h.scrollHeight - 1;
}

function anyDialog(): boolean {
  return dialogOpen.value || !!document.querySelector('.dialog-backdrop');
}

/** The open dialog's backdrop that holds `el` (a dialog is a world of its own: nothing behind it scrolls). */
function dialogOf(el: Element | null): Element | null {
  let n: Element | null = el;
  while (n && n !== document.body) {
    if (n.classList && n.classList.contains('dialog-backdrop')) return n;
    n = n.parentElement;
  }
  return null;
}

/** Nearest ancestor (or self) that can scroll in the wheel direction; falls back to the current screen outside dialogs. */
export function findScrollTarget(from: Element | null, dy: number): HTMLElement | null {
  const stop = dialogOf(from);
  // a dialog is open but the pointer is outside it: nothing behind the dialog scrolls
  if (!stop && anyDialog()) return null;
  let el: Element | null = from;
  while (el && el !== document.body) {
    if (canScroll(el, dy)) return el as HTMLElement;
    if (el === stop) return null;
    el = el.parentElement;
  }
  if (stop) return null;
  const screen = document.querySelector('.screen');
  return screen && canScroll(screen, dy) ? (screen as HTMLElement) : null;
}

/** Magic Remote / LG pointer scrolling: scroll the container under the pointer by the wheel delta. */
export function installWheelScroll(): () => void {
  const onWheel = (e: WheelEvent) => {
    if (e.defaultPrevented || !e.deltaY) return;
    const dy = wheelDelta(e, window.innerHeight);
    const under = (document.elementFromPoint ? document.elementFromPoint(e.clientX, e.clientY) : null) || (e.target as Element | null);
    const t = findScrollTarget(under, dy);
    // with a dialog open the browser must not scroll the page behind it either
    if (anyDialog()) e.preventDefault();
    if (!t) return;
    t.scrollTop += dy;
    e.preventDefault();
  };
  document.addEventListener('wheel', onWheel, { passive: false } as any);
  return () => document.removeEventListener('wheel', onWheel);
}
