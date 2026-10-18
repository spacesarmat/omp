// «Другая раздача» from the player: the torrent screen opens «В лучшем качестве» when that flow exists,
// otherwise the viewer lands on the torrent's details. Chromium 53 safe.
import { signal } from '@preact/signals';
import { goBack, replaceRoute, routeStack } from '../ui/nav';

/** Hash of the torrent whose details should offer another release; the torrent screen clears it. */
export const pendingBetterHash = signal<string | null>(null);

export function openAnotherRelease(hash: string | undefined): void {
  if (!hash) {
    goBack();
    return;
  }
  pendingBetterHash.value = hash;
  const stack = routeStack.value;
  const prev = stack.length >= 2 ? stack[stack.length - 2] : null;
  if (prev && prev.name === 'torrent' && prev.hash === hash) {
    goBack();
    return;
  }
  const top = stack.length ? stack[stack.length - 1] : null;
  if (top && top.name === 'player') replaceRoute({ name: 'torrent', hash: hash });
  else goBack();
}
