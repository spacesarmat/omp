// The colour keys of the TV player, the same on LG (web player) and Android TV (native player): Red — the audio / dub
// list, Green — the subtitles list, Yellow — night sound where the player has it, else the statistics, Blue — the
// player menu. webOS codes 403–406 (src/platform/keys.ts). Pure.
import type { KeyAction } from '../platform/keys';

export type ColorKeyCommand = 'audio' | 'subs' | 'night' | 'stats' | 'menu';

/** What a colour key does; null for any other key. `night`: the player has a night sound switch. */
export function colorKeyCommand(a: KeyAction, night: boolean): ColorKeyCommand | null {
  if (a === 'red') return 'audio';
  if (a === 'green') return 'subs';
  if (a === 'yellow') return night ? 'night' : 'stats';
  if (a === 'blue') return 'menu';
  return null;
}

/** The web player has no night sound: Yellow toggles the statistics. */
export const WEB_NIGHT_SOUND = false;
