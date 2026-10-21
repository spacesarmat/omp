import { computed } from '@preact/signals';
import { isBetaVersion } from '../lib/version';
import { settings } from '../store/settings';
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

export type TestLabelSize = 'small' | 'medium' | 'large';

/** The label size while labels are on. */
export const testLabelSize = computed<TestLabelSize>(() => settings.value.testLabelSize || 'medium');

/**
 * Label text size in CSS px (TV web UI, 1920 layout) or dp (native Android TV).
 * The TV never goes under 24px, so «Маленький» is the old size there and the scale grows from it.
 */
export function tvLabelPx(size: TestLabelSize): number {
  if (size === 'small') return 24;
  if (size === 'large') return 36;
  return 28;
}

/** Phone label text size in CSS px. «Средний» is the size the labels had before the setting. */
export function phoneLabelPx(size: TestLabelSize): number {
  if (size === 'small') return 16;
  if (size === 'large') return 32;
  return 24;
}

/** Options for the size choice, in the order shown. */
export const TEST_LABEL_SIZES: TestLabelSize[] = ['small', 'medium', 'large'];
