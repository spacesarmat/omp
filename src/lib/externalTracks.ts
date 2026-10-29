// External audio tracks and subtitles inside a release: «Rus Sound/LostFilm/Show.S01E01.mka», «Rus Subs/Show.S01E01.srt»,
// «Show.S01E01.rus.forced.srt» next to the video. Given the TorrServer file list of a release: which files are videos and
// which are external tracks, the episode (video) each track belongs to, and its display name (the studio, from the folder
// or the name suffix), language (ISO 639-2: rus, eng, ukr, und) and flags (forced, SDH). Pure, shared by the phone and the TV.
//
// A release with no video has no external tracks (an audiobook or music: its audio files are what is played). The ids of
// the tracks are stable across the episodes of a release («a:rus:lostfilm»), so a choice made in one episode finds the
// same dub in the next one.
//
// Chromium 53 (webOS): no lookbehind, no named groups, no Object.values here.
import { baseName, fileKind, naturalCompare, stripExt, extOf, type TorrentFile } from './episodes';
import { normDub } from './seriesTracks';

export type ExternalKind = 'audio' | 'subtitle';

export interface ExternalTrack {
  /**
   * Stable within the release and across its episodes: kind, language, studio and flags («a:rus:lostfilm»,
   * «s:eng::forced»). A second file of the same id for one episode gets «#2», «#3» (in path order).
   */
  id: string;
  kind: ExternalKind;
  /** The file (its TorrServer index is `file.id`). */
  file: TorrentFile;
  /** File extension, lowercase («mka», «srt»). */
  ext: string;
  /** ISO 639-2 code: «rus», «eng», «ukr», ...; «und» when unknown. */
  lang: string;
  /** The studio or dub name («LostFilm», «Кубик в Кубе»); '' when the files do not say. */
  studio: string;
  /** What to show in a track list: the studio, else the flags («Forced»), else ''. The language is shown apart. */
  name: string;
  /** Subtitles only: forced (signs and songs, «надписи»). */
  forced?: true;
  /** Subtitles only: for the deaf and hard of hearing. */
  sdh?: true;
  /** A MIME hint for the player, when the extension says it. */
  mime?: string;
}

export interface ReleaseFiles {
  /** The video files, in path order. */
  videos: TorrentFile[];
  /** External audio tracks (none when the release has no video). */
  audio: ExternalTrack[];
  /** External subtitles (none when the release has no video). */
  subtitles: ExternalTrack[];
  /** Everything else (nfo, images, playlists). */
  other: TorrentFile[];
}

export interface EpisodeTracks {
  audio: ExternalTrack[];
  subtitles: ExternalTrack[];
}

export interface ReleaseTracks extends ReleaseFiles {
  /** The tracks of each video, by the video's file id. Every video has an entry (maybe empty). */
  byVideo: { [videoId: number]: EpisodeTracks };
  /** External tracks no video could be matched with (a pack where the names say nothing). */
  unmatched: ExternalTrack[];
}

// ---- languages ----

/** Language words: in a folder name, a name suffix, or (3+ letters only) anywhere in a file name. */
const LANG_WORDS: { [k: string]: string } = {
  rus: 'rus', ru: 'rus', russian: 'rus', 'русский': 'rus', 'рус': 'rus', 'russkiy': 'rus',
  eng: 'eng', en: 'eng', english: 'eng', 'английский': 'eng', 'англ': 'eng', 'англійська': 'eng',
  ukr: 'ukr', ua: 'ukr', uk: 'ukr', ukrainian: 'ukr', 'украинский': 'ukr', 'укр': 'ukr', 'українська': 'ukr', 'украина': 'ukr',
  bel: 'bel', belarusian: 'bel', 'белорусский': 'bel',
  kaz: 'kaz', kazakh: 'kaz', 'казахский': 'kaz',
  ger: 'ger', deu: 'ger', de: 'ger', german: 'ger', deutsch: 'ger', 'немецкий': 'ger',
  fre: 'fre', fra: 'fre', fr: 'fre', french: 'fre', 'французский': 'fre',
  spa: 'spa', es: 'spa', spanish: 'spa', 'испанский': 'spa',
  ita: 'ita', italian: 'ita', 'итальянский': 'ita',
  jpn: 'jpn', ja: 'jpn', jap: 'jpn', japanese: 'jpn', 'японский': 'jpn',
  chi: 'chi', zho: 'chi', chinese: 'chi', 'китайский': 'chi',
  kor: 'kor', ko: 'kor', korean: 'kor', 'корейский': 'kor',
  pol: 'pol', polish: 'pol', 'польский': 'pol',
  por: 'por', pt: 'por', portuguese: 'por',
  tur: 'tur', turkish: 'tur', 'турецкий': 'tur',
};

/** Two-letter words are languages only in folder names and name suffixes (in a file name «It», «De» are titles). */
function langWord(token: string, short: boolean): string {
  const k = token.toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(LANG_WORDS, k)) return '';
  if (!short && k.length < 3) return '';
  return LANG_WORDS[k];
}

/** Dub studios that dub into Russian: a folder named only by the studio says the language too. */
const RU_STUDIOS = [
  'lostfilm', 'hdrezka', 'hdrezka studio', 'rezka', 'newstudio', 'alexfilm', 'jaskier', 'kubik v kube', 'kubik', 'tvshows',
  'baibako', 'coldfilm', 'amedia', 'syenduk', 'pifagor', 'novamedia', 'ideafilm', 'gears media', 'anilibria', 'anidub',
  'kurazh bambey', 'red head sound', 'redheadsound', 'flarrow films', 'le production', 'videofilm', 'ultradox', 'gala voices',
  'filmgate', 'mvo', 'dvo', 'avo',
];

const CYRILLIC = /[а-яё]/i;
const UKRAINIAN_LETTERS = /[іїєґ]/i;

// ---- folders and name parts ----

/** Words of a folder that only says what is inside («Rus Sound», «Subs», «Озвучка»). */
const GENERIC_WORDS: { [k: string]: true } = {
  sound: true, sounds: true, audio: true, audios: true, track: true, tracks: true, voice: true, voices: true, dub: true,
  dubs: true, external: true, ext: true, extra: true, add: true, additional: true, dts: true, ac3: true, mka: true, aac: true,
  flac: true, mp3: true, eac3: true, sub: true, subs: true, subtitle: true, subtitles: true, srt: true, ass: true, ssa: true,
  vtt: true, 'озвучка': true, 'озвучки': true, 'озвучание': true, 'озвучивание': true, 'звук': true, 'звуковые': true,
  'дорожки': true, 'дорожка': true, 'аудио': true, 'аудиодорожки': true, 'аудиодорожка': true, 'субтитры': true,
  'сабы': true, 'суб': true, 'внешние': true, 'доп': true, 'дополнительные': true, 'и': true, 'and': true, '&': true,
};

/** A season folder («Season 2», «S02», «Сезон 2», «2 сезон»): no studio, but the season of the files inside. */
function seasonOfFolder(seg: string): number | null {
  const m =
    /^(?:season|сезон|s)[ ._-]*(\d{1,2})$/i.exec(seg.trim()) || /^(\d{1,2})[ ._-]*(?:season|сезон)$/i.exec(seg.trim());
  return m ? +m[1] : null;
}

function tokens(s: string): string[] {
  return s.split(/[\s._\-()[\]{},;+|/]+/).filter(Boolean);
}

/** Folder name cleaned for display: brackets, a leading number («01. LostFilm»), underscores, dots between words. */
export function cleanStudio(seg: string): string {
  let s = seg.replace(/_/g, ' ');
  if (s.indexOf(' ') < 0) s = s.replace(/\./g, ' ');
  s = s.replace(/^\s*\d{1,2}[.)]\s+/, '');
  s = s.replace(/^\s*[[(]\s*([^\])]+?)\s*[\])]\s*$/, '$1');
  return s.replace(/\s+/g, ' ').trim();
}

/** A studio text without the language words at its ends («Rus LostFilm» → «LostFilm»); the language found. */
function splitLang(text: string, short: boolean): { rest: string; lang: string } {
  const words = text.split(/\s+/).filter(Boolean);
  let lang = '';
  const strip = (w: string) => w.replace(/^[[(]+|[\])]+$/g, '');
  // the word goes first, then its language is kept if none yet («Rus Eng Studio» must not loop)
  while (words.length > 1 && langWord(strip(words[0]), short)) {
    const found = langWord(strip(words.shift() as string), short);
    lang = lang || found;
  }
  while (words.length > 1 && langWord(strip(words[words.length - 1]), short)) {
    const found = langWord(strip(words.pop() as string), short);
    lang = lang || found;
  }
  return { rest: words.join(' ').replace(/^[\s\-:|,.]+|[\s\-:|,.]+$/g, ''), lang };
}

interface FolderInfo {
  studio: string;
  lang: string;
  season: number | null;
  /** A subtitle folder of flags only («Forced», «Надписи», «SDH»), read apart from the studio. */
  forced: boolean;
  sdh: boolean;
}

/** A subtitle folder that only says what kind of subtitles («Forced», «Full», «SDH», «Полные»). */
const SUB_FLAG_WORD = /^(?:forced|forsed|надписи|форсированные|форс|signs|full|полные|sdh|cc|hoh)$/i;

/**
 * The folders between the video's folder and the track: the deepest one that names something other than its contents is
 * the studio; language words and season folders say the language and the season.
 */
function folderInfo(dirs: string[], kind: ExternalKind, videoName = ''): FolderInfo {
  let studio = '';
  let lang = '';
  let season: number | null = null;
  let forced = false;
  let sdh = false;
  for (let i = dirs.length - 1; i >= 0; i--) {
    const seg = dirs[i];
    const sn = seasonOfFolder(seg);
    if (sn !== null) {
      if (season === null) season = sn;
      continue;
    }
    // a release or season container («Show.S01.1080p», «Show (2026) WEB-DL 1080p»): no studio, but «LostFilm 1080p»
    // keeps «LostFilm» (the season, resolution, release words and the video's own name words go)
    let seg2 = seg;
    if (isContainerFolder(seg)) {
      seg2 = containerRest(seg, videoName);
      if (!seg2) continue;
    }
    const ts = tokens(seg2.toLowerCase());
    // «Rus Subs/LostFilm/Forced/»: the flags, and the studio is looked for further up
    if (kind === 'subtitle' && ts.length && ts.every((t) => SUB_FLAG_WORD.test(t) || !!langWord(t, true))) {
      ts.forEach((t) => {
        if (FORCED.test(t)) forced = true;
        if (/^(?:sdh|cc|hoh)$/i.test(t)) sdh = true;
        if (!lang && langWord(t, true)) lang = langWord(t, true);
      });
      continue;
    }
    const langs = ts.map((t) => langWord(t, true)).filter(Boolean);
    const generic = ts.every((t) => !!GENERIC_WORDS[t] || !!langWord(t, true) || /^\d+$/.test(t));
    if (generic) {
      if (!lang && langs.length) lang = langs[0];
      continue;
    }
    if (!studio) {
      const parts = splitLang(cleanStudio(seg2), true);
      studio = parts.rest;
      if (!lang && parts.lang) lang = parts.lang;
    }
  }
  return { studio, lang, season, forced, sdh };
}

const RELEASE_WORD = /^(?:s\d{1,2}|season|сезон|сезона|\d{3,4}[pi]|(?:19|20)\d\d|web|dl|webdl|webrip|bdrip|bdremux|bluray|remux|hdtv|hdrip|dvdrip|uhd|hdr|hdr10|sdr|dv|x264|x265|h264|h265|hevc|avc|\d{1,2})$/i;

/**
 * What a release / season folder says besides the release itself: its words without the season, resolution, year,
 * release words and the words of the video's own name («LostFilm 1080p» → «LostFilm», «Show.S01.1080p» → '').
 */
function containerRest(seg: string, videoName: string): string {
  // no video to tell the show's own words from a studio: the folder names the release
  if (!videoName) return '';
  const own: { [w: string]: true } = {};
  tokens(videoName.toLowerCase()).forEach((w) => {
    own[w] = true;
  });
  return tokens(seg)
    .filter((w) => !RELEASE_WORD.test(w) && !own[w.toLowerCase()])
    .join(' ');
}

/** A release or season folder: it names a season («S01», «Season 1», «Сезон 1») or a resolution («1080p», «2160p»). */
function isContainerFolder(seg: string): boolean {
  return (
    /(?:^|[^a-z0-9])s\d{1,2}(?:[^0-9e]|$)/i.test(seg) ||
    /(?:^|[^a-zа-яё])(?:season|сезон)[ ._-]?\d{1,2}/i.test(seg) ||
    /(?:^|[^0-9])\d{3,4}[pi](?:[^a-z0-9]|$)/i.test(seg)
  );
}

const FORCED = /^(?:forced|forsed|надписи|форсированные|форс|signs)$/i;
const SDH = /^(?:sdh|cc|hi|hoh|глухих|слабослышащих)$/i;
const SUFFIX_NOISE =
  /^(?:full|полные|default|sub|subs|srt|ass|ssa|vtt|track\d*|audio|sound|dub|\d{1,2}|\d{3,4}[pi]|web|dl|webdl|webrip|bdrip|bdremux|remux|hdtv|hdrip|x264|x265|h264|h265|hevc|avc|ac3|eac3|dts|aac|flac|mp3|mka)$/i;

interface SuffixInfo {
  studio: string;
  lang: string;
  forced: boolean;
  sdh: boolean;
}

/** What a name says after the video's own name («.rus.forced», «.LostFilm», «_Eng_SDH»). */
function suffixInfo(suffix: string, kind: ExternalKind): SuffixInfo {
  const out: SuffixInfo = { studio: '', lang: '', forced: false, sdh: false };
  const words: string[] = [];
  tokens(suffix).forEach((w) => {
    const l = langWord(w, true);
    if (l) {
      if (!out.lang) out.lang = l;
      return;
    }
    if (kind === 'subtitle' && FORCED.test(w)) {
      out.forced = true;
      return;
    }
    if (kind === 'subtitle' && SDH.test(w)) {
      out.sdh = true;
      return;
    }
    if (SUFFIX_NOISE.test(w)) return;
    words.push(w);
  });
  out.studio = words.join(' ');
  return out;
}

/** Language words and flags anywhere in a file name that is not the video's name («Rus Subs/Show.S01E01.eng.srt»). */
function nameInfo(name: string, kind: ExternalKind): SuffixInfo {
  const out: SuffixInfo = { studio: '', lang: '', forced: false, sdh: false };
  const ts = tokens(name);
  for (let i = ts.length - 1; i >= 0; i--) {
    const l = langWord(ts[i], false);
    if (l && !out.lang) out.lang = l;
    if (kind === 'subtitle' && FORCED.test(ts[i])) out.forced = true;
    if (kind === 'subtitle' && (/^(?:sdh)$/i.test(ts[i]))) out.sdh = true;
  }
  return out;
}

// ---- episodes ----

export interface TrackEpisode {
  season: number | null;
  episode: number;
}

/** A number that is a year or a resolution («2026», «1080p», «720i»), never an episode. */
function notEpisodeNumber(s: string, next: string): boolean {
  return s.length >= 4 || /^[pi]$/i.test(next);
}

/**
 * The episode a name holds: S01E02, s1.e2, 1x02, E02 / Ep 2 / Episode 2 / Серия 2 / 2 серия, « - 02 », or a name that
 * starts with the number («02. Title», «02»). Years and resolutions («2026», «1080p») never count. null when none.
 */
export function trackEpisode(name: string): TrackEpisode | null {
  const m = episodeMatch(stripExt(name));
  return m ? m.ep : null;
}

/** The episode of a name (without its extension) and where its marker ends in the name. */
function episodeMatch(n: string): { ep: TrackEpisode; end: number } | null {
  const at = (r: RegExpExecArray, ep: TrackEpisode, extra = 0) => ({ ep, end: r.index + r[0].length - extra });
  let m = /(?:^|[^a-z0-9])s(\d{1,2})[ ._-]?e(\d{1,3})(?!\d)/i.exec(n);
  if (m) return at(m, { season: +m[1], episode: +m[2] });
  m = /(?:^|[^0-9])(\d{1,2})x(\d{1,3})(?![0-9p])/i.exec(n);
  if (m) return at(m, { season: +m[1], episode: +m[2] });
  m = /(?:^|[^a-zа-яё0-9])(?:e|ep|episode|серия|эпизод|эп)[ ._-]?(\d{1,3})(?![0-9])/i.exec(n);
  if (m) return at(m, { season: null, episode: +m[1] });
  m = /(?:^|[^0-9])(\d{1,3})[ ._-]?(?:серия|series|эпизод)(?:[^a-zа-яё]|$)/i.exec(n);
  if (m) return at(m, { season: null, episode: +m[1] });
  m = /(?:^|\s)-\s*(\d{1,4})(.?)/.exec(n);
  if (m && !notEpisodeNumber(m[1], m[2]) && /^(?:|\s|\.|\[|\(|_)$/.test(m[2])) return at(m, { season: null, episode: +m[1] }, m[2].length);
  m = /^(\d{1,4})(.?)/.exec(n);
  if (m && !notEpisodeNumber(m[1], m[2]) && /^(?:|\s|\.|_|-|\)|\])$/.test(m[2])) return at(m, { season: null, episode: +m[1] }, m[2].length);
  return null;
}

/**
 * What a track's name says after its episode marker, without the words the video's own name has
 * («Show.S01E01.LostFilm» next to «Show.S01E01.1080p» → «LostFilm»; an episode title both share is dropped).
 */
function suffixAfterEpisode(trackName: string, videoName: string): string {
  const m = episodeMatch(trackName);
  if (!m) return '';
  const known: { [w: string]: true } = {};
  tokens(videoName.toLowerCase()).forEach((w) => {
    known[w] = true;
  });
  return tokens(trackName.slice(m.end)).filter((w) => !known[w.toLowerCase()]).join(' ');
}

/** The season from the folders of a path («Season 2/», «S02/», «Сезон 2/», «Show.S02.1080p/»). */
function folderSeason(path: string): number | null {
  const dirs = path.split('/').slice(0, -1);
  for (let i = dirs.length - 1; i >= 0; i--) {
    const own = seasonOfFolder(dirs[i]);
    if (own !== null) return own;
    const m = /(?:^|[^a-z0-9])(?:s|season|сезон)[ ._-]?(\d{1,2})(?:[^0-9e]|$)/i.exec(dirs[i]);
    if (m) return +m[1];
  }
  return null;
}

/** The episode of a file, with the season of its folders when the name has none. */
export function fileTrackEpisode(path: string): TrackEpisode | null {
  const e = trackEpisode(baseName(path));
  if (!e) return null;
  return e.season !== null ? e : { season: folderSeason(path), episode: e.episode };
}

// ---- classification ----

const MIME: { [ext: string]: string } = {
  mka: 'audio/x-matroska', ac3: 'audio/ac3', eac3: 'audio/eac3', dts: 'audio/vnd.dts', mp3: 'audio/mpeg', aac: 'audio/aac',
  m4a: 'audio/mp4', flac: 'audio/flac', ogg: 'audio/ogg', opus: 'audio/opus', wav: 'audio/wav',
  srt: 'application/x-subrip', ass: 'text/x-ssa', ssa: 'text/x-ssa', vtt: 'text/vtt',
};

function byPath(a: TorrentFile, b: TorrentFile): number {
  return naturalCompare(a.path, b.path);
}

/** Videos, external audio, external subtitles and the rest. A release without video has no external tracks. */
export function classifyFiles(files: TorrentFile[]): { videos: TorrentFile[]; audio: TorrentFile[]; subtitles: TorrentFile[]; other: TorrentFile[] } {
  const videos: TorrentFile[] = [];
  const audio: TorrentFile[] = [];
  const subtitles: TorrentFile[] = [];
  const other: TorrentFile[] = [];
  (files || []).forEach((f) => {
    if (!f || typeof f.path !== 'string') return;
    const k = fileKind(f.path);
    if (k === 'video') videos.push(f);
    else if (k === 'audio') audio.push(f);
    else if (k === 'subtitle') subtitles.push(f);
    else other.push(f);
  });
  if (!videos.length) return { videos, audio: [], subtitles: [], other: other.concat(audio, subtitles).sort(byPath) };
  return { videos: videos.sort(byPath), audio: audio.sort(byPath), subtitles: subtitles.sort(byPath), other: other.sort(byPath) };
}

function dirsOf(path: string): string[] {
  return path.split('/').slice(0, -1);
}

function commonDirs(paths: string[]): string[] {
  if (!paths.length) return [];
  let common = dirsOf(paths[0]);
  paths.forEach((p) => {
    const d = dirsOf(p);
    let i = 0;
    while (i < common.length && i < d.length && common[i] === d[i]) i++;
    common = common.slice(0, i);
  });
  return common;
}

/** The folders of `path` below `root` (when `path` lies under it), else below their common part. */
function dirsBelow(path: string, root: string[]): string[] {
  const d = dirsOf(path);
  let i = 0;
  while (i < root.length && i < d.length && root[i] === d[i]) i++;
  return d.slice(i);
}

/** `name` starts with `base` and the next character does not continue a number («Show.E1» is not «Show.E10»). */
function startsWithName(name: string, base: string): boolean {
  if (!base || name.length < base.length || name.slice(0, base.length) !== base) return false;
  if (name.length === base.length) return true;
  const next = name.charAt(base.length);
  return !(/[0-9]/.test(next) && /[0-9]$/.test(base)) && !/[a-zа-яё]/i.test(next);
}

function sameEpisode(a: TrackEpisode | null, b: TrackEpisode | null, seasons: number): boolean {
  if (!a || !b || a.episode !== b.episode) return false;
  if (a.season !== null && b.season !== null) return a.season === b.season;
  // one side has no season: only a release of one season can tell
  return seasons <= 1;
}

interface Match {
  video: TorrentFile | null;
  /** What the track's name says after the video's own name; null when the names are not the same. */
  suffix: string | null;
  /**
   * The suffix is what follows the episode marker, not the video's own name: it may be an episode title
   * («Show.S01E01.Pilot.mka»), so a studio folder wins over it.
   */
  weak?: true;
}

function matchVideo(
  track: TorrentFile,
  videos: TorrentFile[],
  bases: string[],
  episodes: (TrackEpisode | null)[],
  seasons: number,
  main: TorrentFile | null,
): Match {
  if (videos.length === 1) {
    const b = bases[0];
    const own = stripExt(baseName(track.path)).toLowerCase();
    return { video: videos[0], suffix: startsWithName(own, b) ? stripExt(baseName(track.path)).slice(b.length) : null };
  }
  const name = stripExt(baseName(track.path));
  const low = name.toLowerCase();
  const e = fileTrackEpisode(track.path);
  // same names in two season folders («Season 1/01.mkv», «Season 2/01.mkv»): the season must agree
  const fits = (i: number) => {
    const v = episodes[i];
    if (!e || !v) return true;
    if (e.season !== null && v.season !== null && e.season !== v.season) return false;
    return e.episode === v.episode;
  };
  // 1. the video's name, maybe with a suffix («Show.S01E01.rus.srt»): the longest such name, if only one
  let best = -1;
  let tie = false;
  for (let i = 0; i < videos.length; i++) {
    if (!startsWithName(low, bases[i]) || !fits(i)) continue;
    if (best < 0 || bases[i].length > bases[best].length) {
      best = i;
      tie = false;
    } else if (bases[i].length === bases[best].length) tie = true;
  }
  if (best >= 0 && !tie) return { video: videos[best], suffix: name.slice(bases[best].length) };
  // 2. the track's name is the start of one video's name («Show.S01E01.mka» for «Show.S01E01.1080p.mkv»)
  let hit = -1;
  for (let i = 0; i < videos.length; i++) {
    if (startsWithName(bases[i], low) && fits(i)) {
      if (hit >= 0) {
        hit = -2;
        break;
      }
      hit = i;
    }
  }
  if (hit >= 0) return { video: videos[hit], suffix: '' };
  // 3. the same episode; a track that names none belongs to the film when there is one (beside samples or extras)
  if (!e) return { video: main, suffix: null };
  let found = -1;
  for (let i = 0; i < videos.length; i++) {
    if (!sameEpisode(e, episodes[i], seasons)) continue;
    if (found >= 0) return { video: null, suffix: null };
    found = i;
  }
  if (found < 0 && e.season === null) {
    // a pack of several seasons, the track without one: the only video of that episode number
    for (let i = 0; i < videos.length; i++) {
      const v = episodes[i];
      if (!v || v.episode !== e.episode) continue;
      if (found >= 0) return { video: null, suffix: null };
      found = i;
    }
  }
  return found >= 0 ? { video: videos[found], suffix: suffixAfterEpisode(name, stripExt(baseName(videos[found].path))), weak: true } : { video: null, suffix: null };
}

/** Samples and trailers are no part of the film. */
const SAMPLE = /(?:^|[^a-z])(?:sample|trailer|трейлер)(?:[^a-z]|$)/i;
const MAIN_SHARE = 0.7;

/**
 * The film of a release: its only video once samples and trailers are aside, or one video with 70%+ of the videos'
 * size (a film with extras); null for a set of episodes.
 */
export function mainVideo(videos: TorrentFile[]): TorrentFile | null {
  if (videos.length === 1) return videos[0];
  const own = videos.filter((v) => !SAMPLE.test(baseName(v.path)));
  if (own.length === 1) return own[0];
  const size = (f: TorrentFile) => (typeof f.length === 'number' && f.length > 0 ? f.length : 0);
  const total = videos.reduce((n, v) => n + size(v), 0);
  if (!total) return null;
  let big: TorrentFile | null = null;
  videos.forEach((v) => {
    if (size(v) / total >= MAIN_SHARE) big = v;
  });
  return big;
}

function guessLang(studio: string): string {
  if (!studio) return '';
  if (UKRAINIAN_LETTERS.test(studio)) return 'ukr';
  if (CYRILLIC.test(studio)) return 'rus';
  const k = normDub(studio);
  for (let i = 0; i < RU_STUDIOS.length; i++) {
    const s = RU_STUDIOS[i];
    if (k === s || (s.length >= 4 && (' ' + k + ' ').indexOf(' ' + s + ' ') >= 0)) return 'rus';
  }
  return '';
}

/** The stable id of a track (before «#2» for a second file of one episode). */
export function trackId(kind: ExternalKind, lang: string, studio: string, forced?: boolean, sdh?: boolean): string {
  const flags = (forced ? 'forced' : '') + (forced && sdh ? '+' : '') + (sdh ? 'sdh' : '');
  return (kind === 'audio' ? 'a' : 's') + ':' + (lang || 'und') + ':' + normDub(studio).replace(/ /g, '-') + (flags ? ':' + flags : '');
}

function describe(
  file: TorrentFile,
  kind: ExternalKind,
  match: Match,
  root: string[],
  matched: TorrentFile | null,
): ExternalTrack {
  const below = dirsBelow(file.path, matched ? dirsOf(matched.path) : root);
  const folder = folderInfo(below, kind, matched ? stripExt(baseName(matched.path)) : '');
  const own = match.suffix !== null ? suffixInfo(match.suffix, kind) : nameInfo(stripExt(baseName(file.path)), kind);
  // a subtitle folder may be only flags («Forced», «Full»): no studio then
  const dir = kind === 'subtitle' && folder.studio ? suffixInfo(folder.studio, kind) : null;
  const folderStudio = dir ? dir.studio : folder.studio;
  // a studio named after the video's own name («Show.S01E01.1080p.LostFilm.mka») is closer than its folder; after an
  // episode marker it may be the episode's title, so the folder wins then
  const studio = match.weak ? folderStudio || own.studio : own.studio || folderStudio;
  const lang = own.lang || folder.lang || (dir ? dir.lang : '') || guessLang(studio) || 'und';
  const forced = kind === 'subtitle' && (own.forced || folder.forced || (!!dir && dir.forced));
  const sdh = kind === 'subtitle' && (own.sdh || folder.sdh || (!!dir && dir.sdh));
  const flags = [forced ? 'Forced' : '', sdh ? 'SDH' : ''].filter(Boolean).join(' ');
  const ext = extOf(file.path);
  const t: ExternalTrack = {
    id: trackId(kind, lang, studio, forced, sdh),
    kind,
    file,
    ext,
    lang,
    studio,
    name: studio && flags ? studio + ' · ' + flags : studio || flags,
  };
  if (forced) t.forced = true;
  if (sdh) t.sdh = true;
  if (MIME[ext]) t.mime = MIME[ext];
  return t;
}

/** Gives a second (third...) track of one id within one episode its own id: «#2», «#3». */
function uniqueIds(list: ExternalTrack[]): void {
  const seen: { [id: string]: number } = {};
  list.forEach((t) => {
    const n = (seen[t.id] || 0) + 1;
    seen[t.id] = n;
    if (n > 1) t.id = t.id + '#' + n;
  });
}

/** The full picture of a release: classification, the tracks of each video and those of no video. */
export function releaseTracks(files: TorrentFile[]): ReleaseTracks {
  const c = classifyFiles(files);
  const byVideo: { [videoId: number]: EpisodeTracks } = {};
  c.videos.forEach((v) => {
    byVideo[v.id] = { audio: [], subtitles: [] };
  });
  const out: ReleaseTracks = { videos: c.videos, audio: [], subtitles: [], other: c.other, byVideo, unmatched: [] };
  if (!c.videos.length) return out;
  const bases = c.videos.map((v) => stripExt(baseName(v.path)).toLowerCase());
  const episodes = c.videos.map((v) => fileTrackEpisode(v.path));
  const seasonSet: { [k: string]: true } = {};
  episodes.forEach((e) => {
    if (e && e.season !== null) seasonSet[String(e.season)] = true;
  });
  const seasons = Object.keys(seasonSet).length;
  const root = commonDirs(c.videos.map((v) => v.path));
  const main = mainVideo(c.videos);
  const take = (file: TorrentFile, kind: ExternalKind) => {
    const m = matchVideo(file, c.videos, bases, episodes, seasons, main);
    const t = describe(file, kind, m, root, m.video);
    (kind === 'audio' ? out.audio : out.subtitles).push(t);
    if (m.video) (kind === 'audio' ? byVideo[m.video.id].audio : byVideo[m.video.id].subtitles).push(t);
    else out.unmatched.push(t);
  };
  c.audio.forEach((f) => take(f, 'audio'));
  c.subtitles.forEach((f) => take(f, 'subtitle'));
  c.videos.forEach((v) => {
    uniqueIds(byVideo[v.id].audio);
    uniqueIds(byVideo[v.id].subtitles);
  });
  return out;
}

/** The external tracks of one video of the release (empty lists when it has none or is not a video of it). */
export function tracksForVideo(files: TorrentFile[], videoId: number): EpisodeTracks {
  const r = releaseTracks(files);
  return r.byVideo[videoId] || { audio: [], subtitles: [] };
}

/** The id without its «#2» part: one dub across the episodes. */
export function baseTrackId(id: string): string {
  const i = id.indexOf('#');
  return i >= 0 ? id.slice(0, i) : id;
}

export interface ExternalSummary {
  /** Distinct external dubs (studio + language), across the release. */
  dubs: number;
  /** The release has external subtitles. */
  subtitles: boolean;
}

const summaries: WeakMap<TorrentFile[], ExternalSummary> = new WeakMap();

/** What a release holds besides its videos: the number of external dubs and whether there are subtitles. Cached per list. */
export function externalSummary(files: TorrentFile[] | null | undefined): ExternalSummary {
  if (!files || !files.length) return { dubs: 0, subtitles: false };
  const hit = summaries.get(files);
  if (hit) return hit;
  const r = releaseTracks(files);
  const ids: { [id: string]: true } = {};
  r.audio.forEach((t) => {
    ids[baseTrackId(t.id)] = true;
  });
  const s: ExternalSummary = { dubs: Object.keys(ids).length, subtitles: r.subtitles.length > 0 };
  summaries.set(files, s);
  return s;
}
