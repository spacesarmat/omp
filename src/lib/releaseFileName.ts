// A release file name as a person reads it: the episode number, and the shared release tail
// («RUS JP ENG Judas BDrip HEVC 10bit»). Underscores and «- 006» count, the same as SxxEyy.
import { baseName, stripExt } from './episodes';
import { fileEpisodeCut, isFractionalEpisode } from './categoryCheck';
import { parseEpisode } from './episodes';

export interface ReleaseFileName {
  season: number | null;
  episode: number | null;
  /** Text after the episode marker: languages, source, codec. '' when the name has none. */
  tail: string;
}

function normalized(path: string): string {
  return stripExt(baseName(path)).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Episode number and the release tail of one file. A name with no episode has a null episode and an empty tail. */
export function parseReleaseFile(path: string): ReleaseFileName {
  if (isFractionalEpisode(path)) return { season: null, episode: null, tail: '' };
  const text = normalized(path);
  const cut = fileEpisodeCut(text, parseEpisode(path));
  if (!cut || !cut.episodes.length) return { season: null, episode: null, tail: '' };
  const tail = text.slice(cut.end).replace(/[._]+/g, ' ').replace(/^[\s\-[\]]+/, '').replace(/\s+/g, ' ').trim();
  return { season: cut.season, episode: cut.episodes[0], tail };
}

/** The release tail every file shares. '' when the files do not agree, so a mixed list stays quiet. */
export function commonReleaseTail(paths: string[]): string {
  let shared = '';
  let seen = false;
  for (let i = 0; i < paths.length; i++) {
    const tail = parseReleaseFile(paths[i]).tail;
    if (!tail) continue;
    if (!seen) {
      shared = tail;
      seen = true;
      continue;
    }
    if (shared.toLowerCase() !== tail.toLowerCase()) return '';
  }
  return shared;
}

/** A saved TV name shortened for the player header: «[LG] webOS TV OLED55C9PLA» -> «LG OLED55C9». */
export function shortDeviceName(name: string): string {
  const raw = (name || '').trim();
  if (!raw) return '';
  const brand = /^\[([^\]]+)\]/.exec(raw);
  let rest = raw.replace(/^\[[^\]]+\]\s*/, '');
  rest = rest.replace(/\bwebOS\s*TV\b/ig, ' ').replace(/\s+/g, ' ').trim();
  const oled = /\bOLED\d{2}[A-Z]\d/i.exec(rest);
  if (oled) {
    const model = oled[0].toUpperCase();
    const lead = /^([A-Za-z]+)\s+OLED/i.exec(rest);
    const who = brand ? brand[1] : lead && lead[1].toLowerCase() !== 'webos' ? lead[1] : '';
    return who ? who + ' ' + model : model;
  }
  const model = /\b[A-Z]{1,6}\d{2,}[A-Z0-9]*/.exec(rest);
  if (brand && model) return brand[1] + ' ' + model[0];
  return rest || raw;
}
