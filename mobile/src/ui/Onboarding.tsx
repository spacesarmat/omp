import { useState } from 'preact/hooks';
import { t } from '../../../src/i18n';
import {
  completeOnboarding,
  onboardingActionLabel,
  onboardingPrimary,
  type OnboardingAction,
} from '../../../src/onboarding/gate';
import { onboardingSlides, type OnboardingIcon } from '../../../src/onboarding/slides';
import { Logo } from '../../../src/ui/Logo';
import { activeServer } from '../../../src/store/servers';
import { currentRoute, navigate } from '../nav';
import { useBackHandler } from './backStack';
import { Icon, ICONS } from './Icon';

const PHONE = 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2';
const STAR = 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z';

const PATHS: { [K in Exclude<OnboardingIcon, 'logo'>]: string } = {
  server: PHONE,
  play: ICONS.play,
  audio: ICONS.volume,
  star: STAR,
  help: ICONS.settings,
};

function SlideIcon({ name }: { name: OnboardingIcon }) {
  if (name === 'logo') return <Logo size={72} />;
  return (
    <span class="m-onb-badge">
      <Icon d={PATHS[name]} size={36} />
    </span>
  );
}

function finish(action: OnboardingAction): void {
  const connect = action === 'connect';
  completeOnboarding();
  if (connect && currentRoute.peek().name !== 'connect') navigate({ name: 'connect' });
}

/** First-run tour. Skip and the last step both store the version; Back steps back, and leaves on the first screen. */
export function Onboarding() {
  const slides = onboardingSlides('phone');
  const [i, setI] = useState(0);
  const slide = slides[Math.min(i, slides.length - 1)];
  const last = i >= slides.length - 1;
  const action = onboardingPrimary(last, !!activeServer.value, currentRoute.value.name);
  const paragraphs = t(slide.body).split('\n\n');

  function back() {
    if (i > 0) setI(i - 1);
    else finish('start');
  }

  useBackHandler(back);

  return (
    <div
      class="m-onb"
      role="dialog"
      aria-modal="true"
      aria-label={t(slide.title)}
      data-onboarding="phone"
      data-code="PD43"
      data-slide={slide.id}
      data-step={i}
    >
      <div class="m-onb-step">{t('onboarding.step', { n: i + 1, total: slides.length })}</div>
      <div class="m-onb-main">
        <SlideIcon name={slide.icon} />
        <h1>{t(slide.title)}</h1>
        {paragraphs.map((p, n) => (
          <p key={n} class="m-onb-text">
            {p}
          </p>
        ))}
      </div>
      <div class="m-onb-dots" aria-hidden="true">
        {slides.map((s, n) => (
          <span key={s.id} class={'m-onb-dot' + (n === i ? ' on' : '')} />
        ))}
      </div>
      <div class="m-onb-actions">
        <button type="button" class="m-btn m-btn-secondary" data-action="skip" onClick={() => finish('start')}>
          {t('onboarding.skip')}
        </button>
        <button type="button" class="m-btn m-btn-primary" data-action={action} onClick={() => (last ? finish(action) : setI(i + 1))}>
          {onboardingActionLabel(action)}
        </button>
      </div>
    </div>
  );
}
