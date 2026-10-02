import { signal } from '@preact/signals';
import { loadJson, saveJson, isObject } from './storage';
import type { LibrarySort } from '../lib/librarySearch';
import type { LibraryView } from '../lib/libraryView';

export interface AppSettings {
  audioLang: string;
  subLang: string;
  subtitlesOn: boolean;
  seekStep: number;
  edgeSeekStep: number;
  autoNext: boolean;
  subSize: 'small' | 'medium' | 'large';
  subColor: 'white' | 'yellow';
  subBackground: boolean;
  showStats: boolean;
  libraryView: LibraryView;
  librarySort: LibrarySort;
}

export const DEFAULT_SETTINGS: AppSettings = {
  audioLang: 'ru',
  subLang: 'ru',
  subtitlesOn: false,
  seekStep: 10,
  edgeSeekStep: 5,
  autoNext: true,
  subSize: 'medium',
  subColor: 'white',
  subBackground: true,
  showStats: false,
  libraryView: 'large',
  librarySort: 'new',
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
  if ([5, 10, 15].indexOf(out.edgeSeekStep) < 0) out.edgeSeekStep = DEFAULT_SETTINGS.edgeSeekStep;
  if (['large', 'small', 'list', 'compact'].indexOf(out.libraryView) < 0) out.libraryView = DEFAULT_SETTINGS.libraryView;
  if (['new', 'title', 'size'].indexOf(out.librarySort) < 0) out.librarySort = DEFAULT_SETTINGS.librarySort;
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
