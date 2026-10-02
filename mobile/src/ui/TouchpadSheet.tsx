import { Sheet } from './Sheet';
import { touchpad, updateTouchpad } from '../tv/touchpad';

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
    <Sheet onClose={onClose} label="Настройки тачпада">
      <div class="m-sheet-title">Тачпад</div>
      <div class="m-tp-group">
        <div class="m-tp-head">
          <span class="m-tp-label">Скорость курсора</span>
          <span class="m-muted m-small">{s.speed + ' из 5'}</span>
        </div>
        <div class="m-tp-steps" role="radiogroup" aria-label="Скорость курсора">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={s.speed === n}
              aria-label={'Скорость ' + n}
              class={'m-tp-step' + (n <= s.speed ? ' on' : '')}
              onClick={() => updateTouchpad({ speed: n })}
            />
          ))}
        </div>
        <div class="m-tp-ends m-muted m-small">
          <span>Медленно</span>
          <span>Быстро</span>
        </div>
      </div>
      <div class="m-tp-row">
        <div class="m-tp-text">
          <span class="m-tp-label">Ускорение</span>
          <span class="m-muted m-small">Быстрое движение пальца сдвигает курсор дальше</span>
        </div>
        <Switch on={s.accel} label="Ускорение" onToggle={() => updateTouchpad({ accel: !s.accel })} />
      </div>
      <div class="m-tp-row">
        <div class="m-tp-text">
          <span class="m-tp-label">Касание = щелчок</span>
          <span class="m-muted m-small">Короткое касание тачпада нажимает OK</span>
        </div>
        <Switch on={s.tapClick} label="Касание = щелчок" onToggle={() => updateTouchpad({ tapClick: !s.tapClick })} />
      </div>
      <div class="m-tp-row">
        <div class="m-tp-text">
          <span class="m-tp-label">Обратная прокрутка</span>
          <span class="m-muted m-small">Если страница на ТВ едет не в ту сторону</span>
        </div>
        <Switch on={s.invertScroll} label="Обратная прокрутка" onToggle={() => updateTouchpad({ invertScroll: !s.invertScroll })} />
      </div>
      <button type="button" class="m-btn m-btn-primary" onClick={onClose}>
        Готово
      </button>
    </Sheet>
  );
}
