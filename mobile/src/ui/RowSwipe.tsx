// A catalog row that slides sideways to reveal actions underneath. One row open at a time.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { signal } from '@preact/signals';
import { t } from '../../../src/i18n';
import { beginRowSwipe, endRowSwipe, moveRowSwipe, ROW_REVEAL, rowSwipeVisual, type RowGesture } from './rowSwipe';

/** The row whose actions are open. Empty when every row is shut. */
export const openRowKey = signal('');

export function RowSwipe(p: {
  id: string;
  anchor?: string;
  class?: string;
  disabled?: boolean;
  onRemove: () => void;
  onWatched: () => void;
  children: ComponentChildren;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const actions = useRef(p);
  actions.current = p;
  const [open, setOpen] = useState(false);
  const [dx, setDx] = useState(0);
  const [drag, setDrag] = useState(false);
  const ignore = useRef(false);

  useEffect(() => {
    if (openRowKey.value !== p.id && open) {
      setOpen(false);
      setDx(0);
    }
  }, [openRowKey.value, p.id, open]);

  useEffect(() => {
    const root = ref.current;
    if (!root || p.disabled) return;
    let state: RowGesture | null = null;
    const start = (e: TouchEvent) => {
      ignore.current = false;
      if (e.touches.length !== 1) {
        state = null;
        return;
      }
      const t0 = e.touches[0];
      state = beginRowSwipe(t0.clientX, t0.clientY, openRowKey.peek() === actions.current.id);
      setDrag(false);
    };
    const move = (e: TouchEvent) => {
      if (!state || e.touches.length !== 1) return;
      const t0 = e.touches[0];
      const next = moveRowSwipe(state, t0.clientX, t0.clientY);
      if (next.phase === 'horizontal' && e.cancelable) e.preventDefault();
      state = next;
      if (next.phase === 'horizontal') {
        setDrag(true);
        setDx(rowSwipeVisual(next));
      }
    };
    const settle = (next: 'open' | 'closed') => {
      if (next === 'open') {
        openRowKey.value = actions.current.id;
        setOpen(true);
        setDx(-ROW_REVEAL);
      } else {
        if (openRowKey.peek() === actions.current.id) openRowKey.value = '';
        setOpen(false);
        setDx(0);
      }
    };
    const end = () => {
      if (!state) return;
      const horizontal = state.phase === 'horizontal';
      const next = endRowSwipe(state);
      state = null;
      setDrag(false);
      if (horizontal) ignore.current = true;
      settle(next);
    };
    const cancel = () => {
      state = null;
      setDrag(false);
      setDx(openRowKey.peek() === actions.current.id ? -ROW_REVEAL : 0);
    };
    const onClick = (e: Event) => {
      if (!ignore.current && openRowKey.peek() !== actions.current.id) return;
      ignore.current = false;
      if (openRowKey.peek() === actions.current.id) {
        const target = e.target as Element | null;
        if (target && target.closest('.m-row-swipe-actions')) return;
        openRowKey.value = '';
        setOpen(false);
        setDx(0);
      }
      e.preventDefault();
      e.stopPropagation();
    };
    const outside = (e: Event) => {
      if (openRowKey.peek() !== actions.current.id) return;
      const target = e.target as Node | null;
      if (target && root.contains(target)) return;
      openRowKey.value = '';
      setOpen(false);
      setDx(0);
    };
    const onScroll = () => {
      if (openRowKey.peek() !== actions.current.id) return;
      openRowKey.value = '';
      setOpen(false);
      setDx(0);
    };
    root.addEventListener('touchstart', start, { passive: true });
    root.addEventListener('touchmove', move, { passive: false });
    root.addEventListener('touchend', end);
    root.addEventListener('touchcancel', cancel);
    root.addEventListener('click', onClick, true);
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      root.removeEventListener('touchstart', start);
      root.removeEventListener('touchmove', move);
      root.removeEventListener('touchend', end);
      root.removeEventListener('touchcancel', cancel);
      root.removeEventListener('click', onClick, true);
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('scroll', onScroll);
    };
  }, [p.disabled, p.id]);

  return (
    <div class={'m-row-swipe' + (p.class ? ' ' + p.class : '')} ref={ref} data-noswipe data-anchor={p.anchor} data-row-swipe={p.id} data-open={open ? '1' : '0'}>
      <div class="m-row-swipe-actions">
        <button type="button" class="danger" onClick={p.onRemove}>{t('history.removeItem')}</button>
        <button type="button" class="ok" onClick={p.onWatched}>{t('history.markWatched')}</button>
      </div>
      <div class={'m-row-swipe-fg' + (drag ? ' drag' : '')} style={dx ? { transform: 'translateX(' + dx + 'px)' } : undefined}>
        {p.children}
      </div>
    </div>
  );
}
