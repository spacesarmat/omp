/** Left / right swipe between the bottom tabs: the screen follows the finger, a long or quick swipe switches. */

/** px from the screen edge where Android's own back gesture starts */
export const EDGE = 24;
/** px of movement before the direction is decided */
const SLOP = 10;
/** fraction of the screen width that switches on release */
const SWITCH_AT = 0.25;
/** px/ms: a quick flick switches even when short */
const FLICK = 0.5;

/** Tab to go to after a swipe by `dx` px, or null (no neighbour on that side). */
export function swipeTarget(tabs: string[], current: string, dx: number): string | null {
  const i = tabs.indexOf(current);
  if (i < 0 || dx === 0) return null;
  const j = dx < 0 ? i + 1 : i - 1;
  return j >= 0 && j < tabs.length ? tabs[j] : null;
}

/** Whether a release after `dx` px in `ms` switches the tab. */
export function swipeSwitches(dx: number, ms: number, width: number): boolean {
  const a = Math.abs(dx);
  return a >= width * SWITCH_AT || (a >= 40 && a / Math.max(ms, 1) >= FLICK);
}

/** Touches that belong to something else: the touchpad, text fields, open sheets, sideways-scrolling rows. */
export function swipeBlocked(target: Element | null): boolean {
  if (document.querySelector('.m-sheet-host')) return true;
  for (let n: Element | null = target; n && n !== document.body; n = n.parentElement) {
    if (n.matches('.m-touchpad, input, textarea, select, [data-noswipe]')) return true;
    const el = n as HTMLElement;
    if (el.scrollWidth > el.clientWidth + 1) {
      const o = getComputedStyle(el).overflowX;
      if (o === 'auto' || o === 'scroll') return true;
    }
  }
  return false;
}

/**
 * Listens on the document while a tab root is shown. `screen()` is the element that slides;
 * `go(tab)` switches. Returns the remover.
 */
export function installTabSwipe(o: {
  tabs: string[];
  current: () => string;
  screen: () => HTMLElement | null;
  go: (tab: string) => void;
}): () => void {
  let startX = 0;
  let startY = 0;
  let startT = 0;
  let dx = 0;
  let mode: 'idle' | 'maybe' | 'swipe' = 'idle';
  let el: HTMLElement | null = null;

  const place = (x: number, animate: boolean) => {
    if (!el) return;
    el.style.transition = animate ? 'transform .2s ease' : 'none';
    el.style.transform = x ? 'translateX(' + x + 'px)' : '';
  };
  const reset = () => {
    place(0, true);
    mode = 'idle';
    dx = 0;
  };

  const start = (e: TouchEvent) => {
    mode = 'idle';
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    const w = window.innerWidth;
    if (t.clientX < EDGE || t.clientX > w - EDGE) return;
    if (swipeBlocked(e.target as Element | null)) return;
    el = o.screen();
    if (!el) return;
    startX = t.clientX;
    startY = t.clientY;
    startT = Date.now();
    dx = 0;
    mode = 'maybe';
  };
  const move = (e: TouchEvent) => {
    if (mode === 'idle') return;
    const t = e.touches[0];
    if (!t) return;
    const x = t.clientX - startX;
    const y = t.clientY - startY;
    if (mode === 'maybe') {
      if (Math.abs(x) < SLOP && Math.abs(y) < SLOP) return;
      // clearly sideways only; anything else is a scroll or the pull-to-refresh
      if (Math.abs(x) < Math.abs(y) * 1.5) {
        mode = 'idle';
        return;
      }
      mode = 'swipe';
    }
    if (e.cancelable) e.preventDefault();
    dx = x;
    // no neighbour on that side: the screen only gives a little
    const has = swipeTarget(o.tabs, o.current(), x) !== null;
    place(has ? x : x * 0.2, false);
  };
  const end = () => {
    if (mode !== 'swipe') {
      mode = 'idle';
      return;
    }
    const target = swipeTarget(o.tabs, o.current(), dx);
    const ok = target !== null && swipeSwitches(dx, Date.now() - startT, window.innerWidth);
    const moved = el;
    reset();
    if (ok && target) {
      if (moved) {
        moved.style.transition = 'none';
        moved.style.transform = '';
      }
      o.go(target);
    }
  };

  document.addEventListener('touchstart', start, { passive: true });
  document.addEventListener('touchmove', move, { passive: false });
  document.addEventListener('touchend', end, { passive: true });
  document.addEventListener('touchcancel', reset, { passive: true });
  return () => {
    reset();
    document.removeEventListener('touchstart', start);
    document.removeEventListener('touchmove', move);
    document.removeEventListener('touchend', end);
    document.removeEventListener('touchcancel', reset);
  };
}
