// Two-finger pinch on a list container that steps a view one notch bigger (fingers apart) or smaller (together).
// Touch events, not pointer events: with the page's default touch-action the WebView cancels the pointers as soon as
// it treats two fingers as a pan or zoom, while touchmove keeps coming and can be cancelled.
import { useEffect, useRef } from 'preact/hooks';
import type { RefObject } from 'preact';
import { vibrate } from './vibrate';

/** Finger distance against the start that counts as a spread / a pinch. */
export const PINCH_OUT = 1.25;
export const PINCH_IN = 0.8;
/** After the last finger is up, a click (the browser's tap on the card under a finger) is swallowed for this long. */
export const PINCH_CLICK_GUARD_MS = 400;

/** 1: bigger, -1: smaller, 0: not far enough yet. */
export function pinchStepOf(ratio: number): 1 | -1 | 0 {
  if (!(ratio > 0)) return 0;
  if (ratio >= PINCH_OUT) return 1;
  if (ratio <= PINCH_IN) return -1;
  return 0;
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
  /** Applies one step; returns false when nothing changed (an end of the range): no vibration then. */
  onStep: (dir: 1 | -1) => boolean;
  /** The second finger is down: cancel what one finger started (a long press timer). */
  onStart?: () => void;
  /** Items carrying this attribute are used to keep the first visible one in place after the view changes. */
  anchorAttr?: string;
}

/**
 * One step per gesture, applied as soon as the finger distance passes PINCH_OUT / PINCH_IN. While two fingers are
 * down the page does not scroll (touchmove is cancelled while it still can be) and the click that may follow is
 * swallowed. One finger is left alone. Returns `active()`: two fingers are down right now.
 */
export function usePinchStep(ref: RefObject<HTMLElement | null>, opts: PinchOptions): { active: () => boolean } {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const state = useRef({ on: false, start: 0, done: false, guard: false });
  const enabled = opts.enabled;

  useEffect(() => {
    const root = ref.current;
    if (!enabled || !root) return;
    const st = state.current;
    let guardTimer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;

    const anchorOf = (attr: string): { key: string; top: number } | null => {
      const items = root.querySelectorAll('[' + attr + ']');
      for (let i = 0; i < items.length; i++) {
        const r = items[i].getBoundingClientRect();
        if (r.bottom > 0) return { key: items[i].getAttribute(attr) || '', top: r.top };
      }
      return null;
    };
    const step = (dir: 1 | -1) => {
      const o = optsRef.current;
      const attr = o.anchorAttr;
      const before = attr ? anchorOf(attr) : null;
      if (!o.onStep(dir)) return;
      vibrate();
      if (!attr || !before || typeof requestAnimationFrame === 'undefined') return;
      // after the new view renders, scroll so the card that was first on screen is where it was
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        const items = root.querySelectorAll('[' + attr + ']');
        for (let i = 0; i < items.length; i++) {
          if (items[i].getAttribute(attr) !== before.key) continue;
          const delta = Math.round(items[i].getBoundingClientRect().top - before.top);
          if (delta) scroller().scrollTop += delta;
          return;
        }
      });
    };

    const start = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      st.on = true;
      st.done = false;
      st.start = spread(e.touches);
      clearTimeout(guardTimer);
      st.guard = true;
      const o = optsRef.current;
      if (o.onStart) o.onStart();
    };
    const move = (e: TouchEvent) => {
      if (!st.on || e.touches.length < 2) return;
      if (e.cancelable) e.preventDefault();
      if (st.done || !(st.start > 0)) return;
      const dir = pinchStepOf(spread(e.touches) / st.start);
      if (!dir) return;
      st.done = true;
      step(dir);
    };
    const end = (e: TouchEvent) => {
      if (e.touches.length < 2) st.on = false;
      if (e.touches.length === 0 && st.guard) {
        clearTimeout(guardTimer);
        guardTimer = setTimeout(() => {
          st.guard = false;
        }, PINCH_CLICK_GUARD_MS);
      }
    };
    const click = (e: Event) => {
      if (!st.guard && !st.on) return;
      e.preventDefault();
      e.stopPropagation();
    };
    root.addEventListener('touchstart', start, { passive: true });
    root.addEventListener('touchmove', move, { passive: false });
    root.addEventListener('touchend', end, { passive: true });
    root.addEventListener('touchcancel', end, { passive: true });
    root.addEventListener('click', click, true);
    return () => {
      clearTimeout(guardTimer);
      if (frame) cancelAnimationFrame(frame);
      st.on = false;
      st.guard = false;
      root.removeEventListener('touchstart', start);
      root.removeEventListener('touchmove', move);
      root.removeEventListener('touchend', end);
      root.removeEventListener('touchcancel', end);
      root.removeEventListener('click', click, true);
    };
  }, [enabled]);

  return { active: () => state.current.on };
}
