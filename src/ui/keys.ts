import { useEffect, useRef } from 'preact/hooks';
import { keyAction, KeyAction } from '../platform/keys';

/** true = consumed; 'spatial' = stop other handlers but let spatial navigation process the key. */
export type KeyResult = boolean | 'spatial';
export type KeyHandler = (a: KeyAction, e: KeyboardEvent) => KeyResult;

interface Entry {
  h: KeyHandler;
  prio: number;
  seq: number;
}

let entries: Entry[] = [];
let seq = 0;

export function pushKeyHandler(h: KeyHandler, prio = 0): () => void {
  const entry: Entry = { h, prio, seq: ++seq };
  entries.push(entry);
  return () => {
    entries = entries.filter((x) => x !== entry);
  };
}

export function dispatchKey(a: KeyAction, e: KeyboardEvent): KeyResult {
  const sorted = entries.slice().sort((x, y) => y.prio - x.prio || y.seq - x.seq);
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i].h(a, e);
    if (r) return r;
  }
  return false;
}

export function useKeys(handler: KeyHandler, prio = 0): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => pushKeyHandler((a, e) => ref.current(a, e), prio), [prio]);
}

function isTextInput(t: EventTarget | null): t is HTMLInputElement {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
}

export function installKeyListener(onUnhandledBack: () => void): () => void {
  const listener = (e: KeyboardEvent) => {
    const a = keyAction(e);
    if (!a) return;
    if (isTextInput(e.target)) {
      if (e.keyCode === 8) return; // Backspace edits text
      if (a === 'left' || a === 'right') {
        // native caret movement; keep norigin from preventDefault-ing it
        e.stopPropagation();
        return;
      }
      if (a === 'back' || a === 'up' || a === 'down') e.target.blur();
      if (a === 'back') {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    const r = dispatchKey(a, e);
    if (r === true) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (r === 'spatial') return;
    if (a === 'back') {
      e.preventDefault();
      e.stopPropagation();
      onUnhandledBack();
    }
  };
  // capture phase: runs before the spatial-navigation listener on window
  window.addEventListener('keydown', listener, true);
  return () => window.removeEventListener('keydown', listener, true);
}
