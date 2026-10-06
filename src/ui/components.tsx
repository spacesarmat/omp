import { t } from '../i18n';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { useFocusable, FocusContext, pause, resume } from '@noriginmedia/norigin-spatial-navigation';
import { scrollIntoViewSafe } from './focus';
import { Icon, IconName } from './icons';

interface FocusableProps {
  focusKey?: string;
  onPress?: () => void;
  onArrow?: (direction: string) => boolean;
  onFocused?: () => void;
  className?: string;
  disabled?: boolean;
  /** Accessible name of the element (with role, if given). */
  ariaLabel?: string;
  role?: 'button' | 'group' | 'radio';
  /** aria-checked of a radio. */
  ariaChecked?: boolean;
  children?: ComponentChildren;
}

export function Focusable(p: FocusableProps) {
  const { ref, focused, focusSelf, focusKey } = useFocusable({
    focusKey: p.focusKey,
    focusable: !p.disabled,
    onEnterPress: () => { if (p.onPress) p.onPress(); },
    onArrowPress: (direction: string) => (p.onArrow ? p.onArrow(direction) : true),
    onFocus: () => {
      scrollIntoViewSafe(ref.current);
      if (p.onFocused) p.onFocused();
    },
  });
  const cls = 'focusable ' + (p.className || '') + (focused ? ' focused' : '') + (p.disabled ? ' disabled' : '');
  return (
    <div
      ref={ref}
      class={cls}
      data-fk={focusKey}
      role={p.role}
      aria-label={p.ariaLabel}
      aria-checked={p.ariaChecked}
      onMouseEnter={() => { if (!p.disabled) focusSelf(); }}
      onClick={() => { if (!p.disabled && p.onPress) p.onPress(); }}
    >
      {p.children}
    </div>
  );
}

interface FocusGroupProps {
  focusKey: string;
  className?: string;
  boundary?: boolean;
  autoFocus?: boolean;
  preferredChildFocusKey?: string;
  children?: ComponentChildren;
}

export function FocusGroup(p: FocusGroupProps) {
  const { ref, focusKey, focusSelf } = useFocusable({
    focusKey: p.focusKey,
    trackChildren: true,
    saveLastFocusedChild: true,
    isFocusBoundary: !!p.boundary,
    preferredChildFocusKey: p.preferredChildFocusKey,
  });
  useEffect(() => {
    if (p.autoFocus) focusSelf();
  }, []);
  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} class={p.className}>{p.children}</div>
    </FocusContext.Provider>
  );
}

export function Button(p: { label: string; icon?: IconName; onPress: () => void; focusKey?: string; className?: string; disabled?: boolean; onFocused?: () => void }) {
  return (
    <Focusable focusKey={p.focusKey} className={'button ' + (p.className || '')} onPress={p.onPress} disabled={p.disabled} onFocused={p.onFocused}>
      {p.icon && <Icon name={p.icon} size={28} class="button-icon" />}{p.label}
    </Focusable>
  );
}

export function IconButton(p: { icon: IconName; label: string; onPress: () => void; focusKey?: string; disabled?: boolean; onFocused?: () => void }) {
  return (
    <Focusable focusKey={p.focusKey} className="icon-button" onPress={p.onPress} disabled={p.disabled} onFocused={p.onFocused}>
      <Icon name={p.icon} size={28} />
      <span class="icon-button-label">{p.label}</span>
    </Focusable>
  );
}

interface TextInputProps {
  focusKey?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  onSubmit?: () => void;
  onFocused?: () => void;
  type?: 'text' | 'password' | 'url';
}

/**
 * An address field asks the keyboard for its URL layout (digits, «.», «:» and «/» on the first page where the keyboard
 * has one) in Latin letters, with no capitals or corrections. Plain attributes: Chrome 53 (LG) ignores the ones it
 * does not know.
 */
const URL_KEYBOARD: { [k: string]: string } = { inputmode: 'url', autocapitalize: 'off', autocorrect: 'off', autocomplete: 'off', spellcheck: 'false', lang: 'en' };

/** Spatial-nav item that opens the system keyboard (TV or LG ThinQ phone keyboard) on OK. */
export function TextInput(p: TextInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { ref, focused, focusSelf, focusKey } = useFocusable({
    focusKey: p.focusKey,
    onEnterPress: () => { if (inputRef.current) inputRef.current.focus(); },
    onFocus: () => {
      scrollIntoViewSafe(ref.current);
      if (p.onFocused) p.onFocused();
    },
  });
  // resume() is idempotent: unmounting a focused input must not leave navigation paused
  useEffect(() => () => resume(), []);
  return (
    <div
      ref={ref}
      class={'focusable text-input' + (focused ? ' focused' : '')}
      data-fk={focusKey}
      onMouseEnter={() => focusSelf()}
      onClick={() => { if (inputRef.current) inputRef.current.focus(); }}
    >
      <input
        ref={inputRef}
        type={(p.type || 'text') as 'text'}
        {...(p.type === 'url' ? URL_KEYBOARD : {})}
        value={p.value}
        placeholder={p.placeholder}
        onInput={(e) => p.onChange((e.target as HTMLInputElement).value)}
        onFocus={() => pause()}
        onBlur={() => resume()}
        onKeyDown={(e) => {
          if (e.keyCode === 13) {
            e.preventDefault();
            e.stopPropagation();
            if (inputRef.current) inputRef.current.blur();
            if (p.onSubmit) p.onSubmit();
          }
        }}
      />
    </div>
  );
}

interface ChoiceRowProps<T> {
  focusKey?: string;
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}

/** Settings row: OK / ← / → cycle through options. */
export function ChoiceRow<T>(p: ChoiceRowProps<T>) {
  let idx = 0;
  for (let i = 0; i < p.options.length; i++) if (p.options[i].value === p.value) idx = i;
  const step = (d: number) => {
    const n = p.options.length;
    p.onChange(p.options[(idx + d + n) % n].value);
  };
  return (
    <Focusable
      focusKey={p.focusKey}
      className="choice-row"
      onPress={() => step(1)}
      onArrow={(dir) => {
        if (dir === 'left') { step(-1); return false; }
        if (dir === 'right') { step(1); return false; }
        return true;
      }}
    >
      <span class="choice-label">{p.label}</span>
      <span class="choice-value"><Icon name="chevronLeft" size={22} />{p.options[idx] ? p.options[idx].label : ''}<Icon name="chevronRight" size={22} /></span>
    </Focusable>
  );
}

export const onOff = () => [
  { value: true, label: t('tv.on') },
  { value: false, label: t('tv.off') },
];

export function Spinner(p: { text?: string }) {
  return (
    <div class="spinner-wrap">
      <div class="spinner" />
      {p.text && <div class="spinner-text">{p.text}</div>}
    </div>
  );
}

export function ErrorView(p: { message: string; actions: { label: string; onPress: () => void }[] }) {
  return (
    <div class="error-view">
      <div class="message">{p.message}</div>
      <FocusGroup focusKey="ERROR-ACTIONS" className="actions" autoFocus>
        {p.actions.map((a) => <Button key={a.label} label={a.label} onPress={a.onPress} />)}
      </FocusGroup>
    </div>
  );
}

export function ProgressBar(p: { ratio: number }) {
  return (
    <div class="progress">
      <div class="progress-fill" style={{ width: Math.round(Math.max(0, Math.min(1, p.ratio)) * 100) + '%' }} />
    </div>
  );
}
