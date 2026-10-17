// Audio files of an audiobook, in listening order. The extensions are the ones a book is shipped as.
// Order walks the path segment by segment: a disc, «Часть» or «Глава» number wins, otherwise a leading
// number (01, 2, 10), otherwise a natural compare — so nested folders and discs stay in order.
// A single m4b can be split into chapters from ffprobe (FfprobeResult). Pure; shared by the phone.
// Chromium 53 rules: no lookbehind, no u flag, no \b next to Cyrillic.
import type { FfprobeResult } from '../api/types';
import { t } from '../i18n';
import { chapterLabel, chapterList } from '../player/chapters';
import { baseName, extOf, naturalCompare, stripExt, type TorrentFile } from './episodes';

/** Sound files a book card lists. Video, cues and covers stay out. */
export const AUDIOBOOK_EXTS = ['mp3', 'm4b', 'm4a', 'ogg', 'opus', 'aac', 'flac'];

export function isAudiobookAudio(path: string): boolean {
  return AUDIOBOOK_EXTS.indexOf(extOf(path)) >= 0;
}

export interface TrackMark {
  disc: number | null;
  part: number | null;
  chapter: number | null;
}

// A number after the word, not inside another word («cd» in «abcd» is not a disc).
const DISC = /(?:^|[^0-9a-zа-яё])(?:диск|disc|disk|cd)[\s._-]*(\d{1,3})(?:[^0-9]|$)/i;
const PART = /(?:^|[^0-9a-zа-яё])(?:часть|part)[\s._-]*(\d{1,3})(?:[^0-9]|$)/i;
const CHAPTER = /(?:^|[^0-9a-zа-яё])(?:глава|chapter|гл\.?|ch\.?)[\s._-]*(\d{1,4})(?:[^0-9]|$)/i;
const LEADING = /^0*(\d{1,4})(?:\D|$)/;

function firstNumber(re: RegExp, s: string): number | null {
  const m = re.exec(s);
  return m ? parseInt(m[1], 10) : null;
}

/** Disc, part and chapter numbers named anywhere in the path. */
export function trackMark(path: string): TrackMark {
  const s = path || '';
  return { disc: firstNumber(DISC, s), part: firstNumber(PART, s), chapter: firstNumber(CHAPTER, s) };
}

function splitPath(path: string): string[] {
  const parts = (path || '').replace(/\\/g, '/').split('/');
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) if (parts[i]) out.push(parts[i]);
  return out;
}

/** The number a folder or file is ordered by: disc, then part, then chapter, then a leading «01». */
function segmentNumber(seg: string): number | null {
  const m = trackMark(seg);
  if (m.disc !== null) return m.disc;
  if (m.part !== null) return m.part;
  if (m.chapter !== null) return m.chapter;
  const lead = LEADING.exec(stripExt(seg));
  return lead ? parseInt(lead[1], 10) : null;
}

function compareSegment(a: string, b: string): number {
  const an = segmentNumber(a);
  const bn = segmentNumber(b);
  if (an !== null && bn !== null && an !== bn) return an - bn;
  return naturalCompare(a, b);
}

/** Listening order of two paths (nested discs, «Часть», «Глава», 01 < 2 < 10). */
export function compareAudiobookPaths(a: string, b: string): number {
  const as = splitPath(a);
  const bs = splitPath(b);
  const n = as.length < bs.length ? as.length : bs.length;
  for (let i = 0; i < n; i++) {
    const c = compareSegment(as[i], bs[i]);
    if (c !== 0) return c;
  }
  return as.length - bs.length;
}

/**
 * Row label. A file that names both is «Часть 1 / Глава 3»; a chapter or part alone uses that;
 * anything else keeps the file name without its extension.
 */
export function trackLabel(path: string): string {
  const file = baseName(path);
  const m = trackMark(file);
  if (m.part !== null && m.chapter !== null) return t('audiobooks.partChapter', { part: m.part, chapter: m.chapter });
  if (m.chapter !== null) return t('audiobooks.chapter', { n: m.chapter });
  if (m.part !== null) return t('audiobooks.part', { n: m.part });
  const name = stripExt(file);
  return name || file;
}

export interface AudiobookTrack {
  file: TorrentFile;
  /** «Часть 1 / Глава 3», «Глава 3», or the file name. */
  label: string;
  /** Folders under the path every file shares («Диск 1», «Часть 1 / Диск 2»); '' at the book root. */
  group: string;
  disc: number | null;
  part: number | null;
  chapter: number | null;
}

function dirOf(path: string): string[] {
  const parts = splitPath(path);
  parts.pop();
  return parts;
}

function commonDir(dirs: string[][]): string[] {
  if (!dirs.length) return [];
  const first = dirs[0];
  const out: string[] = [];
  for (let i = 0; i < first.length; i++) {
    const seg = first[i];
    let same = true;
    for (let j = 1; j < dirs.length; j++) {
      if (dirs[j][i] !== seg) {
        same = false;
        break;
      }
    }
    if (!same) break;
    out.push(seg);
  }
  return out;
}

/** Audiobook audio files in listening order, with a label and a folder group. */
export function audiobookTracks(files: TorrentFile[]): AudiobookTrack[] {
  const audio = files.filter((f) => isAudiobookAudio(f.path));
  const sorted = audio.slice().sort((a, b) => compareAudiobookPaths(a.path, b.path));
  const dirs = sorted.map((f) => dirOf(f.path));
  const common = commonDir(dirs);
  return sorted.map((file, i) => {
    const mark = trackMark(file.path);
    return {
      file,
      label: trackLabel(file.path),
      group: dirs[i].slice(common.length).join(' / '),
      disc: mark.disc,
      part: mark.part,
      chapter: mark.chapter,
    };
  });
}

export interface AudiobookSection {
  /** '' when the files sit in the shared root (no header). */
  title: string;
  tracks: AudiobookTrack[];
}

/** The same tracks, grouped by folder. Sections follow the listening order of their first track. */
export function audiobookSections(files: TorrentFile[]): AudiobookSection[] {
  const tracks = audiobookTracks(files);
  const out: AudiobookSection[] = [];
  const map: { [k: string]: AudiobookSection } = {};
  tracks.forEach((tr) => {
    const key = tr.group;
    let section = map[key];
    if (!section) {
      section = { title: key, tracks: [] };
      map[key] = section;
      out.push(section);
    }
    section.tracks.push(tr);
  });
  return out;
}

export interface AudiobookChapter {
  file: TorrentFile;
  /** 0-based place in the probe's chapter list. */
  index: number;
  title: string;
  start: number;
  end: number;
}

/**
 * The one m4b of a book (covers and other non-audio files do not count).
 * Null when there are several audio files, or the only one is not m4b — the card lists files instead.
 */
export function singleM4bFile(files: TorrentFile[]): TorrentFile | null {
  const audio = files.filter((f) => isAudiobookAudio(f.path));
  if (audio.length !== 1) return null;
  return extOf(audio[0].path) === 'm4b' ? audio[0] : null;
}

/**
 * Chapters of a single m4b from ffprobe. Empty when the probe has no chapters: the card lists the file.
 * TorrServer's `/ffp` supplies the probe; this function only reads it.
 */
export function m4bChapters(file: TorrentFile, probe: FfprobeResult | null): AudiobookChapter[] {
  if (extOf(file.path) !== 'm4b') return [];
  const list = chapterList(probe);
  const out: AudiobookChapter[] = [];
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    out.push({ file, index: i, title: chapterLabel(c, i), start: c.start, end: c.end });
  }
  return out;
}
