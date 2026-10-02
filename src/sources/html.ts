// Helpers for tracker parsers: HTML, links, sizes, dates, infohashes. Chromium 53 safe.

export function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

/** Text of an element with whitespace collapsed; '' for null. */
export function textOf(el: Element | null | undefined): string {
  if (!el) return '';
  return (el.textContent || '').replace(/\s+/g, ' ').trim();
}

/** Absolute URL of `href` on the page `base`; '' for an empty href. */
export function absUrl(href: string | null | undefined, base: string): string {
  const h = (href || '').trim();
  if (!h) return '';
  try {
    return new URL(h, base).href;
  } catch (e) {
    return h;
  }
}

const UNIT = /^(b|bytes?|б|байт|байта|байтов|[kmgtкмгт](ib|b|б|иб)?)$/;
const POWERS: { [first: string]: number } = { k: 1, к: 1, m: 2, м: 2, g: 3, г: 3, t: 4, т: 4 };

/** '1 234,5' / '1,234.5' / '1.234,5' / '1,37' → number: the last separator followed by digits is the decimal one. */
function parseNumber(raw: string): number {
  const s = raw.replace(/ /g, '');
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let out = s;
  if (lastDot >= 0 && lastComma >= 0) {
    out = lastDot > lastComma ? s.replace(/,/g, '') : s.replace(/\./g, '').replace(',', '.');
  } else if (lastComma >= 0) {
    out = s.split(',').length > 2 ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (s.split('.').length > 2) {
    out = s.replace(/\./g, '');
  }
  return parseFloat(out);
}

/** '1.37 GB', '1,37 ГБ', '700 MB', '1.2 TiB' → bytes (powers of 1024); null when not a size. */
export function parseSize(s: string | null | undefined): number | null {
  const m = /^\s*(\d(?:[\d ,.]*\d)?)\s*([^\s\d]+)/.exec((s || '').replace(/ /g, ' '));
  if (!m) return null;
  // trailing punctuation of the surrounding text: '1.37 GB)', '700 MB,'
  const unit = m[2].toLowerCase().replace(/[^a-zа-яё]+$/, '');
  if (!UNIT.test(unit)) return null;
  const n = parseNumber(m[1]);
  if (!isFinite(n)) return null;
  const p = POWERS[unit.charAt(0)] || 0;
  return Math.round(n * Math.pow(1024, p));
}

const MONTHS: { [prefix: string]: number } = {
  янв: 0, фев: 1, мар: 2, апр: 3, май: 4, мая: 4, июн: 5, июл: 6, авг: 7, сен: 8, окт: 9, ноя: 10, дек: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const MIN_YEAR = 1990;

function year(y: string): number {
  const n = parseInt(y, 10);
  return y.length <= 2 ? 2000 + n : n;
}

/** A real calendar date and time (no rollover: 31.02 is invalid), not a zero/placeholder year. */
function valid(y: number, mo: number, d: number, h: number, mi: number, s: number): boolean {
  if (y < MIN_YEAR || y > 9999 || mo < 0 || mo > 11 || d < 1 || h > 23 || mi > 59 || s > 59) return false;
  return new Date(Date.UTC(y, mo, d)).getUTCDate() === d;
}

function local(y: number, mo: number, d: number, h: number, mi: number, s: number): number | undefined {
  if (!valid(y, mo, d, h, mi, s)) return undefined;
  return new Date(y, mo, d, h, mi, s).getTime();
}

/** With a zone offset in minutes east of UTC. */
function zoned(y: number, mo: number, d: number, h: number, mi: number, s: number, offsetMin: number): number | undefined {
  if (!valid(y, mo, d, h, mi, s)) return undefined;
  return Date.UTC(y, mo, d, h, mi, s) - offsetMin * 60000;
}

/** 'z' / 'gmt' / '+03:00' / '-0500' → minutes east of UTC. */
function zoneOffset(z: string): number {
  if (z === 'z' || z === 'gmt' || z === 'ut' || z === 'utc') return 0;
  const v = z.replace(':', '');
  return (num(v.slice(1, 3)) * 60 + num(v.slice(3, 5))) * (v.charAt(0) === '-' ? -1 : 1);
}

function num(v: string | undefined): number {
  return v ? parseInt(v, 10) : 0;
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[t ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?\s*(z|[+-]\d{2}:?\d{2})?$/;
const DOTTED = /^(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})(?:[ ,]+(?:в )?(\d{1,2}):(\d{2}))?/;
const RELATIVE = /^(сегодня|вчера)(?:,? *(?:в )?(\d{1,2}):(\d{2}))?/;
const RFC822 = /^(?:[a-z]{3}, ?)?(\d{1,2}) ([a-z]{3}) (\d{4}) (\d{1,2}):(\d{2})(?::(\d{2}))?(?: (gmt|ut|utc|z|[+-]\d{4}))?$/;
const NAMED = /^(\d{1,2})[ -]+([a-zа-яё]+)\.?[ -]+(\d{4}|\d{2})(?:[ ,]+(?:в )?(\d{1,2}):(\d{2}))?/;

/**
 * Tracker dates → unix ms: «03 окт 26», «3 Окт 2026», «3-Окт-26», «12 мая 2025 14:05», «сегодня в 21:40»,
 * «вчера в 08:05», «03.10.2026 [21:40]», ISO, RFC 822 («Fri, 03 Oct 2026 10:00:00 +0300»). Without a zone the
 * time is local. undefined when unknown, impossible (31.02) or a placeholder year (0001-01-01).
 */
export function parseDate(s: string | null | undefined, now?: number): number | undefined {
  const t = (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!t) return undefined;
  let m = ISO.exec(t);
  if (m) {
    const parts: [number, number, number, number, number, number] = [num(m[1]), num(m[2]) - 1, num(m[3]), num(m[4]), num(m[5]), num(m[6])];
    if (!m[7]) return local(parts[0], parts[1], parts[2], parts[3], parts[4], parts[5]);
    return zoned(parts[0], parts[1], parts[2], parts[3], parts[4], parts[5], zoneOffset(m[7]));
  }
  m = DOTTED.exec(t);
  if (m) return local(year(m[3]), num(m[2]) - 1, num(m[1]), num(m[4]), num(m[5]), 0);
  m = RELATIVE.exec(t);
  if (m) {
    const base = new Date(now === undefined ? Date.now() : now);
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - (m[1] === 'вчера' ? 1 : 0));
    return local(d.getFullYear(), d.getMonth(), d.getDate(), num(m[2]), num(m[3]), 0);
  }
  m = RFC822.exec(t);
  if (m && MONTHS[m[2]] !== undefined) {
    const mo = MONTHS[m[2]];
    if (!m[7]) return local(num(m[3]), mo, num(m[1]), num(m[4]), num(m[5]), num(m[6]));
    return zoned(num(m[3]), mo, num(m[1]), num(m[4]), num(m[5]), num(m[6]), zoneOffset(m[7]));
  }
  m = NAMED.exec(t);
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3)];
    if (mo === undefined) return undefined;
    return local(year(m[3]), mo, num(m[1]), num(m[4]), num(m[5]), 0);
  }
  return undefined;
}

const B32 = 'abcdefghijklmnopqrstuvwxyz234567';

function base32ToHex(s: string): string | undefined {
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const v = B32.indexOf(s.charAt(i));
    if (v < 0) return undefined;
    value = ((value << 5) | v) & 0xfff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      const byte = (value >> bits) & 0xff;
      out += (byte < 16 ? '0' : '') + byte.toString(16);
    }
  }
  return out.length === 40 ? out : undefined;
}

/** Lowercase 40-hex infohash of a magnet link (hex or base32 btih); undefined otherwise. */
export function infohashFromMagnet(magnet: string | null | undefined): string | undefined {
  const m = /[?&]xt=urn:btih:([0-9a-z]+)/i.exec(magnet || '');
  if (!m) return undefined;
  const h = m[1].toLowerCase();
  if (h.length === 40 && /^[0-9a-f]+$/.test(h)) return h;
  if (h.length === 32) return base32ToHex(h);
  return undefined;
}
