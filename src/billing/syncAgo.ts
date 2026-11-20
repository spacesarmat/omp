// How long ago a sync finished, for the settings row. Chromium 53: no ?., no ??.

export function syncAgo(at: number, now: number): { kind: 'never' | 'just' | 'min' | 'hour' | 'day'; n: number } {
  if (!at || at <= 0) return { kind: 'never', n: 0 };
  const min = Math.floor((now - at) / 60000);
  if (min < 1) return { kind: 'just', n: 0 };
  if (min < 60) return { kind: 'min', n: min };
  const hour = Math.floor(min / 60);
  if (hour < 48) return { kind: 'hour', n: hour };
  return { kind: 'day', n: Math.floor(hour / 24) };
}
