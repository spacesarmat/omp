/** Blu-ray PGS (HDMV) segments to one bitmap. Keeps the latest object, not every line of the film. */

export interface PgsBitmap {
  /** Seconds. */
  start: number;
  end: number;
  videoW: number;
  videoH: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rgba: Uint8Array;
}

interface Obj {
  w: number;
  h: number;
  indices: Uint8Array;
}

interface CompObj {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  cropX: number;
  cropY: number;
  cropped: boolean;
}

const EMPTY = new Uint8Array(0);

export class PgsDecoder {
  private pal: Uint8Array = new Uint8Array(256 * 4);
  private objs: { [id: number]: Obj } = {};
  private comp: CompObj[] = [];
  private videoW = 0;
  private videoH = 0;
  private showStart = 0;
  private showEnd = 0;
  private visible = false;
  private pending: Uint8Array = EMPTY;
  private pendingId = -1;
  private frags = 0;
  private indexBytes = 0;

  reset(): void {
    this.pal = new Uint8Array(256 * 4);
    this.objs = {};
    this.comp = [];
    this.visible = false;
    this.pending = EMPTY;
    this.pendingId = -1;
    this.frags = 0;
    this.indexBytes = 0;
  }

  /** `start` is seconds. `data` is one or more PGS segments (type, u16 length, payload). */
  feed(start: number, data: Uint8Array): void {
    let i = 0;
    while (i + 3 <= data.length) {
      const type = data[i];
      const len = (data[i + 1] << 8) | data[i + 2];
      const from = i + 3;
      const to = from + len;
      if (to > data.length) break;
      this.segment(type, data.subarray(from, to), start);
      i = to;
    }
  }

  bitmapAt(time: number): PgsBitmap | null {
    if (!this.visible || time < this.showStart || time >= this.showEnd) return null;
    return this.paint(this.showStart, this.showEnd);
  }

  private segment(type: number, p: Uint8Array, start: number): void {
    if (type === 0x14) this.palette(p);
    else if (type === 0x15) this.object(p);
    else if (type === 0x16) this.composition(p, start);
    else if (type === 0x80) this.end(start);
  }

  private palette(p: Uint8Array): void {
    let i = 2;
    while (i + 5 <= p.length) {
      const id = p[i];
      const y = p[i + 1];
      const cr = p[i + 2];
      const cb = p[i + 3];
      const a = p[i + 4];
      const px = ycc(y, cb, cr, a);
      const o = id * 4;
      this.pal[o] = px[0];
      this.pal[o + 1] = px[1];
      this.pal[o + 2] = px[2];
      this.pal[o + 3] = px[3];
      i += 5;
    }
  }

  private object(p: Uint8Array): void {
    if (p.length < 4) return;
    const id = (p[0] << 8) | p[1];
    const seq = p[3];
    const first = (seq & 0x80) !== 0;
    const last = (seq & 0x40) !== 0;
    // First segment: id, version, sequence, 3-byte length, width, height, then pixels (11 bytes).
    // A continuation has only id, version and sequence (4 bytes) before the pixels.
    const raw = p.subarray(first ? 11 : 4);
    if (first) {
      if (p.length < 11) return;
      const w = (p[7] << 8) | p[8];
      const h = (p[9] << 8) | p[10];
      if (!(w > 0) || !(h > 0) || w * h > PGS_MAX_PIXELS || raw.length > PGS_MAX_PIXELS) {
        this.dropPending();
        return;
      }
      const prev = this.objs[id];
      if (prev) this.indexBytes -= prev.indices.length;
      this.pendingId = id;
      this.pending = raw;
      this.frags = 1;
      this.objs[id] = { w: w, h: h, indices: EMPTY };
    } else if (this.pendingId === id) {
      this.frags++;
      if (this.frags > PGS_MAX_FRAGMENTS || this.pending.length + raw.length > PGS_MAX_PIXELS) {
        this.dropPending();
        return;
      }
      const joined = new Uint8Array(this.pending.length + raw.length);
      joined.set(this.pending, 0);
      joined.set(raw, this.pending.length);
      this.pending = joined;
    }
    if (!last || this.pendingId !== id || !this.objs[id]) return;
    const o = this.objs[id];
    const indices = rle(this.pending, o.w, o.h);
    const nextBytes = this.indexBytes - o.indices.length + indices.length;
    if (indices.length && nextBytes <= PGS_MAX_PIXELS) {
      this.indexBytes = nextBytes;
      o.indices = indices;
    }
    this.dropPending();
  }

  private dropPending(): void {
    this.pending = EMPTY;
    this.pendingId = -1;
    this.frags = 0;
  }

  private composition(p: Uint8Array, start: number): void {
    if (p.length < 11) return;
    this.videoW = (p[0] << 8) | p[1];
    this.videoH = (p[2] << 8) | p[3];
    const state = p[7];
    if (state === 0x80) {
      this.objs = {};
      this.dropPending();
      this.indexBytes = 0;
    }
    const n = p[10];
    const list: CompObj[] = [];
    let i = 11;
    for (let k = 0; k < n; k++) {
      if (i + 8 > p.length) break;
      const id = (p[i] << 8) | p[i + 1];
      const flags = p[i + 3];
      const cropped = (flags & 0x80) !== 0;
      const x = (p[i + 4] << 8) | p[i + 5];
      const y = (p[i + 6] << 8) | p[i + 7];
      let w = 0;
      let h = 0;
      let cropX = 0;
      let cropY = 0;
      i += 8;
      if (cropped) {
        if (i + 8 > p.length) break;
        cropX = (p[i] << 8) | p[i + 1];
        cropY = (p[i + 2] << 8) | p[i + 3];
        w = (p[i + 4] << 8) | p[i + 5];
        h = (p[i + 6] << 8) | p[i + 7];
        i += 8;
      }
      list.push({ id: id, x: x, y: y, w: w, h: h, cropX: cropX, cropY: cropY, cropped: cropped });
    }
    this.comp = list;
    if (!list.length) {
      this.visible = false;
      this.showEnd = start;
      return;
    }
    this.showStart = start;
    this.showEnd = 1e9;
  }

  private end(start: number): void {
    if (!this.comp.length) {
      this.visible = false;
      this.showEnd = start;
      return;
    }
    this.visible = true;
    if (!this.showStart) this.showStart = start;
    if (this.showEnd <= this.showStart) this.showEnd = 1e9;
  }

  private paint(start: number, end: number): PgsBitmap | null {
    let minX = 0;
    let minY = 0;
    let maxX = 0;
    let maxY = 0;
    let any = false;
    for (let i = 0; i < this.comp.length; i++) {
      const c = this.comp[i];
      const o = this.objs[c.id];
      if (!o || !o.indices.length) continue;
      const w = c.cropped ? c.w : o.w;
      const h = c.cropped ? c.h : o.h;
      if (!any) {
        minX = c.x;
        minY = c.y;
        maxX = c.x + w;
        maxY = c.y + h;
        any = true;
      } else {
        if (c.x < minX) minX = c.x;
        if (c.y < minY) minY = c.y;
        if (c.x + w > maxX) maxX = c.x + w;
        if (c.y + h > maxY) maxY = c.y + h;
      }
    }
    if (!any || maxX <= minX || maxY <= minY) return null;
    const w = maxX - minX;
    const h = maxY - minY;
    if (w * h > 1920 * 1080) return null;
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < this.comp.length; i++) {
      const c = this.comp[i];
      const o = this.objs[c.id];
      if (!o || !o.indices.length) continue;
      const sw = c.cropped ? c.w : o.w;
      const sh = c.cropped ? c.h : o.h;
      const sx0 = c.cropped ? c.cropX : 0;
      const sy0 = c.cropped ? c.cropY : 0;
      for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
          const si = (sy0 + y) * o.w + (sx0 + x);
          if (si < 0 || si >= o.indices.length) continue;
          const id = o.indices[si];
          const a = this.pal[id * 4 + 3];
          if (!a) continue;
          const dx = c.x + x - minX;
          const dy = c.y + y - minY;
          if (dx < 0 || dy < 0 || dx >= w || dy >= h) continue;
          const di = (dy * w + dx) * 4;
          rgba[di] = this.pal[id * 4];
          rgba[di + 1] = this.pal[id * 4 + 1];
          rgba[di + 2] = this.pal[id * 4 + 2];
          rgba[di + 3] = a;
        }
      }
    }
    return { start: start, end: end, videoW: this.videoW || w, videoH: this.videoH || h, x: minX, y: minY, w: w, h: h, rgba: rgba };
  }
}

function ycc(y: number, cb: number, cr: number, a: number): number[] {
  const C = y - 16;
  const D = cb - 128;
  const E = cr - 128;
  return [clamp((298 * C + 409 * E + 128) >> 8), clamp((298 * C - 100 * D - 208 * E + 128) >> 8), clamp((298 * C + 516 * D + 128) >> 8), a];
}

function clamp(n: number): number {
  if (n < 0) return 0;
  if (n > 255) return 255;
  return n;
}

/** One decoded object. A 4K frame is the ceiling; a declared 65535 square is rejected before allocation. */
export const PGS_MAX_PIXELS = 3840 * 2160;
/** One object is a handful of fragments. More than this is not a subtitle. */
export const PGS_MAX_FRAGMENTS = 32;

/** PGS RLE to palette indices, row by row. Empty when the declared size is not a real subtitle. */
export function rle(src: Uint8Array, w: number, h: number): Uint8Array {
  if (!(w > 0) || !(h > 0) || w * h > PGS_MAX_PIXELS) return new Uint8Array(0);
  const out = new Uint8Array(w * h);
  let i = 0;
  let x = 0;
  let y = 0;
  while (i < src.length && y < h) {
    const color = src[i++];
    if (color) {
      if (x < w) out[y * w + x] = color;
      x++;
      continue;
    }
    if (i >= src.length) break;
    const flags = src[i++];
    if (!flags) {
      x = 0;
      y++;
      continue;
    }
    let len = flags & 0x3f;
    if (flags & 0x40) {
      if (i >= src.length) break;
      len = (len << 8) | src[i++];
    }
    let run = 0;
    if (flags & 0x80) {
      if (i >= src.length) break;
      run = src[i++];
    }
    for (let k = 0; k < len && x < w; k++, x++) out[y * w + x] = run;
  }
  return out;
}
