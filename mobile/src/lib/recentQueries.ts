const KEY = 'tsp.recentQueries';
const MAX = 8;

/** Last source searches, newest first, without duplicates. */
export function loadRecentQueries(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter((x) => typeof x === 'string' && x.trim()).slice(0, MAX);
  } catch {
    return [];
  }
}

export function rememberQuery(raw: string): string[] {
  const q = raw.replace(/\s+/g, ' ').trim();
  if (!q || q.length > 80) return loadRecentQueries();
  const next = [q].concat(loadRecentQueries().filter((x) => x.toLowerCase() !== q.toLowerCase())).slice(0, MAX);
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

let clipReader: (() => Promise<string | null>) | null = null;

/** Tests replace the clipboard. Null restores the browser clipboard. */
export function setClipboardReader(fn: (() => Promise<string | null>) | null): void {
  clipReader = fn;
}

export function readClipboardText(): Promise<string | null> {
  if (clipReader) return clipReader();
  const nav = navigator.clipboard;
  if (!nav || typeof nav.readText !== 'function') return Promise.resolve(null);
  return nav.readText().then((t) => t, () => null);
}

/** A magnet or a 40-char hash sitting in clipboard text. Null for anything else. */
export function magnetInClipboard(raw: string | null | undefined): string | null {
  const s = (raw || '').trim();
  if (/^[0-9a-fA-F]{40}$/.test(s)) return 'magnet:?xt=urn:btih:' + s;
  if (/^magnet:\?/i.test(s)) return s;
  return null;
}
