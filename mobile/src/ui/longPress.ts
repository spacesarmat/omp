import { useRef } from 'preact/hooks';

const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP = 10;

/** A long press (500 ms without moving more than 10 px) or contextmenu runs `onLong`; the tap after it is swallowed. */
export function useLongPress(onLong: () => void, onTap: () => void) {
  const p = useRef<{ timer: ReturnType<typeof setTimeout> | undefined; x: number; y: number; fired: boolean }>({
    timer: undefined,
    x: 0,
    y: 0,
    fired: false,
  }).current;
  const stop = () => {
    clearTimeout(p.timer);
    p.timer = undefined;
  };
  return {
    onPointerDown: (e: PointerEvent) => {
      stop();
      p.fired = false;
      p.x = e.clientX;
      p.y = e.clientY;
      p.timer = setTimeout(() => {
        p.timer = undefined;
        p.fired = true;
        onLong();
      }, LONG_PRESS_MS);
    },
    onPointerMove: (e: PointerEvent) => {
      if (p.timer && Math.hypot(e.clientX - p.x, e.clientY - p.y) > LONG_PRESS_SLOP) stop();
    },
    onPointerUp: stop,
    onPointerCancel: stop,
    onContextMenu: (e: Event) => {
      e.preventDefault();
      stop();
      p.fired = true;
      onLong();
    },
    onClick: () => {
      if (p.fired) {
        p.fired = false;
        return;
      }
      onTap();
    },
  };
}
