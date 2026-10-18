// Live seeders for a search row: parse a tracker scrape, remember it, and ask only for rows still on screen.
// The request itself runs on this device (phone, Android TV, webOS). Nothing is sent to the VPS.
// Chromium 53 safe: no Object.values/entries, no AbortController, no regex u flag.
import { tp } from '../i18n';
import { infohashFromMagnet } from './html';
import { seedsText } from './view';

export const LIVE_SEED_TTL_MS = 10 * 60 * 1000;
export const SCRAPE_TIMEOUT_MS = 3000;
export const SCRAPE_CONCURRENCY = 4;
/** New tracker requests allowed inside SCRAPE_WINDOW_MS. A fast scroll cannot open more than this. */
export const SCRAPE_MAX_STARTS = 8;
export const SCRAPE_WINDOW_MS = 2000;
export const SCRAPE_MAX_TRACKERS = 6;

const DISK_KEY = 'tsp.liveSeeds';
const DISK_MAX = 120;
const MEM_MAX = 400;

export interface ScrapeCounts {
  seeders: number;
  leechers: number;
}

export interface TrackerTarget {
  kind: 'http' | 'udp';
  /** HTTP(S) scrape URL including info_hash, or udp://host:port. */
  url: string;
  host: string;
  port: number;
}

/** One tracker request. cancel() drops it; the promise still settles (null when cancelled). */
export interface ScrapeHandle<T> {
  promise: Promise<T>;
  cancel: () => void;
}

export interface ScrapeTransport {
  http(url: string, timeoutMs: number): ScrapeHandle<string | null>;
  udp(host: string, port: number, infohash: string, timeoutMs: number): ScrapeHandle<ScrapeCounts | null>;
}

export function noopTransport(): ScrapeTransport {
  return {
    http: () => ({ promise: Promise.resolve(null), cancel() {} }),
    udp: () => ({ promise: Promise.resolve(null), cancel() {} }),
  };
}

export type BVal = number | string | BVal[] | { [k: string]: BVal };

/** Bencode value, or null when the input is truncated or not valid bencode. The whole input must be one value. */
export function bdecode(input: string): BVal | null {
  const r = bdecodeAt(input, 0);
  if (!r || r.i !== input.length) return null;
  return r.v;
}

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
  return { v: s.substring(start, end), i: end };
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

/** 20 raw bytes of a 40-hex infohash, or null. */
export function infohashBytes(hex: string): string | null {
  const h = (hex || '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(h)) return null;
  let s = '';
  for (let i = 0; i < 40; i += 2) s += String.fromCharCode(parseInt(h.substr(i, 2), 16));
  return s;
}

/** Percent-encoding of the 20 infohash bytes (every byte, uppercase hex). */
export function encodeInfohash(hex: string): string | null {
  const b = infohashBytes(hex);
  if (b === null) return null;
  let out = '';
  for (let i = 0; i < b.length; i++) {
    const hexb = b.charCodeAt(i).toString(16).toUpperCase();
    out += '%' + (hexb.length < 2 ? '0' : '') + hexb;
  }
  return out;
}

/**
 * HTTP(S) scrape URL (BEP 48): the first "announce" in the path becomes "scrape", the query is kept
 * (a passkey), and info_hash is the raw 20 bytes. Null for UDP and for URLs with no announce segment.
 */
export function httpScrapeUrl(announce: string, infohashHex: string): string | null {
  const enc = encodeInfohash(infohashHex);
  if (!enc) return null;
  let u: URL;
  try {
    u = new URL(announce);
  } catch (e) {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username) return null;
  if (!/announce/i.test(u.pathname)) return null;
  const path = u.pathname.replace(/announce/i, 'scrape');
  const q = u.search ? u.search + '&' : '?';
  return u.origin + path + q + 'info_hash=' + enc;
}

export function parseUdpTracker(raw: string): { host: string; port: number } | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch (e) {
    return null;
  }
  if (u.protocol !== 'udp:') return null;
  const host = u.hostname;
  if (!host) return null;
  const port = u.port ? parseInt(u.port, 10) : 6969;
  if (!port || port < 1 || port > 65535) return null;
  return { host: host, port: port };
}

/** Trackers named by a magnet (`tr=`), HTTP scrape URLs and UDP endpoints, de-duplicated, capped. */
export function trackerTargets(magnet: string, infohash: string, max?: number): TrackerTarget[] {
  const cap = max === undefined ? SCRAPE_MAX_TRACKERS : max;
  const out: TrackerTarget[] = [];
  const seen: { [k: string]: boolean } = {};
  const re = /[?&]tr=([^&]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(magnet || '')) && out.length < cap) {
    let raw = m[1];
    try {
      raw = decodeURIComponent(raw.replace(/\+/g, '%20'));
    } catch (e) {
      continue;
    }
    const http = httpScrapeUrl(raw, infohash);
    if (http) {
      let u: URL;
      try {
        u = new URL(http);
      } catch (e) {
        continue;
      }
      if (seen['h:' + http]) continue;
      seen['h:' + http] = true;
      out.push({
        kind: 'http',
        url: http,
        host: u.hostname,
        port: u.port ? parseInt(u.port, 10) : u.protocol === 'https:' ? 443 : 80,
      });
      continue;
    }
    const udp = parseUdpTracker(raw);
    if (!udp) continue;
    const key = 'u:' + udp.host + ':' + udp.port;
    if (seen[key]) continue;
    seen[key] = true;
    out.push({ kind: 'udp', url: 'udp://' + (udp.host.indexOf(':') >= 0 ? '[' + udp.host + ']' : udp.host) + ':' + udp.port, host: udp.host, port: udp.port });
  }
  return out;
}

/** Lowercase 40-hex infohash from the row, or '' when the row has none. */
export function infohashOf(r: { hash?: string; Hash?: string; Magnet?: string }): string {
  const h = (r.hash || r.Hash || '').toLowerCase();
  if (/^[0-9a-f]{40}$/.test(h)) return h;
  return infohashFromMagnet(r.Magnet) || '';
}

/**
 * Seeders (`complete`) and leechers (`incomplete`) for this infohash. A scrape dict with a single file entry is
 * accepted even when its key does not match (one hash was requested). Failure dicts and junk are null.
 */
export function parseHttpScrape(body: string, infohashHex: string): ScrapeCounts | null {
  const v = bdecode(body);
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const files = (v as { [k: string]: BVal })['files'];
  if (!files || typeof files !== 'object' || Array.isArray(files)) return null;
  const map = files as { [k: string]: BVal };
  const key = infohashBytes(infohashHex);
  let entry: BVal | undefined;
  if (key !== null && Object.prototype.hasOwnProperty.call(map, key)) entry = map[key];
  if (entry === undefined) {
    const keys = Object.keys(map);
    if (keys.length === 1) entry = map[keys[0]];
  }
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const e = entry as { [k: string]: BVal };
  const seeders = e['complete'];
  const leechers = e['incomplete'];
  if (typeof seeders !== 'number' || typeof leechers !== 'number') return null;
  if (seeders < 0 || leechers < 0 || seeders !== Math.floor(seeders) || leechers !== Math.floor(leechers)) return null;
  return { seeders: seeders, leechers: leechers };
}

/**
 * Max seeders across trackers that answered, with the leechers from that same tracker (a tie keeps the higher
 * leecher count). No answers: the numbers that came with the search, and live false.
 */
export function mergeScrape(originalSeed: number, originalLeechers: number, answers: ScrapeCounts[]): { seeders: number; leechers: number; live: boolean } {
  const seed0 = originalSeed > 0 ? originalSeed : 0;
  const leech0 = originalLeechers > 0 ? originalLeechers : 0;
  if (!answers.length) return { seeders: seed0, leechers: leech0, live: false };
  let best = answers[0];
  for (let i = 1; i < answers.length; i++) {
    const a = answers[i];
    if (a.seeders > best.seeders || (a.seeders === best.seeders && a.leechers > best.leechers)) best = a;
  }
  return { seeders: best.seeders, leechers: best.leechers, live: true };
}

export interface LiveSeedEntry {
  seeders: number;
  leechers: number;
  /** False: every tracker we asked failed. The search numbers stay on screen, marked approximate. */
  live: boolean;
  at: number;
}

export interface StringStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

/** Memory cache plus a small persisted list of successful scrapes. Failures stay in memory only. */
export class LiveSeedCache {
  private mem: { [hash: string]: LiveSeedEntry } = {};
  private loaded = false;

  constructor(private store: StringStore | null, private now: () => number, private ttlMs: number) {}

  get(hash: string): LiveSeedEntry | null {
    this.load();
    const e = this.mem[hash];
    if (!e) return null;
    if (this.now() - e.at >= this.ttlMs) {
      delete this.mem[hash];
      if (e.live) this.persist();
      return null;
    }
    return e;
  }

  put(hash: string, entry: LiveSeedEntry): void {
    this.load();
    this.mem[hash] = entry;
    this.trim();
    if (entry.live) this.persist();
  }

  private trim(): void {
    const keys = Object.keys(this.mem);
    if (keys.length <= MEM_MAX) return;
    keys.sort((a, b) => this.mem[a].at - this.mem[b].at);
    const drop = keys.length - MEM_MAX;
    for (let i = 0; i < drop; i++) delete this.mem[keys[i]];
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.store) return;
    let raw: string | null = null;
    try {
      raw = this.store.get(DISK_KEY);
    } catch (e) {
      return;
    }
    if (!raw) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return;
    }
    if (!parsed || typeof parsed !== 'object') return;
    const items = (parsed as { items?: unknown }).items;
    if (!Array.isArray(items)) return;
    for (let i = 0; i < items.length; i++) {
      const it = items[i] as { h?: unknown; s?: unknown; l?: unknown; t?: unknown };
      if (typeof it.h !== 'string' || !/^[0-9a-f]{40}$/.test(it.h)) continue;
      if (typeof it.s !== 'number' || typeof it.l !== 'number' || typeof it.t !== 'number') continue;
      if (this.now() - it.t >= this.ttlMs) continue;
      this.mem[it.h] = { seeders: it.s, leechers: it.l, live: true, at: it.t };
    }
  }

  private persist(): void {
    if (!this.store) return;
    const now = this.now();
    const keys = Object.keys(this.mem).filter((h) => this.mem[h].live && now - this.mem[h].at < this.ttlMs);
    keys.sort((a, b) => this.mem[b].at - this.mem[a].at);
    const items: { h: string; s: number; l: number; t: number }[] = [];
    const n = keys.length < DISK_MAX ? keys.length : DISK_MAX;
    for (let i = 0; i < n; i++) {
      const e = this.mem[keys[i]];
      items.push({ h: keys[i], s: e.seeders, l: e.leechers, t: e.at });
    }
    try {
      this.store.set(DISK_KEY, JSON.stringify({ v: 1, items: items }));
    } catch (e) {
      // storage full: the memory cache still answers
    }
  }
}

export type SeedMode = 'off' | 'search' | 'live' | 'approx';

export interface SeedDisplay {
  mode: SeedMode;
  seeders: number;
  leechers: number;
}

/** What a row shows. Sort order is not derived from this: the list keeps the order of the search. */
export function seedDisplay(r: { Seed: number; Peer: number }, enabled: boolean, entry: LiveSeedEntry | null): SeedDisplay {
  if (!enabled) return { mode: 'off', seeders: r.Seed || 0, leechers: r.Peer || 0 };
  if (!entry) return { mode: 'search', seeders: r.Seed || 0, leechers: r.Peer || 0 };
  if (!entry.live) return { mode: 'approx', seeders: r.Seed || 0, leechers: r.Peer || 0 };
  return { mode: 'live', seeders: entry.seeders, leechers: entry.leechers };
}

/** Phone line built from plural keys: live "N seeds · M leechers", approximate "~N seeds", empty when search had no count. */
export function phoneSeedBits(view: SeedDisplay): { text: string; mode: SeedMode } {
  if (view.mode === 'live') return { text: seedsText(view.seeders) + ' · ' + tp('sources.leechers', view.leechers), mode: 'live' };
  if (view.mode === 'approx') return { text: view.seeders > 0 ? '~' + seedsText(view.seeders) : '', mode: 'approx' };
  return { text: view.seeders > 0 ? seedsText(view.seeders) : '', mode: view.mode };
}

/** TV line: «↑152», «↑152 ↓3» once a tracker answered, «~↑152» when none did. */
export function tvSeedLabel(view: SeedDisplay): string {
  const n = view.seeders || 0;
  const prefix = view.mode === 'approx' ? '~' : '';
  if (view.mode === 'live') return '↑' + n + ' ↓' + (view.leechers || 0);
  return prefix + '↑' + n;
}

export interface ScrapeJob {
  hash: string;
  trackers: TrackerTarget[];
  seed: number;
  peer: number;
}

interface JobState {
  hash: string;
  trackers: TrackerTarget[];
  seed: number;
  peer: number;
  next: number;
  answers: ScrapeCounts[];
  gen: number;
  wanted: boolean;
  done: boolean;
}

interface Flight {
  hash: string;
  gen: number;
  cancel: () => void;
}

export interface ScrapeQueue {
  watch(job: ScrapeJob): () => void;
  subscribe(hash: string, fn: () => void): () => void;
  get(hash: string): LiveSeedEntry | null;
}

export interface ScrapeQueueOptions {
  transport: ScrapeTransport;
  cache: LiveSeedCache;
  now?: () => number;
  concurrency?: number;
  maxStarts?: number;
  windowMs?: number;
  timeoutMs?: number;
  maxTrackers?: number;
  schedule?: (fn: () => void, ms: number) => number;
}

/**
 * Visible rows only. At most `concurrency` tracker requests at once, and at most `maxStarts` new ones per window,
 * so a fast scroll does not fan out. A row that leaves the screen is removed from the queue and its request is
 * cancelled. One infohash is cached for the TTL whatever row asked.
 */
export function createScrapeQueue(o: ScrapeQueueOptions): ScrapeQueue {
  const now = o.now || (() => Date.now());
  const concurrency = o.concurrency === undefined ? SCRAPE_CONCURRENCY : o.concurrency;
  const maxStarts = o.maxStarts === undefined ? SCRAPE_MAX_STARTS : o.maxStarts;
  const windowMs = o.windowMs === undefined ? SCRAPE_WINDOW_MS : o.windowMs;
  const timeoutMs = o.timeoutMs === undefined ? SCRAPE_TIMEOUT_MS : o.timeoutMs;
  const maxTrackers = o.maxTrackers === undefined ? SCRAPE_MAX_TRACKERS : o.maxTrackers;
  const schedule = o.schedule || ((fn: () => void, ms: number) => setTimeout(fn, ms) as unknown as number);
  const jobs: { [hash: string]: JobState } = {};
  const refs: { [hash: string]: number } = {};
  const listeners: { [hash: string]: Array<() => void> } = {};
  const order: string[] = [];
  const flights: Flight[] = [];
  const stamps: number[] = [];
  let timer: number | null = null;

  function emit(hash: string): void {
    const list = listeners[hash];
    if (!list) return;
    for (let i = 0; i < list.length; i++) list[i]();
  }

  function startsAllowed(): boolean {
    const n = now();
    while (stamps.length && n - stamps[0] >= windowMs) stamps.shift();
    return stamps.length < maxStarts;
  }

  function arm(): void {
    if (timer !== null) return;
    const n = now();
    const wait = stamps.length ? Math.max(1, windowMs - (n - stamps[0])) : windowMs;
    timer = schedule(() => {
      timer = null;
      pump();
    }, wait);
  }

  function dropFlight(flight: Flight): void {
    const i = flights.indexOf(flight);
    if (i >= 0) flights.splice(i, 1);
  }

  function finish(j: JobState): void {
    if (!j.wanted || j.done) return;
    j.done = true;
    const merged = mergeScrape(j.seed, j.peer, j.answers);
    o.cache.put(j.hash, { seeders: merged.seeders, leechers: merged.leechers, live: merged.live, at: now() });
    emit(j.hash);
  }

  function begin(j: JobState, tr: TrackerTarget): void {
    const gen = j.gen;
    let promise: Promise<ScrapeCounts | null>;
    let cancel: () => void;
    if (tr.kind === 'http') {
      const h = o.transport.http(tr.url, timeoutMs);
      cancel = h.cancel;
      promise = h.promise.then((body) => (body ? parseHttpScrape(body, j.hash) : null));
    } else {
      const h = o.transport.udp(tr.host, tr.port, j.hash, timeoutMs);
      cancel = h.cancel;
      promise = h.promise;
    }
    const flight: Flight = { hash: j.hash, gen: gen, cancel: cancel };
    flights.push(flight);
    stamps.push(now());
    promise.then((parsed) => {
      dropFlight(flight);
      const cur = jobs[j.hash];
      if (!cur || cur.gen !== gen || !cur.wanted || cur.done) {
        pump();
        return;
      }
      if (parsed) cur.answers.push(parsed);
      const still = flights.some((f) => f.hash === cur.hash && f.gen === gen);
      if (cur.next >= cur.trackers.length && !still) finish(cur);
      pump();
    });
  }

  function pump(): void {
    let guard = 0;
    while (flights.length < concurrency && order.length && guard < 100) {
      guard++;
      const hash = order.shift() as string;
      const j = jobs[hash];
      if (!j || !j.wanted || j.done) continue;
      if (o.cache.get(hash)) {
        j.done = true;
        emit(hash);
        continue;
      }
      if (j.next >= j.trackers.length) {
        finish(j);
        continue;
      }
      if (!startsAllowed()) {
        order.unshift(hash);
        arm();
        return;
      }
      const tr = j.trackers[j.next];
      j.next++;
      begin(j, tr);
      if (j.wanted && !j.done && j.next < j.trackers.length) order.push(j.hash);
    }
    if (order.length && flights.length < concurrency && !startsAllowed()) arm();
  }

  function cancelJob(j: JobState): void {
    const gen = j.gen;
    j.wanted = false;
    j.answers = [];
    j.gen = gen + 1;
    for (let i = flights.length - 1; i >= 0; i--) {
      if (flights[i].hash === j.hash && flights[i].gen === gen) {
        flights[i].cancel();
        flights.splice(i, 1);
      }
    }
    for (let i = order.length - 1; i >= 0; i--) if (order[i] === j.hash) order.splice(i, 1);
  }

  return {
    get: (hash) => o.cache.get(hash),
    subscribe(hash, fn) {
      if (!listeners[hash]) listeners[hash] = [];
      listeners[hash].push(fn);
      return () => {
        const list = listeners[hash];
        if (!list) return;
        const i = list.indexOf(fn);
        if (i >= 0) list.splice(i, 1);
      };
    },
    watch(job) {
      const hash = job.hash;
      refs[hash] = (refs[hash] || 0) + 1;
      const hit = o.cache.get(hash);
      if (!hit) {
        const prev = jobs[hash];
        if (!prev || prev.done || !prev.wanted) {
          const trackers = job.trackers.slice(0, maxTrackers);
          jobs[hash] = {
            hash: hash,
            trackers: trackers,
            seed: job.seed,
            peer: job.peer,
            next: 0,
            answers: [],
            gen: prev ? prev.gen + 1 : 1,
            wanted: true,
            done: trackers.length === 0,
          };
          if (trackers.length) order.push(hash);
          else finish(jobs[hash]);
          pump();
        }
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        refs[hash] = (refs[hash] || 1) - 1;
        if (refs[hash] > 0) return;
        delete refs[hash];
        const j = jobs[hash];
        if (!j || j.done) return;
        cancelJob(j);
      };
    },
  };
}

function browserStore(): StringStore {
  return {
    get(key) {
      try {
        return localStorage.getItem(key);
      } catch (e) {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch (e) {
        // storage full or unavailable
      }
    },
  };
}

export const liveSeedCache = new LiveSeedCache(typeof localStorage === 'undefined' ? null : browserStore(), () => Date.now(), LIVE_SEED_TTL_MS);

/** Latin-1 string of an ArrayBuffer (each byte one char), capped so a huge body is dropped. */
export function latin1FromBuffer(buf: ArrayBuffer, maxBytes: number): string | null {
  if (buf.byteLength > maxBytes) return null;
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}
