// A text field with a clear button inside, on the right. The button is absent while the field is empty.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { t } from '../../../src/i18n';
import { ClearMark } from '../../../src/ui/clearField';

type Props = JSX.IntrinsicElements['input'] & {
  testCode?: string;
  /** Extra attributes on the clear button (for example data-subs-clear). */
  clearAttrs?: { [k: string]: string };
  clearLabel?: string;
};

function assignRef(ref: Props['ref'], el: HTMLInputElement | null) {
  if (!ref) return;
  if (typeof ref === 'function') ref(el);
  else (ref as { current: HTMLInputElement | null }).current = el;
}

export function TextField(p: Props) {
  const { testCode, clearAttrs, clearLabel, ref, onInput, class: cls, className, ...rest } = p;
  const inner = useRef<HTMLInputElement>(null);
  const controlled = p.value != null;
  const [local, setLocal] = useState(controlled ? String(p.value) : '');
  useEffect(() => {
    if (controlled) setLocal(String(p.value));
  }, [controlled, p.value]);
  const shown = controlled ? String(p.value) : local;
  const classes = [cls, className].filter(Boolean).join(' ');
  const grow = classes.indexOf('m-grow') >= 0;
  const extra: { [k: string]: string } = clearAttrs || {};
  return (
    <span class={'clear-field' + (grow ? ' m-grow' : '')}>
      <input
        {...rest}
        class={classes}
        ref={(el) => {
          inner.current = el;
          assignRef(ref, el);
        }}
        onInput={(e) => {
          if (!controlled) setLocal((e.target as HTMLInputElement).value);
          if (onInput) onInput(e);
        }}
      />
      {shown.length > 0 && (
        <button
          type="button"
          class="field-clear m-icon-btn"
          data-clear=""
          aria-label={clearLabel || t('common.clearField')}
          {...extra}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const el = inner.current;
            if (!el) return;
            const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
            if (desc && desc.set) desc.set.call(el, '');
            else el.value = '';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.focus();
          }}
        >
          <ClearMark />
        </button>
      )}
    </span>
  );
}
