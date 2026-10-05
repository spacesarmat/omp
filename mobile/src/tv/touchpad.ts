// Touchpad settings (speed, acceleration, tap = click) and the pure maths that applies them.
import { signal } from '@preact/signals';
import { loadJson, saveJson, isObject } from '../../../src/store/storage';

export interface TouchpadSettings {
  /** 1 (slow) … 5 (fast). */
  speed: number;
  accel: boolean;
  tapClick: boolean;
  /** Flips the scroll direction (two fingers; the real TV's direction is checked by the user). */
  invertScroll: boolean;
}

export const TOUCHPAD_KEY = 'tsp.touchpad';
export const TOUCHPAD_DEFAULTS: TouchpadSettings = { speed: 3, accel: true, tapClick: true, invertScroll: false };

/** Gain per speed step 1…5, multiplied with the base gain of 1. */
export const SPEED_MULT = [0.6, 0.8, 1.0, 1.4, 1.9];
/** Acceleration factor = min(ACCEL_MAX, 1 + velocity[px/ms] × ACCEL_K): a 1 px/ms flick gives ×1.8. */
export const ACCEL_K = 0.8;
export const ACCEL_MAX = 2.5;

export function sanitizeTouchpad(v: unknown): TouchpadSettings {
  const o = isObject(v) ? v : {};
  const sp = typeof o.speed === 'number' && isFinite(o.speed) ? Math.round(o.speed) : TOUCHPAD_DEFAULTS.speed;
  return {
    speed: Math.min(5, Math.max(1, sp)),
    accel: typeof o.accel === 'boolean' ? o.accel : TOUCHPAD_DEFAULTS.accel,
    tapClick: typeof o.tapClick === 'boolean' ? o.tapClick : TOUCHPAD_DEFAULTS.tapClick,
    invertScroll: typeof o.invertScroll === 'boolean' ? o.invertScroll : TOUCHPAD_DEFAULTS.invertScroll,
  };
}

export const touchpad = signal<TouchpadSettings>(sanitizeTouchpad(loadJson<unknown>(TOUCHPAD_KEY, null)));

export function reloadTouchpad(): void {
  touchpad.value = sanitizeTouchpad(loadJson<unknown>(TOUCHPAD_KEY, null));
}

export function updateTouchpad(patch: Partial<TouchpadSettings>): void {
  touchpad.value = sanitizeTouchpad({ ...touchpad.value, ...patch });
  saveJson(TOUCHPAD_KEY, touchpad.value);
}

/** Total gain for a finger moving at `velocity` px/ms. */
export function cursorGain(s: TouchpadSettings, velocity: number): number {
  const base = SPEED_MULT[Math.min(5, Math.max(1, Math.round(s.speed))) - 1];
  const accel = s.accel ? Math.min(ACCEL_MAX, 1 + Math.max(0, velocity) * ACCEL_K) : 1;
  return base * accel;
}

/** Default factor from finger travel to the `dy` of a scroll frame; the sign was chosen without checking a real TV. */
export const SCROLL_DIRECTION = -1;

export function scrollFactor(s: TouchpadSettings): number {
  return s.invertScroll ? -SCROLL_DIRECTION : SCROLL_DIRECTION;
}
