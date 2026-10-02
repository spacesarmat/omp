import { describe, it, expect } from 'vitest';
import { sanitizeCmd, sanitizeMessage } from '../../src/phone/protocol';

const HASH = 'abcdef0123456789abcdef0123456789abcdef01';
const state = () => ({
  hash: HASH, file: 2, title: 'T', subtitle: 'S', time: 10, duration: 100, paused: false, buffering: false,
  audio: { list: ['a', 'b'], sel: 0 }, subs: { list: [{ label: 'Off', value: 'off' }], sel: 'off' }, next: { title: 'N' },
});

describe('sanitizeCmd', () => {
  it('accepts every command type', () => {
    for (const type of ['play', 'pause', 'next', 'prev']) expect(sanitizeCmd({ id: 1, type })).toEqual({ id: 1, type });
    expect(sanitizeCmd({ id: 2, type: 'seek', t: 30.5 })).toEqual({ id: 2, type: 'seek', t: 30.5 });
    expect(sanitizeCmd({ id: 3, type: 'skip', d: -10 })).toEqual({ id: 3, type: 'skip', d: -10 });
    expect(sanitizeCmd({ id: 4, type: 'audio', i: 1 })).toEqual({ id: 4, type: 'audio', i: 1 });
    expect(sanitizeCmd({ id: 5, type: 'subs', value: 'off' })).toEqual({ id: 5, type: 'subs', value: 'off' });
  });
  it('rejects malformed commands', () => {
    expect(sanitizeCmd(null)).toBeNull();
    expect(sanitizeCmd('x')).toBeNull();
    expect(sanitizeCmd([])).toBeNull();
    expect(sanitizeCmd({ type: 'play' })).toBeNull();
    expect(sanitizeCmd({ id: '1', type: 'play' })).toBeNull();
    expect(sanitizeCmd({ id: 1.5, type: 'play' })).toBeNull();
    expect(sanitizeCmd({ id: 1, type: 'boom' })).toBeNull();
    expect(sanitizeCmd({ id: 1, type: 'seek' })).toBeNull();
    expect(sanitizeCmd({ id: 1, type: 'seek', t: -1 })).toBeNull();
    expect(sanitizeCmd({ id: 1, type: 'seek', t: NaN })).toBeNull();
    expect(sanitizeCmd({ id: 1, type: 'skip', d: 'x' })).toBeNull();
    expect(sanitizeCmd({ id: 1, type: 'audio', i: -1 })).toBeNull();
    expect(sanitizeCmd({ id: 1, type: 'audio', i: 0.5 })).toBeNull();
    expect(sanitizeCmd({ id: 1, type: 'subs', value: 3 })).toBeNull();
  });
});

describe('sanitizeMessage', () => {
  it('accepts null state and a full state', () => {
    expect(sanitizeMessage({ v: 1, app: '0.8.0', state: null })).toEqual({ v: 1, app: '0.8.0', state: null });
    expect(sanitizeMessage({ v: 1, app: '0.8.0', state: state() })!.state).toEqual(state());
  });
  it('keeps poster when present, tolerates it missing, next may be null', () => {
    expect(sanitizeMessage({ v: 1, app: 'x', state: { ...state(), poster: 'http://p' } })!.state!.poster).toBe('http://p');
    expect(sanitizeMessage({ v: 1, app: 'x', state: state() })!.state).not.toHaveProperty('poster');
    expect(sanitizeMessage({ v: 1, app: 'x', state: { ...state(), next: null } })!.state!.next).toBeNull();
  });
  it('rejects malformed messages', () => {
    expect(sanitizeMessage(null)).toBeNull();
    expect(sanitizeMessage({ v: 2, app: 'x', state: null })).toBeNull();
    expect(sanitizeMessage({ v: 1, state: null })).toBeNull();
    expect(sanitizeMessage({ v: 1, app: 'x' })).toBeNull();
    expect(sanitizeMessage({ v: 1, app: 'x', state: 'no' })).toBeNull();
    const bad = (patch: object) => sanitizeMessage({ v: 1, app: 'x', state: { ...state(), ...patch } });
    expect(bad({ hash: 'zz' })).toBeNull();
    expect(bad({ file: 1.2 })).toBeNull();
    expect(bad({ time: Infinity })).toBeNull();
    expect(bad({ duration: '1' })).toBeNull();
    expect(bad({ paused: 0 })).toBeNull();
    expect(bad({ poster: 5 })).toBeNull();
    expect(bad({ audio: { list: [1], sel: 0 } })).toBeNull();
    expect(bad({ audio: { list: 'a', sel: 0 } })).toBeNull();
    expect(bad({ subs: { list: [{ label: 'a' }], sel: 'off' } })).toBeNull();
    expect(bad({ subs: { list: [], sel: 1 } })).toBeNull();
    expect(bad({ next: { title: 1 } })).toBeNull();
  });
});
