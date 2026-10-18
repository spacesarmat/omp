import { signal } from '@preact/signals';
import { settings, updateSettings } from '../store/settings';

/**
 * First-visit coach marks. The order is the priority when several anchors are on one screen.
 * Any other id still works: a later feature registers it and it shows when it is the only one offered.
 */
export const HINT_ORDER = ['catalog', 'mine', 'audiobooks', 'audiobookPlayer', 'videoPlayer'] as const;

const offers = signal<string[]>([]);

export function hintOffers(): string[] {
  return offers.value;
}

export function registerHint(id: string): void {
  if (offers.value.indexOf(id) >= 0) return;
  offers.value = offers.value.concat(id);
}

export function unregisterHint(id: string): void {
  if (offers.value.indexOf(id) < 0) return;
  offers.value = offers.value.filter((x) => x !== id);
}

/** The one hint to show: known ids first, then any other offered id. Null when all of them were dismissed. */
export function pickHint(offered: readonly string[], seen: { [id: string]: boolean }, anchored: (id: string) => boolean = () => true): string | null {
  const unseen = (id: string) => offered.indexOf(id) >= 0 && seen[id] !== true && anchored(id);
  for (let i = 0; i < HINT_ORDER.length; i++) {
    if (unseen(HINT_ORDER[i])) return HINT_ORDER[i];
  }
  for (let i = 0; i < offered.length; i++) {
    const id = offered[i];
    if (HINT_ORDER.indexOf(id as (typeof HINT_ORDER)[number]) >= 0) continue;
    if (seen[id] !== true && anchored(id)) return id;
  }
  return null;
}

export function markHintSeen(id: string): void {
  const cur = settings.peek().seenHints;
  if (cur[id] === true) return;
  updateSettings({ seenHints: { ...cur, [id]: true } });
}

export function resetHints(): void {
  updateSettings({ seenHints: {} });
}

/** Tests: drop anchors registered by a screen that was not unmounted cleanly. */
export function resetHintRuntime(): void {
  offers.value = [];
}
