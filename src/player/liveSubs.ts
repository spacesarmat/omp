import { decodeText, parseAss, parseSubtitles, type Cue } from '../lib/subtitles';
import { parseMkvHead, peekElement, takeElements, type MkvCue, type MkvHead, type MkvPacket, type MkvSubTrack } from '../lib/mkvSubs';
import { PgsDecoder, type PgsBitmap } from '../lib/pgs';

const HEAD = 4 * 1024 * 1024;
const TAIL = 4 * 1024 * 1024;
const CHUNK = 1024 * 1024;
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
  private packetFrom: number[] = [];
  private packetBytes = 0;
  private seen: { [pos: number]: boolean } = {};
  /** Next file offset when a cluster is larger than one read. */
  private rest: { [pos: number]: number } = {};
  private clusterTc: { [pos: number]: number } = {};
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
    const hard = next > cue.cluster ? next - 1 : this.src.size - 1;
    let pos = this.rest[cue.cluster] !== undefined ? this.rest[cue.cluster] : cue.cluster;
    const end = Math.min(hard, pos + CHUNK - 1);
    const buf = end >= pos ? await this.src.read(pos, end) : null;
    this.busy = false;
    if (this.closed || !buf) return;
    const step = takeElements(buf, this.head.scale, this.clusterTc[cue.cluster] || 0);
    // A block bigger than this chunk still has a header here: skip its body without buffering it.
    let advance = step.bytes;
    if (advance <= 0) {
      const el = peekElement(buf, 0);
      if (!el || el.unknown || el.size < 0) {
        this.seen[cue.cluster] = true;
        delete this.rest[cue.cluster];
        delete this.clusterTc[cue.cluster];
        this.publish(time);
        return;
      }
      advance = el.header + el.size;
    }
    for (let i = 0; i < step.packets.length; i++) {
      if (step.packets[i].track !== this.track.number) continue;
      this.packets.push(step.packets[i]);
      this.packetFrom.push(cue.cluster);
      this.packetBytes += step.packets[i].data.length;
    }
    const nextPos = pos + advance;
    if (nextPos > hard) {
      this.seen[cue.cluster] = true;
      delete this.rest[cue.cluster];
      delete this.clusterTc[cue.cluster];
    } else {
      this.rest[cue.cluster] = nextPos;
      this.clusterTc[cue.cluster] = step.clusterTc;
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
    const ordered = this.packets.slice().sort((a, b) => a.start - b.start);
    let nextEvent = 1e9;
    for (let i = 0; i < ordered.length; i++) {
      if (ordered[i].start > time && ordered[i].start < nextEvent) nextEvent = ordered[i].start;
    }
    if (this.bitmap && time >= this.bitmap.start && time < this.bitmap.end && time < nextEvent && this.painted === this.packets.length) return;
    const dec = new PgsDecoder();
    for (let i = 0; i < ordered.length; i++) {
      if (ordered[i].start <= time + 0.001) dec.feed(ordered[i].start, ordered[i].data);
    }
    const frame = dec.bitmapAt(time);
    if (frame && nextEvent < frame.end) frame.end = nextEvent;
    this.bitmap = frame;
    this.painted = this.packets.length;
  }

  private trim(time: number): void {
    if (this.packetBytes <= PACKET_CAP) return;
    const keep = time - 180;
    const next: MkvPacket[] = [];
    const from: number[] = [];
    const still: { [pos: number]: boolean } = {};
    let bytes = 0;
    for (let i = 0; i < this.packets.length; i++) {
      if (this.packets[i].start < keep) continue;
      next.push(this.packets[i]);
      from.push(this.packetFrom[i]);
      still[this.packetFrom[i]] = true;
      bytes += this.packets[i].data.length;
    }
    if (bytes >= this.packetBytes) return;
    for (let i = 0; i < this.packetFrom.length; i++) {
      const c = this.packetFrom[i];
      if (!still[c]) delete this.seen[c];
    }
    this.packets = next;
    this.packetFrom = from;
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

/** Matroska ASS/SSA packets are the event fields, not a full Dialogue line. Times come from the block. */
function assCues(packets: MkvPacket[], priv: Uint8Array): Cue[] {
  const out: Cue[] = [];
  const header = utf8(priv);
  for (let i = 0; i < packets.length; i++) {
    const raw = utf8(packets[i].data).replace(/^\uFEFF/, '').trim();
    if (!raw) continue;
    let text = '';
    if (raw.indexOf('Dialogue:') === 0) {
      const parsed = parseAss(header + '\n' + raw);
      text = parsed.length ? parsed[0].text : '';
    } else text = assFieldText(raw);
    if (!text) continue;
    const end = packets[i].duration > 0 ? packets[i].start + packets[i].duration : packets[i].start + 4;
    out.push({ start: packets[i].start, end: end, text: text });
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

/** Text is the 9th comma-separated field (ReadOrder through Effect). Commas inside the text stay. */
function assFieldText(line: string): string {
  let commas = 0;
  for (let i = 0; i < line.length; i++) {
    if (line.charAt(i) !== ',') continue;
    commas++;
    if (commas === 8) {
      return line.slice(i + 1).replace(/\{[^}]*\}/g, '').replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' ').trim();
    }
  }
  return '';
}

export function textCues(packets: MkvPacket[], codecId: string, priv: Uint8Array): Cue[] {
  const id = (codecId || '').toUpperCase();
  if (id.indexOf('ASS') >= 0 || id.indexOf('SSA') >= 0) return assCues(packets, priv);
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
