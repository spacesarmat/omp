import { t } from '../i18n';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { useFocusable, FocusContext, pause, resume } from '@noriginmedia/norigin-spatial-navigation';
import { badgeFor, TestBadge } from '../testmode/badge';
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
  /** Badge anchor when the focus key is shared or unstable (`src-first`). */
  testAnchor?: string;
  /** Current choice. The badge shows that option's code when it is registered. */
  testValue?: unknown;
  /** Badge text already resolved (dialog rows). Empty hides it. */
  testCode?: string;
  children?: ComponentChildren | ((focused: boolean) => ComponentChildren);
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
  const code = badgeFor(p);
  const cls = 'focusable ' + (p.className || '') + (focused ? ' focused' : '') + (p.disabled ? ' disabled' : '') + (code ? ' test-anchor' : '');
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
      {typeof p.children === 'function' ? (p.children as (f: boolean) => ComponentChildren)(focused) : p.children}
      {code ? <TestBadge code={code} /> : null}
    </div>
  );
}

interface FocusGroupProps {
  focusKey: string;
  className?: string;
  boundary?: boolean;
  autoFocus?: boolean;
  preferredChildFocusKey?: string;
  /**
   * When false, entering this group does not return to the child focused last time.
   * The preferred child is used instead (the top bar always returns to the active tab).
   */
  saveLastFocusedChild?: boolean;
  /** When false, unmounting this group does not move focus to its parent. */
  autoRestoreFocus?: boolean;
  children?: ComponentChildren;
}

export function FocusGroup(p: FocusGroupProps) {
  const { ref, focusKey, focusSelf } = useFocusable({
    focusKey: p.focusKey,
    trackChildren: true,
    saveLastFocusedChild: p.saveLastFocusedChild !== false,
    isFocusBoundary: !!p.boundary,
    preferredChildFocusKey: p.preferredChildFocusKey,
    autoRestoreFocus: p.autoRestoreFocus,
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

export function Button(p: { label: string; icon?: IconName; onPress: () => void; focusKey?: string; className?: string; disabled?: boolean; onFocused?: () => void; onArrow?: (direction: string) => boolean; testAnchor?: string; testValue?: unknown; testCode?: string }) {
  return (
    <Focusable focusKey={p.focusKey} className={'button ' + (p.className || '')} onPress={p.onPress} disabled={p.disabled} onFocused={p.onFocused} onArrow={p.onArrow} testAnchor={p.testAnchor} testValue={p.testValue} testCode={p.testCode}>
      {p.icon && <Icon name={p.icon} size={28} class="button-icon" />}{p.label}
    </Focusable>
  );
}

/**
 * A square icon button. With `expand` the focused button shows its label as a chip under it: absolutely placed, so the
 * button keeps its width and the bar its height. `labelEdge` pins the chip to the button's start or end edge instead of
 * centering it, for the buttons at the screen's edges, so the chip never runs off the screen.
 */
export function IconButton(p: { icon: IconName; label: string; onPress: () => void; focusKey?: string; disabled?: boolean; onFocused?: () => void; onArrow?: (direction: string) => boolean; expand?: boolean; labelEdge?: 'start' | 'end'; dot?: boolean; testAnchor?: string; testValue?: unknown; testCode?: string }) {
  return (
    <Focusable focusKey={p.focusKey} className="icon-button" onPress={p.onPress} disabled={p.disabled} onFocused={p.onFocused} onArrow={p.onArrow} ariaLabel={p.label} role="button" testAnchor={p.testAnchor} testValue={p.testValue} testCode={p.testCode}>
      {(focused: boolean) => [
        <Icon key="i" name={p.icon} size={28} />,
        p.expand && focused ? <span key="l" class={'icon-btn-label' + (p.labelEdge ? ' icon-btn-label--' + p.labelEdge : '')}>{p.label}</span> : null,
        p.dot ? <span key="d" class="icon-dot" /> : null,
      ]}
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
  testCode?: string;
}

/**
 * An address field asks the keyboard for its URL layout (digits, «.», «:» and «/» on the first page where the keyboard
 * has one) in Latin letters, with no capitals or corrections. Plain attributes: Chrome 53 (LG) ignores the ones it
 * does not know.
 */
export const URL_KEYBOARD: { [k: string]: string } = { inputmode: 'url', autocapitalize: 'off', autocorrect: 'off', autocomplete: 'off', spellcheck: 'false', lang: 'en' };

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
  const code = badgeFor({ focusKey: p.focusKey, testCode: p.testCode });
  return (
    <div
      ref={ref}
      class={'focusable text-input' + (focused ? ' focused' : '') + (code ? ' test-anchor' : '')}
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
      {code ? <TestBadge code={code} /> : null}
    </div>
  );
}

interface ChoiceRowProps<T> {
  focusKey?: string;
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  /** Up/down (left/right already cycle the value). */
  onArrow?: (direction: string) => boolean;
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
      testValue={p.value}
      onPress={() => step(1)}
      onArrow={(dir) => {
        if (dir === 'left') { step(-1); return false; }
        if (dir === 'right') { step(1); return false; }
        return p.onArrow ? p.onArrow(dir) : true;
      }}
    >
      <span class="choice-label">{p.label}</span>
      <span class="choice-value"><Icon name="chevronLeft" size={22} />{p.options[idx] ? p.options[idx].label : ''}<Icon name="chevronRight" size={22} /></span>
    </Focusable>
  );
}

/** Settings row with a number: ← / → step it inside [min, max] (no wrap), OK steps up and wraps to min. */
export function StepperRow(p: {
  focusKey?: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
  onArrow?: (direction: string) => boolean;
}) {
  const set = (v: number) => {
    const n = v < p.min ? p.min : v > p.max ? p.max : v;
    if (n !== p.value) p.onChange(n);
  };
  return (
    <Focusable
      focusKey={p.focusKey}
      className="choice-row stepper-row"
      onPress={() => p.onChange(p.value + p.step > p.max ? p.min : p.value + p.step)}
      onArrow={(dir) => {
        if (dir === 'left') { set(p.value - p.step); return false; }
        if (dir === 'right') { set(p.value + p.step); return false; }
        return p.onArrow ? p.onArrow(dir) : true;
      }}
    >
      <span class="choice-label">{p.label}</span>
      <span class="choice-value"><Icon name="chevronLeft" size={22} />{p.value + ' ' + p.unit}<Icon name="chevronRight" size={22} /></span>
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

export function ErrorView(p: {
  message: string;
  /** Second line under the title (player errors). */
  detail?: string;
  actions: { label: string; onPress: () => void; focusKey?: string; className?: string }[];
  /** D-pad focus lands here (the primary button). */
  preferredChildFocusKey?: string;
}) {
  return (
    <div class="error-view">
      <div class="message">{p.message}</div>
      {p.detail ? <div class="details">{p.detail}</div> : null}
      <FocusGroup focusKey="ERROR-ACTIONS" className="actions" autoFocus preferredChildFocusKey={p.preferredChildFocusKey}>
        {p.actions.map((a) => <Button key={a.focusKey || a.label} focusKey={a.focusKey} className={a.className} label={a.label} onPress={a.onPress} />)}
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
