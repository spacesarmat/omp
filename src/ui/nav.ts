import { signal, computed } from '@preact/signals';
import { getCurrentFocusKey } from '@noriginmedia/norigin-spatial-navigation';
import type { PlayItem } from '../player/types';

export type Route =
  | { name: 'connect' }
  | { name: 'library' }
  | { name: 'torrent'; hash: string }
  | { name: 'player'; queue: PlayItem[]; index: number; startAt?: number; from?: string }
  | { name: 'add' }
  | { name: 'playlist'; url?: string; title?: string }
  | { name: 'settings' }
  | { name: 'update' }
  | { name: 'pairPhone' };

export const routeStack = signal<Route[]>([{ name: 'connect' }]);
export const currentRoute = computed(() => routeStack.value[routeStack.value.length - 1]);

// Unique key per route object (pushed, replaced or reset): the screen host is keyed by it, so a replaced route
// with the same name (player → player) always remounts its screen. Kept outside the objects to leave Route as is.
const routeIds = new WeakMap<Route, number>();
let routeSeq = 0;

export function routeKey(r: Route): number {
  let id = routeIds.get(r);
  if (id === undefined) {
    id = ++routeSeq;
    routeIds.set(r, id);
  }
  return id;
}

// focus key that was active on each stack level when we navigated away from it
const focusMemory: (string | undefined)[] = [];

function currentFocus(): string | undefined {
  try {
    return getCurrentFocusKey() || undefined;
  } catch (e) {
    return undefined;
  }
}

export function navigate(r: Route): void {
  focusMemory[routeStack.value.length - 1] = currentFocus();
  routeStack.value = routeStack.value.concat(r);
}

export function replaceRoute(r: Route): void {
  focusMemory[routeStack.value.length - 1] = undefined;
  routeStack.value = routeStack.value.slice(0, -1).concat(r);
}

/** Opens a player route; a player already on top is replaced, so closing the new one never brings the old back. */
export function openPlayer(r: Route): void {
  if (currentRoute.value.name === 'player') replaceRoute(r);
  else navigate(r);
}

export function resetTo(r: Route): void {
  focusMemory.length = 0;
  routeStack.value = [r];
}

export function goBack(): boolean {
  if (routeStack.value.length <= 1) return false;
  focusMemory[routeStack.value.length - 1] = undefined;
  routeStack.value = routeStack.value.slice(0, -1);
  return true;
}

export function takeSavedFocus(): string | undefined {
  const i = routeStack.value.length - 1;
  const k = focusMemory[i];
  focusMemory[i] = undefined;
  return k;
}
