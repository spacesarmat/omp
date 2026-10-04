// Android TV: which native player engine plays (Media3 «Встроенный» or libVLC «VLC»), see
// android/.../player/EngineChooser.kt. The page sends the setting (or the torrent's own choice from the player
// menu) with playNative and tells the player when ffprobe finds ASS/SSA subtitles; the player reports its
// switches with `nativePlayerEngine`.
import type { FfprobeResult } from '../api/types';
import type { TrackPref } from '../store/trackPrefs';
import { tracksFromProbe, normalizeLang } from '../lib/tracks';
import type { OmpNativeTvPlugin } from '../platform/androidNative';

/** «Плеер» of the TV settings. */
export type PlayerEngineSetting = 'auto' | 'builtin' | 'vlc';
/** An engine chosen for one torrent in the player menu. */
export type EngineChoice = 'builtin' | 'vlc';

export const PLAYER_ENGINES: PlayerEngineSetting[] = ['auto', 'builtin', 'vlc'];

export function isPlayerEngine(v: unknown): v is PlayerEngineSetting {
  return v === 'auto' || v === 'builtin' || v === 'vlc';
}

export function isEngineChoice(v: unknown): v is EngineChoice {
  return v === 'builtin' || v === 'vlc';
}

/** The settings choices (names and texts of the «Плеер» section). */
export const PLAYER_ENGINE_OPTIONS: { value: PlayerEngineSetting; name: string; text: string }[] = [
  { value: 'auto', name: 'Авто', text: 'Встроенный плеер; если он не может открыть файл или в нём субтитры ASS — VLC с того же места' },
  { value: 'builtin', name: 'Встроенный', text: 'Плеер Android с декодером FFmpeg: DTS, AC3 и TrueHD без поддержки приставки' },
  { value: 'vlc', name: 'VLC', text: 'Почти все форматы и субтитры ASS со стилями; чуть дольше открывает файл' },
];

/** Shown instead of the «VLC» text when libVLC cannot run on the device (no native libraries for its ABI). */
export const VLC_UNAVAILABLE = 'VLC недоступен на этом устройстве';

/** Whether libVLC runs on this device; true when the plugin cannot tell (the player falls back by itself). */
export function vlcAvailable(p: Pick<OmpNativeTvPlugin, 'vlcAvailable'> | null): Promise<boolean> {
  if (!p || typeof p.vlcAvailable !== 'function') return Promise.resolve(true);
  return p.vlcAvailable().then((r) => !(r && r.available === false), () => true);
}

/** The engine for playNative: the torrent's own choice wins over the setting. */
export function engineFor(setting: PlayerEngineSetting, pref: TrackPref | null): PlayerEngineSetting {
  return pref && pref.engine ? pref.engine : setting;
}

function isAss(codec: string): boolean {
  const c = codec.toLowerCase();
  return c === 'ass' || c === 'ssa';
}

/**
 * True when the embedded subtitles the player would show are ASS/SSA (ffprobe): the torrent's remembered choice
 * (off: none; else the same title, or language), else with subtitles on the preferred language, else the track
 * marked default. With subtitles off nothing is shown.
 */
export function assSubsShown(
  probe: FfprobeResult | null,
  s: { subtitlesOn: boolean; subLang: string },
  pref: TrackPref | null,
): boolean {
  const subs = tracksFromProbe(probe).filter((t) => t.kind === 'subtitle');
  if (!subs.length) return false;
  const p = pref && pref.sub;
  if (p === 'off') return false;
  if (p) {
    for (let i = 0; i < subs.length; i++) if (p.label && subs[i].title === p.label) return isAss(subs[i].codec);
    const lang = normalizeLang(p.lang);
    for (let i = 0; i < subs.length; i++) if (lang && subs[i].language === lang) return isAss(subs[i].codec);
  }
  if (!s.subtitlesOn && !p) return false;
  const want = normalizeLang(s.subLang);
  for (let i = 0; i < subs.length; i++) if (want && subs[i].language === want) return isAss(subs[i].codec);
  for (let i = 0; i < subs.length; i++) if (subs[i].isDefault) return isAss(subs[i].codec);
  return false;
}

/** `nativePlayerEngine` from the player: the engine it switched to and why. */
export interface NativeEngineEvent {
  index: number;
  engine: EngineChoice;
  reason: 'format' | 'ass' | 'manual';
}

export function sanitizeNativeEngine(v: unknown): NativeEngineEvent | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const index = o.index;
  if (typeof index !== 'number' || !isFinite(index) || Math.floor(index) !== index || index < 0) return null;
  if (!isEngineChoice(o.engine)) return null;
  if (o.reason !== 'format' && o.reason !== 'ass' && o.reason !== 'manual') return null;
  return { index, engine: o.engine, reason: o.reason };
}

/** The error-log text of an automatic switch (no file names); null for a choice from the menu. */
export function engineLogText(e: NativeEngineEvent): string | null {
  if (e.reason === 'format') return 'плеер: переключение на VLC (формат)';
  if (e.reason === 'ass') return 'плеер: переключение на VLC (субтитры ASS)';
  return null;
}

// ---- ffprobe answers of this app run (a file opened again knows its subtitles before playNative) ----

const PROBE_MAX = 50;
const probes: { key: string; probe: FfprobeResult | null }[] = [];

export function rememberProbe(hash: string, fileIndex: number, probe: FfprobeResult | null): void {
  const key = hash + ':' + fileIndex;
  for (let i = 0; i < probes.length; i++) {
    if (probes[i].key === key) {
      probes.splice(i, 1);
      break;
    }
  }
  probes.push({ key, probe });
  if (probes.length > PROBE_MAX) probes.shift();
}

/** The remembered ffprobe answer; undefined when this file was not probed in this run. */
export function knownProbe(hash: string, fileIndex: number): FfprobeResult | null | undefined {
  const key = hash + ':' + fileIndex;
  for (let i = 0; i < probes.length; i++) if (probes[i].key === key) return probes[i].probe;
  return undefined;
}

export function clearProbes(): void {
  probes.length = 0;
}
