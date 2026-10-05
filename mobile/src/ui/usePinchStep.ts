// Two-finger pinch on a list container: one view step per gesture (fingers apart = bigger, together = smaller).
// The step fires as soon as the finger distance passes a threshold; the rest of the gesture is ignored until the
// fingers lift. Nothing is scaled while the fingers move: the change itself is animated afterwards, FLIP style on the
// cards visible on screen, so the text stays crisp. When the card markup changes (rows and poster tiles), each
// poster moves and resizes from its old place to its new one (a shared-element transition) and the rest fades in.
// Touch events, not pointer events: with the page's default touch-action the WebView cancels the pointers as soon as
// it treats two fingers as a pan or zoom, while touchmove keeps coming and can be cancelled.
import { useEffect, useRef } from 'preact/hooks';
import type { RefObject } from 'preact';
import { vibrate } from './vibrate';

/** Finger distance ratios (now / at the start) that fire a step: at least PINCH_UP bigger, at most PINCH_DOWN smaller. */
export const PINCH_UP = 1.2;
export const PINCH_DOWN = 0.83;
/** The FLIP animation of the cards after a step. */
export const PINCH_FLIP_MS = 250;
/** When the card markup changes: the poster morph, and the fade-in of the rest of the card after a short delay. */
export const PINCH_MORPH_MS = 250;
export const PINCH_TEXT_DELAY_MS = 70;
export const PINCH_TEXT_MS = 180;
/** At most this many cards are measured and animated. */
export const PINCH_FLIP_MAX = 40;
/** After the last finger is up, a click (the browser's tap on the card under a finger) is swallowed for this long. */
export const PINCH_CLICK_GUARD_MS = 400;
const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

/** The step a finger distance ratio asks for: 1 = bigger, -1 = smaller, 0 = not yet. */
export function pinchDir(ratio: number): 1 | -1 | 0 {
  if (!(ratio > 0) || !isFinite(ratio)) return 0;
  if (ratio >= PINCH_UP) return 1;
  if (ratio <= PINCH_DOWN) return -1;
  return 0;
}

/** The step level after one step in `dir`, kept inside 0..levels-1. */
export function pinchTarget(level: number, levels: number, dir: number): number {
  return Math.max(0, Math.min(levels - 1, level + dir));
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

function viewportHeight(): number {
  return window.innerHeight || document.documentElement.clientHeight || 0;
}

interface Card {
  key: string;
  el: HTMLElement;
  rect: DOMRect;
}

/**
 * The cards on screen, in document order, at most PINCH_FLIP_MAX. Cards are laid out top to bottom, so the first one
 * on screen is found by a binary search and the walk stops below the viewport: only the visible cards are measured.
 */
export function visibleCards(root: HTMLElement, attr: string): Card[] {
  const items = root.querySelectorAll<HTMLElement>('[' + attr + ']');
  const vh = viewportHeight();
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid].getBoundingClientRect().bottom > 0) hi = mid;
    else lo = mid + 1;
  }
  const out: Card[] = [];
  for (let i = lo; i < items.length && out.length < PINCH_FLIP_MAX; i++) {
    const rect = items[i].getBoundingClientRect();
    if (vh && rect.top >= vh) break;
    if (rect.bottom <= 0 || rect.width <= 0 || rect.height <= 0) continue;
    out.push({ key: items[i].getAttribute(attr) || '', el: items[i], rect });
  }
  return out;
}

function canAnimate(el: Element): boolean {
  return typeof (el as HTMLElement).animate === 'function';
}

export interface PinchOptions {
  enabled: boolean;
  /** Number of view steps; 0 is the smallest, levels - 1 the biggest. */
  levels: number;
  /** The current step. */
  level: () => number;
  /** Applies a step (always a different one from level()). */
  apply: (level: number) => void;
  /** The second finger is down: cancel what one finger started (a long press timer). */
  onStart?: () => void;
  /** The attribute carrying each card's stable key: cards are matched by it before and after the step. */
  anchorAttr?: string;
  /** The attribute on each card's poster (same key as the card): posters are matched by it when the markup changes. */
  posterAttr?: string;
  /** The step changes the card markup (rows and poster tiles): morph the posters instead of moving the cards. */
  morph?: (from: number, to: number) => boolean;
}

interface PosterBox {
  rect: DOMRect;
  radius: number;
}

function radiusOf(el: Element): number {
  try {
    const r = parseFloat(getComputedStyle(el).borderTopLeftRadius);
    return r > 0 ? r : 0;
  } catch {
    return 0;
  }
}

/** The posters inside the given cards, by card key (the first poster of each card). */
function postersOf(cards: Card[], attr: string): Map<string, PosterBox> {
  const out = new Map<string, PosterBox>();
  for (const c of cards) {
    const p = c.el.hasAttribute(attr) ? c.el : c.el.querySelector('[' + attr + ']');
    if (!p) continue;
    const rect = p.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    out.set(p.getAttribute(attr) || c.key, { rect, radius: radiusOf(p) });
  }
  return out;
}

/** Everything in the card but the poster: the siblings of the poster and of each of its ancestors up to the card. */
function besidePoster(card: HTMLElement, poster: Element): HTMLElement[] {
  const out: HTMLElement[] = [];
  let node: Element = poster;
  while (node !== card && node.parentElement) {
    const parent: HTMLElement = node.parentElement;
    for (let i = 0; i < parent.children.length; i++) {
      const sib = parent.children[i];
      if (sib !== node) out.push(sib as HTMLElement);
    }
    if (parent === card) break;
    node = parent;
  }
  return out;
}

interface Anchor {
  key: string;
  /** Centre of the card before the step (viewport y). */
  cy: number;
}

/**
 * Listens for two fingers on the element. While they are down the page does not scroll and the click that may follow
 * is swallowed; once the distance passes PINCH_UP or PINCH_DOWN the step is applied (with a short vibration) and the
 * change animated. One finger is left alone. Returns `active()`: two fingers are down.
 */
export function usePinchStep(ref: RefObject<HTMLElement | null>, opts: PinchOptions): { active: () => boolean } {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const state = useRef({ on: false, guard: false });
  const enabled = opts.enabled;

  useEffect(() => {
    const root = ref.current;
    if (!enabled || !root) return;
    const st = state.current;
    let guardTimer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;
    let start = 0;
    /** The step of this gesture has fired (or hit an end): ignore the fingers until they all lift. */
    let spent = false;
    let my = 0;
    let mx = 0;
    let running: Animation[] = [];

    const stopAnimations = () => {
      for (const a of running) {
        try {
          a.cancel();
        } catch {
          /* already gone */
        }
      }
      running = [];
    };
    const play = (el: HTMLElement, frames: Keyframe[], o: KeyframeAnimationOptions) => {
      if (!canAnimate(el)) return null;
      const a = el.animate(frames, o);
      if (a) running.push(a);
      return a;
    };
    /** Runs `fn` once, after the render the step asked for and before the next paint. */
    const afterRender = (fn: () => void) => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      if (typeof requestAnimationFrame === 'function') {
        frame = requestAnimationFrame(() => {
          frame = 0;
          fn();
        });
      } else {
        Promise.resolve().then(fn);
      }
    };

    /** The card nearest to the pinch midpoint, among the ones on screen. */
    const anchorOf = (cards: Card[]): Anchor | null => {
      let best: Anchor | null = null;
      let bestD = Infinity;
      for (const c of cards) {
        const r = c.rect;
        const dx = mx < r.left ? r.left - mx : mx > r.right ? mx - r.right : 0;
        const dy = my < r.top ? r.top - my : my > r.bottom ? my - r.bottom : 0;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = { key: c.key, cy: (r.top + r.bottom) / 2 };
        }
      }
      return best;
    };
    /** The anchor card goes back to where it was seen. */
    const keepAnchor = (a: Anchor) => {
      const attr = optsRef.current.anchorAttr;
      if (!attr) return;
      const items = root.querySelectorAll('[' + attr + ']');
      for (let i = 0; i < items.length; i++) {
        if (items[i].getAttribute(attr) !== a.key) continue;
        const r = items[i].getBoundingClientRect();
        const delta = Math.round((r.top + r.bottom) / 2 - a.cy);
        if (delta) scroller().scrollTop += delta;
        return;
      }
    };

    /** FLIP: every card on screen now starts where it was seen and moves to its new place; new ones fade in. */
    const flip = (before: Card[]) => {
      const attr = optsRef.current.anchorAttr;
      if (!attr) return;
      const old = new Map<string, DOMRect>();
      for (const c of before) old.set(c.key, c.rect);
      const after = visibleCards(root, attr);
      const seen = new Set<string>();
      const timing: KeyframeAnimationOptions = { duration: PINCH_FLIP_MS, easing: EASE_OUT };
      for (const c of after) {
        seen.add(c.key);
        const o = old.get(c.key);
        if (!o) {
          play(c.el, [{ opacity: 0 }, { opacity: 1 }], timing);
          continue;
        }
        const n = c.rect;
        const s = n.width > 0 ? o.width / n.width : 1;
        const dx = o.left - n.left;
        const dy = o.top - n.top;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(s - 1) < 0.005) continue;
        play(
          c.el,
          [
            { transformOrigin: '0 0', transform: 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px) scale(' + s.toFixed(4) + ')' },
            { transformOrigin: '0 0', transform: 'none' },
          ],
          timing,
        );
      }
      // cards that leave the screen (still in the list, now below or above it) slide out and fade
      for (const c of before) {
        if (seen.has(c.key) || running.length >= PINCH_FLIP_MAX) continue;
        if (!c.el.isConnected) continue;
        const n = c.el.getBoundingClientRect();
        const s = n.width > 0 ? c.rect.width / n.width : 1;
        const dx = c.rect.left - n.left;
        const dy = c.rect.top - n.top;
        play(
          c.el,
          [
            { transformOrigin: '0 0', transform: 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px) scale(' + s.toFixed(4) + ')', opacity: 1 },
            { transformOrigin: '0 0', transform: 'none', opacity: 0 },
          ],
          timing,
        );
      }
    };

    /**
     * Rows and poster tiles: each poster seen before moves and resizes from its old box to its new one, the rest of
     * the card fades in a little later. Cards without a poster counterpart fade in whole; the old ones are just gone.
     */
    const morph = (oldPosters: Map<string, PosterBox>) => {
      const o = optsRef.current;
      const attr = o.anchorAttr;
      const pAttr = o.posterAttr;
      if (!attr || !pAttr) return;
      const after = visibleCards(root, attr);
      const timing: KeyframeAnimationOptions = { duration: PINCH_MORPH_MS, easing: EASE_OUT };
      const text: KeyframeAnimationOptions = { duration: PINCH_TEXT_MS, delay: PINCH_TEXT_DELAY_MS, easing: 'ease-out', fill: 'backwards' };
      for (const c of after) {
        const poster = c.el.querySelector<HTMLElement>('[' + pAttr + ']');
        const old = poster ? oldPosters.get(poster.getAttribute(pAttr) || c.key) : undefined;
        if (!poster || !old) {
          play(c.el, [{ opacity: 0 }, { opacity: 1 }], timing);
          continue;
        }
        const n = poster.getBoundingClientRect();
        const sx = n.width > 0 ? old.rect.width / n.width : 1;
        const sy = n.height > 0 ? old.rect.height / n.height : 1;
        const dx = old.rect.left - n.left;
        const dy = old.rect.top - n.top;
        const first: Keyframe = {
          transformOrigin: '0 0',
          transform: 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px) scale(' + sx.toFixed(4) + ',' + sy.toFixed(4) + ')',
        };
        const last: Keyframe = { transformOrigin: '0 0', transform: 'none' };
        // the corners keep their old look while the box is scaled unevenly
        const r = radiusOf(poster);
        if ((old.radius || r) && sx > 0 && sy > 0) {
          first.borderRadius = (old.radius / sx).toFixed(1) + 'px / ' + (old.radius / sy).toFixed(1) + 'px';
          last.borderRadius = r + 'px';
        }
        play(poster, [first, last], timing);
        for (const x of besidePoster(c.el, poster)) play(x, [{ opacity: 0 }, { opacity: 1 }], text);
      }
    };

    const step = (dir: 1 | -1) => {
      spent = true;
      const o = optsRef.current;
      const from = o.level();
      const to = pinchTarget(from, o.levels, dir);
      if (to === from) return;
      vibrate();
      const attr = o.anchorAttr;
      // measured with any running animation still on, so a new step starts from what is seen
      const before = attr ? visibleCards(root, attr) : [];
      const anchor = anchorOf(before);
      const still = prefersReducedMotion() || !canAnimate(root);
      const morphing = !still && !!o.morph && !!o.posterAttr && o.morph(from, to);
      const posters = morphing && o.posterAttr ? postersOf(before, o.posterAttr) : null;
      stopAnimations();
      optsRef.current.apply(to);
      afterRender(() => {
        if (anchor) keepAnchor(anchor);
        if (still) return;
        if (posters) morph(posters);
        else flip(before);
      });
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length < 2) return;
      if (!st.on) {
        st.on = true;
        clearTimeout(guardTimer);
        st.guard = true;
        const o = optsRef.current;
        if (o.onStart) o.onStart();
      }
      if (spent || e.touches.length !== 2) return;
      start = spread(e.touches);
      const a = e.touches[0];
      const b = e.touches[1];
      mx = (a.clientX + b.clientX) / 2;
      my = (a.clientY + b.clientY) / 2;
    };
    const onMove = (e: TouchEvent) => {
      if (!st.on || e.touches.length < 2) return;
      if (e.cancelable) e.preventDefault();
      if (spent || !(start > 0)) return;
      const dir = pinchDir(spread(e.touches) / start);
      if (dir) step(dir);
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length > 0) return;
      st.on = false;
      spent = false;
      start = 0;
      if (st.guard) {
        clearTimeout(guardTimer);
        guardTimer = setTimeout(() => {
          st.guard = false;
        }, PINCH_CLICK_GUARD_MS);
      }
    };
    const onClick = (e: Event) => {
      if (!st.guard && !st.on) return;
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
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      stopAnimations();
      st.on = false;
      st.guard = false;
      root.removeEventListener('touchstart', onStart);
      root.removeEventListener('touchmove', onMove);
      root.removeEventListener('touchend', onEnd);
      root.removeEventListener('touchcancel', onEnd);
      root.removeEventListener('click', onClick, true);
    };
  }, [enabled]);

  return { active: () => state.current.on };
}
