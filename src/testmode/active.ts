import { computed } from '@preact/signals';
import { isBetaVersion } from '../lib/version';
import { settings } from '../store/settings';
import { APP_VERSION } from '../version';

/** True when this build's version is `x.y.z-beta.N`. Stable releases are false. */
export function isBetaBuild(): boolean {
  return isBetaVersion(APP_VERSION);
}

/**
 * Labels are shown only on a beta build, and only after «Режим тестирования» is on.
 * A leftover `testMode: true` on a stable build stays hidden.
 */
export const testLabels = computed(() => isBetaBuild() && settings.value.testMode);
