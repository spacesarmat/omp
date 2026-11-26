// Poster and icon bytes are asked once and reused. The TV grid drops the `src` of tiles far from the focus and the
// phone does the same near the viewport, so without this cache every scroll back would hit the network again - and
// on webOS the browser's own cache is small and out of our control.
//
// A picture gets here through fetch, which needs the host to allow cross-origin reads. The TMDB mirror the app
// uses by default answers `Access-Control-Allow-Origin: *`; the official image.tmdb.org does not, and a user can
// paste any URL at all. So a failed fetch is not an error: the host is remembered as blocked and the plain URL is
// used, exactly like before this cache existed.

/** How many decoded bytes the cache holds before it drops the oldest picture. */
const DEFAULT_BUDGET = 24 * 1024 * 1024;
/** Posters of the row the person is heading to, asked ahead while the screen is idle. */
const PREFETCH_CONCURRENCY = 2;

type Entry = { objectUrl: string; bytes: number; seen: number };

const store = new Map<string, Entry>();
const pending = new Map<string, Promise<string>>();
const blocked = new Set<string>();

let budget = DEFAULT_BUDGET;
let used = 0;
let hits = 0;
let misses = 0;
let falls = 0;

function hostOf(url: string): string {
  const m = /^[a-z]+:\/\/([^/?#]+)/i.exec(url);
  return m ? m[1].toLowerCase() : '';
}

/** True where a Blob can be turned into an address at all; jsdom and the oldest engines cannot. */
function canStore(): boolean {
  return typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';
}

/** True for the URLs this cache can hold; data: and blob: are already local. */
export function canCache(url: string): boolean {
  if (!url || !canStore()) return false;
  if (url.indexOf('http://') !== 0 && url.indexOf('https://') !== 0) return false;
  return !blocked.has(hostOf(url));
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

function remember(url: string, blob: Blob): string {
  const objectUrl = URL.createObjectURL(blob);
  const bytes = blob.size || 0;
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
  const running = pending.get(url);
  if (running) return running;
  misses++;
  const job = fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error('image ' + res.status);
      return res.blob();
    })
    .then((blob) => remember(url, blob))
    .catch(() => {
      // no CORS, no network or a broken picture: show the URL the way it was shown before the cache existed
      if (url.indexOf('https://') === 0 || url.indexOf('http://') === 0) {
        const host = hostOf(url);
        if (host) blocked.add(host);
        falls++;
      }
      return url;
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

/** Asks a list of posters in the background, two at a time; already cached ones are skipped. */
export function prefetchImages(urls: string[]): void {
  const queue = urls.filter((u) => u && canCache(u) && !store.has(u) && !pending.has(u));
  let at = 0;
  const step = (): void => {
    if (at >= queue.length) return;
    const url = queue[at++];
    loadImage(url).then(step, step);
  };
  for (let i = 0; i < PREFETCH_CONCURRENCY; i++) step();
}

/** Numbers for the test-mode overlay: what the cache holds and how often it had to fall back. */
export function imageCacheStats(): { items: number; bytes: number; hits: number; misses: number; falls: number; blocked: string[] } {
  return { items: store.size, bytes: used, hits, misses, falls, blocked: Array.from(blocked) };
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
  blocked.clear();
  setImageCacheBudget(DEFAULT_BUDGET);
}
