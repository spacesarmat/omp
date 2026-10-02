import { describe, it, expect } from 'vitest';
import { keyAction } from '../../src/platform/keys';

describe('keyAction', () => {
  it('maps remote codes', () => {
    expect(keyAction({ keyCode: 37 })).toBe('left');
    expect(keyAction({ keyCode: 13 })).toBe('enter');
    expect(keyAction({ keyCode: 461 })).toBe('back');
    expect(keyAction({ keyCode: 415 })).toBe('play');
    expect(keyAction({ keyCode: 19 })).toBe('pause');
    expect(keyAction({ keyCode: 413 })).toBe('stop');
    expect(keyAction({ keyCode: 417 })).toBe('ff');
    expect(keyAction({ keyCode: 412 })).toBe('rw');
    expect(keyAction({ keyCode: 33 })).toBe('chup');
    expect(keyAction({ keyCode: 34 })).toBe('chdown');
    expect(keyAction({ keyCode: 403 })).toBe('red');
    expect(keyAction({ keyCode: 404 })).toBe('green');
    expect(keyAction({ keyCode: 405 })).toBe('yellow');
    expect(keyAction({ keyCode: 406 })).toBe('blue');
    expect(keyAction({ keyCode: 457 })).toBe('info');
  });
  it('maps desktop keys for development', () => {
    expect(keyAction({ keyCode: 27 })).toBe('back');
    expect(keyAction({ keyCode: 8 })).toBe('back');
    expect(keyAction({ keyCode: 32 })).toBe('playpause');
    expect(keyAction({ keyCode: 112 })).toBe('red');
    expect(keyAction({ keyCode: 73 })).toBe('info');
  });
  it('returns null for others', () => expect(keyAction({ keyCode: 65 })).toBeNull());
});
