import type { Key } from '../i18n';

export type OnboardingPlatform = 'phone' | 'tv';

/** Drawn with the logo or an icon the app already uses. */
export type OnboardingIcon = 'logo' | 'server' | 'play' | 'audio' | 'star' | 'help';

export interface OnboardingSlide {
  id: string;
  icon: OnboardingIcon;
  title: Key;
  body: Key;
}

/** Phone: connect, catalog, audiobooks, paid search, then help. */
const PHONE: OnboardingSlide[] = [
  { id: 'welcome', icon: 'logo', title: 'onboarding.phone.welcomeTitle', body: 'onboarding.phone.welcomeBody' },
  { id: 'server', icon: 'server', title: 'onboarding.phone.serverTitle', body: 'onboarding.phone.serverBody' },
  { id: 'watch', icon: 'play', title: 'onboarding.phone.watchTitle', body: 'onboarding.phone.watchBody' },
  { id: 'audio', icon: 'audio', title: 'onboarding.phone.audioTitle', body: 'onboarding.phone.audioBody' },
  { id: 'subscription', icon: 'star', title: 'onboarding.phone.subTitle', body: 'onboarding.phone.subBody' },
  { id: 'ready', icon: 'help', title: 'onboarding.phone.readyTitle', body: 'onboarding.phone.readyBody' },
];

/**
 * TV has no audiobook player and no OMP account: paid Jackett/JacRed stay on the phone
 * (a billing source is not sent to the TV). The remote tour is the TV's own flow.
 */
const TV: OnboardingSlide[] = [
  { id: 'welcome', icon: 'logo', title: 'onboarding.tv.welcomeTitle', body: 'onboarding.tv.welcomeBody' },
  { id: 'server', icon: 'server', title: 'onboarding.tv.serverTitle', body: 'onboarding.tv.serverBody' },
  { id: 'watch', icon: 'play', title: 'onboarding.tv.watchTitle', body: 'onboarding.tv.watchBody' },
  { id: 'help', icon: 'help', title: 'onboarding.tv.helpTitle', body: 'onboarding.tv.helpBody' },
  { id: 'ready', icon: 'star', title: 'onboarding.tv.readyTitle', body: 'onboarding.tv.readyBody' },
];

export function onboardingSlides(platform: OnboardingPlatform): OnboardingSlide[] {
  return platform === 'tv' ? TV : PHONE;
}
