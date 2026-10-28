import { t } from '../i18n';
import { signal, computed } from '@preact/signals';
import { getCurrentFocusKey } from '@noriginmedia/norigin-spatial-navigation';
import { DialogBadge, visibleDialogCode, visibleDialogOption } from '../testmode/badge';
import { FocusGroup, Focusable } from './components';
import { focusAfterClose } from './focus';
import { useKeys } from './keys';

interface DialogState {
  id: number;
  title: string;
  /** Long text under the title; Up/Down scroll it while the dialog is open. */
  body?: string;
  options: { label: string; value: unknown; danger?: boolean }[];
  current?: unknown;
  resolve: (v: unknown) => void;
  prevFocus?: string;
  /** Stable id from src/testmode/registry.ts. Absent dialogs stay uncoded. */
  testId?: string;
}

const dialog = signal<DialogState | null>(null);
/** True while a DialogHost dialog is open. */
export const dialogOpen = computed(() => dialog.value !== null);
let dialogSeq = 0;

export function choose<T>(title: string, options: { label: string; value: T; danger?: boolean }[], current?: T, testId?: string): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    if (dialog.value) dialog.value.resolve(null);
    dialog.value = {
      id: ++dialogSeq,
      title,
      options,
      current,
      testId,
      resolve: resolve as (v: unknown) => void,
      prevFocus: getCurrentFocusKey() || undefined,
    };
  });
}

/** A dialog with a long text (the title and the body); resolves when closed. */
export function textDialog(title: string, body: string, closeLabel: string, testId?: string): Promise<void> {
  return new Promise<void>((resolve) => {
    if (dialog.value) dialog.value.resolve(null);
    dialog.value = {
      id: ++dialogSeq,
      title,
      body,
      testId,
      options: [{ label: closeLabel, value: true }],
      resolve: () => resolve(),
      prevFocus: getCurrentFocusKey() || undefined,
    };
  });
}

/**
 * A question with a long text under the title (a certificate's fingerprint): [okLabel] or Cancel, focus starts on
 * Cancel, Back cancels. Resolves true only for [okLabel].
 */
export function confirmWithBody(title: string, body: string, okLabel: string, testId?: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (dialog.value) dialog.value.resolve(null);
    dialog.value = {
      id: ++dialogSeq,
      title,
      body,
      testId,
      options: [
        { label: okLabel, value: true, danger: true },
        { label: t('common.cancel'), value: false },
      ],
      current: false,
      resolve: (v) => resolve(v === true),
      prevFocus: getCurrentFocusKey() || undefined,
    };
  });
}

const BODY_STEP = 160;

/** Confirm: focus starts on Cancel, the action is a red danger button, Back cancels. */
export function confirmDialog(text: string, okLabel = t('tv.yes'), testId?: string): Promise<boolean> {
  return choose(text, [
    { label: okLabel, value: true, danger: true },
    { label: t('common.cancel'), value: false },
  ], false, testId).then((v) => v === true);
}

/** Closes the open dialog as Back would (its promise resolves with null); nothing when none is open. */
export function dismissDialog(): void {
  close(null);
}

function close(v: unknown) {
  const d = dialog.value;
  if (!d) return;
  dialog.value = null;
  focusAfterClose(d.prevFocus);
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
  const dlgCode = d.testId ? visibleDialogCode(d.testId) : '';
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
      <FocusGroup key={d.id} focusKey={'DIALOG-' + d.id} className={'dialog' + (dlgCode ? ' test-anchor' : '')} boundary autoFocus preferredChildFocusKey={preferred}>
        {d.testId ? <DialogBadge id={d.testId} /> : null}
        <div class="dialog-title">{d.title}</div>
        {d.body ? <div class="dialog-body">{d.body}</div> : null}
        {d.options.map((o, i) => {
          const optCode = d.testId ? visibleDialogOption(d.testId, o.value, i) : '';
          return (
            <Focusable
              key={i}
              focusKey={'dialog-opt-' + i}
              testCode={optCode}
              className={'dialog-option' + (o.danger ? ' danger' : '') + (o.value === d.current ? ' current' : '')}
              onPress={() => close(o.value)}
            >
              {o.label}
            </Focusable>
          );
        })}
      </FocusGroup>
    </div>
  );
}
