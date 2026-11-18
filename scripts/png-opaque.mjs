// LG Content Store icons must be fully opaque: no transparent corner, no partial alpha.
// The brand tile is #181B22 (assets/icon.svg and --panel). Color type 2 (RGB) has no alpha channel.
import { deflateSync, inflateSync } from 'node:zlib';

export const ICON_BG = { r: 0x18, g: 0x1b, b: 0x22 };

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilter(raw, width, height, bpp) {
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const row = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const x = raw[p++];
      const a = i >= bpp ? row[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = x;
      if (filter === 1) v = (x + a) & 255;
      else if (filter === 2) v = (x + b) & 255;
      else if (filter === 3) v = (x + Math.floor((a + b) / 2)) & 255;
      else if (filter === 4) v = (x + paeth(a, b, c)) & 255;
      else if (filter !== 0) throw new Error('png filter ' + filter);
      row[i] = v;
    }
    row.copy(out, y * stride);
    prev = row;
  }
  return out;
}

/** Decode an 8-bit RGB or RGBA PNG (no interlace) to straight RGBA. */
export function decodePng(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8 || !buf.subarray(0, 8).equals(SIG)) throw new Error('not a png');
  let o = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (o + 8 <= buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('ascii', o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error('interlaced png');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    o += 12 + len;
  }
  if (!width || !height) throw new Error('png without IHDR');
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) throw new Error('unsupported png ' + colorType + '/' + bitDepth);
  const bpp = colorType === 6 ? 4 : 3;
  const raw = unfilter(inflateSync(Buffer.concat(idat)), width, height, bpp);
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0; i < raw.length; i += bpp, j += 4) {
    rgba[j] = raw[i];
    rgba[j + 1] = raw[i + 1];
    rgba[j + 2] = raw[i + 2];
    rgba[j + 3] = bpp === 4 ? raw[i + 3] : 255;
  }
  return { width, height, rgba };
}

/** Composite onto bg and write an 8-bit RGB PNG (no alpha). */
export function flattenToOpaquePng(buf, bg = ICON_BG) {
  const { width, height, rgba } = decodePng(buf);
  const stride = width * 3;
  const raw = Buffer.alloc(height * (1 + stride));
  let transparent = 0;
  for (let y = 0; y < height; y++) {
    const row = y * (1 + stride);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      const a = rgba[s + 3] / 255;
      if (rgba[s + 3] !== 255) transparent++;
      const i = row + 1 + x * 3;
      raw[i] = Math.round(rgba[s] * a + bg.r * (1 - a));
      raw[i + 1] = Math.round(rgba[s + 1] * a + bg.g * (1 - a));
      raw[i + 2] = Math.round(rgba[s + 2] * a + bg.b * (1 - a));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return { png, width, height, transparent };
}

/** How many pixels are not fully opaque. RGB (no alpha) is zero. */
export function transparentPixels(buf) {
  const { width, height, rgba } = decodePng(buf);
  let n = 0;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) n++;
  return { width, height, transparent: n };
}
