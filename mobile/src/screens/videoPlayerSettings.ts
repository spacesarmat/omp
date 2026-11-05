import { t } from '../../../src/i18n';
import type { PhonePlayer } from '../../../src/store/settings';

/** Label of the current phone player choice (for the Settings pick row). */
export function phonePlayerName(v: PhonePlayer): string {
  if (v === 'p2160') return t('player.p2160AppPhone');
  if (v === 'chooser') return t('player.builtinPlayerPhone');
  return t('player.embeddedPlayerPhone');
}
