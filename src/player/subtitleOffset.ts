export const SUB_OFFSET_STEP = 0.5;
export const SUB_OFFSET_MAX = 5;

export const SUB_SIZE_OPTIONS: { value: 'small' | 'medium' | 'large'; label: string }[] = [
  { value: 'small', label: 'Маленький' },
  { value: 'medium', label: 'Средний' },
  { value: 'large', label: 'Крупный' },
];

export function formatOffset(v: number): string {
  if (v === 0) return '0 с';
  const abs = Math.abs(v).toFixed(1).replace('.', ',');
  return v > 0 ? '+' + abs + ' с (позже)' : '−' + abs + ' с (раньше)';
}

export function subtitleOffsetOptions(): { value: number; label: string }[] {
  const out: { value: number; label: string }[] = [];
  const steps = SUB_OFFSET_MAX / SUB_OFFSET_STEP;
  for (let i = -steps; i <= steps; i++) {
    const value = i * SUB_OFFSET_STEP;
    out.push({ value, label: formatOffset(value) });
  }
  return out;
}
