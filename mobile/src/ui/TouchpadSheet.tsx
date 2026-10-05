import { Sheet } from './Sheet';
import { touchpad, updateTouchpad } from '../tv/touchpad';
import { t } from '../../../src/i18n';

function Switch(p: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={p.on} aria-label={p.label} class={'m-switch' + (p.on ? ' on' : '')} onClick={p.onToggle}>
      <span class="m-switch-knob" />
    </button>
  );
}

/** Bottom sheet with the touchpad settings; every change is saved at once. */
export function TouchpadSheet({ onClose }: { onClose: () => void }) {
  const s = touchpad.value;
  return (
    <Sheet onClose={onClose} label={t('remote.touchpad.label')}>
      <div class="m-sheet-title">{t('remote.touchpad.title')}</div>
      <div class="m-tp-group">
        <div class="m-tp-head">
          <span class="m-tp-label">{t('remote.touchpad.speed')}</span>
          <span class="m-muted m-small">{t('remote.touchpad.speedOf', { n: s.speed })}</span>
        </div>
        <div class="m-tp-steps" role="radiogroup" aria-label={t('remote.touchpad.speed')}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={s.speed === n}
              aria-label={t('remote.touchpad.speedN', { n })}
              class={'m-tp-step' + (n <= s.speed ? ' on' : '')}
              onClick={() => updateTouchpad({ speed: n })}
            />
          ))}
        </div>
        <div class="m-tp-ends m-muted m-small">
          <span>{t('remote.touchpad.slow')}</span>
          <span>{t('remote.touchpad.fast')}</span>
        </div>
      </div>
      <div class="m-tp-row">
        <div class="m-tp-text">
          <span class="m-tp-label">{t('remote.touchpad.accel')}</span>
          <span class="m-muted m-small">{t('remote.touchpad.accelHint')}</span>
        </div>
        <Switch on={s.accel} label={t('remote.touchpad.accel')} onToggle={() => updateTouchpad({ accel: !s.accel })} />
      </div>
      <div class="m-tp-row">
        <div class="m-tp-text">
          <span class="m-tp-label">{t('remote.touchpad.tap')}</span>
          <span class="m-muted m-small">{t('remote.touchpad.tapHint')}</span>
        </div>
        <Switch on={s.tapClick} label={t('remote.touchpad.tap')} onToggle={() => updateTouchpad({ tapClick: !s.tapClick })} />
      </div>
      <div class="m-tp-row">
        <div class="m-tp-text">
          <span class="m-tp-label">{t('remote.touchpad.invert')}</span>
          <span class="m-muted m-small">{t('remote.touchpad.invertHint')}</span>
        </div>
        <Switch on={s.invertScroll} label={t('remote.touchpad.invert')} onToggle={() => updateTouchpad({ invertScroll: !s.invertScroll })} />
      </div>
      <button type="button" class="m-btn m-btn-primary" onClick={onClose}>
        {t('common.done')}
      </button>
    </Sheet>
  );
}
