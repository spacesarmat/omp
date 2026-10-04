// Support code on the TV side: the phone writes only the end time into the watch journal (omp.d.until, see
// src/lib/journal.ts); the TV takes the latest one from the torrent lists it reads anyway (the library and the
// list the player reads for the skip settings).
import { computed, signal } from '@preact/signals';
import { supportOfList } from '../lib/journal';
import { supportActive } from '../lib/donate';
import { torrents } from './library';

/** The latest omp.d.until seen in a list read outside the library (the player's skip-settings read). */
const seenUntil = signal(0);

/** A torrent list was read: remember its support mark. */
export function noteSupport(list: { data?: string }[] | null | undefined): void {
  const u = supportOfList(list);
  if (u > seenUntil.value) seenUntil.value = u;
}

/** The support end time known from the server's journal (0: none). */
export const journalSupportUntil = computed(() => Math.max(supportOfList(torrents.value), seenUntil.value));

/** True while a support code applied on a phone hides the «Поддержать» prompts. */
export function journalSupportActive(now: number = Date.now()): boolean {
  return supportActive(journalSupportUntil.value, now);
}

/** Tests: forget the marks seen. */
export function resetSupportSeen(): void {
  seenUntil.value = 0;
}
