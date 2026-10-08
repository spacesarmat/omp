import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../../../src/i18n';
import {
  KEYPAD_ROWS, keypadEdit, addressInputMode, setAddressInputMode, type KeypadKey, type AddressEdit,
} from '../../../src/lib/addressKeypad';
import { Icon } from './Icon';
import { useLongPress } from './longPress';
import { vibrate } from './vibrate';

const BACKSPACE = 'M9 5h11v14H9l-6-7zM12 9l6 6M18 9l-6 6';
const KEYBOARD = 'M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8';

interface Props {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** The wide key («Подключиться»): the keypad hides, then this runs. */
  onSubmit: () => void;
  submitLabel: string;
}

/** Class on <html> while the keypad is up: the tab bar steps aside and the screen gets room under the field. */
const OPEN_CLASS = 'm-keypad-open';

/**
 * The TorrServer address on the phone: OMP's keypad docked at the bottom instead of the system keyboard
 * (inputmode="none": the field keeps its caret, no IME). A tap in the field moves the caret and the keys edit there;
 * a long press on ⌫ clears the field. «Клавиатура» switches to the system keyboard for host names, «123» by the field
 * back; the choice is remembered on this device.
 */
export function AddressInput(p: Props) {
  const mode = addressInputMode.value;
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const pad = useRef<HTMLDivElement>(null);
  // the latest text, also between two quick taps before a re-render
  const valueRef = useRef(p.value);
  valueRef.current = p.value;
  const caret = useRef<number | null>(null);
  const keypad = mode === 'keypad';
  const shown = keypad && open;

  useEffect(() => {
    if (!shown) return;
    const root = document.documentElement;
    root.classList.add(OPEN_CLASS);
    const el = input.current;
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    // a tap anywhere but the field and the keypad hides it
    const outside = (e: Event) => {
      const n = e.target as Node;
      if ((wrap.current && wrap.current.contains(n)) || (pad.current && pad.current.contains(n))) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      root.classList.remove(OPEN_CLASS);
    };
  }, [shown]);

  // the caret goes where the edit left it (after the value is in the field)
  useEffect(() => {
    const el = input.current;
    if (caret.current === null || !el || document.activeElement !== el) return;
    const at = caret.current;
    caret.current = null;
    try { el.setSelectionRange(at, at); } catch { /* not a text field */ }
  });

  const selection = (): AddressEdit => {
    const v = valueRef.current;
    const el = input.current;
    // edits go to the caret while the field has it, to the end otherwise
    if (el && document.activeElement === el && el.selectionStart !== null && el.selectionEnd !== null) {
      return { value: v, start: el.selectionStart, end: el.selectionEnd };
    }
    return { value: v, start: v.length, end: v.length };
  };

  const edit = (k: KeypadKey) => {
    const r = keypadEdit(selection(), k);
    valueRef.current = r.value;
    caret.current = r.start;
    if (r.value !== p.value) p.onChange(r.value);
    else {
      const el = input.current;
      if (el && document.activeElement === el) try { el.setSelectionRange(r.start, r.end); } catch { /* not a text field */ }
    }
  };

  const toSystem = () => {
    setOpen(false);
    setAddressInputMode('system');
    const el = input.current;
    if (!el) return;
    // the system keyboard opens on the same field, at once (still in the tap)
    el.setAttribute('inputmode', 'url');
    el.blur();
    el.focus();
  };

  const toKeypad = () => {
    setAddressInputMode('keypad');
    const el = input.current;
    if (el) {
      el.setAttribute('inputmode', 'none');
      el.blur();
      el.focus();
    }
    setOpen(true);
  };

  const press = (k: KeypadKey) => {
    vibrate();
    if (k === 'system') return toSystem();
    if (k === 'submit') {
      setOpen(false);
      if (input.current) input.current.blur();
      p.onSubmit();
      return;
    }
    edit(k);
  };

  // the live mode: a switch focuses the field before this render has the new one
  const openIfKeypad = () => { if (addressInputMode.value === 'keypad') setOpen(true); };
  return (
    <div class="m-addr" ref={wrap}>
      <div class="m-addr-row">
        <input
          ref={input}
          id={p.id}
          class={'m-input m-addr-input' + (open ? ' m-addr-input--open' : '')}
          type="text"
          inputMode={keypad ? 'none' : 'url'}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellcheck={false}
          placeholder={p.placeholder}
          value={p.value}
          onFocus={openIfKeypad}
          onClick={openIfKeypad}
          onInput={(e) => p.onChange((e.target as HTMLInputElement).value)}
        />
        {!keypad && (
          <button type="button" class="m-addr-switch" aria-label={t('keypad.toKeypad')} onClick={toKeypad}>
            {t('keypad.toKeypadShort')}
          </button>
        )}
      </div>
      {shown && (
        <Keypad padRef={pad} submitLabel={p.submitLabel} onKey={press} onClear={() => { vibrate(); edit('clear'); }} />
      )}
    </div>
  );
}

function Keypad(p: { padRef: { current: HTMLDivElement | null }; submitLabel: string; onKey: (k: KeypadKey) => void; onClear: () => void }) {
  const erase = useLongPress(p.onClear, () => p.onKey('back'));
  return (
    <div
      class="m-keypad"
      ref={p.padRef}
      role="group"
      // taps on the keys keep the focus (and the caret) in the field
      onMouseDown={(e) => e.preventDefault()}
    >
      {KEYPAD_ROWS.map((row) =>
        row.map((k) => {
          const cls = 'm-kp-key m-kp-key--' + k + (k === 'submit' ? ' m-btn-primary' : '');
          if (k === 'back') {
            return (
              <button key={k} type="button" class={cls} aria-label={t('keypad.backspace')} {...erase}>
                <Icon d={BACKSPACE} size={26} />
              </button>
            );
          }
          return (
            <button key={k} type="button" class={cls} onClick={() => p.onKey(k)}>
              {k === 'system' ? (
                <>
                  <Icon d={KEYBOARD} size={20} />
                  <span class="m-kp-small">{t('keypad.keyboard')}</span>
                </>
              ) : k === 'http' ? 'http://' : k === 'https' ? 'https://' : k === 'submit' ? p.submitLabel : k}
            </button>
          );
        }),
      )}
    </div>
  );
}
