import { decodeText, parseAss, parseSubtitles, type Cue } from '../lib/subtitles';
import { parseCluster, parseMkvHead, type MkvCue, type MkvHead, type MkvPacket, type MkvSubTrack } from '../lib/mkvSubs';
import { PgsDecoder, type PgsBitmap } from '../lib/pgs';

const HEAD = 4 * 1024 * 1024;
const TAIL = 4 * 1024 * 1024;
const CLUSTER_CAP = 8 * 1024 * 1024;
const PACKET_CAP = 16 * 1024 * 1024;

export interface RangeSource {
  size: number;
  read(start: number, end: number): Promise<Uint8Array | null>;
}

/**
 * Embedded subtitles for a player that cannot read them from the video element.
 * Text: TorrServer WebVTT playlist when the server has it, else SRT/ASS packets from MKV clusters.
 * PGS: one bitmap at the playhead. Only the head, the cue index and the current cluster are read.
 */
export class LiveSubs {
  cues: Cue[] = [];
  bitmap: PgsBitmap | null = null;
  note = '';
  failed = false;
  private head: MkvHead | null = null;
  private track: MkvSubTrack | null = null;
  private packets: MkvPacket[] = [];
  private packetBytes = 0;
  private seen: { [pos: number]: boolean } = {};
  private closed = false;
  private busy = false;
  private fromGst = false;
  private painted = -1;
  private cueMark = '';

  constructor(
    private src: RangeSource,
    private ordinal: number,
    private kind: 'text' | 'pgs',
    private gst: (() => Promise<Cue[] | null>) | null,
  ) {}

  close(): void {
    this.closed = true;
  }

  async init(): Promise<void> {
    if (this.kind === 'text' && this.gst) {
      try {
        const got = await this.gst();
        if (this.closed) return;
        if (got && got.length) {
          this.cues = got;
          this.fromGst = true;
          this.note = '';
          return;
        }
      } catch (e) {
        /* this TorrServer build has no subtitle extractor */
      }
    }
    const size = this.src.size;
    if (!(size > 32)) {
      this.failed = true;
      return;
    }
    const headEnd = Math.min(HEAD, size) - 1;
    const tailStart = Math.max(0, size - Math.min(TAIL, size));
    const head = await this.src.read(0, headEnd);
    const tail = await this.src.read(tailStart, size - 1);
    if (this.closed || !head || !tail) {
      this.failed = true;
      return;
    }
    this.head = parseMkvHead(head, tail, tailStart);
    this.track = this.head.tracks[this.ordinal] || null;
    if (!this.track) this.failed = true;
  }

  async poll(time: number): Promise<void> {
    if (this.closed || this.failed || this.fromGst || !this.head || !this.track || this.busy) {
      this.publish(time);
      return;
    }
    const cue = cueAtTime(this.head.cues, time);
    if (!cue || this.seen[cue.cluster]) {
      this.publish(time);
      return;
    }
    this.busy = true;
    const next = nextCluster(this.head.cues, cue.cluster);
    let end = cue.cluster + CLUSTER_CAP - 1;
    if (next > cue.cluster && next - 1 < end) end = next - 1;
    if (end > this.src.size - 1) end = this.src.size - 1;
    const buf = end >= cue.cluster ? await this.src.read(cue.cluster, end) : null;
    this.busy = false;
    if (this.closed || !buf) return;
    this.seen[cue.cluster] = true;
    const all = parseCluster(buf, this.head.scale);
    for (let i = 0; i < all.length; i++) {
      if (all[i].track !== this.track.number) continue;
      this.packets.push(all[i]);
      this.packetBytes += all[i].data.length;
    }
    this.trim(time);
    this.publish(time);
  }

  private publish(time: number): void {
    if (!this.track) return;
    if (this.kind === 'text') {
      if (!this.fromGst) {
        const next = textCues(this.packets, this.track.codecId, this.track.codecPrivate);
        const mark = next.length ? next.length + ':' + next[next.length - 1].start + ':' + next[0].start : '0';
        if (mark !== this.cueMark) {
          this.cueMark = mark;
          this.cues = next;
        }
      }
      return;
    }
    if (this.bitmap && time >= this.bitmap.start && time < this.bitmap.end && this.painted === this.packets.length) return;
    const dec = new PgsDecoder();
    for (let i = 0; i < this.packets.length; i++) {
      if (this.packets[i].start <= time + 0.05) dec.feed(this.packets[i].start, this.packets[i].data);
    }
    this.bitmap = dec.bitmapAt(time);
    this.painted = this.packets.length;
  }

  private trim(time: number): void {
    if (this.packetBytes <= PACKET_CAP) return;
    const keep = time - 180;
    const next: MkvPacket[] = [];
    let bytes = 0;
    for (let i = 0; i < this.packets.length; i++) {
      if (this.packets[i].start < keep) continue;
      next.push(this.packets[i]);
      bytes += this.packets[i].data.length;
    }
    this.packets = next;
    this.packetBytes = bytes;
  }
}

export function cueAtTime(cues: MkvCue[], time: number): MkvCue | null {
  let best: MkvCue | null = null;
  for (let i = 0; i < cues.length; i++) {
    if (cues[i].time <= time + 0.5) best = cues[i];
  }
  if (!best && cues.length) return cues[0];
  return best;
}

function nextCluster(cues: MkvCue[], cluster: number): number {
  let next = -1;
  for (let i = 0; i < cues.length; i++) {
    if (cues[i].cluster > cluster && (next < 0 || cues[i].cluster < next)) next = cues[i].cluster;
  }
  return next;
}

export function textCues(packets: MkvPacket[], codecId: string, priv: Uint8Array): Cue[] {
  const id = (codecId || '').toUpperCase();
  if (id.indexOf('ASS') >= 0 || id.indexOf('SSA') >= 0) {
    let body = utf8(priv);
    for (let i = 0; i < packets.length; i++) body += '\n' + utf8(packets[i].data);
    return parseAss(body);
  }
  const out: Cue[] = [];
  for (let i = 0; i < packets.length; i++) {
    const p = packets[i];
    const text = utf8(p.data).replace(/^\uFEFF/, '').trim();
    if (!text) continue;
    out.push({ start: p.start, end: p.duration > 0 ? p.start + p.duration : p.start + 4, text: text });
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

/** TorrServer `-gst` playlist for one embedded text track. Rejects are an absent extractor, not a failure of the file. */
export function gstLoader(
  fetchText: (url: string, timeoutMs?: number) => Promise<string>,
  baseUrl: string,
  hash: string,
  ordinal: number,
): () => Promise<Cue[] | null> {
  const playlist = baseUrl + '/gst/' + hash + '/subs/' + ordinal + '.m3u8';
  const root = playlist.slice(0, playlist.lastIndexOf('/') + 1);
  return () => fetchText(playlist, 8000).then(
    (text) => cuesFromPlaylist(text, (url) => fetchText(url, 15000), root),
    () => null,
  );
}

function utf8(u: Uint8Array): string {
  const copy = new Uint8Array(u.length);
  for (let i = 0; i < u.length; i++) copy[i] = u[i];
  return decodeText(copy.buffer);
}

/** Segmented WebVTT from TorrServer's extractor. Null when the body is not a playlist. */
export async function cuesFromPlaylist(text: string, fetchText: (url: string) => Promise<string>, base: string): Promise<Cue[] | null> {
  if (text.indexOf('#EXTM3U') < 0) return null;
  const lines = text.replace(/\r/g, '').split('\n');
  const cues: Cue[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.charAt(0) === '#') continue;
    const url = line.indexOf('://') >= 0 ? line : base + line;
    const body = await fetchText(url);
    const part = parseSubtitles(body, 'vtt');
    for (let k = 0; k < part.length; k++) cues.push(part[k]);
  }
  cues.sort((a, b) => a.start - b.start);
  return cues;
}
