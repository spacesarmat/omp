// Phone «Продолжить просмотр»: only a real stop (2-90%), a finished episode moves to the next file,
// and a show nobody touched for 30 days stays in history but leaves this row. The TV row is unchanged.
import { fileEpisodes } from './categoryCheck';
import { t } from '../i18n';
import { formatDuration } from './format';

export interface ContinueFile {
  id: number;
  path: string;
  /** Set when the next episode lives in another torrent of the same show. */
  hash?: string;
  /** False for a subtitle or an external audio file. Absent means playable. */
  playable?: boolean;
}

export interface ContinueWatch {
  hash: string;
  fileIndex: number;
  time: number;
  duration: number;
  updated: number;
  open?: boolean;
  src: 'tv' | 'phone';
  name?: string;
  showKey: string;
}

export interface ContinueCard {
  hash: string;
  fileIndex: number;
  time: number;
  duration: number;
  updated: number;
  open?: boolean;
  src: 'tv' | 'phone';
  name?: string;
  showKey: string;
  kind: 'resume' | 'next';
  code: string;
}

const MIN_RATIO = 0.02;
const DONE_RATIO = 0.9;
export const CONTINUE_STALE_MS = 30 * 24 * 60 * 60 * 1000;

function pad(n: number): string {
  return (n < 10 ? '0' : '') + n;
}

export function episodeCode(path: string): string {
  const e = fileEpisodes(path);
  if (!e || !e.episodes.length) return '';
  const season = e.season !== null ? 'S' + pad(e.season) : '';
  const a = e.episodes[0];
  const b = e.episodes[e.episodes.length - 1];
  return a === b ? season + 'E' + pad(a) : season + 'E' + pad(a) + '-E' + pad(b);
}

function orderOf(path: string): number {
  const e = fileEpisodes(path);
  if (!e || !e.episodes.length) return 1e9;
  return (e.season === null ? 0 : e.season) * 1000 + e.episodes[0];
}

function ratioOf(w: ContinueWatch): number {
  return w.duration > 0 ? w.time / w.duration : -1;
}

function cardFrom(w: ContinueWatch, fileIndex: number, time: number, duration: number, kind: 'resume' | 'next', code: string): ContinueCard {
  const row: ContinueCard = {
    hash: w.hash,
    fileIndex,
    time,
    duration,
    updated: w.updated,
    src: w.src,
    showKey: w.showKey,
    kind,
    code,
  };
  if (w.open && kind === 'resume') row.open = true;
  if (w.name) row.name = w.name;
  return row;
}

/** One card per show, newest watch first. */
export function continueCards(
  watches: ContinueWatch[],
  filesByHash: { [hash: string]: ContinueFile[] },
  now: number,
): ContinueCard[] {
  const sorted = watches.slice().sort((a, b) => b.updated - a.updated || a.hash.localeCompare(b.hash));
  const seen: { [k: string]: boolean } = {};
  const out: ContinueCard[] = [];
  sorted.forEach((w) => {
    const key = w.showKey || w.hash;
    if (seen[key]) return;
    if (!(w.updated > 0) || now - w.updated > CONTINUE_STALE_MS) return;
    const files = filesByHash[w.showKey] || filesByHash[w.hash] || [];
    const ratio = ratioOf(w);
    const resume = w.open ? ratio >= MIN_RATIO && ratio < 1 : ratio >= MIN_RATIO && ratio < DONE_RATIO;
    if (resume) {
      seen[key] = true;
      const file = files.filter((f) => f.id === w.fileIndex && (!f.hash || f.hash === w.hash))[0]
        || files.filter((f) => f.id === w.fileIndex)[0];
      out.push(cardFrom(w, w.fileIndex, w.time, w.duration, 'resume', file ? episodeCode(file.path) : ''));
      return;
    }
    if (w.open || ratio < DONE_RATIO) return;
    const cur = files.filter((f) => f.id === w.fileIndex && (!f.hash || f.hash === w.hash))[0];
    const curOrder = cur ? orderOf(cur.path) : -1;
    const next = files
      .filter((f) => f.playable !== false && orderOf(f.path) > curOrder)
      .sort((a, b) => orderOf(a.path) - orderOf(b.path))[0];
    if (!next) return;
    const later = watches.filter((x) => x.hash === w.hash && x.fileIndex === next.id)[0];
    if (later && !later.open && ratioOf(later) >= DONE_RATIO) return;
    seen[key] = true;
    const row = cardFrom(w, next.id, 0, 0, 'next', episodeCode(next.path));
    if (next.hash) row.hash = next.hash;
    out.push(row);
  });
  return out;
}

/** Phone, TV, or a desktop client that recorded itself as a phone named like a computer. */
export function deviceKind(src: 'tv' | 'phone', name?: string): 'tv' | 'phone' | 'pc' {
  if (src === 'tv') return 'tv';
  if (name && /desktop|компьютер|(^|[^a-zа-я])(pc|пк)([^a-zа-я]|$)/i.test(name)) return 'pc';
  return 'phone';
}

function dayStart(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function clock(at: number): string {
  const d = new Date(at);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}

/** «ТВ · вчера в 22:10». */
export function continueSourceLine(src: 'tv' | 'phone', name: string | undefined, at: number, now: number): string {
  const kind = deviceKind(src, name);
  const device = kind === 'tv' ? t('history.shortTv') : kind === 'pc' ? t('history.shortPc') : t('history.shortPhone');
  if (!(at > 0)) return device;
  const time = clock(at);
  const today = dayStart(now);
  const day = dayStart(at);
  let when = t('date.day', { d: new Date(at).getDate(), month: t('date.monthsFull').split(' ')[new Date(at).getMonth()] });
  if (day === today) when = t('history.todayIn', { time });
  else if (day === dayStart(today - 12 * 3600 * 1000)) when = t('history.yesterdayIn', { time });
  return device + ' · ' + when;
}

/** The two lines of the series main button. */
export function mainButtonLines(opts: { onTv: boolean; code: string; at: number }): { title: string; sub: string } {
  const verb = opts.at > 0 ? t('nav.continueBare') : t('nav.watchBare');
  const title = (verb + (opts.code ? ' ' + opts.code : '')).trim();
  if (!(opts.at > 0)) {
    return { title, sub: opts.onTv ? t('nav.watchSubTv') : t('nav.watchSubPhone') };
  }
  const time = formatDuration(opts.at);
  return { title, sub: t(opts.onTv ? 'nav.continueSubTv' : 'nav.continueSubPhone', { time }) };
}
