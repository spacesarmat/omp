// Scroll position of the window across route changes (used only by nav.ts).
// Screens scroll the window; sheets are overlays and never go through here.

/** How long a restore keeps waiting for a screen whose list renders later. */
export const RESTORE_WINDOW_MS = 1500;

function scroller(): Element {
  return document.scrollingElement || document.documentElement;
}

/** Current vertical scroll of the page. */
export function currentScroll(): number {
  return window.scrollY || scroller().scrollTop || 0;
}

function setScroll(y: number): void {
  // scrollTop on the scrolling element: same effect as window.scrollTo, and quiet in jsdom
  scroller().scrollTop = y;
}

function maxScroll(): number {
  return Math.max(0, scroller().scrollHeight - window.innerHeight);
}

let frame = 0;
let stopListening: (() => void) | null = null;

/** The page to the top now (a restore still waiting is dropped). */
export function scrollToTop(): void {
  cancelRestore();
  setScroll(0);
}

/** Stops a restore still waiting for the page to grow. */
export function cancelRestore(): void {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  if (stopListening) stopListening();
  stopListening = null;
}

/**
 * Scrolls the page to `y` once the new screen has rendered. While the page is still too short (a list arriving from the
 * server) it keeps re-applying the target every frame for up to RESTORE_WINDOW_MS, and gives up as soon as the user
 * touches or scrolls the page. A new navigation cancels it.
 */
export function restoreScroll(y: number): void {
  cancelRestore();
  const target = Math.max(0, y || 0);
  const started = Date.now();
  const onUser = () => cancelRestore();
  const opts = { passive: true } as AddEventListenerOptions;
  window.addEventListener('touchstart', onUser, opts);
  window.addEventListener('wheel', onUser, opts);
  window.addEventListener('keydown', onUser);
  stopListening = () => {
    window.removeEventListener('touchstart', onUser, opts);
    window.removeEventListener('wheel', onUser, opts);
    window.removeEventListener('keydown', onUser);
  };
  const step = () => {
    frame = 0;
    const reachable = Math.min(target, maxScroll());
    if (currentScroll() !== reachable) setScroll(reachable);
    if (reachable >= target || Date.now() - started >= RESTORE_WINDOW_MS) {
      cancelRestore();
      return;
    }
    frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
}

// scroll of each bottom tab's root screen, by tab name (memory only)
const tabScroll: Record<string, number> = {};

export function rememberTab(name: string, y: number): void {
  tabScroll[name] = y;
}

export function tabScrollOf(name: string): number {
  return tabScroll[name] || 0;
}

/** Forgets everything (tests). */
export function resetScrollMemory(): void {
  cancelRestore();
  for (const k of Object.keys(tabScroll)) delete tabScroll[k];
}
