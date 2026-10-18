import { describe, it, expect, beforeEach } from 'vitest';
import { sanitizeSettings, settings, updateSettings } from '../../src/store/settings';
import {
  ONBOARDING_VERSION,
  completeOnboarding,
  onboardingPrimary,
  resetOnboardingRuntime,
  shouldShowOnboarding,
  shouldShowSetup,
} from '../../src/onboarding/gate';
import { markHintSeen, pickHint, resetHints } from '../../src/onboarding/hints';
import { onboardingSlides } from '../../src/onboarding/slides';

beforeEach(() => {
  localStorage.clear();
  resetOnboardingRuntime();
  updateSettings({ onboardingVersion: 0 });
});

describe('onboarding persistence', () => {
  it('is unfinished for a new install and for saved settings that predate the tour', () => {
    expect(settings.value.onboardingVersion).toBe(0);
    expect(sanitizeSettings({}).onboardingVersion).toBe(0);
    expect(sanitizeSettings({ seekStep: 30 }).onboardingVersion).toBe(0);
    expect(sanitizeSettings({ onboardingVersion: '1' }).onboardingVersion).toBe(0);
    expect(sanitizeSettings({ onboardingVersion: -2 }).onboardingVersion).toBe(0);
    expect(sanitizeSettings({ onboardingVersion: 1.8 }).onboardingVersion).toBe(1);
    expect(sanitizeSettings({}).setupDone).toBe(false);
    expect(sanitizeSettings({ setupDone: true }).setupDone).toBe(true);
    expect(sanitizeSettings({ seenHints: { catalog: true, 'no pe': true, n: 1 } }).seenHints).toEqual({ catalog: true });
  });

  it('skip and the last step store the version', () => {
    completeOnboarding();
    expect(settings.value.onboardingVersion).toBe(ONBOARDING_VERSION);
    expect(JSON.parse(localStorage.getItem('tsp.settings')!).onboardingVersion).toBe(ONBOARDING_VERSION);
    completeOnboarding();
    expect(settings.value.onboardingVersion).toBe(ONBOARDING_VERSION);
  });
});

describe('shouldShowOnboarding', () => {
  const base = { route: 'library', platform: 'phone' as const, force: false };

  it('stays hidden until Settings opens it, and never over a player', () => {
    expect(shouldShowOnboarding(base)).toBe(false);
    expect(shouldShowOnboarding({ ...base, force: true, route: 'settings' })).toBe(true);
    expect(shouldShowOnboarding({ ...base, force: true, route: 'audiobookPlayer' })).toBe(false);
    expect(shouldShowOnboarding({ ...base, platform: 'tv', force: true, route: 'player' })).toBe(false);
    expect(shouldShowOnboarding({ ...base, platform: 'tv', force: false })).toBe(false);
  });
});

describe('shouldShowSetup', () => {
  const base = {
    platform: 'phone' as const,
    route: 'connect',
    hasServer: false,
    setupDone: false,
    ready: true,
    pause: false,
    hold: null as string | null,
    handoff: false,
    session: false,
    tour: false,
  };

  it('shows on a first launch with no server, and not when one is already saved', () => {
    expect(shouldShowSetup(base)).toBe(true);
    expect(shouldShowSetup({ ...base, hasServer: true })).toBe(false);
    expect(shouldShowSetup({ ...base, setupDone: true })).toBe(false);
    expect(shouldShowSetup({ ...base, ready: false })).toBe(false);
    expect(shouldShowSetup({ ...base, platform: 'tv' })).toBe(false);
  });

  it('stays off a player and a notification, and stays up after this session connects', () => {
    expect(shouldShowSetup({ ...base, route: 'nowPlaying' })).toBe(false);
    expect(shouldShowSetup({ ...base, route: 'news', hold: 'news' })).toBe(false);
    expect(shouldShowSetup({ ...base, hasServer: true, session: true })).toBe(true);
    expect(shouldShowSetup({ ...base, tour: true })).toBe(false);
    expect(shouldShowSetup({ ...base, handoff: true })).toBe(false);
  });
});

describe('hints', () => {
  it('shows one unseen hint, remembers it, and comes back after a reset', () => {
    expect(pickHint(['catalog', 'mine'], {})).toBe('catalog');
    expect(pickHint(['mine', 'catalog'], { catalog: true })).toBe('mine');
    expect(pickHint(['catalog'], { catalog: true })).toBeNull();
    expect(pickHint(['futureFeature'], {}, () => true)).toBe('futureFeature');
    expect(pickHint(['catalog'], {}, () => false)).toBeNull();
    markHintSeen('catalog');
    expect(settings.value.seenHints.catalog).toBe(true);
    expect(JSON.parse(localStorage.getItem('tsp.settings')!).seenHints.catalog).toBe(true);
    resetHints();
    expect(settings.value.seenHints.catalog).toBeUndefined();
  });
});

describe('onboarding slides', () => {
  it('is a short tour, and the last step connects a server only when there is none', () => {
    expect(onboardingSlides('phone').length).toBeGreaterThanOrEqual(4);
    expect(onboardingSlides('phone').length).toBeLessThanOrEqual(6);
    expect(onboardingSlides('tv').length).toBeGreaterThanOrEqual(4);
    expect(onboardingSlides('tv').length).toBeLessThanOrEqual(6);
    expect(onboardingPrimary(false, false, 'library')).toBe('next');
    expect(onboardingPrimary(true, false, 'library')).toBe('connect');
    expect(onboardingPrimary(true, false, 'connect')).toBe('start');
    expect(onboardingPrimary(true, true, 'library')).toBe('start');
  });
});
