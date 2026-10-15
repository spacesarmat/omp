import { signal } from '@preact/signals';

/** True while the «сертификат изменился» sheet is open. */
export const certAsk = signal(false);

let pending: ((ok: boolean) => void) | null = null;

const FP = /^[0-9a-f]{64}$/i;

/**
 * The new leaf fingerprint when a TV or box handshake was refused because the certificate changed.
 * The plugin sends it as the message, with code `cert-changed` or `box-cert-changed`.
 */
export function certChangedFingerprint(e: unknown): string | null {
  if (!e || typeof e !== 'object') return null;
  const o = e as { code?: unknown; message?: unknown };
  const code = typeof o.code === 'string' ? o.code : '';
  const message = typeof o.message === 'string' ? o.message : '';
  if (code !== 'cert-changed' && code !== 'box-cert-changed' && message.indexOf('cert-changed:') < 0) return null;
  const marked = /cert-changed:([0-9a-f]{64})/i.exec(message);
  if (marked) return marked[1].toLowerCase();
  const bare = message.trim().toLowerCase();
  return FP.test(bare) ? bare : null;
}

/** One sheet for every handshake that needs a decision. A second caller shares the same answer. */
export function confirmCertChange(): Promise<boolean> {
  if (pending) {
    const first = pending;
    return new Promise((resolve) => {
      pending = (ok) => {
        first(ok);
        resolve(ok);
      };
    });
  }
  certAsk.value = true;
  return new Promise((resolve) => {
    pending = (ok) => {
      pending = null;
      certAsk.value = false;
      resolve(ok);
    };
  });
}

/** Closes the sheet. `true` — trust the new certificate and retry. */
export function answerCertChange(trust: boolean): void {
  const answer = pending;
  pending = null;
  certAsk.value = false;
  answer?.(trust);
}
