import { resumePosition } from '../store/progress';
import { formatDuration } from '../lib/format';
import { choose } from '../ui/dialog';
import type { PlayItem } from './types';

/**
 * Start position for an item: the explicit one when given, else «Продолжить просмотр?» when a resume point exists.
 * Resolves -1 when the dialog was dismissed (the caller leaves the player). With `ask` false (the native player
 * is open in front of the TV interface) the saved position is used without the dialog.
 */
export function decideStart(item: PlayItem, explicit?: number, ask = true): Promise<number> {
  if (explicit !== undefined) return Promise.resolve(explicit);
  if (!item.hash || item.fileIndex === undefined) return Promise.resolve(0);
  const pos = resumePosition(item.hash, item.fileIndex);
  if (pos <= 0 || !ask) return Promise.resolve(Math.max(0, pos));
  return choose('Продолжить просмотр?', [
    { label: 'Продолжить с ' + formatDuration(pos), value: pos },
    { label: 'Сначала', value: 0 },
  ]).then((v) => (v === null ? -1 : v));
}
