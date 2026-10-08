import { useEffect, useRef, useState } from 'preact/hooks';
import { useFocusable, setFocus, doesFocusableExist } from '@noriginmedia/norigin-spatial-navigation';
import { t } from '../i18n';
import { Focusable, FocusGroup, TextInput, URL_KEYBOARD } from './components';
import { Icon } from './icons';
import { useKeys } from './keys';
import { scrollIntoViewSafe } from './focus';
import {
  KEYPAD_ROWS, KeypadKey, keypadEditAtEnd, keypadMove, digitOfKeyCode, addressInputMode, setAddressInputMode,
} from '../lib/addressKeypad';

interface AddressFieldProps {
  focusKey: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** «Готово» on the keypad (and Enter of the system keyboard) calls it after the keypad closes. */
  onSubmit?: () => void;
  /** The wide key's label: «Подключиться» on the connect screen, «Готово» otherwise. */
  submitLabel?: string;
}

/** Focus key of a keypad key. */
export function keypadKeyFk(fieldFk: string, key: KeypadKey): string {
  return fieldFk + '-kp-' + key;
}

function keyLabel(k: KeypadKey, submitLabel: string) {
  if (k === 'back') return <Icon name="backspace" size={34} />;
  if (k === 'system') return [<Icon key="i" name="keyboard" size={30} />, <span key="l" class="kp-key-small">{t('keypad.keyboard')}</span>];
  if (k === 'http') return 'http://';
  if (k === 'https') return 'https://';
  if (k === 'submit') return submitLabel;
  return k;
}

/**
 * The TorrServer address on the TV: OMP's keypad (digits, «.», «:», ⌫, http:// / https://, «Готово», «Клавиатура»)
 * instead of the system keyboard, which on LG and Android TV boxes hands out look-alike characters. OK on the field
 * opens the keypad, Back hides it, the remote's number keys type digits straight away. «Клавиатура» switches to the
 * system keyboard (host names); the choice is remembered on this device. The keypad always edits at the end.
 */
export function AddressField(p: AddressFieldProps) {
  const [open, setOpen] = useState(false);
  if (addressInputMode.value === 'system') {
    return (
      <div class="row address-field address-field--system">
        <TextInput focusKey={p.focusKey} value={p.value} onChange={p.onChange} placeholder={p.placeholder} type="url" onSubmit={p.onSubmit} />
        <Focusable
          focusKey={p.focusKey + '-to-keypad'}
          className="button kp-switch"
          ariaLabel={t('keypad.toKeypad')}
          role="button"
          onPress={() => {
            setOpen(true);
            setAddressInputMode('keypad');
          }}
        >
          {t('keypad.toKeypadShort')}
        </Focusable>
      </div>
    );
  }
  return <KeypadField {...p} open={open} setOpen={setOpen} />;
}

function KeypadField(p: AddressFieldProps & { open: boolean; setOpen: (v: boolean) => void }) {
  const { open, setOpen } = p;
  const fk = p.focusKey;
  // the latest text, also between two quick key presses before a re-render
  const valueRef = useRef(p.value);
  valueRef.current = p.value;
  const lastCol = useRef(0);
  const submitLabel = p.submitLabel || t('keypad.done');

  const { ref, focused, focusSelf } = useFocusable({
    focusKey: fk,
    onEnterPress: () => setOpen(true),
    onFocus: () => scrollIntoViewSafe(ref.current),
  });
  const active = useRef(false);
  active.current = open || focused;

  useEffect(() => {
    if (open && doesFocusableExist(keypadKeyFk(fk, '1'))) setFocus(keypadKeyFk(fk, '1'));
  }, [open]);

  const type = (k: KeypadKey) => {
    const v = keypadEditAtEnd(valueRef.current, k);
    valueRef.current = v;
    p.onChange(v);
  };

  const close = () => {
    setOpen(false);
    if (doesFocusableExist(fk)) setFocus(fk);
  };

  const toSystem = () => {
    setOpen(false);
    setAddressInputMode('system');
    // the system keyboard opens on the same field
    setTimeout(() => {
      if (doesFocusableExist(fk)) setFocus(fk);
      const input = document.querySelector('[data-fk="' + fk + '"] input') as HTMLInputElement | null;
      if (input) input.focus();
    }, 0);
  };

  const press = (k: KeypadKey) => {
    if (k === 'system') return toSystem();
    if (k === 'submit') {
      close();
      if (p.onSubmit) p.onSubmit();
      return;
    }
    type(k);
  };

  // Back hides the keypad; a keyboard's Backspace (8, mapped to «back») erases
  useKeys((a, e) => {
    if (!active.current) return false;
    if (e.keyCode === 8) { type('back'); return true; }
    if (!open) return false;
    if (a === 'back') { close(); return true; }
    return 'spatial';
  }, 80);

  // the remote's number keys (LG 48–57; Android TV KEYCODE_0..9 reach the WebView as 48–57) type digits
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!active.current) return;
      const el = e.target as HTMLInputElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && !el.readOnly) return;
      const d = digitOfKeyCode(e.keyCode);
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      type(d);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  return (
    <div class="address-field">
      <div
        ref={ref}
        class={'focusable text-input address-input' + (focused ? ' focused' : '') + (open ? ' open' : '')}
        data-fk={fk}
        onMouseEnter={() => focusSelf()}
        // the pointer opens the keypad, never the system keyboard
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => { focusSelf(); setOpen(true); }}
      >
        <input
          type="url"
          {...URL_KEYBOARD}
          readOnly
          tabIndex={-1}
          value={p.value}
          placeholder={p.placeholder}
          onInput={(e) => p.onChange((e.target as HTMLInputElement).value)}
        />
      </div>
      {open && (
        <FocusGroup focusKey={fk + '-KEYPAD'} className="keypad" boundary>
          {KEYPAD_ROWS.map((row, r) => (
            <div key={r} class={'kp-row' + (row.length === 1 ? ' kp-row--wide' : '')}>
              {row.map((k, c) => (
                <Focusable
                  key={k}
                  focusKey={keypadKeyFk(fk, k)}
                  className={'kp-key kp-key--' + k + (k === 'submit' ? ' primary' : '')}
                  role="button"
                  ariaLabel={k === 'back' ? t('keypad.backspace') : k === 'system' ? t('keypad.keyboard') : undefined}
                  onFocused={() => { if (row.length > 1) lastCol.current = c; }}
                  onPress={() => press(k)}
                  onArrow={(dir) => {
                    const to = keypadMove(r, row.length > 1 ? c : lastCol.current, dir);
                    if (to) setFocus(keypadKeyFk(fk, KEYPAD_ROWS[to.row][to.col]));
                    return false;
                  }}
                >
                  {keyLabel(k, submitLabel)}
                </Focusable>
              ))}
            </div>
          ))}
          <div class="kp-hint muted">{t('keypad.tvHint')}</div>
        </FocusGroup>
      )}
    </div>
  );
}
