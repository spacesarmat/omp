import { signal } from '@preact/signals';
import { loadJson, saveJson } from './storage';

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

export const settings = signal<AppSettings>({ ...DEFAULT_SETTINGS, ...loadJson<Partial<AppSettings>>(KEY, {}) });

export function updateSettings(patch: Partial<AppSettings>): void {
  settings.value = { ...settings.value, ...patch };
  saveJson(KEY, settings.value);
}

export function resetSettings(): void {
  settings.value = { ...DEFAULT_SETTINGS };
  saveJson(KEY, settings.value);
}
