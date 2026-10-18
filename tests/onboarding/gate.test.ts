import { describe, it, expect, beforeEach } from 'vitest';
import { sanitizeSettings, settings, updateSettings } from '../../src/store/settings';
import {
  ONBOARDING_VERSION,
  completeOnboarding,
  onboardingPrimary,
  resetOnboardingRuntime,
  shouldShowOnboarding,
} from '../../src/onboarding/gate';
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
  const base = {
    version: 0,
    route: 'library',
    platform: 'phone' as const,
    force: false,
    hold: null,
    ready: true,
    pause: false,
  };

  it('shows on first launch once startup has settled', () => {
    expect(shouldShowOnboarding(base)).toBe(true);
    expect(shouldShowOnboarding({ ...base, ready: false })).toBe(false);
    expect(shouldShowOnboarding({ ...base, version: ONBOARDING_VERSION })).toBe(false);
  });

  it('stays off a running player and off the screen a notification opened', () => {
    expect(shouldShowOnboarding({ ...base, route: 'audiobookPlayer' })).toBe(false);
    expect(shouldShowOnboarding({ ...base, route: 'nowPlaying' })).toBe(false);
    expect(shouldShowOnboarding({ ...base, platform: 'tv', route: 'player' })).toBe(false);
    expect(shouldShowOnboarding({ ...base, route: 'news', hold: 'news' })).toBe(false);
    expect(shouldShowOnboarding({ ...base, route: 'library', hold: 'news' })).toBe(true);
    expect(shouldShowOnboarding({ ...base, pause: true })).toBe(false);
  });

  it('replay from settings shows again, still not over the player', () => {
    expect(shouldShowOnboarding({ ...base, version: ONBOARDING_VERSION, force: true, route: 'settings' })).toBe(true);
    expect(shouldShowOnboarding({ ...base, force: true, route: 'audiobookPlayer' })).toBe(false);
    expect(shouldShowOnboarding({ ...base, platform: 'tv', force: true, route: 'player' })).toBe(false);
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
