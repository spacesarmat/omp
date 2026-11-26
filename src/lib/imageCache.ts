// Poster and icon bytes are asked once and reused. The TV grid drops the `src` of tiles far from the focus and the
// phone does the same near the viewport, so without this cache every scroll back would hit the network again - and
// on webOS the browser's own cache is small and out of our control.
//
// A picture gets here through fetch, which needs the host to allow cross-origin reads. The TMDB mirror the app
// uses by default answers `Access-Control-Allow-Origin: *`; the official image.tmdb.org does not, and a user can
// paste any URL at all. So a failed fetch is not an error: the plain URL is used, exactly like before this cache
// existed. A host that refused a read is not asked again for a cooldown (a network that is down must recover),
// and a poster the server itself answered for with an error is not asked again at all.

/** How many decoded bytes the cache holds before it drops the oldest picture. */
const DEFAULT_BUDGET = 24 * 1024 * 1024;
/** Posters of the row the person is heading to, asked ahead while the screen is idle. */
const PREFETCH_CONCURRENCY = 2;

type Entry = { objectUrl: string; bytes: number; seen: number };

const store = new Map<string, Entry>();
const pending = new Map<string, Promise<string>>();
/** Hosts that refused a cross-origin read: how often and when for the last time. */
const hosts = new Map<string, { fails: number; at: number }>();
/** Posters that answered with an error of their own (a 404, a picture too big): asked once per session. */
const refused = new Set<string>();
const queue: string[] = [];

/** A host that cannot be read stops being asked for this long, then gets one more chance. */
const HOST_COOLDOWN_MS = 5 * 60 * 1000;
/** `refused` is a memo, not a record: it is dropped once it grows past this. */
const REFUSED_MAX = 400;
/** A background prefetch backlog longer than this is not worth keeping: the person has scrolled away. */
const QUEUE_MAX = 64;

let inFlight = 0;

let budget = DEFAULT_BUDGET;
let used = 0;
let hits = 0;
let misses = 0;
let falls = 0;

function hostOf(url: string): string {
  const m = /^[a-z]+:\/\/([^/?#]+)/i.exec(url);
  return m ? m[1].toLowerCase() : '';
}

function hostBlocked(host: string): boolean {
  const s = hosts.get(host);
  if (!s) return false;
  if (Date.now() - s.at > HOST_COOLDOWN_MS) {
    hosts.delete(host);
    return false;
  }
  return true;
}

/** True where a Blob can be turned into an address at all; jsdom and the oldest engines cannot. */
function canStore(): boolean {
  return typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';
}

/** True for the URLs this cache can hold; data: and blob: are already local. */
export function canCache(url: string): boolean {
  if (!url || !canStore()) return false;
  if (url.indexOf('http://') !== 0 && url.indexOf('https://') !== 0) return false;
  if (refused.has(url)) return false;
  return !hostBlocked(hostOf(url));
}

/** The address to put in `src`: the cached copy when there is one, the original URL otherwise. */
export function imageSrc(url: string): string {
  const e = store.get(url);
  if (e) {
    hits++;
    e.seen = Date.now();
    return e.objectUrl;
  }
  return url;
}

function dropOldest(): void {
  let oldestKey = '';
  let oldest = Infinity;
  store.forEach((v, k) => {
    if (v.seen < oldest) {
      oldest = v.seen;
      oldestKey = k;
    }
  });
  if (!oldestKey) return;
  const gone = store.get(oldestKey);
  if (gone) {
    used -= gone.bytes;
    try {
      URL.revokeObjectURL(gone.objectUrl);
    } catch (e) {
      /* the engine may already have dropped it */
    }
    store.delete(oldestKey);
  }
}

function refuse(url: string): string {
  if (refused.size >= REFUSED_MAX) refused.clear();
  refused.add(url);
  return url;
}

function remember(url: string, blob: Blob): string {
  const bytes = blob.size || 0;
  // a picture that alone is larger than the whole room is not worth an address of its own
  if (bytes > budget) return refuse(url);
  const objectUrl = URL.createObjectURL(blob);
  store.set(url, { objectUrl, bytes, seen: Date.now() });
  used += bytes;
  while (used > budget && store.size > 1) dropOldest();
  return objectUrl;
}

/**
 * Asks for the picture and returns the address to show: a cached object URL when the host allows cross-origin
 * reads, the original URL otherwise. Two tiles asking the same poster share one request.
 */
export function loadImage(url: string): Promise<string> {
  if (!canCache(url)) return Promise.resolve(url);
  const have = store.get(url);
  if (have) {
    hits++;
    have.seen = Date.now();
    return Promise.resolve(have.objectUrl);
  }
  const going = pending.get(url);
  if (going) return going;
  misses++;
  const job = fetch(url)
    .then((res) => {
      if (!res.ok) throw new HttpStatus('image ' + res.status);
      return res.blob();
    })
    .then((blob) => remember(url, blob))
    .catch((err: unknown) => {
      // show the URL the way it was shown before the cache existed
      falls++;
      if (err instanceof HttpStatus) {
        // this poster is missing or broken; the host itself is still fine
        return refuse(url);
      }
      // no CORS, or the network is down right now: stop asking this host for a while, not forever
      const host = hostOf(url);
      if (host) hosts.set(host, { fails: (hosts.get(host)?.fails || 0) + 1, at: Date.now() });
      return refuse(url);
    });
  pending.set(url, job);
  return job.then(
    (out) => {
      pending.delete(url);
      return out;
    },
    (err) => {
      pending.delete(url);
      return Promise.reject(err);
    },
  );
}

/** A poster the server answered for with an error of its own: the host still allows reads. */
class HttpStatus extends Error {}

/** Asks the next posters in the shared background queue; every caller adds to the same two workers. */
function pump(): void {
  while (inFlight < PREFETCH_CONCURRENCY && queue.length) {
    const url = queue.shift() as string;
    if (!canCache(url) || store.has(url) || pending.has(url)) continue;
    inFlight++;
    const done = (): void => {
      inFlight--;
      pump();
    };
    loadImage(url).then(done, done);
  }
}

/** Asks a list of posters in the background, two at a time over the whole app; cached ones are skipped. */
export function prefetchImages(urls: string[]): void {
  for (let i = 0; i < urls.length && queue.length < QUEUE_MAX; i++) {
    const u = urls[i];
    if (!u || !canCache(u) || store.has(u) || pending.has(u)) continue;
    if (queue.indexOf(u) < 0) queue.push(u);
  }
  pump();
}

/** Numbers for the test-mode overlay: what the cache holds and how often it had to fall back. */
export function imageCacheStats(): { items: number; bytes: number; hits: number; misses: number; falls: number; blocked: string[] } {
  return { items: store.size, bytes: used, hits, misses, falls, blocked: Array.from(hosts.keys()).filter(hostBlocked) };
}

/** Forgets everything: the pictures are asked again next time they are shown. */
export function clearImageCache(): void {
  store.forEach((e) => {
    try {
      URL.revokeObjectURL(e.objectUrl);
    } catch (err) {
      /* already gone */
    }
  });
  store.clear();
  pending.clear();
  hosts.clear();
  refused.clear();
  queue.length = 0;
  inFlight = 0;
  used = 0;
  hits = 0;
  misses = 0;
  falls = 0;
}

/** How many decoded bytes may be kept; the phone sets a smaller room than the TV. */
export function setImageCacheBudget(bytes: number): void {
  if (bytes > 0) budget = bytes;
  while (used > budget && store.size > 1) dropOldest();
}

export function imageCacheBudget(): number {
  return budget;
}

/** Tests start from a clean room. */
export function resetImageCache(): void {
  clearImageCache();
  setImageCacheBudget(DEFAULT_BUDGET);
}
