import { signal } from '@preact/signals';
import { loadJson, saveJson, isObject } from './storage';
import type { LibrarySort } from '../lib/librarySearch';
import type { LibraryView } from '../lib/libraryView';
import { isHistoryFilter, type HistoryFilter } from '../lib/history';
import type { PlayerEngineSetting } from '../player/nativeEngine';
import { applyLanguageSetting, type LanguageSetting } from '../i18n';

export type PhonePlayer = 'embedded' | 'p2160' | 'chooser';

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
  updateCheck: boolean;
  /** «Получать бета-версии»: the beta feed (update-beta.json); off = a beta stays until the next release. */
  betaUpdates: boolean;
  historyFilter: HistoryFilter;
  /** Android TV: «Плеер» — Авто / Встроенный / VLC. */
  playerEngine: PlayerEngineSetting;
  /** Android TV: «Плеер для видео» — built-in or 2160 Player (when installed). */
  videoPlayer: 'builtin' | 'p2160';
  /**
   * Phone: «Плеер для видео» — 2160 Player's screen inside OMP («Встроенный»), the 2160 Player app, or the Android
   * chooser. Its own key: the TV's `videoPlayer` 'builtin' is OMP's player there, but meant the chooser on the phone.
   */
  phonePlayer: PhonePlayer;
  /**
   * Phone, «Встроенный» player: «Звук в фоне» — 2160's media service (notification, lock screen, headset buttons)
   * and sound with the screen off / after the PiP window is closed. Off: PiP only. Never on the TV.
   */
  backgroundAudio: boolean;
  /** UI language: 'system' follows the device (ru/uk/be/kk → Russian, else English). */
  language: LanguageSetting;
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
  updateCheck: true,
  betaUpdates: false,
  historyFilter: 'all',
  playerEngine: 'auto',
  videoPlayer: 'builtin',
  phonePlayer: 'embedded',
  backgroundAudio: false,
  language: 'system',
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
  if (!isHistoryFilter(out.historyFilter)) out.historyFilter = DEFAULT_SETTINGS.historyFilter;
  if (['auto', 'builtin', 'vlc'].indexOf(out.playerEngine) < 0) out.playerEngine = DEFAULT_SETTINGS.playerEngine;
  if (['builtin', 'p2160'].indexOf(out.videoPlayer) < 0) out.videoPlayer = DEFAULT_SETTINGS.videoPlayer;
  // before phonePlayer the phone kept its choice in videoPlayer: 2160 Player stays, the chooser moves to «Встроенный»
  if (['embedded', 'p2160', 'chooser'].indexOf(v.phonePlayer as string) < 0) {
    out.phonePlayer = out.videoPlayer === 'p2160' ? 'p2160' : DEFAULT_SETTINGS.phonePlayer;
  }
  if (['system', 'ru', 'en'].indexOf(out.language) < 0) out.language = DEFAULT_SETTINGS.language;
  return out;
}

export const settings = signal<AppSettings>(sanitizeSettings(loadJson<unknown>(KEY, {}, isObject)));
applyLanguageSetting(settings.value.language);

export function updateSettings(patch: Partial<AppSettings>): void {
  settings.value = { ...settings.value, ...patch };
  saveJson(KEY, settings.value);
  applyLanguageSetting(settings.value.language);
}

export function resetSettings(): void {
  settings.value = { ...DEFAULT_SETTINGS };
  saveJson(KEY, settings.value);
  applyLanguageSetting(settings.value.language);
}
