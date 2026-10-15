import { describe, expect, it } from 'vitest';
import { PARALLAX_MAX_X, PARALLAX_MAX_Y, gyroTilt, lerpTilt, parallaxShift, pointerTilt } from '../src/ui/posterParallax';

describe('poster parallax', () => {
  it('gyro is flat at the rest pose and clamps a hard tilt', () => {
    expect(gyroTilt(48, 2, 48, 2)).toEqual({ rx: 0, ry: 0 });
    const hard = gyroTilt(48 + 40, 2 + 40, 48, 2);
    expect(hard.rx).toBe(PARALLAX_MAX_X);
    expect(hard.ry).toBe(PARALLAX_MAX_Y);
    const back = gyroTilt(48 - 10, 2 - 8, 48, 2);
    expect(back.rx).toBeCloseTo(-4);
    expect(back.ry).toBeCloseTo(-4);
  });

  it('a finger on the right lifts that edge and the art shifts the other way', () => {
    const t = pointerTilt(0.5, 0);
    expect(t.ry).toBe(PARALLAX_MAX_Y);
    expect(t.rx).toBeCloseTo(0);
    const s = parallaxShift(t);
    expect(s.x).toBeLessThan(0);
    expect(s.gx).toBeGreaterThan(50);
  });

  it('lerp moves toward the target without passing it', () => {
    const next = lerpTilt({ rx: 0, ry: 0 }, { rx: 8, ry: -4 }, 0.5);
    expect(next.rx).toBe(4);
    expect(next.ry).toBe(-2);
  });
});
