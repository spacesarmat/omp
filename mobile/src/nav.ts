import { signal, computed } from '@preact/signals';

export type MRoute =
  | { name: 'connect' }
  | { name: 'library' }
  | { name: 'torrent'; hash: string }
  | { name: 'add'; link?: string }
  | { name: 'remote' }
  | { name: 'nowPlaying' }
  | { name: 'tv' }
  | { name: 'settings' };

export const routeStack = signal<MRoute[]>([{ name: 'connect' }]);
export const currentRoute = computed(() => routeStack.value[routeStack.value.length - 1]);

export function navigate(r: MRoute): void {
  routeStack.value = routeStack.value.concat(r);
}

export function goBack(): boolean {
  if (routeStack.value.length <= 1) return false;
  routeStack.value = routeStack.value.slice(0, -1);
  return true;
}

export function resetTo(r: MRoute): void {
  routeStack.value = [r];
}

// root tabs (library/add/remote/settings) replace the whole stack
export function switchTab(r: MRoute): void {
  resetTo(r);
}

// a magnet received before any server is connected: opened in «Добавить» after the connect
let pendingLink: string | null = null;

export function setPendingLink(l: string | null): void {
  pendingLink = l;
}

/** Where to go after a successful connect: «Добавить» with the remembered magnet, else the library. */
export function afterConnectRoute(): MRoute {
  const l = pendingLink;
  pendingLink = null;
  return l ? { name: 'add', link: l } : { name: 'library' };
}
