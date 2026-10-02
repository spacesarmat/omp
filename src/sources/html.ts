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

/** '1.37 GB', '1,37 ГБ', '700 MB', '1.2 TiB' → bytes (powers of 1024); null when not a size. */
export function parseSize(s: string | null | undefined): number | null {
  const m = /^\s*(\d[\d ]*(?:[.,]\d+)?)\s*([^\s\d]+)/.exec((s || '').replace(/ /g, ' '));
  if (!m) return null;
  const unit = m[2].toLowerCase();
  if (!UNIT.test(unit)) return null;
  const n = parseFloat(m[1].replace(/ /g, '').replace(',', '.'));
  if (!isFinite(n)) return null;
  const p = POWERS[unit.charAt(0)] || 0;
  return Math.round(n * Math.pow(1024, p));
}

const MONTHS: { [prefix: string]: number } = {
  янв: 0, фев: 1, мар: 2, апр: 3, май: 4, мая: 4, июн: 5, июл: 6, авг: 7, сен: 8, окт: 9, ноя: 10, дек: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function year(y: string): number {
  const n = parseInt(y, 10);
  return y.length <= 2 ? 2000 + n : n;
}

function local(y: number, mo: number, d: number, h: number, mi: number, s: number): number | undefined {
  if (mo < 0 || mo > 11 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return undefined;
  return new Date(y, mo, d, h, mi, s).getTime();
}

function num(v: string | undefined): number {
  return v ? parseInt(v, 10) : 0;
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[t ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?\s*(z|[+-]\d{2}:?\d{2})?$/;
const DOTTED = /^(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})(?:[ ,]+(?:в )?(\d{1,2}):(\d{2}))?/;
const RELATIVE = /^(сегодня|вчера)(?:,? *(?:в )?(\d{1,2}):(\d{2}))?/;
const NAMED = /^(\d{1,2})[ -]+([a-zа-яё]+)\.?[ -]+(\d{4}|\d{2})(?:[ ,]+(?:в )?(\d{1,2}):(\d{2}))?/;

/**
 * Tracker dates → unix ms: «03 окт 26», «3 Окт 2026», «3-Окт-26», «12 мая 2025 14:05», «сегодня в 21:40»,
 * «вчера в 08:05», «03.10.2026 [21:40]», ISO. Without a zone the time is local. undefined when unknown.
 */
export function parseDate(s: string | null | undefined, now?: number): number | undefined {
  const t = (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!t) return undefined;
  let m = ISO.exec(t);
  if (m) {
    const y = num(m[1]);
    const mo = num(m[2]) - 1;
    const d = num(m[3]);
    const h = num(m[4]);
    const mi = num(m[5]);
    const sec = num(m[6]);
    if (!m[7]) return local(y, mo, d, h, mi, sec);
    if (local(y, mo, d, h, mi, sec) === undefined) return undefined;
    let offset = 0;
    if (m[7] !== 'z') {
      const z = m[7].replace(':', '');
      offset = (num(z.slice(1, 3)) * 60 + num(z.slice(3, 5))) * (z.charAt(0) === '-' ? -1 : 1);
    }
    return Date.UTC(y, mo, d, h, mi, sec) - offset * 60000;
  }
  m = DOTTED.exec(t);
  if (m) return local(year(m[3]), num(m[2]) - 1, num(m[1]), num(m[4]), num(m[5]), 0);
  m = RELATIVE.exec(t);
  if (m) {
    const base = new Date(now === undefined ? Date.now() : now);
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - (m[1] === 'вчера' ? 1 : 0));
    return local(d.getFullYear(), d.getMonth(), d.getDate(), num(m[2]), num(m[3]), 0);
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
