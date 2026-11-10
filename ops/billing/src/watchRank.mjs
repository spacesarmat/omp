// Community quality of a release. Pure scoring and Torznab annotation.
// Shared stats store hashes and counters only. The vote key is a sha256, never an account id.
// Cold start is seeds or a DHT estimate. Playback samples blend in as they arrive.
// Order changes only once a release has samples, or an admin pinned or banned it.
// Until then the feed stays byte for byte, so an empty table does not reshuffle search.
import { sha256 } from './crypto.mjs';
import { normalizeInfohash } from './cacheNodes.mjs';

export const BLEND_K = 8;
export const COMMUNITY_SAMPLES = 3;
export const BATCH_MAX = 20;
export const FOLLOW_MIN_WATCH = 5;

const REASONS = { community: true, blend: true, seeds: true, dht: true, pinned: true };
const CODECS = { h264: true, hevc: true, av1: true, hdr: true, dv: true };

export function watchRankEnabled(settings) {
  return !settings || settings.watchRankEnabled !== false;
}

export function deviceClassOf(raw) {
  return raw === 'tv' ? 'tv' : 'phone';
}

/** One vote per account and device. The raw ids never land in a table. */
export function voterHash(accountId, deviceId) {
  const account = String(accountId || '').slice(0, 80);
  const device = String(deviceId || '').slice(0, 80);
  if (!account || !device) return '';
  return sha256(account + '\n' + device);
}

export function clipText(v, max) {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) : s;
}

export function titleKeyOf(title, given) {
  const g = clipText(given, 80).toLowerCase();
  if (g && /^[a-z0-9а-яё .:_-]{2,80}$/i.test(g)) return g;
  let t = clipText(title, 300).toLowerCase().split('/')[0];
  t = t.replace(/\[[^\]]*\]/g, ' ').replace(/\([^)]*\)/g, ' ');
  t = t.replace(/\b(19|20)\d{2}\b/g, ' ');
  t = t.replace(/\b(s\d{1,2}e\d{1,3}|[248]k|2160p|1080p|720p|480p|hdr10\+|hdr|sdr|hevc|x265|x264|h\.?264|h\.?265|avc|aac|ac3|dts)\b/gi, ' ');
  t = t.replace(/\b(web[\s-]?dl|webrip|bluray|blu-ray|bdrip|bdremux|hdrip|hdtv|dvdrip|remux|amzn|dsnp|nf|hmax)\b/gi, ' ');
  t = t.replace(/[^a-z0-9а-яё]+/gi, ' ').trim();
  return t.slice(0, 80);
}

export function episodeOf(title) {
  const m = /(?:^|[^a-z0-9])s(\d{1,2})[\s._-]*e(\d{1,3})(?![a-z0-9])/i.exec(String(title || ''));
  if (!m) return { season: 0, episode: 0 };
  return { season: clampInt(m[1], 0, 80), episode: clampInt(m[2], 0, 5000) };
}

function clampInt(v, min, max) {
  const n = Math.floor(Number(v) || 0);
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function resolution(title) {
  const t = String(title || '').toLowerCase();
  if (/\b(2160p|4k|uhd)\b/.test(t)) return 2160;
  if (/\b1080p\b/.test(t)) return 1080;
  if (/\b720p\b/.test(t)) return 720;
  if (/\b480p\b/.test(t)) return 480;
  return 0;
}

/**
 * TV prefers 4K and HDR when that class actually plays them.
 * Phone prefers 1080p and a compatible codec. A high codec rate gives 4K back some points.
 */
export function deviceFit(title, deviceClass, codecRate) {
  const res = resolution(title);
  const t = String(title || '').toLowerCase();
  const hdr = /\b(hdr10\+|hdr|dolby\s*vision|\bdv\b|dovi)\b/.test(t);
  const hevc = /\b(hevc|x265|h\.?265|av1)\b/.test(t);
  const rate = typeof codecRate === 'number' && isFinite(codecRate) ? codecRate : 0.5;
  if (deviceClass === 'tv') {
    let n = 0;
    if (res >= 2160 && rate >= 0.5) n += 8;
    if (hdr && rate >= 0.5) n += 4;
    if (hevc && rate >= 0.5) n += 2;
    if (rate < 0.4 && (res >= 2160 || hdr)) n -= 10;
    return n;
  }
  let n = 0;
  if (res === 1080) n += 6;
  if (res >= 2160) n -= 6;
  if (hdr) n -= 4;
  if (hevc && res >= 2160) n -= 3;
  if (!hevc && res > 0 && res <= 1080) n += 3;
  if (rate >= 0.8 && res >= 2160) n += 4;
  return n;
}

/** 0..100 from tracker seeds, else a smaller DHT estimate. */
export function coldScore(seeds, dhtSeeds) {
  const s = clampInt(seeds, 0, 1000000);
  const d = clampInt(dhtSeeds, 0, 1000000);
  if (s > 0) return Math.min(100, Math.round(Math.log10(s + 1) * 33));
  if (d > 0) return Math.min(80, Math.round(Math.log10(d + 1) * 25));
  return 0;
}

export function emptyStats() {
  return {
    samples: 0,
    completed: 0,
    switched: 0,
    ttffMs: 0,
    rebufferN: 0,
    rebufferMs: 0,
    watchedSum: 0,
    codecOk: 0,
    codecFail: 0,
  };
}

/** Learned quality 0..100. Null when nobody has reported this release on this device class. */
export function learnedScore(stats, deviceClass, title) {
  if (!stats || !(stats.samples > 0)) return null;
  const n = stats.samples;
  const complete = stats.completed / n;
  const watched = Math.min(100, stats.watchedSum / n) / 100;
  const switched = Math.min(1, stats.switched / n);
  const ttff = stats.ttffMs / n;
  const reb = stats.rebufferN / n;
  const rebMs = stats.rebufferMs / n;
  const codecN = stats.codecOk + stats.codecFail;
  const codec = codecN > 0 ? stats.codecOk / codecN : 0.5;
  let s = complete * 35 + watched * 25 + (1 - switched) * 15 + codec * 10;
  if (ttff <= 0) s += 6;
  else if (ttff < 2000) s += 12;
  else if (ttff < 5000) s += 6;
  else if (ttff < 12000) s += 2;
  if (reb <= 0.2 && rebMs < 1500) s += 8;
  else if (reb < 1) s += 4;
  s += deviceFit(title || '', deviceClass, codec);
  if (s < 0) return 0;
  if (s > 100) return 100;
  return s;
}

/** samples / (samples + K). Zero samples returns the cold score unchanged. */
export function blendScore(learned, cold, samples) {
  const c = clampInt(cold, 0, 100);
  const n = clampInt(samples, 0, 1000000);
  if (learned === null || learned === undefined || n <= 0) return c;
  const w = n / (n + BLEND_K);
  const l = learned < 0 ? 0 : learned > 100 ? 100 : learned;
  return l * w + c * (1 - w);
}

export function voteEffect(vote) {
  const v = vote || {};
  return {
    completed: v.completed ? 1 : 0,
    switched: v.switched ? 1 : 0,
    ttffMs: clampInt(v.ttffMs, 0, 600000),
    rebufferN: clampInt(v.rebufferN !== undefined ? v.rebufferN : v.rebufferCount, 0, 1000),
    rebufferMs: clampInt(v.rebufferMs, 0, 3600000),
    watchedSum: clampInt(v.watchedPct, 0, 100),
    codecOk: v.codecOk === true ? 1 : 0,
    codecFail: v.codecOk === false ? 1 : 0,
  };
}

function addNum(n, d) {
  const x = (Number(n) || 0) + d;
  return x > 0 ? x : 0;
}

/** Apply one vote onto a stats row. A repeat replaces the previous effect and does not add a sample. */
export function applyVote(stats, prev, next) {
  const base = Object.assign(emptyStats(), stats || {});
  if (prev) {
    const old = voteEffect(prev);
    base.completed = addNum(base.completed, -old.completed);
    base.switched = addNum(base.switched, -old.switched);
    base.ttffMs = addNum(base.ttffMs, -old.ttffMs);
    base.rebufferN = addNum(base.rebufferN, -old.rebufferN);
    base.rebufferMs = addNum(base.rebufferMs, -old.rebufferMs);
    base.watchedSum = addNum(base.watchedSum, -old.watchedSum);
    base.codecOk = addNum(base.codecOk, -old.codecOk);
    base.codecFail = addNum(base.codecFail, -old.codecFail);
  } else {
    base.samples = addNum(base.samples, 1);
  }
  const cur = voteEffect(next);
  base.completed = addNum(base.completed, cur.completed);
  base.switched = addNum(base.switched, cur.switched);
  base.ttffMs = addNum(base.ttffMs, cur.ttffMs);
  base.rebufferN = addNum(base.rebufferN, cur.rebufferN);
  base.rebufferMs = addNum(base.rebufferMs, cur.rebufferMs);
  base.watchedSum = addNum(base.watchedSum, cur.watchedSum);
  base.codecOk = addNum(base.codecOk, cur.codecOk);
  base.codecFail = addNum(base.codecFail, cur.codecFail);
  return base;
}

/** Delta from `prev` to `next` for an SQL add. samples is 1 on the first vote and 0 on a replacement. */
export function voteDelta(prev, next) {
  const cur = voteEffect(next);
  if (!prev) return Object.assign({ samples: 1 }, cur);
  const old = voteEffect(prev);
  return {
    samples: 0,
    completed: cur.completed - old.completed,
    switched: cur.switched - old.switched,
    ttffMs: cur.ttffMs - old.ttffMs,
    rebufferN: cur.rebufferN - old.rebufferN,
    rebufferMs: cur.rebufferMs - old.rebufferMs,
    watchedSum: cur.watchedSum - old.watchedSum,
    codecOk: cur.codecOk - old.codecOk,
    codecFail: cur.codecFail - old.codecFail,
  };
}

/** Remove a vote from the device class it was counted on. */
export function removeDelta(prev) {
  const old = voteEffect(prev || {});
  return {
    samples: -1,
    completed: -old.completed,
    switched: -old.switched,
    ttffMs: -old.ttffMs,
    rebufferN: -old.rebufferN,
    rebufferMs: -old.rebufferMs,
    watchedSum: -old.watchedSum,
    codecOk: -old.codecOk,
    codecFail: -old.codecFail,
  };
}

export function scoreOf(stats, cold, deviceClass, title, mod) {
  if (mod && mod.banned) return { score: -1, reason: 'banned', rank: -1, reorder: true };
  const samples = stats && stats.samples > 0 ? stats.samples : 0;
  const learned = samples > 0 ? learnedScore(stats, deviceClass, title) : null;
  const score = blendScore(learned, cold, samples);
  let reason = 'seeds';
  if (samples >= COMMUNITY_SAMPLES) reason = 'community';
  else if (samples > 0) reason = 'blend';
  let rank = Math.round(score * 100);
  let reorder = samples > 0;
  if (mod && mod.pinned) {
    reason = 'pinned';
    rank += 100000;
    reorder = true;
  }
  if (!REASONS[reason]) reason = 'seeds';
  return { score, reason, rank, reorder };
}

function xmlAttr(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function tagText(item, name) {
  const m = new RegExp('<' + name + '\\b[^>]*>([\\s\\S]*?)</' + name + '>', 'i').exec(item);
  if (!m) return '';
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
}

function attrValue(item, name) {
  const re = new RegExp('<[^>]*\\battr\\b[^>]*\\bname="' + name + '"[^>]*\\bvalue="([^"]*)"', 'i');
  const re2 = new RegExp('<[^>]*\\battr\\b[^>]*\\bvalue="([^"]*)"[^>]*\\bname="' + name + '"', 'i');
  const m = re.exec(item) || re2.exec(item);
  return m ? m[1] : '';
}

function hashFrom(item) {
  const direct = normalizeInfohash(attrValue(item, 'infohash'));
  if (direct) return direct;
  const magnet = attrValue(item, 'magneturl') || tagText(item, 'link') || tagText(item, 'guid');
  const m = /btih:([a-f0-9]{40})/i.exec(magnet);
  return m ? m[1].toLowerCase() : '';
}

export function parseFeed(xml) {
  const src = String(xml || '');
  const first = src.search(/<item\b/i);
  const end = src.toLowerCase().lastIndexOf('</item>');
  if (first < 0 || end < 0) return { original: src, items: [], head: src, tail: '' };
  const head = src.slice(0, first);
  const tail = src.slice(end + '</item>'.length);
  const body = src.slice(first, end + '</item>'.length);
  const chunks = body.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || [];
  const items = [];
  for (let i = 0; i < chunks.length && i < 200; i++) {
    const title = clipText(tagText(chunks[i], 'title'), 300);
    const ep = episodeOf(title);
    items.push({
      index: i,
      xml: chunks[i],
      title,
      titleKey: titleKeyOf(title, ''),
      infohash: hashFrom(chunks[i]),
      seeds: clampInt(attrValue(chunks[i], 'seeders'), 0, 1000000),
      dhtSeeds: clampInt(attrValue(chunks[i], 'dhtseeds'), 0, 1000000),
      sizeBytes: clampInt(attrValue(chunks[i], 'size'), 0, 1e15),
      season: ep.season,
      episode: ep.episode,
    });
  }
  return { original: src, items, head, tail, truncated: chunks.length > items.length ? chunks.slice(items.length) : [] };
}

function stripOmp(item) {
  return item
    .replace(/<[^>]*\battr\b[^>]*\bname="omp_(?:rank|reason|voice)"[^>]*\/>/gi, '')
    .replace(/<[^>]*\battr\b[^>]*\bname="omp_(?:rank|reason|voice)"[^>]*>[\s\S]*?<\/[^>]*attr>/gi, '');
}

function annotate(item, fields) {
  let xml = stripOmp(item.xml);
  const bits = [];
  if (fields.reorder) {
    bits.push('<torznab:attr name="omp_rank" value="' + String(fields.rank) + '"/>');
    bits.push('<torznab:attr name="omp_reason" value="' + fields.reason + '"/>');
  }
  if (fields.voice) bits.push('<torznab:attr name="omp_voice" value="' + xmlAttr(fields.voice) + '"/>');
  if (!bits.length) return xml;
  return xml.replace(/<\/item>\s*$/i, bits.join('') + '</item>');
}

/**
 * Annotate and, when any row has samples or a pin, put the best first.
 * Banned rows are removed. No samples and no pins: the original string comes back.
 */
export function renderFeed(parsed, ctx) {
  const stats = (ctx && ctx.stats) || {};
  const mods = (ctx && ctx.mods) || {};
  const voices = (ctx && ctx.voices) || {};
  const deviceClass = deviceClassOf(ctx && ctx.deviceClass);
  const rows = [];
  let changed = false;
  for (let i = 0; i < parsed.items.length; i++) {
    const it = parsed.items[i];
    const mod = it.infohash ? mods[it.infohash] : null;
    if (mod && mod.banned) {
      changed = true;
      continue;
    }
    const st = it.infohash ? stats[it.infohash] : null;
    const probe = it.infohash && ctx && ctx.probes ? ctx.probes[it.infohash] : null;
    const seeds = probe && probe.seeds > it.seeds ? probe.seeds : it.seeds;
    const dht = probe && probe.dhtSeeds > it.dhtSeeds ? probe.dhtSeeds : it.dhtSeeds;
    const cold = coldScore(seeds, dht);
    const scored = scoreOf(st, cold, deviceClass, it.title, mod);
    const voice = voices[it.titleKey] || '';
    if (scored.reorder || voice) changed = true;
    rows.push({
      index: it.index,
      item: it,
      voice,
      reason: scored.reason,
      blend: scored.rank,
      reorder: scored.reorder,
    });
  }
  if (!changed) return { xml: parsed.original, changed: false, rows: parsed.items };
  const anyOrder = rows.some((r) => r.reorder);
  if (anyOrder) rows.sort((a, b) => b.blend - a.blend || a.index - b.index);
  const bodyRows = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    bodyRows.push(annotate(row.item, { reorder: anyOrder, rank: row.blend, reason: row.reason, voice: row.voice }));
  }
  let body = '';
  for (let i = 0; i < bodyRows.length; i++) body += bodyRows[i];
  const rest = parsed.truncated || [];
  for (let i = 0; i < rest.length; i++) body += rest[i];
  return { xml: parsed.head + body + parsed.tail, changed: true, rows };
}

function boolOf(v) {
  return v === true || v === 'true' || v === 1 || v === '1';
}

function codecList(raw) {
  const parts = String(raw || '').toLowerCase().split(/[^a-z0-9+]+/);
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    if (CODECS[parts[i]] && out.indexOf(parts[i]) < 0) out.push(parts[i]);
  }
  return out.slice(0, 5);
}

function oneSignal(raw, deviceClass, codecs) {
  if (!raw || typeof raw !== 'object') return null;
  const infohash = normalizeInfohash(raw.infohash || raw.hash);
  if (!infohash) return null;
  const title = clipText(raw.title, 300);
  const ep = episodeOf(title);
  const season = raw.season !== undefined && raw.season !== '' ? clampInt(raw.season, 0, 80) : ep.season;
  const episode = raw.episode !== undefined && raw.episode !== '' ? clampInt(raw.episode, 0, 5000) : ep.episode;
  let codecOk = null;
  if (raw.codecOk === true || raw.codecOk === false || raw.codecOk === 'true' || raw.codecOk === 'false') codecOk = boolOf(raw.codecOk);
  const watchedPct = clampInt(raw.watchedPct, 0, 100);
  const completed = boolOf(raw.completed) || watchedPct >= 90;
  return {
    infohash,
    fileIndex: clampInt(raw.file !== undefined ? raw.file : raw.fileIndex, 0, 100000),
    title,
    titleKey: titleKeyOf(title, raw.titleKey),
    season,
    episode,
    ttffMs: clampInt(raw.ttffMs, 0, 600000),
    rebufferN: clampInt(raw.rebufferCount !== undefined ? raw.rebufferCount : raw.rebufferN, 0, 1000),
    rebufferMs: clampInt(raw.rebufferMs, 0, 3600000),
    watchedPct,
    completed,
    switched: boolOf(raw.switched),
    voice: clipText(raw.voice, 40),
    codecOk,
    deviceClass,
    codecs,
    follow: watchedPct >= FOLLOW_MIN_WATCH || completed || clampInt(raw.ttffMs, 0, 600000) > 0,
  };
}

/** A batch from the app. `help` false stores nothing. At most 20 rows. */
export function parseSignalBody(body) {
  let src = body && typeof body === 'object' ? body : {};
  if (typeof src.payload === 'string' && src.payload) {
    try {
      const parsed = JSON.parse(src.payload);
      if (parsed && typeof parsed === 'object') {
        if (src.deviceClass && parsed.deviceClass === undefined) parsed.deviceClass = src.deviceClass;
        if (src.help !== undefined && parsed.help === undefined) parsed.help = src.help;
        if (src.codecs && parsed.codecs === undefined) parsed.codecs = src.codecs;
        src = parsed;
      }
    } catch (e) {
      return { ok: false, error: 'bad_request' };
    }
  }
  const help = src.help === undefined ? true : !(src.help === false || src.help === 'false' || src.help === 0 || src.help === '0');
  if (!help) return { ok: true, help: false, items: [] };
  const deviceClass = deviceClassOf(src.deviceClass);
  const codecs = codecList(src.codecs);
  const list = Array.isArray(src.items) ? src.items : [];
  if (list.length > BATCH_MAX) return { ok: false, error: 'bad_request' };
  const items = [];
  for (let i = 0; i < list.length; i++) {
    const row = oneSignal(list[i], deviceClass, codecs);
    if (row) items.push(row);
  }
  return { ok: true, help: true, items };
}

/** Releases the cache job should hear about. Seedless rows stay out: popularity skips them. */
export function releasesToWarm(rows) {
  const out = [];
  const seen = {};
  const list = Array.isArray(rows) ? rows : [];
  for (let i = 0; i < list.length; i++) {
    const row = list[i];
    const infohash = normalizeInfohash(row && row.infohash);
    if (!infohash || seen[infohash]) continue;
    if (!(row.seeds > 0)) continue;
    if (row.banned) continue;
    seen[infohash] = true;
    out.push({
      infohash,
      title: clipText(row.title, 300),
      seeds: clampInt(row.seeds, 0, 1000000),
      sizeBytes: clampInt(row.sizeBytes, 0, 1e15),
    });
  }
  return out;
}
