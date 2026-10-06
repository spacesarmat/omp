// Pull-to-refresh, the way «Мои» does it: a downward drag from the very top of the page moves the list at half speed;
// released past the trigger it refreshes, the spinner holding until the refresh ends. Horizontal chip rows and the
// segment are left alone.
import type { ComponentChildren, RefObject } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

const PULL_DAMP = 0.5;
const PULL_MAX = 110;
export const PULL_TRIGGER = 64;
const PULL_HOLD = 56;
const pullOf = (dy: number) => (dy > 0 ? Math.min(PULL_MAX, dy * PULL_DAMP) : 0);

export interface PullState { pull: number; dragging: boolean; refreshing: boolean; }

export function usePullRefresh(rootRef: RefObject<HTMLElement | null>, onRefresh: () => Promise<unknown>): PullState {
  const [pull, setPull] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let startY = 0;
    let startX = 0;
    let pulling = false;
    let busy = false;
    let alive = true;
    const atTop = () => (window.scrollY || document.documentElement.scrollTop || 0) <= 0;
    let frame = 0;
    let next = 0;
    const show = (v: number) => {
      next = v;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (alive) setPull(next);
      });
    };
    const move = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      const dy = t.clientY - startY;
      const dx = t.clientX - startX;
      if (dy > 0 && dy > Math.abs(dx) && atTop()) {
        if (e.cancelable) e.preventDefault();
        setDragging(true);
        show(pullOf(dy));
      } else show(0);
    };
    const stop = () => {
      pulling = false;
      document.removeEventListener('touchmove', move);
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      setDragging(false);
    };
    const start = (e: TouchEvent) => {
      stop();
      if (busy || e.touches.length !== 1 || !atTop()) return;
      const target = e.target as Element | null;
      if (target && target.closest && target.closest('.m-chips, .m-seg, .m-hfilters')) return;
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      pulling = true;
      document.addEventListener('touchmove', move, { passive: false });
    };
    const end = (e: TouchEvent) => {
      if (!pulling) return;
      const t = e.changedTouches[0];
      const dy = t ? t.clientY - startY : 0;
      const dx = t ? t.clientX - startX : 0;
      stop();
      if (pullOf(dy) >= PULL_TRIGGER && dy > Math.abs(dx) * 1.5 && atTop() && !busy) {
        busy = true;
        setPull(PULL_HOLD);
        setRefreshing(true);
        const done = () => {
          busy = false;
          if (!alive) return;
          setRefreshing(false);
          setPull(0);
        };
        refresh.current().then(done, done);
      } else setPull(0);
    };
    const cancel = () => {
      stop();
      if (!busy) setPull(0);
    };
    root.addEventListener('touchstart', start, { passive: true });
    root.addEventListener('touchend', end, { passive: true });
    root.addEventListener('touchcancel', cancel, { passive: true });
    return () => {
      alive = false;
      stop();
      root.removeEventListener('touchstart', start);
      root.removeEventListener('touchend', end);
      root.removeEventListener('touchcancel', cancel);
    };
  }, []);
  return { pull, dragging, refreshing };
}

/** The spinner over the list and the list that follows the finger (the m-lib-pull look of «Мои»). */
export function PullArea({ state, label, children }: { state: PullState; label: string; children: ComponentChildren }) {
  const { pull, dragging, refreshing } = state;
  const armed = pull >= PULL_TRIGGER || refreshing;
  const bodyStyle = pull > 0 || dragging
    ? { transform: 'translateY(' + pull + 'px)', transition: dragging ? 'none' : 'transform .25s ease' }
    : { transition: 'transform .25s ease' };
  return (
    <div class="m-lib-pull">
      {(pull > 0 || refreshing) && (
        <div
          class={'m-ptr' + (armed ? ' armed' : '')}
          role="status"
          style={{
            transform: 'translate(-50%, ' + (pull - 48) + 'px)',
            opacity: Math.min(1, pull / PULL_TRIGGER),
            transition: dragging ? 'none' : 'transform .25s ease, opacity .25s ease',
          }}
        >
          <svg
            class={refreshing ? 'm-spin' : ''}
            style={refreshing ? undefined : { transform: 'rotate(' + Math.round((pull / PULL_TRIGGER) * 300) + 'deg)' }}
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4" />
          </svg>
          {refreshing && <span class="m-sr">{label}</span>}
        </div>
      )}
      <div class="m-lib-body" style={bodyStyle}>
        {children}
      </div>
    </div>
  );
}
