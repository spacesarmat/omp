import { signal } from '@preact/signals';
import { t } from '../i18n';
import { settings, updateSettings } from '../store/settings';
import type { OnboardingPlatform } from './slides';

/**
 * Stored onboardingVersion >= this means the current tour was finished (skip or the last step).
 * Bump it to show the tour once more after an update.
 */
export const ONBOARDING_VERSION = 1;

/** Startup intakes have settled (or nothing was pending). Auto-show waits for this. */
export const onboardingReady = signal(false);
/** Settings → «Показать знакомство с приложением»: show even when the tour was finished. */
export const onboardingForce = signal(false);
/**
 * Route a notification just opened (`news`, `subFindings`, `audiobookPlayer`).
 * The auto tour does not cover that route for the rest of the session.
 */
export const onboardingHold = signal<string | null>(null);
/** A launch is about to open the player: hide the auto tour until that finishes or the player closes. */
export const onboardingPause = signal(false);

export type OnboardingAction = 'next' | 'start' | 'connect';

const PHONE_BLOCKED = ['audiobookPlayer', 'nowPlaying'];
const TV_BLOCKED = ['player'];

/** Full-screen player (phone audiobook / TV remote of the current film, or the TV player). */
export function onboardingRouteBlocked(platform: OnboardingPlatform, route: string): boolean {
  const list = platform === 'tv' ? TV_BLOCKED : PHONE_BLOCKED;
  return list.indexOf(route) >= 0;
}

export function shouldShowOnboarding(o: {
  version: number;
  route: string;
  platform: OnboardingPlatform;
  force: boolean;
  hold: string | null;
  ready: boolean;
  pause: boolean;
}): boolean {
  // Never over a running player, including a replay that is still open when playback starts.
  if (onboardingRouteBlocked(o.platform, o.route)) return false;
  if (o.force) return true;
  if (o.pause) return false;
  if (!o.ready) return false;
  if (o.version >= ONBOARDING_VERSION) return false;
  // The screen the notification opened. Leaving it (another route) is fine.
  if (o.hold && o.hold === o.route) return false;
  return true;
}

/** Reads the signals. Call during render so the screen follows them. */
export function onboardingVisible(platform: OnboardingPlatform, route: string): boolean {
  return shouldShowOnboarding({
    version: settings.value.onboardingVersion,
    route,
    platform,
    force: onboardingForce.value,
    hold: onboardingHold.value,
    ready: onboardingReady.value,
    pause: onboardingPause.value,
  });
}

/** Skip and the last step both count: the tour does not return until the version is bumped. */
export function completeOnboarding(): void {
  onboardingForce.value = false;
  const cur = settings.peek().onboardingVersion;
  if (cur < ONBOARDING_VERSION) updateSettings({ onboardingVersion: ONBOARDING_VERSION });
}

export function openOnboarding(): void {
  onboardingForce.value = true;
  onboardingReady.value = true;
}

export function holdOnboarding(route: string): void {
  onboardingHold.value = route;
}

export function pauseOnboarding(): void {
  onboardingPause.value = true;
}

export function resumeOnboarding(): void {
  onboardingPause.value = false;
}

/**
 * Last step offers the connect screen when there is no server and we are not already on it.
 * Otherwise the primary button is Next, then Start.
 */
export function onboardingPrimary(last: boolean, hasServer: boolean, route: string): OnboardingAction {
  if (!last) return 'next';
  if (!hasServer && route !== 'connect') return 'connect';
  return 'start';
}

export function onboardingActionLabel(action: OnboardingAction): string {
  if (action === 'next') return t('onboarding.next');
  if (action === 'connect') return t('onboarding.connect');
  return t('onboarding.start');
}

let bootLeft = 0;
let bootTimer: ReturnType<typeof setTimeout> | null = null;

function settleBoot(): void {
  bootLeft = Math.max(0, bootLeft - 1);
  if (bootLeft > 0) return;
  if (bootTimer) {
    clearTimeout(bootTimer);
    bootTimer = null;
  }
  onboardingReady.value = true;
}

/**
 * Count one startup intake. Pass the promise that already applied the deep link,
 * so the tour is not decided a turn before that navigation.
 */
export function trackOnboardingBoot<T>(p: Promise<T>): Promise<T> {
  bootLeft++;
  onboardingReady.value = false;
  const done = () => settleBoot();
  return p.then(
    (v) => {
      done();
      return v;
    },
    (e) => {
      done();
      return Promise.reject(e);
    },
  );
}

/** Call once from the app shell. If nothing was tracked, the tour may show on the next turn. */
export function armOnboardingBoot(): void {
  queueMicrotask(() => {
    if (bootLeft <= 0) {
      onboardingReady.value = true;
      return;
    }
    if (bootTimer) return;
    // A hung native call must not hide the tour for the whole session.
    bootTimer = setTimeout(() => {
      bootTimer = null;
      bootLeft = 0;
      onboardingReady.value = true;
    }, 2000);
  });
}

/** Tests: forget in-flight startup tracking and the open/hold flags. Does not write settings. */
export function resetOnboardingRuntime(): void {
  if (bootTimer) clearTimeout(bootTimer);
  bootTimer = null;
  bootLeft = 0;
  onboardingReady.value = false;
  onboardingForce.value = false;
  onboardingHold.value = null;
  onboardingPause.value = false;
}
