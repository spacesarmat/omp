import { signal } from '@preact/signals';
import { loadJson, saveJson, isObject } from './storage';

export interface AppSettings {
  audioLang: string;
  subLang: string;
  subtitlesOn: boolean;
  seekStep: number;
  autoNext: boolean;
  subSize: 'small' | 'medium' | 'large';
  subColor: 'white' | 'yellow';
  subBackground: boolean;
  showStats: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  audioLang: 'ru',
  subLang: 'ru',
  subtitlesOn: false,
  seekStep: 10,
  autoNext: true,
  subSize: 'medium',
  subColor: 'white',
  subBackground: true,
  showStats: false,
};

const KEY = 'tsp.settings';

const SUB_SIZES = ['small', 'medium', 'large'];
const SUB_COLORS = ['white', 'yellow'];

export function sanitizeSettings(v: unknown): AppSettings {
  const out: AppSettings = { ...DEFAULT_SETTINGS };
  if (!isObject(v)) return out;
  const target = out as unknown as Record<string, unknown>;
  (Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[]).forEach((k) => {
    if (typeof v[k] === typeof DEFAULT_SETTINGS[k]) target[k] = v[k];
  });
  if (SUB_SIZES.indexOf(out.subSize) < 0) out.subSize = DEFAULT_SETTINGS.subSize;
  if (SUB_COLORS.indexOf(out.subColor) < 0) out.subColor = DEFAULT_SETTINGS.subColor;
  return out;
}

export const settings = signal<AppSettings>(sanitizeSettings(loadJson<unknown>(KEY, {}, isObject)));

export function updateSettings(patch: Partial<AppSettings>): void {
  settings.value = { ...settings.value, ...patch };
  saveJson(KEY, settings.value);
}

export function resetSettings(): void {
  settings.value = { ...DEFAULT_SETTINGS };
  saveJson(KEY, settings.value);
}
