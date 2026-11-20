/** Enough of Matroska to pull one subtitle track. Reads the head, the cue index, and one cluster at a time. */

export interface MkvSubTrack {
  number: number;
  codecId: string;
  codecPrivate: Uint8Array;
  language?: string;
}

export interface MkvPacket {
  track: number;
  /** Seconds. */
  start: number;
  duration: number;
  data: Uint8Array;
}

export interface MkvCue {
  /** Seconds. */
  time: number;
  /** Byte offset of the cluster in the file. */
  cluster: number;
}

export interface MkvHead {
  tracks: MkvSubTrack[];
  cues: MkvCue[];
  segmentStart: number;
  /** Matroska TimestampScale. Timecodes are in these units (1e6 = milliseconds). */
  scale: number;
}

const EMPTY = new Uint8Array(0);

/** Matroska TimestampScale is in nanoseconds. Default 1e6 means timecodes are milliseconds. */
export function mkvSeconds(timecode: number, scale: number): number {
  return (timecode * (scale || 1000000)) / 1000000000;
}

export function parseMkvHead(head: Uint8Array, tail: Uint8Array, tailOffset: number): MkvHead {
  const found = walkTop(head);
  const cues = parseCues(head, found.scale, found.segmentStart, 0).concat(parseCues(tail, found.scale, found.segmentStart, tailOffset));
  const seen: { [k: number]: boolean } = {};
  const uniq: MkvCue[] = [];
  for (let i = 0; i < cues.length; i++) {
    if (seen[cues[i].cluster]) continue;
    seen[cues[i].cluster] = true;
    uniq.push(cues[i]);
  }
  uniq.sort((a, b) => a.time - b.time);
  return { tracks: found.tracks, cues: uniq, segmentStart: found.segmentStart, scale: found.scale };
}

/**
 * Every cluster in the buffer. A cue range often covers more than one cluster, and only the first used to be read.
 * Returns how many leading bytes formed complete elements, so a short read can resume without a cut block.
 */
export function parseCluster(buf: Uint8Array, scale: number): MkvPacket[] {
  return takeElements(buf, scale).packets;
}

export function takeElements(buf: Uint8Array, scale: number): { packets: MkvPacket[]; bytes: number } {
  const out: MkvPacket[] = [];
  let i = 0;
  let clusterTc = 0;
  let consumed = 0;
  while (i + 2 <= buf.length) {
    const el = peekElement(buf, i);
    if (!el) break;
    if (el.unknown) break;
    const end = i + el.header + el.size;
    if (end > buf.length && el.id !== 0x1f43b675) break;
    if (el.id === 0x1f43b675) {
      clusterTc = 0;
      i = el.data;
      consumed = i;
      continue;
    }
    if (el.id === 0xe7) clusterTc = uint(buf, el.data, end);
    else if (el.id === 0xa3) pushBlock(buf.subarray(el.data, end), clusterTc, scale, 0, out);
    else if (el.id === 0xa0) pushGroup(buf.subarray(el.data, end), clusterTc, scale, out);
    i = end;
    consumed = i;
  }
  return { packets: out, bytes: consumed };
}

export interface EbmlPeek {
  id: number;
  header: number;
  data: number;
  size: number;
  unknown: boolean;
}

/** Element header only. `size` is the payload length; it is not clamped to the buffer. */
export function peekElement(b: Uint8Array, i: number): EbmlPeek | null {
  const id = vint(b, i, false);
  if (!id) return null;
  const sz = vint(b, i + id.n, true);
  if (!sz) return null;
  const data = i + id.n + sz.n;
  const unknown = allFf(b, i + id.n, sz.n);
  return { id: id.v, header: id.n + sz.n, data: data, size: unknown ? -1 : sz.v, unknown: unknown };
}

function walkTop(buf: Uint8Array): { tracks: MkvSubTrack[]; scale: number; segmentStart: number } {
  const tracks: MkvSubTrack[] = [];
  let scale = 1000000;
  let segmentStart = 0;
  walk(buf, 0, buf.length, (id, data, end) => {
    if (id !== 0x18538067) return false;
    segmentStart = data;
    walk(buf, data, end, (cid, cdata, cend) => {
      if (cid === 0x1549a966) {
        walk(buf, cdata, cend, (iid, idata, iend) => {
          if (iid === 0x2ad7b1) scale = uint(buf, idata, iend) || scale;
          return false;
        });
      } else if (cid === 0x1654ae6b) {
        walk(buf, cdata, cend, (tid, tdata, tend) => {
          if (tid === 0xae) {
            const tr = trackEntry(buf, tdata, tend);
            if (tr) tracks.push(tr);
          }
          return false;
        });
      }
      return false;
    });
    return true;
  });
  return { tracks: tracks, scale: scale, segmentStart: segmentStart };
}

function trackEntry(buf: Uint8Array, start: number, end: number): MkvSubTrack | null {
  let number = 0;
  let type = 0;
  let codecId = '';
  let language = '';
  let priv = EMPTY;
  walk(buf, start, end, (id, data, stop) => {
    if (id === 0xd7) number = uint(buf, data, stop);
    else if (id === 0x83) type = uint(buf, data, stop);
    else if (id === 0x86) codecId = latin1(buf, data, stop);
    else if (id === 0x22b59c || id === 0x22b59d) language = latin1(buf, data, stop);
    else if (id === 0x63a2) {
      const slice = buf.subarray(data, stop);
      const copy = new Uint8Array(slice.length);
      copy.set(slice);
      priv = copy;
    }
    return false;
  });
  if (type !== 0x11 || !number) return null;
  return { number: number, codecId: codecId, codecPrivate: priv, language: language || undefined };
}

function parseCues(buf: Uint8Array, scale: number, segmentStart: number, tailOffset: number): MkvCue[] {
  const out: MkvCue[] = [];
  const at = findId(buf, 0x1c53bb6b);
  if (at < 0) return out;
  const el = readId(buf, at);
  if (!el) return out;
  walk(buf, el.data, Math.min(buf.length, el.end), (id, data, end) => {
    if (id !== 0xbb) return false;
    let time = 0;
    let cluster = -1;
    walk(buf, data, end, (cid, cdata, cend) => {
      if (cid === 0xb3) time = uint(buf, cdata, cend);
      else if (cid === 0xb7) {
        walk(buf, cdata, cend, (pid, pdata, pend) => {
          if (pid === 0xf1) cluster = uint(buf, pdata, pend);
          return false;
        });
      }
      return false;
    });
    if (cluster >= 0) out.push({ time: mkvSeconds(time, scale), cluster: segmentStart + cluster });
    return false;
  });
  // tailOffset is unused when cues carry segment-relative positions; kept so a caller can pass the slice origin
  if (tailOffset < 0) return [];
  return out;
}

function pushBlock(block: Uint8Array, clusterTc: number, scale: number, duration: number, out: MkvPacket[]): void {
  const tr = vint(block, 0, true);
  if (!tr) return;
  const tcAt = tr.n;
  if (tcAt + 3 > block.length) return;
  let tc = (block[tcAt] << 8) | block[tcAt + 1];
  if (tc & 0x8000) tc -= 0x10000;
  const flags = block[tcAt + 2];
  if (((flags >> 1) & 3) !== 0) return;
  const start = mkvSeconds(clusterTc + tc, scale);
  const dur = duration ? mkvSeconds(duration, scale) : 0;
  out.push({ track: tr.v, start: start, duration: dur, data: copyBytes(block.subarray(tcAt + 3)) });
}

function pushGroup(group: Uint8Array, clusterTc: number, scale: number, out: MkvPacket[]): void {
  let block: Uint8Array | null = null;
  let dur = 0;
  walk(group, 0, group.length, (cid, cdata, cend) => {
    if (cid === 0xa1) block = group.subarray(cdata, cend);
    else if (cid === 0x9b) dur = uint(group, cdata, cend);
    return false;
  });
  if (block) pushBlock(block, clusterTc, scale, dur, out);
}

function copyBytes(src: Uint8Array): Uint8Array {
  const out = new Uint8Array(src.length);
  out.set(src);
  return out;
}

interface El {
  v: number;
  data: number;
  end: number;
}

function readId(b: Uint8Array, i: number): El | null {
  const id = vint(b, i, false);
  if (!id) return null;
  const sz = vint(b, i + id.n, true);
  if (!sz) return null;
  const data = i + id.n + sz.n;
  const unknown = allFf(b, i + id.n, sz.n);
  const end = unknown ? b.length : data + sz.v;
  return { v: id.v, data: data, end: end > b.length ? b.length : end };
}

function walk(b: Uint8Array, start: number, end: number, fn: (id: number, data: number, end: number) => boolean): void {
  let i = start;
  const stop = end > b.length ? b.length : end;
  while (i + 2 <= stop) {
    const el = readId(b, i);
    if (!el || el.data > stop) return;
    const limited = el.end > stop ? stop : el.end;
    if (fn(el.v, el.data, limited)) return;
    if (el.end <= i) return;
    i = el.end;
  }
}

function vint(b: Uint8Array, i: number, strip: boolean): { v: number; n: number } | null {
  if (i >= b.length) return null;
  const first = b[i];
  if (!first) return null;
  let width = 1;
  let mask = 0x80;
  while (width <= 8 && (first & mask) === 0) {
    width++;
    mask >>= 1;
  }
  if (width > 8 || i + width > b.length) return null;
  let v = strip ? first & (mask - 1) : first;
  for (let k = 1; k < width; k++) v = v * 256 + b[i + k];
  return { v: v, n: width };
}

function allFf(b: Uint8Array, i: number, n: number): boolean {
  for (let k = 0; k < n; k++) if (b[i + k] !== 0xff) return false;
  return n > 0;
}

function uint(b: Uint8Array, start: number, end: number): number {
  let v = 0;
  for (let i = start; i < end; i++) v = v * 256 + b[i];
  return v;
}

function latin1(b: Uint8Array, start: number, end: number): string {
  let s = '';
  for (let i = start; i < end; i++) s += String.fromCharCode(b[i]);
  return s;
}

function findId(b: Uint8Array, id: number): number {
  const bytes: number[] = [];
  let n = id;
  const tmp: number[] = [];
  while (n > 0) {
    tmp.push(n & 0xff);
    n = Math.floor(n / 256);
  }
  for (let i = tmp.length - 1; i >= 0; i--) bytes.push(tmp[i]);
  if (!bytes.length) return -1;
  for (let i = 0; i + bytes.length <= b.length; i++) {
    let ok = true;
    for (let k = 0; k < bytes.length; k++) if (b[i + k] !== bytes[k]) ok = false;
    if (ok) return i;
  }
  return -1;
}
