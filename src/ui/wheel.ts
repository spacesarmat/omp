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

/** Nearest ancestor (or self) that can scroll in the wheel direction; falls back to the current screen. */
export function findScrollTarget(from: Element | null, dy: number): HTMLElement | null {
  let el: Element | null = from;
  while (el && el !== document.body) {
    if (canScroll(el, dy)) return el as HTMLElement;
    el = el.parentElement;
  }
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
    if (!t) return;
    t.scrollTop += dy;
    e.preventDefault();
  };
  document.addEventListener('wheel', onWheel, { passive: false } as any);
  return () => document.removeEventListener('wheel', onWheel);
}
