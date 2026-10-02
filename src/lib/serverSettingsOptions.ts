// Preset choices for the TorrServer settings, shared by the TV and phone screens.
export interface NumOption {
  value: number;
  label: string;
}

const MB = 1024 * 1024;
export const CACHE = [64, 128, 256, 512, 1024, 2048].map((m) => ({ value: m * MB, label: m >= 1024 ? m / 1024 + ' ГБ' : m + ' МБ' }));
export const PRELOAD = [0, 5, 10, 25, 50, 75, 95].map((v) => ({ value: v, label: v + '%' }));
export const READAHEAD = [5, 25, 50, 75, 95].map((v) => ({ value: v, label: v + '%' }));
export const CONNS = [10, 25, 50, 100, 200].map((v) => ({ value: v, label: String(v) }));
// TorrServer rate limits are in KB/s, 0 = unlimited
export const RATE = [{ value: 0, label: 'Без ограничений' }].concat([1, 5, 10, 25, 50].map((m) => ({ value: m * 1024, label: m + ' МБ/с' })));
export const DISCONNECT = [30, 60, 120, 300].map((v) => ({ value: v, label: v + ' с' }));

/** Keeps a server value visible even when it is not one of our presets. */
export function withCurrent(options: NumOption[], value: number): NumOption[] {
  return options.some((o) => o.value === value) ? options : [{ value, label: String(value) }].concat(options);
}
