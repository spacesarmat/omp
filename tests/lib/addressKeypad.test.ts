import { describe, it, expect, beforeEach } from 'vitest';
import {
  keypadEdit, keypadEditAtEnd, keypadMove, digitOfKeyCode, KEYPAD_ROWS, addressInputMode, setAddressInputMode,
  type KeypadKey,
} from '../../src/lib/addressKeypad';

const typeAll = (keys: KeypadKey[], from = '') => keys.reduce((v, k) => keypadEditAtEnd(v, k), from);

describe('address keypad: editing', () => {
  it('types digits, dots and the colon at the end', () => {
    expect(typeAll(['1', '9', '2', '.', '1', '6', '8', '.', '1', '.', '5', ':', '8', '0', '9', '0'])).toBe('192.168.1.5:8090');
  });
  it('backspace erases the last character; on an empty field it does nothing', () => {
    expect(keypadEditAtEnd('192.168.1.5:', 'back')).toBe('192.168.1.5');
    expect(keypadEditAtEnd('', 'back')).toBe('');
  });
  it('clear empties the field', () => {
    expect(keypadEdit({ value: '10.0.0.1', start: 3, end: 3 }, 'clear')).toEqual({ value: '', start: 0, end: 0 });
  });
  it('edits at the caret and replaces a selection', () => {
    expect(keypadEdit({ value: '192.168.1.5', start: 3, end: 3 }, '9')).toEqual({ value: '1929.168.1.5', start: 4, end: 4 });
    expect(keypadEdit({ value: '192.168.1.5', start: 4, end: 7 }, '0')).toEqual({ value: '192.0.1.5', start: 5, end: 5 });
    expect(keypadEdit({ value: '192.168.1.5', start: 4, end: 4 }, 'back')).toEqual({ value: '192168.1.5', start: 3, end: 3 });
    expect(keypadEdit({ value: '192.168.1.5', start: 0, end: 0 }, 'back')).toEqual({ value: '192.168.1.5', start: 0, end: 0 });
    expect(keypadEdit({ value: '192.168.1.5', start: 0, end: 4 }, 'back')).toEqual({ value: '168.1.5', start: 0, end: 0 });
  });
  it('the scheme keys insert the scheme at the start, or replace the one there', () => {
    expect(keypadEditAtEnd('', 'http')).toBe('http://');
    expect(keypadEditAtEnd('192.168.1.5:8090', 'https')).toBe('https://192.168.1.5:8090');
    expect(keypadEditAtEnd('http://192.168.1.5:8090', 'https')).toBe('https://192.168.1.5:8090');
    expect(keypadEditAtEnd('HTTPS://10.0.0.2', 'http')).toBe('http://10.0.0.2');
    expect(keypadEditAtEnd('http:/10.0.0.2', 'http')).toBe('http://10.0.0.2');
    expect(keypadEditAtEnd('//10.0.0.2', 'https')).toBe('https://10.0.0.2');
    expect(keypadEditAtEnd('https://10.0.0.2', 'https')).toBe('https://10.0.0.2');
    // a host name with a port is not a scheme
    expect(keypadEditAtEnd('localhost:8090', 'http')).toBe('http://localhost:8090');
  });
  it('the scheme keys keep the caret in the host, or put it after the scheme', () => {
    expect(keypadEdit({ value: '10.0.0.2', start: 2, end: 2 }, 'https')).toEqual({ value: 'https://10.0.0.2', start: 10, end: 10 });
    expect(keypadEdit({ value: 'https://10.0.0.2', start: 3, end: 3 }, 'http')).toEqual({ value: 'http://10.0.0.2', start: 7, end: 7 });
    expect(keypadEdit({ value: 'http://1', start: 8, end: 8 }, 'https')).toEqual({ value: 'https://1', start: 9, end: 9 });
  });
  it('«Клавиатура» and «Готово» leave the text as it is', () => {
    expect(keypadEditAtEnd('10.0.0.2', 'system')).toBe('10.0.0.2');
    expect(keypadEditAtEnd('10.0.0.2', 'submit')).toBe('10.0.0.2');
  });
});

describe('address keypad: remote keys and arrows', () => {
  it('digit key codes: 48–57 and the numpad', () => {
    expect(digitOfKeyCode(48)).toBe('0');
    expect(digitOfKeyCode(57)).toBe('9');
    expect(digitOfKeyCode(96)).toBe('0');
    expect(digitOfKeyCode(105)).toBe('9');
    expect(digitOfKeyCode(13)).toBeNull();
    expect(digitOfKeyCode(461)).toBeNull();
  });
  it('arrows move within the rows and stop at the edges', () => {
    expect(keypadMove(0, 0, 'right')).toEqual({ row: 0, col: 1 });
    expect(keypadMove(0, 0, 'left')).toBeNull();
    expect(keypadMove(0, 3, 'right')).toBeNull();
    expect(keypadMove(0, 0, 'up')).toBeNull();
    expect(keypadMove(0, 2, 'down')).toEqual({ row: 1, col: 2 });
    // into the wide «Готово» row and back to the column it came from (the caller passes it)
    expect(keypadMove(3, 2, 'down')).toEqual({ row: 4, col: 0 });
    expect(keypadMove(4, 2, 'up')).toEqual({ row: 3, col: 2 });
    expect(keypadMove(4, 0, 'down')).toBeNull();
    expect(KEYPAD_ROWS[4]).toEqual(['submit']);
  });
});

describe('address keypad: the choice per device', () => {
  beforeEach(() => localStorage.clear());
  it('is remembered in local settings', () => {
    setAddressInputMode('system');
    expect(addressInputMode.value).toBe('system');
    expect(localStorage.getItem('tsp.addressInput')).toBe('"system"');
    setAddressInputMode('keypad');
    expect(localStorage.getItem('tsp.addressInput')).toBe('"keypad"');
  });
});
