// «Что нового» on the phone: the unmarked changelog bullets and the «[phone]» ones, never the TV-only «[tv]» / «[lg]» / «[atv]» ones.
import { getChangelog, setChangelogPlatform } from '../../../src/lib/changelogData';
import type { ChangelogEntry } from '../../../src/lib/changelog';

// set when this module loads: the notice rebuilt on a language change reads the same platform
setChangelogPlatform('phone');

/** The phone's changelog in the current UI language. */
export function phoneChangelog(): ChangelogEntry[] {
  setChangelogPlatform('phone');
  return getChangelog();
}
