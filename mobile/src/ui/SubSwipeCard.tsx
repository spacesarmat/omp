// One subscription card that follows a finger sideways. Right checks, left asks before delete.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { t } from '../../../src/i18n';
import { Icon, ICONS } from './Icon';
import { beginSubSwipe, moveSubSwipe, subSwipeAction, subSwipeVisual, type SubSwipe } from './subSwipe';

export function SubSwipeCard(p: { id: string; onCheck: () => void; onDelete: () => void; children: ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  const actions = useRef(p);
  actions.current = p;
  const [dx, setDx] = useState(0);
  const [drag, setDrag] = useState(false);
  const ignore = useRef(false);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let state: SubSwipe | null = null;
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        state = null;
        return;
      }
      const t0 = e.touches[0];
      state = beginSubSwipe(t0.clientX, t0.clientY);
      setDrag(false);
    };
    const move = (e: TouchEvent) => {
      if (!state || e.touches.length !== 1) return;
      const t0 = e.touches[0];
      const next = moveSubSwipe(state, t0.clientX, t0.clientY);
      if (next.phase === 'horizontal' && e.cancelable) e.preventDefault();
      state = next;
      if (next.phase === 'horizontal') {
        setDrag(true);
        setDx(subSwipeVisual(next.dx));
      }
    };
    const end = () => {
      if (!state) return;
      const action = state.phase === 'horizontal' ? subSwipeAction(state.dx) : null;
      if (state.phase === 'horizontal') ignore.current = true;
      state = null;
      setDrag(false);
      setDx(0);
      if (action === 'check') actions.current.onCheck();
      else if (action === 'delete') actions.current.onDelete();
    };
    const cancel = () => {
      state = null;
      setDrag(false);
      setDx(0);
    };
    const onClick = (e: Event) => {
      if (!ignore.current) return;
      ignore.current = false;
      e.preventDefault();
      e.stopPropagation();
    };
    root.addEventListener('touchstart', start, { passive: true });
    root.addEventListener('touchmove', move, { passive: false });
    root.addEventListener('touchend', end);
    root.addEventListener('touchcancel', cancel);
    root.addEventListener('click', onClick, true);
    return () => {
      root.removeEventListener('touchstart', start);
      root.removeEventListener('touchmove', move);
      root.removeEventListener('touchend', end);
      root.removeEventListener('touchcancel', cancel);
      root.removeEventListener('click', onClick, true);
    };
  }, []);

  return (
    <div class="m-sub-swipe" ref={ref} data-noswipe data-sub-swipe={p.id}>
      <div class={'m-sub-swipe-bg m-sub-swipe-check tm' + (dx > 0 ? ' on' : '')} data-code="P03.5" aria-hidden="true">
        <Icon d={ICONS.refresh} size={22} />
        <span class="m-sub-swipe-label">{t('news.swipeCheck')}</span>
      </div>
      <div class={'m-sub-swipe-bg m-sub-swipe-delete tm' + (dx < 0 ? ' on' : '')} data-code="P03.6" aria-hidden="true">
        <Icon d={ICONS.trash} size={22} />
        <span class="m-sub-swipe-label">{t('common.delete')}</span>
      </div>
      <div class={'m-sub-swipe-fg' + (drag ? ' drag' : '')} style={dx ? { transform: 'translateX(' + dx + 'px)' } : undefined}>
        {p.children}
      </div>
    </div>
  );
}
