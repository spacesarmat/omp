import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { t } from '../../../src/i18n';
import type { Key } from '../../../src/i18n';
import { settings } from '../../../src/store/settings';
import { currentRoute } from '../nav';
import { hintOffers, markHintSeen, pickHint, registerHint, unregisterHint } from '../../../src/onboarding/hints';
import { hintBlockedByOverlay, hintBubbleWidth, placeCoachMark, readSafeInsets, ZERO_INSETS, type HintBox } from './hintPlace';

const TEXT: { [id: string]: Key } = {
  catalog: 'hints.catalog',
  mine: 'hints.mine',
  audiobooks: 'hints.audiobooks',
  audiobookPlayer: 'hints.audiobookPlayer',
  videoPlayer: 'hints.videoPlayer',
};

const ESTIMATE_H = 112;

interface Shown {
  id: string;
  top: number;
  left: number;
  place: 'above' | 'below';
  arrow: number;
}

/** Offer this hint while the screen that owns the control is mounted. */
export function useHint(id: string): void {
  useLayoutEffect(() => {
    registerHint(id);
    return () => unregisterHint(id);
  }, [id]);
}

function anchorOf(id: string): HTMLElement | null {
  return document.querySelector('[data-hint-anchor="' + id + '"]');
}

function toBox(r: HintBox): HintBox {
  return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
}

function sameShown(a: Shown | null, b: Shown | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.id === b.id && a.place === b.place && a.top === b.top && a.left === b.left && a.arrow === b.arrow;
}

/**
 * One coach mark at a time, with an arrow toward its control.
 * Hidden while any sheet, dialog, or the first-run tour is up, and while the target is offscreen.
 * Nothing is drawn over «Сейчас играет». TV does not mount this.
 */
export function HintHost(p: { blocked: boolean }) {
  const offered = hintOffers();
  const seen = settings.value.seenHints;
  const route = currentRoute.value.name;
  const [box, setBox] = useState<Shown | null>(null);
  const hintRef = useRef<HTMLDivElement>(null);
  const insetRef = useRef<HTMLDivElement>(null);
  const live = useRef({ blocked: p.blocked, route, offered, seen });
  live.current = { blocked: p.blocked, route, offered, seen };

  const measureRef = useRef(() => {});
  measureRef.current = () => {
    const cur = live.current;
    const hold = hintBlockedByOverlay(document);
    // Class flips before paint, so a sheet covers nothing clickable even for the frame before this unmounts.
    document.documentElement.classList.toggle('m-hint-hold', hold);
    if (cur.blocked || cur.route === 'nowPlaying' || hold) {
      setBox((prev) => (prev === null ? prev : null));
      return;
    }
    // Offscreen does not skip ahead: a higher hint stays queued until its control is back, or it is dismissed.
    const id = pickHint(cur.offered, cur.seen, (hint) => !!anchorOf(hint));
    const el = id ? anchorOf(id) : null;
    if (!id || !el) {
      setBox((prev) => (prev === null ? prev : null));
      return;
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const node = hintRef.current;
    const measured = node && node.getAttribute('data-hint') === id ? node.getBoundingClientRect() : null;
    const hint = {
      width: measured && measured.width > 0 ? measured.width : hintBubbleWidth(vw),
      height: measured && measured.height > 0 ? Math.round(measured.height) : ESTIMATE_H,
    };
    const insets = insetRef.current ? readSafeInsets(getComputedStyle(insetRef.current)) : ZERO_INSETS;
    const spot = placeCoachMark(toBox(el.getBoundingClientRect()), hint, vw, vh, insets);
    const next: Shown | null = spot
      ? { id, top: Math.round(spot.top), left: Math.round(spot.left), place: spot.place, arrow: Math.round(spot.arrow) }
      : null;
    setBox((prev) => (sameShown(prev, next) ? prev : next));
  };

  useLayoutEffect(() => {
    measureRef.current();
  });

  // The control's own box (a wrapping label, a font load). Scroll is handled separately: size is not position.
  useLayoutEffect(() => {
    if (typeof ResizeObserver !== 'function') return;
    const el = box ? anchorOf(box.id) : null;
    if (!el) return;
    const ro = new ResizeObserver(() => measureRef.current());
    ro.observe(el);
    return () => ro.disconnect();
  }, [box ? box.id : '']);

  useLayoutEffect(() => {
    let alive = true;
    const run = () => {
      if (alive) measureRef.current();
    };
    // Capture: a scroll inside a pane (not only the window) moves the control too.
    window.addEventListener('scroll', run, true);
    document.addEventListener('scroll', run, true);
    window.addEventListener('resize', run);
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', run);
      vv.addEventListener('scroll', run);
    }
    const mo = new MutationObserver(run);
    mo.observe(document.body, { childList: true, subtree: true });
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(run);
      ro.observe(document.documentElement);
    }
    return () => {
      alive = false;
      window.removeEventListener('scroll', run, true);
      document.removeEventListener('scroll', run, true);
      window.removeEventListener('resize', run);
      if (vv) {
        vv.removeEventListener('resize', run);
        vv.removeEventListener('scroll', run);
      }
      mo.disconnect();
      ro?.disconnect();
      document.documentElement.classList.remove('m-hint-hold');
    };
  }, []);

  const text = box && TEXT[box.id] ? t(TEXT[box.id]) : box ? box.id : '';
  return (
    <>
      {/* Reads env(safe-area-inset-*) for the status bar. Kept mounted so the first placement already clears it. */}
      <div ref={insetRef} class="m-hint-insets" aria-hidden="true" />
      {box && (
        <div
          ref={hintRef}
          class="m-hint"
          style={{ top: box.top + 'px', left: box.left + 'px' }}
          data-hint={box.id}
          data-place={box.place}
          role="note"
        >
          <span class="m-hint-arrow" data-hint-arrow="" style={{ left: box.arrow + 'px' }} aria-hidden="true" />
          <p>{text}</p>
          <button type="button" data-action="hint-dismiss" onClick={() => markHintSeen(box.id)}>
            {t('hints.dismiss')}
          </button>
        </div>
      )}
    </>
  );
}
