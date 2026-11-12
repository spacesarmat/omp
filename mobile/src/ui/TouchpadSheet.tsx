import { useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { Sheet } from './Sheet';
import { cursorGain, touchpad, updateTouchpad } from '../tv/touchpad';
import { t } from '../../../src/i18n';

function Switch(p: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={p.on} aria-label={p.label} class={'m-switch' + (p.on ? ' on' : '')} onClick={p.onToggle}>
      <span class="m-switch-knob" />
    </button>
  );
}

function TryPad() {
  const s = touchpad.value;
  const [p, setP] = useState({ x: 50, y: 50 });
  const last = useRef<{ x: number; y: number; t: number } | null>(null);
  return (
    <div
      class="m-tp-try"
      data-tp-try
      aria-hidden="true"
      onPointerDown={(e) => {
        const el = e.currentTarget as HTMLElement;
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* the test DOM has no capture */
        }
        last.current = { x: e.clientX, y: e.clientY, t: Date.now() };
      }}
      onPointerMove={(e) => {
        const prev = last.current;
        if (!prev) return;
        const dt = Math.max(1, Date.now() - prev.t);
        const dx = e.clientX - prev.x;
        const dy = e.clientY - prev.y;
        const gain = cursorGain(s, Math.hypot(dx, dy) / dt);
        last.current = { x: e.clientX, y: e.clientY, t: Date.now() };
        setP((cur) => ({
          x: Math.min(100, Math.max(0, cur.x + dx * gain * 0.4)),
          y: Math.min(100, Math.max(0, cur.y + dy * gain * 0.4)),
        }));
      }}
      onPointerUp={() => {
        last.current = null;
      }}
      onPointerCancel={() => {
        last.current = null;
      }}
      onLostPointerCapture={() => {
        last.current = null;
      }}
    >
      <span class="m-tp-dot" style={{ left: p.x + '%', top: p.y + '%' }} />
    </div>
  );
}

/** Bottom sheet with the touchpad settings; every change is saved at once.
 * Portaled to document.body so it still covers the screen when Remote sits inside NowDeck (CSS transform). */
export function TouchpadSheet({ onClose }: { onClose: () => void }) {
  const s = touchpad.value;
  if (typeof document === 'undefined') return null;
  return createPortal(
    <Sheet onClose={onClose} testId="PD08" label={t('remote.touchpad.label')}>
      <div class="m-sheet-title">{t('remote.touchpad.title')}</div>
      <div class="m-tp-group">
        <div class="m-tp-head">
          <span class="m-tp-label">{t('remote.touchpad.speed')}</span>
          <span class="m-muted m-small">{t('remote.touchpad.speedOf', { n: s.speed })}</span>
        </div>
        <input
          class="m-tp-range"
          type="range"
          min={1}
          max={5}
          step={1}
          value={s.speed}
          aria-label={t('remote.touchpad.speed')}
          onInput={(e) => updateTouchpad({ speed: Number((e.target as HTMLInputElement).value) })}
        />
        <div class="m-tp-ends m-muted m-small">
          <span>{t('remote.touchpad.slow')}</span>
          <span>{t('remote.touchpad.fast')}</span>
        </div>
        <TryPad />
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
    </Sheet>,
    document.body,
  );
}
