// Dedup markers kept by Android outside localStorage (android/.../monitor/MonitorJournal.kt). Chromium writes
// localStorage to disk a few seconds late, so a process killed right after a run could lose the seen keys and notify the
// same release again. The page sends a marker before each notification and after each button, and merges them back
// into localStorage at the start of the next run. Merging only adds «seen»: it never brings a finding back.
import { seenIndex } from '../../../src/monitor/match';
import { loadSubs, markFindingsSeen, rememberSeen, removeFindings, seenKeys } from '../../../src/monitor/subs';
import { BETTER_ID, EPISODES_ID } from '../../../src/monitor/types';

/** A result seen by a subscription (`e` = seenEntry), a reported new last episode (`e` = episodesKey) or a reported better rank (`e` = betterKey). */
export interface SeenMarker {
  s: string;
  e: string;
}

/** A notification button that succeeded. */
export interface ActionMarker {
  s: string;
  k: string;
  a: 'add' | 'replace';
}

export type JournalItem = SeenMarker | ActionMarker;

export function sanitizeJournal(v: unknown): JournalItem[] {
  if (!Array.isArray(v)) return [];
  const out: JournalItem[] = [];
  v.forEach((x) => {
    if (!x || typeof x !== 'object') return;
    const o = x as { s?: unknown; e?: unknown; k?: unknown; a?: unknown };
    if (typeof o.s !== 'string' || !o.s) return;
    if (typeof o.e === 'string' && o.e) out.push({ s: o.s, e: o.e });
    else if (typeof o.k === 'string' && o.k && (o.a === 'add' || o.a === 'replace')) out.push({ s: o.s, k: o.k, a: o.a });
  });
  return out;
}

/**
 * Applies the markers to localStorage; returns how many seen entries were added back. Subscriptions that were deleted, or whose
 * seen set is gone (edited: the next check is silent anyway), are left alone.
 */
export function mergeJournal(items: JournalItem[]): number {
  const subs: { [id: string]: boolean } = {};
  loadSubs().forEach((s) => (subs[s.id] = true));
  const entries: { [subId: string]: string[] } = {};
  let changed = 0;
  items.forEach((it) => {
    if ('e' in it) {
      (entries[it.s] = entries[it.s] || []).push(it.e);
      return;
    }
    if (it.a === 'add') markFindingsSeen(it.s, [it.k]);
    else removeFindings(it.s, it.k);
  });
  Object.keys(entries).forEach((subId) => {
    const library = subId === EPISODES_ID || subId === BETTER_ID;
    if (!library && !subs[subId]) return;
    const seen = seenKeys(subId);
    if (seen === null && !library) return;
    const index = seenIndex(seen || []);
    const missing = entries[subId].filter((e, i, all) => all.indexOf(e) === i && !e.split('|').some((k) => index[k]));
    if (!missing.length) return;
    rememberSeen(subId, missing);
    changed += missing.length;
  });
  return changed;
}
