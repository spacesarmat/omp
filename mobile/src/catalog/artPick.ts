// A poster chosen on a catalog card, kept on the phone (TMDB stays the default).
import { signal } from '@preact/signals';

const KEY = 'tsp.catalogArt';

export const artVersion = signal(0);

function read(): { [k: string]: string } {
  try {
    const raw = localStorage.getItem(KEY);
    const o = raw ? JSON.parse(raw) : null;
    return o && typeof o === 'object' ? (o as { [k: string]: string }) : {};
  } catch {
    return {};
  }
}

/** `tv:21` for the series, `tv:21:s2` for a season. */
export function artKey(id: number, season?: number): string {
  return season ? 'tv:' + id + ':s' + season : 'tv:' + id;
}

export function pickedArt(key: string): string {
  const u = read()[key];
  return typeof u === 'string' ? u : '';
}

export function saveArt(key: string, url: string): void {
  const o = read();
  if (url) o[key] = url;
  else delete o[key];
  try {
    localStorage.setItem(KEY, JSON.stringify(o));
  } catch {
    /* the choice stays for this page via the signal */
  }
  artVersion.value++;
}
