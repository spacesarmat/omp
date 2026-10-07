// The colour keys of the TV player, the same on LG (web player) and Android TV (native player): Red — the audio / dub
// list, Green — the subtitles list, Yellow — night sound where the player has it, else «Инфо», Blue — the player
// menu. webOS codes 403–406 (src/platform/keys.ts). Pure.
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

/** A player window a colour key opens: the audio list (Red), the subtitles list (Green), the menu (Blue). */
export type ColorWindow = 'audio' | 'subs' | 'menu';

/**
 * A colour key while one of the player's windows is open (as on Android TV, ColorKeys.inDialog): the window closes.
 * Its own key only closes it (a toggle: Red closes the audio list, opened by Red or from the menu); Blue only closes;
 * another key then does its own action (null: nothing more).
 */
export function colorKeyOverWindow(cmd: ColorKeyCommand, open: ColorWindow): ColorKeyCommand | null {
  if (cmd === 'menu' || cmd === open) return null;
  return cmd;
}

/** The web player has no night sound: Yellow toggles «Инфо» (the `stats` command). */
export const WEB_NIGHT_SOUND = false;
