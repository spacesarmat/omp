import { useEffect, useRef } from 'preact/hooks';

/**
 * System «Назад» for whatever is open on top of the screen (sheets, dialogs): the last opened one handles it first.
 * A handler returns false to let «Назад» go on to the screen below.
 */
const stack: (() => boolean)[] = [];

/** Registers a handler; returns the function that removes it. */
export function pushBack(h: () => boolean): () => void {
  stack.push(h);
  return () => {
    const i = stack.lastIndexOf(h);
    if (i >= 0) stack.splice(i, 1);
  };
}

/** Runs the top handler; true when it took «Назад». */
export function runBack(): boolean {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i]()) return true;
  }
  return false;
}

/** While mounted (and `active`), «Назад» calls `onBack`, the latest one passed. */
export function useBackHandler(onBack: () => void, active = true): void {
  const ref = useRef(onBack);
  ref.current = onBack;
  useEffect(() => {
    if (!active) return;
    return pushBack(() => {
      ref.current();
      return true;
    });
  }, [active]);
}
