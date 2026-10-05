// Two-finger pinch on a list container: the content follows the fingers (a CSS scale around the pinch midpoint) and,
// when the fingers are lifted, settles on the nearest view step (fingers apart = bigger, together = smaller).
// Touch events, not pointer events: with the page's default touch-action the WebView cancels the pointers as soon as
// it treats two fingers as a pan or zoom, while touchmove keeps coming and can be cancelled.
import { useEffect, useRef } from 'preact/hooks';
import type { RefObject } from 'preact';
import { vibrate } from './vibrate';

/** The live scale is clamped to this range. */
export const PINCH_MIN = 0.6;
export const PINCH_MAX = 1.6;
/**
 * Release thresholds, symmetric in log space: a live scale of at least 1.15 / 1.35 / 1.55 is one / two / three steps
 * bigger, at most 1/1.15 (0.87) / 1/1.35 (0.74) / 1/1.55 (0.645) one / two / three steps smaller. Anything in between
 * springs back to the current view.
 */
export const PINCH_STEPS_UP = [1.15, 1.35, 1.55];
export const PINCH_STEPS_DOWN = PINCH_STEPS_UP.map((x) => 1 / x);
/** The settle animation after release. */
export const PINCH_SETTLE_MS = 200;
const SETTLE_EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
/** Visual scale of one step when the screen gives none. */
export const PINCH_STEP_SCALE = 1.25;
/** After the last finger is up, a click (the browser's tap on the card under a finger) is swallowed for this long. */
export const PINCH_CLICK_GUARD_MS = 400;
/** Set on <html> while the content is scaled, so a scaled-up list does not make the page scroll sideways. */
export const PINCH_LIVE_CLASS = 'm-pinch-live';

/** The live scale for a finger distance ratio (now / at the start), clamped to PINCH_MIN..PINCH_MAX. */
export function pinchScale(ratio: number): number {
  if (!(ratio > 0) || !isFinite(ratio)) return 1;
  return Math.max(PINCH_MIN, Math.min(PINCH_MAX, ratio));
}

/** How many steps a released scale asks for: positive = bigger, negative = smaller, 0 = spring back. */
export function pinchStepsOf(scale: number): number {
  if (!(scale > 0)) return 0;
  let n = 0;
  if (scale >= 1) {
    for (const x of PINCH_STEPS_UP) if (scale >= x - 1e-9) n++;
    return n;
  }
  for (const x of PINCH_STEPS_DOWN) if (scale <= x + 1e-9) n--;
  return n;
}

/** The step level a release lands on, kept inside 0..levels-1. */
export function pinchTarget(level: number, levels: number, scale: number): number {
  return Math.max(0, Math.min(levels - 1, level + pinchStepsOf(scale)));
}

export function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

interface TouchPt {
  clientX: number;
  clientY: number;
}

function spread(list: ArrayLike<TouchPt>): number {
  const a = list[0];
  const b = list[1];
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function scroller(): Element {
  return document.scrollingElement || document.documentElement;
}

export interface PinchOptions {
  enabled: boolean;
  /** Number of view steps; 0 is the smallest, levels - 1 the biggest. */
  levels: number;
  /** The current step. */
  level: () => number;
  /** Applies a step (always a different one from level()). */
  apply: (level: number) => void;
  /** How much bigger the content looks at `to` than at `from`; default PINCH_STEP_SCALE per step. */
  scaleOf?: (from: number, to: number) => number;
  /** The second finger is down: cancel what one finger started (a long press timer). */
  onStart?: () => void;
  /** Items carrying this attribute: the one under the fingers is kept in place after the view changes. */
  anchorAttr?: string;
  /** The element that is scaled; default the one the listeners are on. */
  target?: (root: HTMLElement) => HTMLElement | null;
}

interface Saved {
  el: HTMLElement;
  transform: string;
  transformOrigin: string;
  transition: string;
  willChange: string;
}

interface Anchor {
  key: string;
  /** Centre of the item before the gesture (viewport y). */
  cy: number;
  /** The pinch midpoint at the start (viewport y). */
  my: number;
}

/**
 * While two fingers are down the target is scaled with them (written straight to its style, once per frame, no
 * re-render), the page does not scroll and the click that may follow is swallowed. On release the scale animates to
 * the look of the nearest step, the step is applied, and the transform is dropped in the same task the new layout
 * renders in, with the item that was under the fingers scrolled back to where it was seen. One finger is left alone.
 * Returns `active()`: a pinch is in progress (fingers down or settling).
 */
export function usePinchStep(ref: RefObject<HTMLElement | null>, opts: PinchOptions): { active: () => boolean } {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const state = useRef({ on: false, settling: false, guard: false });
  const enabled = opts.enabled;

  useEffect(() => {
    const root = ref.current;
    if (!enabled || !root) return;
    const st = state.current;
    let guardTimer: ReturnType<typeof setTimeout> | undefined;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;
    let start = 0;
    let scale = 1;
    let saved: Saved | null = null;
    let anchor: Anchor | null = null;
    let pendingCommit: (() => void) | null = null;

    const targetEl = (): HTMLElement => {
      const o = optsRef.current;
      return (o.target && o.target(root)) || root;
    };
    const write = () => {
      frame = 0;
      if (saved) saved.el.style.transform = 'scale(' + scale.toFixed(4) + ')';
    };
    const schedule = () => {
      if (typeof requestAnimationFrame === 'undefined') return write();
      if (!frame) frame = requestAnimationFrame(write);
    };
    const flushFrame = () => {
      if (frame) cancelAnimationFrame(frame);
      write();
    };
    const restore = () => {
      if (!saved) return;
      const s = saved.el.style;
      s.transform = saved.transform;
      s.transformOrigin = saved.transformOrigin;
      s.transition = saved.transition;
      s.willChange = saved.willChange;
      saved = null;
      document.documentElement.classList.remove(PINCH_LIVE_CLASS);
    };

    const anchorAt = (mx: number, my: number): Anchor | null => {
      const attr = optsRef.current.anchorAttr;
      if (!attr) return null;
      const items = root.querySelectorAll('[' + attr + ']');
      let best: Anchor | null = null;
      let bestD = Infinity;
      const vh = window.innerHeight || 0;
      for (let i = 0; i < items.length; i++) {
        const r = items[i].getBoundingClientRect();
        if (r.bottom <= 0 || (vh && r.top >= vh)) continue;
        const dx = mx < r.left ? r.left - mx : mx > r.right ? mx - r.right : 0;
        const dy = my < r.top ? r.top - my : my > r.bottom ? my - r.bottom : 0;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = { key: items[i].getAttribute(attr) || '', cy: (r.top + r.bottom) / 2, my };
        }
      }
      return best;
    };
    /** After the new view rendered: the anchor's centre goes where it was seen at the settled scale. */
    const keepAnchor = (a: Anchor, shown: number) => {
      const attr = optsRef.current.anchorAttr;
      if (!attr) return;
      const items = root.querySelectorAll('[' + attr + ']');
      for (let i = 0; i < items.length; i++) {
        if (items[i].getAttribute(attr) !== a.key) continue;
        const r = items[i].getBoundingClientRect();
        const want = a.my + (a.cy - a.my) * shown;
        const delta = Math.round((r.top + r.bottom) / 2 - want);
        if (delta) scroller().scrollTop += delta;
        return;
      }
    };

    /** Applies the step (if any) and drops the transform right after the new layout renders. */
    const commit = (to: number, shown: number) => {
      pendingCommit = null;
      clearTimeout(settleTimer);
      settleTimer = undefined;
      const o = optsRef.current;
      const a = anchor;
      anchor = null;
      const changed = to !== o.level();
      if (changed) {
        o.apply(to);
        vibrate();
      }
      const finish = () => {
        restore();
        if (changed && a) keepAnchor(a, shown);
        st.settling = false;
      };
      // the render the step asked for is queued as a microtask; this one runs right after it, before the paint
      if (changed) Promise.resolve().then(finish);
      else finish();
    };

    const begin = (e: TouchEvent) => {
      if (pendingCommit) pendingCommit();
      st.on = true;
      start = spread(e.touches);
      scale = 1;
      clearTimeout(guardTimer);
      st.guard = true;
      const o = optsRef.current;
      if (o.onStart) o.onStart();
      const el = targetEl();
      const r = el.getBoundingClientRect();
      const a = e.touches[0];
      const b = e.touches[1];
      const mx = (a.clientX + b.clientX) / 2;
      const my = (a.clientY + b.clientY) / 2;
      anchor = anchorAt(mx, my);
      restore();
      saved = {
        el,
        transform: el.style.transform,
        transformOrigin: el.style.transformOrigin,
        transition: el.style.transition,
        willChange: el.style.willChange,
      };
      el.style.transition = 'none';
      el.style.willChange = 'transform';
      el.style.transformOrigin = Math.round(mx - r.left) + 'px ' + Math.round(my - r.top) + 'px';
      document.documentElement.classList.add(PINCH_LIVE_CLASS);
    };
    const release = () => {
      st.on = false;
      flushFrame();
      const o = optsRef.current;
      const from = o.level();
      const to = pinchTarget(from, o.levels, scale);
      const shown = to === from ? 1 : o.scaleOf ? o.scaleOf(from, to) : Math.pow(PINCH_STEP_SCALE, to - from);
      if (!saved || prefersReducedMotion() || Math.abs(scale - shown) < 0.005) {
        commit(to, shown);
        return;
      }
      st.settling = true;
      const s = saved.el.style;
      s.transition = 'transform ' + PINCH_SETTLE_MS + 'ms ' + SETTLE_EASE;
      s.transform = 'scale(' + shown.toFixed(4) + ')';
      pendingCommit = () => commit(to, shown);
      settleTimer = setTimeout(() => {
        if (pendingCommit) pendingCommit();
      }, PINCH_SETTLE_MS);
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      begin(e);
    };
    const onMove = (e: TouchEvent) => {
      if (!st.on || e.touches.length < 2) return;
      if (e.cancelable) e.preventDefault();
      if (!(start > 0)) return;
      scale = pinchScale(spread(e.touches) / start);
      schedule();
    };
    const onEnd = (e: TouchEvent) => {
      if (st.on && e.touches.length < 2) release();
      if (e.touches.length === 0 && st.guard) {
        clearTimeout(guardTimer);
        guardTimer = setTimeout(() => {
          st.guard = false;
        }, PINCH_CLICK_GUARD_MS);
      }
    };
    const onClick = (e: Event) => {
      if (!st.guard && !st.on && !st.settling) return;
      e.preventDefault();
      e.stopPropagation();
    };
    root.addEventListener('touchstart', onStart, { passive: true });
    root.addEventListener('touchmove', onMove, { passive: false });
    root.addEventListener('touchend', onEnd, { passive: true });
    root.addEventListener('touchcancel', onEnd, { passive: true });
    root.addEventListener('click', onClick, true);
    return () => {
      clearTimeout(guardTimer);
      clearTimeout(settleTimer);
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      pendingCommit = null;
      restore();
      st.on = false;
      st.settling = false;
      st.guard = false;
      root.removeEventListener('touchstart', onStart);
      root.removeEventListener('touchmove', onMove);
      root.removeEventListener('touchend', onEnd);
      root.removeEventListener('touchcancel', onEnd);
      root.removeEventListener('click', onClick, true);
    };
  }, [enabled]);

  return { active: () => state.current.on || state.current.settling };
}
