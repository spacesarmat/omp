import { signal } from '@preact/signals';
import { loadJson, saveJson } from './storage';
import { compareVersions } from '../lib/version';
import { releasesUpTo, type ChangelogEntry } from '../lib/changelog';

export const SEEN_KEY = 'tsp.seenVersion';
/** Keys written on every start (phone: first-run time): they say nothing about an older install. */
const NOT_DATA = [SEEN_KEY, 'tsp.firstRun'];

export interface WhatsNew {
  title: string;
  entries: ChangelogEntry[];
  /** Opened by itself after an update (may wait for other prompts), not by the user. */
  auto: boolean;
  /** Version to remember once an automatic notice is actually shown. */
  version?: string;
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

/** Any saved OMP data besides the seen version: this install is older than the feature, not new. */
function hasOtherData(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf('tsp.') === 0 && NOT_DATA.indexOf(k) < 0) return true;
    }
  } catch (e) {
    // storage unavailable
  }
  return false;
}

/** The host calls this when an automatic notice is on screen: only now is the version remembered. */
export function markWhatsNewShown(): void {
  const w = whatsNew.value;
  if (w && w.auto && w.version) saveJson(SEEN_KEY, w.version);
}

/**
 * Once per update, on app start. Truly empty storage = fresh install: remember the version, show nothing.
 * A missing key with other saved data is an update from before this feature (unknown version): show the
 * current version. A known older version shows every version newer than it. The version is saved when the
 * notice is shown (markWhatsNewShown), so a kill while it waits behind the player does not lose it.
 */
export function checkWhatsNew(list: ChangelogEntry[], current: string): void {
  const seen = sanitizeSeen(loadJson<unknown>(SEEN_KEY, null, (v) => sanitizeSeen(v) !== null));
  if (seen === current) return;
  if (seen === null && !hasOtherData()) {
    saveJson(SEEN_KEY, current);
    return;
  }
  if (seen !== null && compareVersions(current, seen) <= 0) {
    saveJson(SEEN_KEY, current);
    return;
  }
  let entries = releasesUpTo(list, current);
  if (seen !== null) entries = entries.filter((e) => compareVersions(e.version, seen) > 0);
  else entries = entries.slice(0, 1);
  if (!entries.length || entries[0].version !== current) {
    saveJson(SEEN_KEY, current);
    return;
  }
  whatsNew.value = { title: 'Что нового в ' + current, entries, auto: true, version: current };
}
