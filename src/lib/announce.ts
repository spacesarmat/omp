// Tracker announce URLs for a release added from Jackett / JacRed.
// TorrServer's default is RetrackersMode 1: it APPENDS its own trackers (utils.GetDefTrackers and trackers.txt)
// to whatever the torrent or magnet already names. Uploading the .torrent, or a magnet that keeps every `tr=`,
// does not replace those defaults and this module never sends a mode that would drop them.
// A private passkey lives in the announce URL. It is sent to TorrServer and never written to the log.
// Chromium 53 safe: no Object.values/entries, no regex u flag, no AbortController.
import { infohashFromMagnet } from '../sources/html';

/** A .torrent handed to the TV over the phone link, above this the TV gets the magnet only. */
export const TV_TORRENT_MAX = 1500000;

const URL_OK = /^(https?|udp):\/\//i;
const TR = /[?&]tr=([^&]*)/gi;

export interface TorrentHandoff {
  /** Magnet with every known announce, when a hash is known. */
  link?: string;
  /** Base64 of the .torrent bytes (latin-1), when they fit in TV_TORRENT_MAX. */
  file?: string;
}

function pushUrl(out: string[], seen: { [k: string]: boolean }, raw: unknown): void {
  if (typeof raw !== 'string') return;
  const u = raw.trim();
  if (!u || !URL_OK.test(u) || seen[u]) return;
  seen[u] = true;
  out.push(u);
}

/** `tr=` values of a magnet, decoded, de-duplicated, order kept. */
export function trackersFromMagnet(magnet: string): string[] {
  const out: string[] = [];
  const seen: { [k: string]: boolean } = {};
  const re = new RegExp(TR.source, 'gi');
  let m: RegExpExecArray | null;
  const src = magnet || '';
  while ((m = re.exec(src))) {
    let raw = m[1];
    try {
      raw = decodeURIComponent(raw.replace(/\+/g, '%20'));
    } catch (e) {
      continue;
    }
    pushUrl(out, seen, raw);
  }
  return out;
}

type BVal = number | string | BVal[] | { [k: string]: BVal };

/** One bencode value. Strings longer than 4 KB (piece hashes) are skipped, not stored. */
function bdecodeAt(s: string, i: number): { v: BVal; i: number } | null {
  if (i >= s.length) return null;
  const c = s.charAt(i);
  if (c === 'i') return bdecodeInt(s, i);
  if (c === 'l') return bdecodeList(s, i);
  if (c === 'd') return bdecodeDict(s, i);
  if (c >= '0' && c <= '9') return bdecodeStr(s, i);
  return null;
}

function bdecodeInt(s: string, i: number): { v: number; i: number } | null {
  let j = i + 1;
  let neg = false;
  if (s.charAt(j) === '-') {
    neg = true;
    j++;
  }
  const start = j;
  while (j < s.length && s.charAt(j) >= '0' && s.charAt(j) <= '9') j++;
  if (j === start || s.charAt(j) !== 'e') return null;
  if (s.charAt(start) === '0' && (j - start > 1 || neg)) return null;
  const n = parseInt(s.substring(i + 1, j), 10);
  if (!isFinite(n)) return null;
  return { v: n, i: j + 1 };
}

function bdecodeStr(s: string, i: number): { v: string; i: number } | null {
  let j = i;
  while (j < s.length && s.charAt(j) >= '0' && s.charAt(j) <= '9') j++;
  if (j === i || s.charAt(j) !== ':') return null;
  if (s.charAt(i) === '0' && j - i > 1) return null;
  const len = parseInt(s.substring(i, j), 10);
  if (!isFinite(len) || len < 0) return null;
  const start = j + 1;
  const end = start + len;
  if (end > s.length) return null;
  return { v: len > 4096 ? '' : s.substring(start, end), i: end };
}

function bdecodeList(s: string, i: number): { v: BVal[]; i: number } | null {
  const out: BVal[] = [];
  let j = i + 1;
  while (j < s.length && s.charAt(j) !== 'e') {
    const item = bdecodeAt(s, j);
    if (!item) return null;
    out.push(item.v);
    j = item.i;
  }
  if (s.charAt(j) !== 'e') return null;
  return { v: out, i: j + 1 };
}

function bdecodeDict(s: string, i: number): { v: { [k: string]: BVal }; i: number } | null {
  const out: { [k: string]: BVal } = {};
  let j = i + 1;
  while (j < s.length && s.charAt(j) !== 'e') {
    const key = bdecodeStr(s, j);
    if (!key) return null;
    const val = bdecodeAt(s, key.i);
    if (!val) return null;
    out[key.v] = val.v;
    j = val.i;
  }
  if (s.charAt(j) !== 'e') return null;
  return { v: out, i: j + 1 };
}

function latin1(bytes: Uint8Array): string {
  let s = '';
  const size = 8192;
  for (let i = 0; i < bytes.length; i += size) {
    const end = i + size < bytes.length ? i + size : bytes.length;
    const chunk: number[] = [];
    for (let j = i; j < end; j++) chunk.push(bytes[j]);
    s += String.fromCharCode.apply(null, chunk);
  }
  return s;
}

/** `announce` and `announce-list` of a .torrent (bytes or a latin-1 string). */
export function trackersFromTorrent(input: Uint8Array | string): string[] {
  const s = typeof input === 'string' ? input : latin1(input);
  const root = bdecodeAt(s, 0);
  const out: string[] = [];
  const seen: { [k: string]: boolean } = {};
  if (!root || typeof root.v === 'number' || typeof root.v === 'string' || root.v instanceof Array) return out;
  const dict = root.v;
  pushUrl(out, seen, dict['announce']);
  const list = dict['announce-list'];
  if (list instanceof Array) {
    for (let i = 0; i < list.length; i++) {
      const tier = list[i];
      if (typeof tier === 'string') pushUrl(out, seen, tier);
      else if (tier instanceof Array) {
        for (let j = 0; j < tier.length; j++) pushUrl(out, seen, tier[j]);
      }
    }
  }
  return out;
}

/** Magnet plus any announce not already in its `tr=` params. Existing `tr=` values stay. */
export function mergeMagnetTrackers(magnet: string, extra: string[]): string {
  const base = (magnet || '').trim();
  if (base.indexOf('magnet:') !== 0) return base;
  const have = trackersFromMagnet(base);
  const seen: { [k: string]: boolean } = {};
  for (let i = 0; i < have.length; i++) seen[have[i]] = true;
  let out = base;
  for (let i = 0; i < extra.length; i++) {
    const u = (extra[i] || '').trim();
    if (!u || seen[u] || !URL_OK.test(u)) continue;
    seen[u] = true;
    out += (out.indexOf('?') >= 0 ? '&' : '?') + 'tr=' + encodeURIComponent(u);
  }
  return out;
}

/**
 * Link passed to TorrServer. A stashed file or an http(s) .torrent link is unchanged: the file carries
 * announce-list, and TorrServer still appends its default trackers. A magnet gains any missing `tr=`.
 */
export function linkWithTrackers(link: string, extra: string[]): string {
  const l = (link || '').trim();
  if (!l || l.indexOf('omp-file:') === 0 || /^https?:\/\//i.test(l)) return l;
  if (l.indexOf('magnet:') === 0) return mergeMagnetTrackers(l, extra);
  return l;
}

export function bytesToB64(bytes: Uint8Array): string {
  return btoa(latin1(bytes));
}

/** Bytes of a latin-1 base64 payload, or null when it is not base64. */
export function bytesFromB64(s: string): Uint8Array | null {
  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 255;
    return out;
  } catch (e) {
    return null;
  }
}

function hashOf(row: { Magnet?: string; Hash?: string; hash?: string }): string {
  const hex = (row.hash || row.Hash || '').toLowerCase();
  if (/^[0-9a-f]{40}$/.test(hex)) return hex;
  return infohashFromMagnet(row.Magnet || '') || '';
}

/**
 * What the phone sends the TV for a .torrent it downloaded itself. The file is preferred (the TV uploads it);
 * `link` is a magnet with every announce from the file and the row, so a client that only reads `link` still
 * reaches the source tracker. Nothing here is logged.
 */
export function handoffTorrent(bytes: Uint8Array, row: { Title?: string; Magnet?: string; Hash?: string; hash?: string }): TorrentHandoff | null {
  const fromFile = trackersFromTorrent(bytes);
  let magnet = row.Magnet && row.Magnet.indexOf('magnet:') === 0 ? row.Magnet : '';
  const hash = hashOf(row);
  if (!magnet && hash) {
    magnet = 'magnet:?xt=urn:btih:' + hash;
    if (row.Title) magnet += '&dn=' + encodeURIComponent(row.Title);
  }
  if (magnet) magnet = mergeMagnetTrackers(magnet, fromFile);
  const out: TorrentHandoff = {};
  if (magnet) out.link = magnet;
  if (bytes.length > 0 && bytes.length <= TV_TORRENT_MAX) out.file = bytesToB64(bytes);
  if (!out.link && !out.file) return null;
  return out;
}
