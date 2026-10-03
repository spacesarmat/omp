import { signal } from '@preact/signals';
import { loadJson, saveJson } from './storage';
import { compareVersions } from '../lib/version';
import { releasesUpTo, type ChangelogEntry } from '../lib/changelog';

export const SEEN_KEY = 'tsp.seenVersion';

export interface WhatsNew {
  title: string;
  entries: ChangelogEntry[];
  /** Opened by itself after an update (may wait for other prompts), not by the user. */
  auto: boolean;
}

/** What the «Что нового» sheet/dialog shows right now. */
export const whatsNew = signal<WhatsNew | null>(null);

export function sanitizeSeen(v: unknown): string | null {
  return typeof v === 'string' && /^\d+(\.\d+)*$/.test(v) ? v : null;
}

export function openWhatsNew(list: ChangelogEntry[], current: string): void {
  whatsNew.value = { title: 'Что нового', entries: releasesUpTo(list, current), auto: false };
}

export function closeWhatsNew(): void {
  whatsNew.value = null;
}

/**
 * Once per update, on app start. A fresh install only remembers the version; a newer build than the
 * remembered one queues «Что нового в <версия>» (the host shows it when no other prompt is open).
 * The version is stored right away, so a restart never repeats it.
 */
export function checkWhatsNew(list: ChangelogEntry[], current: string): void {
  const seen = sanitizeSeen(loadJson<unknown>(SEEN_KEY, null, (v) => sanitizeSeen(v) !== null));
  if (seen === current) return;
  saveJson(SEEN_KEY, current);
  if (seen === null || compareVersions(current, seen) <= 0) return;
  const entries = releasesUpTo(list, current);
  if (!entries.length || entries[0].version !== current) return;
  whatsNew.value = { title: 'Что нового в ' + current, entries, auto: true };
}
