import { describe, it, expect } from 'vitest';
import { KeyPump, LONG_PRESS_MS, PAD_STEP, PadArrows, padGain, pressKey } from '../src/tv/atvPad';

describe('«Тачпад» on Android TV: gestures to keys', () => {
  it('a slow swipe gives one arrow per 40 px on its main axis', () => {
    const p = new PadArrows();
    expect(p.move(30, 2, 100)).toEqual([]);
    expect(p.move(15, 1, 100)).toEqual(['RIGHT']);
    expect(p.move(-65, 0, 300)).toEqual(['LEFT']);
    p.reset();
    expect(p.move(0, 2 * PAD_STEP, 400)).toEqual(['DOWN', 'DOWN']);
    expect(p.move(3, -PAD_STEP, 400)).toEqual(['UP']);
  });

  it('a fast swipe counts more (acceleration), a slow one does not', () => {
    expect(padGain(0.2)).toBe(1);
    expect(padGain(1)).toBe(1.5);
    expect(padGain(3)).toBe(2);
    const p = new PadArrows();
    // 120 px in 40 ms: 3 px/ms → double → 6 arrows
    expect(p.move(120, 0, 40)).toEqual(['RIGHT', 'RIGHT', 'RIGHT', 'RIGHT', 'RIGHT', 'RIGHT']);
  });

  it('a diagonal goes by its main axis, the side drift is dropped after each arrow', () => {
    const p = new PadArrows();
    expect(p.move(45, 35, 200)).toEqual(['RIGHT']);
    expect(p.move(0, 30, 200)).toEqual([]);
  });

  it('two fingers scroll: fingers up → Down, fingers down → Up', () => {
    const p = new PadArrows();
    expect(p.scroll(-PAD_STEP, 400)).toEqual(['DOWN']);
    expect(p.scroll(2 * PAD_STEP, 400)).toEqual(['UP', 'UP']);
  });

  it('a tap is OK; a long press (Menu, sent while held) and a swipe are not', () => {
    expect(pressKey(false, 120, false)).toBe('ENTER');
    expect(pressKey(true, 120, false)).toBeNull();
    expect(pressKey(false, LONG_PRESS_MS + 10, true)).toBeNull();
    expect(pressKey(false, LONG_PRESS_MS + 10, false)).toBeNull();
  });

  it('keys go one at a time; a fast swipe keeps only the latest few waiting', async () => {
    const sent: string[] = [];
    const resolvers: (() => void)[] = [];
    const pump = new KeyPump<string>((k) => {
      sent.push(k);
      return new Promise<void>((r) => resolvers.push(r));
    }, 3);
    pump.push(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(sent).toEqual(['A']);
    expect(pump.waiting).toBe(3);
    for (let i = 0; i < 4; i++) {
      resolvers.shift()!();
      await Promise.resolve();
      await Promise.resolve();
    }
    expect(sent).toEqual(['A', 'D', 'E', 'F']);
  });

  it('a failed key empties the queue and reports once', async () => {
    const errors: unknown[] = [];
    const sent: string[] = [];
    const pump = new KeyPump<string>((k) => (sent.push(k), Promise.reject(new Error('нет связи'))), 4, (e) => errors.push(e));
    pump.push(['A', 'B', 'C']);
    await Promise.resolve();
    await Promise.resolve();
    expect(sent).toEqual(['A']);
    expect(errors).toHaveLength(1);
    expect(pump.waiting).toBe(0);
  });
});
