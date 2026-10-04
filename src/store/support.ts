// Support code on the TV side: the phone writes only the end time into the watch journal (omp.d.until, see
// src/lib/journal.ts); the TV takes the latest one from the torrent lists it reads anyway (the library and the
// list the player reads for the skip settings).
import { computed, signal } from '@preact/signals';
import { supportOf } from '../lib/journal';
import { supportActive, SUPPORT_MAX_AHEAD_MS } from '../lib/donate';
import { torrents } from './library';

/** The latest omp.d.until seen in a list read outside the library (the player's skip-settings read). */
const seenUntil = signal(0);

// Per torrent: the data string last parsed and its mark. The library list changes on every journal write (a pause
// records one), so only the torrents whose data changed are parsed again; data without a `"d"` key is not parsed.
const cache: { [hash: string]: { data: string; until: number } } = {};

function markOf(t: { hash?: string; data?: string }): number {
  const data = t.data || '';
  if (data.indexOf('"d"') < 0) return 0;
  const key = typeof t.hash === 'string' ? t.hash : '';
  const hit = key ? cache[key] : undefined;
  if (hit && hit.data === data) return hit.until;
  const until = supportOf(data);
  if (key) cache[key] = { data, until };
  return until;
}

/**
 * The latest believable mark of a list: one further ahead than a code can reach (SUPPORT_MAX_AHEAD_MS) is ignored,
 * so a bogus value cannot hide a valid one.
 */
export function supportUntilOf(list: { hash?: string; data?: string }[] | null | undefined, now: number = Date.now()): number {
  const ceiling = now + SUPPORT_MAX_AHEAD_MS;
  let max = 0;
  (list || []).forEach((t) => {
    if (!t) return;
    const u = markOf(t);
    if (u > max && u <= ceiling) max = u;
  });
  return max;
}

/** A torrent list was read: remember its support mark. */
export function noteSupport(list: { hash?: string; data?: string }[] | null | undefined): void {
  const u = supportUntilOf(list);
  if (u > seenUntil.value) seenUntil.value = u;
}

/** A mark this device has just written to the server (the phone after «Применить»). */
export function noteSupportUntil(until: number): void {
  if (until > seenUntil.value) seenUntil.value = until;
}

/** The support end time known from the server's journal (0: none). */
export const journalSupportUntil = computed(() => Math.max(supportUntilOf(torrents.value), seenUntil.value));

/** True while a support code applied on a phone hides the «Поддержать» prompts. */
export function journalSupportActive(now: number = Date.now()): boolean {
  return supportActive(journalSupportUntil.value, now);
}

/** Tests: forget the marks seen. */
export function resetSupportSeen(): void {
  seenUntil.value = 0;
  Object.keys(cache).forEach((k) => delete cache[k]);
}
