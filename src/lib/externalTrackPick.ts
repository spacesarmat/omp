// Which external track (src/lib/externalTracks.ts) an episode starts with. The remembered choice is the series' own
// record («Озвучка», src/lib/seriesTracks.ts: dub label + language, subtitles by title + language or off), shared by the
// TV and the phone through the watch journal, so a dub picked in one episode is found again in the next one by its
// studio and language. The order is that of the built-in players (nativeTrackStart in src/player/trackPrefs.ts): the
// series' dub by name, then the series' language, then the settings («Язык озвучки», «Язык субтитров»).
//
// An embedded track that answers a step first leaves the choice to the player (null): the external one is picked only
// when the video itself has nothing better. When the embedded tracks are not known (no probe yet), an external track
// in the wanted language wins over the video's own (a release ships external dubs because the video lacks them).
// Pure; not wired to a player yet (src/player/externalTracks.ts).
import { normalizeLang } from './tracks';
import { dubOf, isReset, normDub, sameDub, type SeriesTracks } from './seriesTracks';
import { baseTrackId, type EpisodeTracks, type ExternalTrack } from './externalTracks';

export interface ExternalStartSettings {
  /** «Язык озвучки» (settings.audioLang, «ru» by default). */
  audioLang: string;
  /** «Язык субтитров» (settings.subLang). */
  subLang: string;
  /** «Субтитры» on by default (settings.subtitlesOn). */
  subtitlesOn: boolean;
}

/** A track of the video itself (from ffprobe or the player), when known. */
export interface EmbeddedTrack {
  title?: string;
  label?: string;
  language?: string;
  forced?: boolean;
}

export interface ExternalStart {
  /** The id of the external dub to start with; null: the player's own choice (an embedded track). */
  audio: string | null;
  /** The id of the external subtitles to start with, 'off', or null: the player's own choice. */
  subtitle: string | 'off' | null;
}

export const DEFAULT_AUDIO_LANG = 'ru';

function langOk(a: string | undefined, b: string | undefined): boolean {
  const x = normalizeLang(a);
  const y = normalizeLang(b);
  return !x || !y || x === y;
}

function sameLang(a: string | undefined, b: string | undefined): boolean {
  const x = normalizeLang(a);
  return !!x && x === normalizeLang(b);
}

/** The dub (or subtitle) name of an external track for comparing with a remembered label. */
function labelOf(t: ExternalTrack): string {
  return t.studio || t.name;
}

function embeddedDub(embedded: EmbeddedTrack[] | undefined, l: string, g: string | undefined): boolean {
  return !!embedded && embedded.some((e) => sameDub(dubOf(e), l) && langOk(e.language, g));
}

function embeddedLang(embedded: EmbeddedTrack[] | undefined, g: string, skipForced = false): boolean {
  return !!embedded && embedded.some((e) => sameLang(e.language, g) && !(skipForced && e.forced));
}

/** The external dub to start with; null when an embedded track (or nothing) answers first. */
export function pickExternalAudio(
  tracks: ExternalTrack[],
  series: SeriesTracks | null,
  s: Pick<ExternalStartSettings, 'audioLang'>,
  embedded?: EmbeddedTrack[],
): string | null {
  const rec = series && !isReset(series) ? series : null;
  if (rec && rec.l) {
    if (embeddedDub(embedded, rec.l, rec.g)) return null;
    for (let i = 0; i < tracks.length; i++) if (sameDub(labelOf(tracks[i]), rec.l) && langOk(tracks[i].lang, rec.g)) return tracks[i].id;
  }
  const langs: string[] = [];
  if (rec && rec.g) langs.push(rec.g);
  langs.push(s.audioLang || DEFAULT_AUDIO_LANG);
  for (let j = 0; j < langs.length; j++) {
    if (embeddedLang(embedded, langs[j])) return null;
    for (let i = 0; i < tracks.length; i++) if (sameLang(tracks[i].lang, langs[j])) return tracks[i].id;
  }
  return null;
}

/** Full (not forced) subtitles in `g`; null when none. */
function fullInLang(tracks: ExternalTrack[], g: string): string | null {
  for (let i = 0; i < tracks.length; i++) if (sameLang(tracks[i].lang, g) && !tracks[i].forced) return tracks[i].id;
  return null;
}

/** Full subtitles in `g` first, forced ones after. */
function subInLang(tracks: ExternalTrack[], g: string): string | null {
  let forced: string | null = null;
  for (let i = 0; i < tracks.length; i++) {
    if (!sameLang(tracks[i].lang, g)) continue;
    if (!tracks[i].forced) return tracks[i].id;
    if (!forced) forced = tracks[i].id;
  }
  return forced;
}

/** The external subtitles to start with, 'off', or null when an embedded track (or nothing) answers first. */
export function pickExternalSubtitle(
  tracks: ExternalTrack[],
  series: SeriesTracks | null,
  s: Pick<ExternalStartSettings, 'subLang' | 'subtitlesOn'>,
  embedded?: EmbeddedTrack[],
): string | 'off' | null {
  const want = series && !isReset(series) ? series.s : undefined;
  if (want === 'off') return 'off';
  if (want) {
    // a nameless external choice: the same nameless track of this episode (the same «#2» first, then the same base id)
    if (want.i) {
      for (let i = 0; i < tracks.length; i++) if (tracks[i].id === want.i) return tracks[i].id;
      const base = baseTrackId(want.i);
      for (let i = 0; i < tracks.length; i++) if (baseTrackId(tracks[i].id) === base) return tracks[i].id;
    }
    if (want.l) {
      if (embedded && embedded.some((e) => sameDub(dubOf(e), want.l) && langOk(e.language, want.g))) return null;
      // the same name first («LostFilm · Forced» is not «LostFilm»), then the same studio, full subtitles first
      for (let i = 0; i < tracks.length; i++) if (normDub(tracks[i].name) === normDub(want.l) && langOk(tracks[i].lang, want.g)) return tracks[i].id;
      let forcedHit: string | null = null;
      for (let i = 0; i < tracks.length; i++) {
        if (!sameDub(labelOf(tracks[i]), want.l) || !langOk(tracks[i].lang, want.g)) continue;
        if (!tracks[i].forced) return tracks[i].id;
        if (!forcedHit) forcedHit = tracks[i].id;
      }
      // only the studio's forced ones here: full subtitles of the language (another studio) are closer to the choice
      if (forcedHit) {
        const full = want.g ? fullInLang(tracks, want.g) : null;
        return full || forcedHit;
      }
    }
    if (want.g) {
      if (embeddedLang(embedded, want.g, true)) return null;
      const hit = subInLang(tracks, want.g);
      if (hit) return hit;
    }
  }
  if (!s.subtitlesOn) return null;
  if (embeddedLang(embedded, s.subLang, true)) return null;
  return subInLang(tracks, s.subLang);
}

/** Both choices for one episode. */
export function pickExternalStart(
  tracks: EpisodeTracks,
  series: SeriesTracks | null,
  s: ExternalStartSettings,
  embedded?: { audio?: EmbeddedTrack[]; subtitles?: EmbeddedTrack[] },
): ExternalStart {
  return {
    audio: pickExternalAudio(tracks.audio, series, s, embedded ? embedded.audio : undefined),
    subtitle: pickExternalSubtitle(tracks.subtitles, series, s, embedded ? embedded.subtitles : undefined),
  };
}
