// OMP's own keypad for the TorrServer address (TV and phone): digits, «.», «:», backspace, the scheme keys, «Готово»
// and the switch to the system keyboard. Pure editing here; the TV and phone components draw it.
import { signal } from '@preact/signals';
import { loadJson, saveJson } from '../store/storage';

export type KeypadKey =
  | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | ':'
  | 'back' | 'clear' | 'http' | 'https' | 'system' | 'submit';

/** The keypad, row by row (4 columns; the last row is one wide «Готово» / «Подключиться»). */
export const KEYPAD_ROWS: KeypadKey[][] = [
  ['1', '2', '3', 'back'],
  ['4', '5', '6', '.'],
  ['7', '8', '9', ':'],
  ['http', '0', 'https', 'system'],
  ['submit'],
];

/** The text and the selection (start = end: a caret). */
export interface AddressEdit {
  value: string;
  start: number;
  end: number;
}

/** A scheme typed at the start: «http://», «https://», a half-typed «http:/», a bare «//». */
const SCHEME = /^(?:https?:\/*|\/\/)/i;

function clamp(n: number, max: number): number {
  return n < 0 ? 0 : n > max ? max : n;
}

/** The field after a key; 'system' and 'submit' leave it as it is. */
export function keypadEdit(s: AddressEdit, key: KeypadKey): AddressEdit {
  const len = s.value.length;
  const a = clamp(Math.min(s.start, s.end), len);
  const b = clamp(Math.max(s.start, s.end), len);
  if (key === 'clear') return { value: '', start: 0, end: 0 };
  if (key === 'back') {
    if (a !== b) return { value: s.value.slice(0, a) + s.value.slice(b), start: a, end: a };
    if (a === 0) return { value: s.value, start: 0, end: 0 };
    return { value: s.value.slice(0, a - 1) + s.value.slice(a), start: a - 1, end: a - 1 };
  }
  if (key === 'http' || key === 'https') {
    const scheme = key + '://';
    const m = SCHEME.exec(s.value);
    const old = m ? m[0].length : 0;
    const value = scheme + s.value.slice(old);
    // a caret in the old scheme goes after the new one; one in the host keeps its place in the host
    const at = a <= old ? scheme.length : a - old + scheme.length;
    return { value, start: at, end: at };
  }
  if (key === 'system' || key === 'submit') return { value: s.value, start: a, end: b };
  const value = s.value.slice(0, a) + key + s.value.slice(b);
  return { value, start: a + 1, end: a + 1 };
}

/** The same edit at the end of the text (the TV keypad and a phone field with no caret). */
export function keypadEditAtEnd(value: string, key: KeypadKey): string {
  return keypadEdit({ value, start: value.length, end: value.length }, key).value;
}

/** Digit keys of a remote or a keyboard: 48–57 (LG, Android TV KEYCODE_0..9 in the WebView), numpad 96–105. */
export function digitOfKeyCode(code: number): KeypadKey | null {
  if (code >= 48 && code <= 57) return String(code - 48) as KeypadKey;
  if (code >= 96 && code <= 105) return String(code - 96) as KeypadKey;
  return null;
}

/** Where the arrow goes from a key: its row and column, or null at the keypad's edge. */
export function keypadMove(row: number, col: number, dir: string): { row: number; col: number } | null {
  const rows = KEYPAD_ROWS;
  if (dir === 'left' || dir === 'right') {
    const c = col + (dir === 'left' ? -1 : 1);
    return c >= 0 && c < rows[row].length ? { row, col: c } : null;
  }
  const r = row + (dir === 'up' ? -1 : dir === 'down' ? 1 : 0);
  if (r === row || r < 0 || r >= rows.length) return null;
  return { row: r, col: Math.min(col, rows[r].length - 1) };
}

export type AddressInputMode = 'keypad' | 'system';

const KEY = 'tsp.addressInput';

/** The last choice on this device (not in the backup: a TV and a phone choose for themselves). */
export const addressInputMode = signal<AddressInputMode>(
  loadJson<AddressInputMode>(KEY, 'keypad', (v) => v === 'keypad' || v === 'system'),
);

export function setAddressInputMode(m: AddressInputMode): void {
  addressInputMode.value = m;
  saveJson(KEY, m);
}
