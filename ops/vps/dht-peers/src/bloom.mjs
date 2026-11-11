// BEP 33 DHT scrape bloom filters. 256 bytes, two hash functions.
// The estimate is the BEP formula, not a count of get_peers addresses.
// https://www.bittorrent.org/beps/bep_0033.html

export const BLOOM_BYTES = 256;
export const BLOOM_BITS = BLOOM_BYTES * 8;
export const BLOOM_K = 2;
/** A full filter has no finite estimate. Cap it instead of returning Infinity. */
export const BLOOM_CAP = 1000000;
const DECODE_MAX = 8192;
const DECODE_DEPTH = 8;

/** 256-byte filter, or null. A JS string is read as latin1 so binary filters survive. */
export function asBloom(value) {
  if (Buffer.isBuffer(value) && value.length === BLOOM_BYTES) return value;
  if (value instanceof Uint8Array && value.byteLength === BLOOM_BYTES) return Buffer.from(value);
  if (typeof value === 'string' && value.length === BLOOM_BYTES) return Buffer.from(value, 'latin1');
  return null;
}

export function countSetBits(buf) {
  const raw = asBloom(buf);
  if (!raw) return null;
  let n = 0;
  for (let i = 0; i < raw.length; i++) {
    let b = raw[i];
    while (b) {
      n += b & 1;
      b >>>= 1;
    }
  }
  return n;
}

/**
 * BEP 33: size = -m/k * ln(1 - X/m), m = 2048, k = 2, X = bits set.
 * 0 bits is 0. A full filter is BLOOM_CAP. A bad length is null.
 */
export function estimateBloom(buf) {
  const set = countSetBits(buf);
  if (set === null) return null;
  if (set <= 0) return 0;
  if (set >= BLOOM_BITS) return BLOOM_CAP;
  const est = (-BLOOM_BITS / BLOOM_K) * Math.log(1 - set / BLOOM_BITS);
  if (!Number.isFinite(est) || est < 0) return BLOOM_CAP;
  const rounded = Math.round(est);
  if (rounded > BLOOM_CAP) return BLOOM_CAP;
  return rounded;
}

/** Bitwise OR. The first valid filter is copied. A bad buffer is skipped. */
export function mergeBloom(into, next) {
  const add = asBloom(next);
  if (!add) return asBloom(into);
  const base = asBloom(into);
  if (!base) return Buffer.from(add);
  const out = Buffer.from(base);
  for (let i = 0; i < BLOOM_BYTES; i++) out[i] |= add[i];
  return out;
}

/** `BFsd` / `BFpe` on a get_peers response dict (`r`) or on the message itself. */
export function parseScrapeFilters(message) {
  const host = message && message.r && typeof message.r === 'object' ? message.r : message;
  if (!host || typeof host !== 'object') return null;
  const seeds = asBloom(host.BFsd);
  const peers = asBloom(host.BFpe);
  if (!seeds && !peers) return null;
  return { seeds: seeds, peers: peers };
}

/**
 * One bencoded value. Byte strings stay Buffers. Truncated or too-deep input is null.
 * `i` is the index after the value.
 */
export function bdecode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input || []);
  if (buf.length > DECODE_MAX) return null;
  const r = bdecodeAt(buf, 0, 0);
  if (!r || r.i !== buf.length) return null;
  return r.v;
}

function bdecodeAt(buf, i, depth) {
  if (depth > DECODE_DEPTH || i >= buf.length) return null;
  const c = buf[i];
  if (c === 0x69) return bdecodeInt(buf, i);
  if (c === 0x6c) return bdecodeList(buf, i, depth);
  if (c === 0x64) return bdecodeDict(buf, i, depth);
  if (c >= 0x30 && c <= 0x39) return bdecodeBytes(buf, i);
  return null;
}

function bdecodeInt(buf, i) {
  let j = i + 1;
  let neg = false;
  if (buf[j] === 0x2d) {
    neg = true;
    j++;
  }
  const start = j;
  while (j < buf.length && buf[j] >= 0x30 && buf[j] <= 0x39) j++;
  if (j === start || buf[j] !== 0x65) return null;
  if (buf[start] === 0x30 && (j - start > 1 || neg)) return null;
  const text = buf.toString('latin1', i + 1, j);
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  return { v: n, i: j + 1 };
}

function bdecodeBytes(buf, i) {
  let j = i;
  while (j < buf.length && buf[j] >= 0x30 && buf[j] <= 0x39) j++;
  if (j === i || buf[j] !== 0x3a) return null;
  if (buf[i] === 0x30 && j - i > 1) return null;
  const len = Number(buf.toString('latin1', i, j));
  if (!Number.isFinite(len) || len < 0) return null;
  const start = j + 1;
  const end = start + len;
  if (end > buf.length) return null;
  return { v: Buffer.from(buf.subarray(start, end)), i: end };
}

function bdecodeList(buf, i, depth) {
  const out = [];
  let j = i + 1;
  while (j < buf.length && buf[j] !== 0x65) {
    const item = bdecodeAt(buf, j, depth + 1);
    if (!item) return null;
    out.push(item.v);
    j = item.i;
  }
  if (buf[j] !== 0x65) return null;
  return { v: out, i: j + 1 };
}

function bdecodeDict(buf, i, depth) {
  const out = {};
  let j = i + 1;
  while (j < buf.length && buf[j] !== 0x65) {
    const key = bdecodeBytes(buf, j);
    if (!key) return null;
    const val = bdecodeAt(buf, key.i, depth + 1);
    if (!val) return null;
    out[key.v.toString('latin1')] = val.v;
    j = val.i;
  }
  if (buf[j] !== 0x65) return null;
  return { v: out, i: j + 1 };
}

/** Bencoded get_peers reply (or the `r` dict alone) -> bloom filters. */
export function decodeScrape(input) {
  let v;
  try {
    v = bdecode(input);
  } catch (e) {
    return null;
  }
  if (!v || typeof v !== 'object' || Buffer.isBuffer(v) || Array.isArray(v)) return null;
  if (v.r && typeof v.r === 'object') return parseScrapeFilters({ r: v.r });
  return parseScrapeFilters(v);
}
