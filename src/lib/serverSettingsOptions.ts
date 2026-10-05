// Preset choices for the TorrServer settings, shared by the TV and phone screens.
import { t } from '../i18n';

export interface NumOption {
  value: number;
  label: string;
}

const MB = 1024 * 1024;
export const cacheOptions = (): NumOption[] =>
  [64, 128, 256, 512, 1024, 2048].map((m) => ({ value: m * MB, label: m >= 1024 ? m / 1024 + ' ' + t('common.gb') : m + ' ' + t('common.mb') }));
export const preloadOptions = (): NumOption[] => [0, 5, 10, 25, 50, 75, 95].map((v) => ({ value: v, label: v + '%' }));
export const readaheadOptions = (): NumOption[] => [5, 25, 50, 75, 95].map((v) => ({ value: v, label: v + '%' }));
export const connsOptions = (): NumOption[] => [10, 25, 50, 100, 200].map((v) => ({ value: v, label: String(v) }));
// TorrServer rate limits are in KB/s, 0 = unlimited
export const rateOptions = (): NumOption[] =>
  [{ value: 0, label: t('server.unlimited') }].concat([1, 5, 10, 25, 50].map((m) => ({ value: m * 1024, label: m + ' ' + t('common.mbps') })));
export const disconnectOptions = (): NumOption[] => [30, 60, 120, 300].map((v) => ({ value: v, label: v + ' ' + t('common.sec') }));

/** Keeps a server value visible even when it is not one of our presets. */
export function withCurrent(options: NumOption[], value: number): NumOption[] {
  return options.some((o) => o.value === value) ? options : [{ value, label: String(value) }].concat(options);
}
