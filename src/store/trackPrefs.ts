import { loadJson, saveJson, isObject } from './storage';

export interface TrackPref {
  audioLang?: string;
  audioLabel?: string;
  sub?: 'off' | { lang: string; label: string };
  /** Android TV: the player engine chosen for this torrent in the player menu («Плеер: … → сменить»). */
  engine?: 'builtin' | 'vlc';
}

const KEY = 'tsp.trackPrefs';

export function sanitizeTrackPrefs(v: unknown): { [hash: string]: TrackPref } {
  const out: { [hash: string]: TrackPref } = {};
  if (!isObject(v)) return out;
  Object.keys(v).forEach((hash) => {
    const p = v[hash];
    if (!isObject(p)) return;
    const pref: TrackPref = {};
    if (typeof p.audioLang === 'string') pref.audioLang = p.audioLang;
    if (typeof p.audioLabel === 'string') pref.audioLabel = p.audioLabel;
    if (p.sub === 'off') pref.sub = 'off';
    else if (isObject(p.sub) && typeof p.sub.lang === 'string' && typeof p.sub.label === 'string') {
      pref.sub = { lang: p.sub.lang, label: p.sub.label };
    }
    if (p.engine === 'builtin' || p.engine === 'vlc') pref.engine = p.engine;
    out[hash] = pref;
  });
  return out;
}

let prefs = sanitizeTrackPrefs(loadJson<unknown>(KEY, {}, isObject));

export function reloadTrackPrefs(): void {
  prefs = sanitizeTrackPrefs(loadJson<unknown>(KEY, {}, isObject));
}

export function getTrackPref(hash: string): TrackPref | null {
  return prefs[hash] || null;
}

export function saveTrackPref(hash: string, patch: TrackPref): void {
  prefs[hash] = { ...prefs[hash], ...patch };
  saveJson(KEY, prefs);
}
