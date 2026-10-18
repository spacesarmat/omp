import { signal } from '@preact/signals';
import { t } from '../i18n';
import { settings, updateSettings } from '../store/settings';
import { resetHintRuntime } from './hints';
import type { OnboardingPlatform } from './slides';

/**
 * Stored when the slide tour is finished from Settings. The tour is not shown on launch.
 * Bump it only if a future build should offer the slides on its own again.
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
/** A launch is about to open the player: hide first-run setup until that finishes or the player closes. */
export const onboardingPause = signal(false);
/** Setup handed the phone TorrServer screen over to the existing installer. The wizard hides until that returns. */
export const setupHandoff = signal(false);
/** True after the wizard has opened this session, so connecting a server does not dismiss it before the last step. */
export const setupSession = signal(false);
export type SetupStep = 'where' | 'network' | 'result' | 'prefs';
export const setupStep = signal<SetupStep>('where');
/** Set when the existing phone-TorrServer screen connects, so the result step survives the wizard hiding. */
export const setupNotice = signal<{ name: string; version: string } | null>(null);

export type OnboardingAction = 'next' | 'start' | 'connect';

const PHONE_BLOCKED = ['audiobookPlayer', 'nowPlaying'];
const TV_BLOCKED = ['player'];

/** Full-screen player (phone audiobook / TV remote of the current film, or the TV player). */
export function onboardingRouteBlocked(platform: OnboardingPlatform, route: string): boolean {
  const list = platform === 'tv' ? TV_BLOCKED : PHONE_BLOCKED;
  return list.indexOf(route) >= 0;
}

/** The slide tour is only the Settings action. It still steps aside for a running player. */
export function shouldShowOnboarding(o: { route: string; platform: OnboardingPlatform; force: boolean }): boolean {
  if (onboardingRouteBlocked(o.platform, o.route)) return false;
  return o.force;
}

export function shouldShowSetup(o: {
  platform: OnboardingPlatform;
  route: string;
  hasServer: boolean;
  setupDone: boolean;
  ready: boolean;
  pause: boolean;
  hold: string | null;
  handoff: boolean;
  session: boolean;
  tour: boolean;
}): boolean {
  if (o.platform !== 'phone') return false;
  if (o.tour || o.handoff) return false;
  if (onboardingRouteBlocked('phone', o.route)) return false;
  if (o.pause || !o.ready) return false;
  if (o.hold && o.hold === o.route) return false;
  if (o.setupDone) return false;
  // A server saved before this launch: nothing to configure, and no full-screen wizard.
  if (o.hasServer && !o.session) return false;
  return true;
}

/** Reads the signals. Call during render so the screen follows them. */
export function onboardingVisible(platform: OnboardingPlatform, route: string): boolean {
  return shouldShowOnboarding({ route, platform, force: onboardingForce.value });
}

export function setupVisible(route: string, hasServer: boolean): boolean {
  return shouldShowSetup({
    platform: 'phone',
    route,
    hasServer,
    setupDone: settings.value.setupDone,
    ready: onboardingReady.value,
    pause: onboardingPause.value,
    hold: onboardingHold.value,
    handoff: setupHandoff.value,
    session: setupSession.value,
    tour: onboardingForce.value,
  });
}

export function beginSetupSession(): void {
  setupSession.value = true;
}

/** Skip and the last step. A server saved along the way is what later launches look at. */
export function completeSetup(): void {
  setupSession.value = false;
  setupHandoff.value = false;
  setupStep.value = 'where';
  setupNotice.value = null;
  if (!settings.peek().setupDone) updateSettings({ setupDone: true });
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
  setupHandoff.value = false;
  setupSession.value = false;
  setupStep.value = 'where';
  setupNotice.value = null;
  resetHintRuntime();
}
