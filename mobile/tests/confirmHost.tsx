import { render } from 'preact';
import { act } from 'preact/test-utils';
import { ConfirmHost, resetConfirm } from '../src/ui/confirm';

let root: HTMLElement | null = null;

/** Renders the confirm next to the screen under test. Call after any innerHTML reset. */
export function mountConfirmHost(): void {
  if (root && !root.isConnected) root = null;
  if (!root) {
    root = document.createElement('div');
    root.id = 'confirm-host';
    document.body.appendChild(root);
  }
  act(() => render(<ConfirmHost />, root!));
}

export function unmountConfirmHost(): void {
  if (root && root.isConnected) act(() => render(null, root!));
  if (root && root.parentNode) root.remove();
  root = null;
  resetConfirm();
}

export function confirmText(): string {
  return document.getElementById('m-confirm-msg')?.textContent || '';
}

export async function acceptConfirm(): Promise<void> {
  const b = document.querySelector('[data-confirm-ok]') as HTMLButtonElement | null;
  if (!b) throw new Error('confirm dialog is not open');
  await act(async () => {
    b.click();
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
}

export async function declineConfirm(): Promise<void> {
  const b = document.querySelector('[data-confirm-cancel]') as HTMLButtonElement | null;
  if (!b) throw new Error('confirm dialog is not open');
  await act(async () => {
    b.click();
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
}
