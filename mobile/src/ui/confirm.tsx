import { useEffect } from 'preact/hooks';
import { signal } from '@preact/signals';
import { t } from '../../../src/i18n';
import { useBackHandler } from './backStack';

export interface ConfirmAsk {
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive: boolean;
  /** Stable confirm code (PD45). The two buttons are that code plus .1 and .2. */
  testId?: string;
  /** Line breaks of [message] are kept (a certificate fingerprint). */
  multiline?: boolean;
  resolve: (ok: boolean) => void;
}

/** The confirm on screen, or null. One at a time: a new question cancels the previous one. */
export const confirmAsk = signal<ConfirmAsk | null>(null);

/** Drops a pending question (tests that tear the tree down without unmounting). */
export function resetConfirm(): void {
  const cur = confirmAsk.value;
  confirmAsk.value = null;
  if (cur) cur.resolve(false);
}

/**
 * In-app confirm instead of window.confirm (the Android WebView shows that as a native
 * AlertDialog with English CANCEL / OK). Resolves false on «Отмена», the backdrop, or «Назад».
 */
export function askConfirm(
  message: string,
  confirmLabel: string,
  opts?: { destructive?: boolean; cancelLabel?: string; testId?: string; multiline?: boolean },
): Promise<boolean> {
  const prev = confirmAsk.peek();
  if (prev) {
    confirmAsk.value = null;
    prev.resolve(false);
  }
  return new Promise((resolve) => {
    confirmAsk.value = {
      message,
      confirmLabel,
      cancelLabel: opts?.cancelLabel || t('common.cancel'),
      destructive: !!opts?.destructive,
      testId: opts && opts.testId,
      multiline: !!opts?.multiline,
      resolve,
    };
  });
}

/** Centered confirm. Mount once, above the screens, so it stays over any open sheet. */
export function ConfirmHost() {
  const ask = confirmAsk.value;
  useBackHandler(() => {
    const cur = confirmAsk.peek();
    if (!cur) return;
    confirmAsk.value = null;
    cur.resolve(false);
  }, !!ask);
  useEffect(() => () => resetConfirm(), []);
  if (!ask) return null;
  const close = (ok: boolean) => {
    if (confirmAsk.peek() !== ask) return;
    confirmAsk.value = null;
    ask.resolve(ok);
  };
  return (
    <div class="m-sheet-host m-dialog-host m-confirm-host" data-confirm-host="">
      <button type="button" class="m-sheet-backdrop" aria-label={ask.cancelLabel} onClick={() => close(false)} />
      <div class="m-dialog" role="dialog" aria-modal="true" aria-labelledby="m-confirm-msg" data-code={ask.testId}>
        <div class={'m-dialog-text' + (ask.multiline ? ' m-pre' : '')} id="m-confirm-msg">{ask.message}</div>
        <button
          type="button"
          class={(ask.destructive ? 'm-btn m-btn-danger' : 'm-btn m-btn-primary') + (ask.testId ? ' tm' : '')}
          data-confirm={ask.destructive ? 'danger' : 'ok'}
          data-confirm-ok
          data-code={ask.testId ? ask.testId + '.1' : undefined}
          onClick={() => close(true)}
        >
          {ask.confirmLabel}
        </button>
        <button
          type="button"
          class={'m-btn m-btn-secondary' + (ask.testId ? ' tm' : '')}
          data-confirm-cancel
          data-code={ask.testId ? ask.testId + '.2' : undefined}
          onClick={() => close(false)}
        >
          {ask.cancelLabel}
        </button>
      </div>
    </div>
  );
}
