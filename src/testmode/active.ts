import { computed, signal } from '@preact/signals';
import { isBetaVersion } from '../lib/version';
import { settings } from '../store/settings';
import { clampLabelPx, PHONE_LABEL_PX, TV_LABEL_PX } from './labelPx';
import { APP_VERSION } from '../version';

/**
 * Dev-server only (`vite` with `?testlabels=1`). Production builds inline this as false,
 * so a stable APK cannot turn the labels on through the address bar.
 */
function devLabelPreview(): boolean {
  try {
    if (!import.meta.env.DEV) return false;
  } catch (e) {
    return false;
  }
  try {
    return /(?:^|[?&])testlabels=1(?:&|$)/.test(location.search || '');
  } catch (e2) {
    return false;
  }
}

/** True when this build's version is `x.y.z-beta.N`. Stable releases are false. */
export function isBetaBuild(): boolean {
  return isBetaVersion(APP_VERSION) || devLabelPreview();
}

/**
 * Labels are shown only on a beta build, and only after «Режим тестирования» is on.
 * A leftover `testMode: true` on a stable build stays hidden.
 */
export const testLabels = computed(() => isBetaBuild() && settings.value.testMode);

export { TV_LABEL_PX, PHONE_LABEL_PX, clampLabelPx } from './labelPx';

/** Set by the phone app at start: the same code then reads the phone size. */
const phoneUi = signal(false);

export function markPhoneUi(): void {
  phoneUi.value = true;
}

/** The label size in px for this app (TV or phone). Also what the native player and dialogs get. */
export const testLabelPx = computed<number>(() =>
  phoneUi.value
    ? clampLabelPx(settings.value.testLabelPhonePx, PHONE_LABEL_PX)
    : clampLabelPx(settings.value.testLabelPx, TV_LABEL_PX),
);
