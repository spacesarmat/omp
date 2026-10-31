// Ranges of «Размер меток». No imports: the settings store uses them too.

/**
 * Label text size, «Размер меток». Test-mode labels are the one place allowed under the 24px TV text rule.
 * TV web UI and the native Android TV player: 16..36 px, step 2, default 20. Phone: 8..24 px, step 1, default 12.
 */
export const TV_LABEL_PX = { min: 16, max: 36, step: 2, def: 20 };
export const PHONE_LABEL_PX = { min: 8, max: 24, step: 1, def: 12 };

/** Clamp to the range and snap to the step (from min). Anything not a number is the default. */
export function clampLabelPx(v: unknown, r: { min: number; max: number; step: number; def: number }): number {
  if (typeof v !== 'number' || !isFinite(v)) return r.def;
  const n = Math.round((v - r.min) / r.step) * r.step + r.min;
  if (n < r.min) return r.min;
  if (n > r.max) return r.max;
  return n;
}
