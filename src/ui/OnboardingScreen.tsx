import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { getCurrentFocusKey, setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { focusAfterClose } from './focus';
import { t } from '../i18n';
import {
  completeOnboarding,
  onboardingActionLabel,
  onboardingPrimary,
  resumeOnboarding,
  type OnboardingAction,
} from '../onboarding/gate';
import { onboardingSlides, type OnboardingIcon } from '../onboarding/slides';
import { activeServer } from '../store/servers';
import { currentRoute, navigate } from './nav';
import { FocusGroup, Button } from './components';
import { Icon, type IconName } from './icons';
import { Logo } from './Logo';
import { pushKeyHandler } from './keys';

const ICONS: { [K in Exclude<OnboardingIcon, 'logo'>]: IconName } = {
  server: 'phone',
  play: 'play',
  audio: 'tracks',
  star: 'star',
  help: 'settings',
};

function SlideIcon({ name }: { name: OnboardingIcon }) {
  if (name === 'logo') return <Logo size={120} />;
  return (
    <div class="onb-badge">
      <Icon name={ICONS[name]} size={72} />
    </div>
  );
}

function finish(action: OnboardingAction): void {
  const connect = action === 'connect';
  completeOnboarding();
  resumeOnboarding();
  if (connect && currentRoute.peek().name !== 'connect') navigate({ name: 'connect' });
}

/**
 * TV tour. Two focusable buttons: Skip and Next / Start / Connect a server.
 * Left and Right move between them; Back steps to the previous screen, and skips on the first.
 */
export function OnboardingScreen() {
  const slides = onboardingSlides('tv');
  const [i, setI] = useState(0);
  const step = useRef(i);
  step.current = i;
  const slide = slides[Math.min(i, slides.length - 1)];
  const last = i >= slides.length - 1;
  const action = onboardingPrimary(last, !!activeServer.value, currentRoute.value.name);
  const paragraphs = t(slide.body).split('\n\n');

  // Layout, not a passive effect: the remote must hit this screen on the same commit it appears.
  useLayoutEffect(() => {
    let prev = '';
    try {
      prev = getCurrentFocusKey() || '';
    } catch (e) {
      prev = '';
    }
    // The tour covers Settings. Back and «Начать» return to the button that opened it.
    if (!prev || prev === 'onb-next' || prev === 'onb-skip') prev = 'set-onboarding';
    const offKeys = pushKeyHandler((a) => {
      if (a === 'back') {
        if (step.current > 0) setI(step.current - 1);
        else finish('start');
        return true;
      }
      // The row is only two buttons: move explicitly so a remote does not depend on measured layout.
      if (a === 'left') {
        setFocus('onb-skip');
        return true;
      }
      if (a === 'right') {
        setFocus('onb-next');
        return true;
      }
      return 'spatial';
    }, 80);
    return () => {
      offKeys();
      focusAfterClose(prev);
    };
  }, []);

  return (
    <div class="onboarding-host" role="dialog" aria-modal="true" aria-label={t(slide.title)} data-onboarding="tv" data-slide={slide.id} data-step={i}>
      <FocusGroup key={slide.id} focusKey="ONBOARDING" className="onboarding" boundary autoFocus preferredChildFocusKey="onb-next">
        <div class="onb-step">{t('onboarding.step', { n: i + 1, total: slides.length })}</div>
        <div class="onb-main">
          <SlideIcon name={slide.icon} />
          <h1>{t(slide.title)}</h1>
          {paragraphs.map((p, n) => (
            <p key={n} class="onb-text">
              {p}
            </p>
          ))}
        </div>
        <div class="onb-dots" aria-hidden="true">
          {slides.map((s, n) => (
            <span key={s.id} class={'onb-dot' + (n === i ? ' on' : '')} />
          ))}
        </div>
        <div class="onb-actions">
          <Button focusKey="onb-skip" label={t('onboarding.skip')} onPress={() => finish('start')} />
          <Button focusKey="onb-next" className="primary" label={onboardingActionLabel(action)} onPress={() => (last ? finish(action) : setI(i + 1))} />
        </div>
      </FocusGroup>
    </div>
  );
}
