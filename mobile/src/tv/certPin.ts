import { signal } from '@preact/signals';

/** True while the «сертификат изменился» sheet is open. */
export const certAsk = signal(false);

interface CertAsk {
  host: string;
  fp: string;
  resolve: (ok: boolean) => void;
}

let current: CertAsk | null = null;
const queue: CertAsk[] = [];

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

function sameAsk(a: { host: string; fp: string }, host: string, fp: string): boolean {
  return a.host === host && a.fp === fp;
}

function share(ask: CertAsk, resolve: (ok: boolean) => void): void {
  const first = ask.resolve;
  ask.resolve = (ok) => {
    first(ok);
    resolve(ok);
  };
}

function pump(): void {
  if (current) return;
  const next = queue.shift();
  if (!next) {
    certAsk.value = false;
    return;
  }
  current = next;
  certAsk.value = true;
}

/**
 * One sheet per host and fingerprint. A second handshake for that same pair shares the answer.
 * A different TV or box waits its own turn, so one tap cannot replace both pins.
 */
export function confirmCertChange(host: string, fingerprint: string): Promise<boolean> {
  const keyHost = host.trim().toLowerCase();
  const fp = fingerprint.trim().toLowerCase();
  return new Promise((resolve) => {
    if (current && sameAsk(current, keyHost, fp)) {
      share(current, resolve);
      return;
    }
    const queued = queue.find((a) => sameAsk(a, keyHost, fp));
    if (queued) {
      share(queued, resolve);
      return;
    }
    queue.push({ host: keyHost, fp, resolve });
    pump();
  });
}

/** Closes the sheet. `true` — trust the new certificate and retry. */
export function answerCertChange(trust: boolean): void {
  const ask = current;
  current = null;
  certAsk.value = false;
  ask?.resolve(trust);
  pump();
}
