// One honest "no internet" state for the phone: navigator.onLine plus the online/offline events.
// Screens read `online` instead of guessing from a failed request (a failed TMDB or tracker call
// without any network used to read as «TMDB не отвечает из этой сети» or «Источники не ответили»).
import { signal } from '@preact/signals';

function readOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/** False only when the system reports no network at all. */
export const online = signal(readOnline());

let installed = false;

/** Keeps {@link online} in sync with the system. Safe to call more than once. */
export function installOnlineWatcher(target: Window | undefined = typeof window === 'undefined' ? undefined : window): void {
  if (installed || !target) return;
  installed = true;
  const sync = () => {
    online.value = readOnline();
  };
  target.addEventListener('online', sync);
  target.addEventListener('offline', sync);
}

/** Tests: force the state. Null reads the system again. */
export function setOnlineForTest(v: boolean | null): void {
  online.value = v === null ? readOnline() : v;
}

installOnlineWatcher();
