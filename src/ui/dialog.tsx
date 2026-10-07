import { t } from '../i18n';
import { signal, computed } from '@preact/signals';
import { getCurrentFocusKey, setFocus, doesFocusableExist } from '@noriginmedia/norigin-spatial-navigation';
import { FocusGroup, Focusable } from './components';
import { useKeys } from './keys';

interface DialogState {
  id: number;
  title: string;
  /** Long text under the title; Up/Down scroll it while the dialog is open. */
  body?: string;
  options: { label: string; value: unknown }[];
  current?: unknown;
  resolve: (v: unknown) => void;
  prevFocus?: string;
}

const dialog = signal<DialogState | null>(null);
/** True while a DialogHost dialog is open. */
export const dialogOpen = computed(() => dialog.value !== null);
let dialogSeq = 0;

export function choose<T>(title: string, options: { label: string; value: T }[], current?: T): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    if (dialog.value) dialog.value.resolve(null);
    dialog.value = {
      id: ++dialogSeq,
      title,
      options,
      current,
      resolve: resolve as (v: unknown) => void,
      prevFocus: getCurrentFocusKey() || undefined,
    };
  });
}

/** A dialog with a long text (the title and the body); resolves when closed. */
export function textDialog(title: string, body: string, closeLabel: string): Promise<void> {
  return new Promise<void>((resolve) => {
    if (dialog.value) dialog.value.resolve(null);
    dialog.value = {
      id: ++dialogSeq,
      title,
      body,
      options: [{ label: closeLabel, value: true }],
      resolve: () => resolve(),
      prevFocus: getCurrentFocusKey() || undefined,
    };
  });
}

const BODY_STEP = 160;

export function confirmDialog(text: string, okLabel = t('tv.yes')): Promise<boolean> {
  return choose(text, [
    { label: okLabel, value: true },
    { label: t('common.cancel'), value: false },
  ]).then((v) => v === true);
}

/** Closes the open dialog as Back would (its promise resolves with null); nothing when none is open. */
export function dismissDialog(): void {
  close(null);
}

function close(v: unknown) {
  const d = dialog.value;
  if (!d) return;
  dialog.value = null;
  if (d.prevFocus && doesFocusableExist(d.prevFocus)) setFocus(d.prevFocus);
  d.resolve(v);
}

export function DialogHost() {
  // highest priority: while a dialog is open, screens never see keys
  useKeys((a) => {
    if (!dialog.value) return false;
    if (a === 'back') {
      close(null);
      return true;
    }
    if (dialog.value.body && (a === 'up' || a === 'down')) {
      const el = document.querySelector('.dialog-body') as HTMLElement | null;
      if (el) {
        el.scrollTop += a === 'down' ? BODY_STEP : -BODY_STEP;
        return true;
      }
    }
    return 'spatial';
  }, 100);
  const d = dialog.value;
  if (!d) return null;
  let preferred: string | undefined;
  d.options.forEach((o, i) => { if (o.value === d.current) preferred = 'dialog-opt-' + i; });
  return (
    <div
      class="dialog-backdrop"
      onClick={(e) => {
        // a pointer click outside the box = Back; never reaches the screen's own click handler (player tap zones)
        if (e.target !== e.currentTarget) return;
        e.stopPropagation();
        close(null);
      }}
    >
      <FocusGroup key={d.id} focusKey={'DIALOG-' + d.id} className="dialog" boundary autoFocus preferredChildFocusKey={preferred}>
        <div class="dialog-title">{d.title}</div>
        {d.body ? <div class="dialog-body">{d.body}</div> : null}
        {d.options.map((o, i) => (
          <Focusable
            key={i}
            focusKey={'dialog-opt-' + i}
            className={'dialog-option' + (o.value === d.current ? ' current' : '')}
            onPress={() => close(o.value)}
          >
            {o.label}
          </Focusable>
        ))}
      </FocusGroup>
    </div>
  );
}
