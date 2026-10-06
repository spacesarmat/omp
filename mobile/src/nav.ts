import { signal, computed } from '@preact/signals';
import { cancelRestore, currentScroll, rememberTab, restoreScroll, scrollToTop, tabScrollOf } from './scrollMemory';

export { scrollToTop };

export type MRoute =
  | { name: 'connect' }
  | { name: 'library' }
  /** «Новое»: `seg` opens a segment, `finding` highlights a new-episodes card, `watch` readies «Смотреть на ТВ» for it. */
  | { name: 'news'; seg?: 'feed' | 'subs' | 'calendar'; finding?: string; watch?: boolean }
  /** Findings of one subscription. */
  | { name: 'subFindings'; id: string; finding?: string; watch?: boolean }
  /** «Настройки» → «Мониторинг». */
  | { name: 'monitor' }
  | { name: 'torrent'; hash: string }
  /** `query` fills the tracker search; `run` starts it on arrival. */
  | { name: 'add'; link?: string; query?: string; run?: boolean }
  | { name: 'remote' }
  | { name: 'nowPlaying' }
  | { name: 'tv' }
  | { name: 'settings' }
  | { name: 'serverSettings'; url?: string }
  | { name: 'localServer' }
  /** `q` opens that question. */
  | { name: 'faq'; q?: string }
  /** «Установить OMP на телевизор»: the device list, or the steps for the device at `ip`. */
  | { name: 'install'; ip?: string; kind?: 'lg' | 'atv' | 'samsung' }
  | { name: 'log' }
  | { name: 'backup' }
  | { name: 'sources' }
  /** «Источники поиска» → FlareSolverr. */
  | { name: 'flaresolverr' }
  | { name: 'sourceSite'; id: string }
  /** A TMDB title card from «Обзор» (`TitleCard`). */
  | { name: 'title'; kind: 'movie' | 'tv'; id: number }
  /** «Мои» → the torrents of one series (`key` from seriesGroups), by season. */
  /** `season` is the season to open first (the series screen falls back to its own pick without it). */
  | { name: 'series'; key: string; season?: number };

export const routeStack = signal<MRoute[]>([{ name: 'connect' }]);
export const currentRoute = computed(() => routeStack.value[routeStack.value.length - 1]);

// window scroll of each stack entry when another screen was pushed over it
const coveredScroll = new WeakMap<MRoute, number>();

export function navigate(r: MRoute): void {
  const s = routeStack.value;
  coveredScroll.set(s[s.length - 1], currentScroll());
  cancelRestore();
  routeStack.value = s.concat(r);
  restoreScroll(0);
}

export function goBack(): boolean {
  if (routeStack.value.length <= 1) return false;
  const s = routeStack.value.slice(0, -1);
  routeStack.value = s;
  restoreScroll(coveredScroll.get(s[s.length - 1]) || 0);
  return true;
}

/** Deep links and the connect flow: a fresh stack that starts at the top. */
export function resetTo(r: MRoute): void {
  routeStack.value = [r];
  restoreScroll(0);
}

/** A plain tab tap (no extra fields): the only kind of switch that brings back the tab's scroll. */
function isPlainTab(r: MRoute): boolean {
  return Object.keys(r).length === 1;
}

// Root tabs (library/news/add/remote/settings) replace the whole stack. The tab being left keeps the scroll of its
// root screen; opening it again from the tab bar brings that scroll back. Tapping the tab already open: from its root
// screen it goes to the top; from a screen above the root (the «Обзор» title card) it returns to the root where it was.
// A switch carrying data (a shared magnet, a notification) starts at the top.
export function switchTab(r: MRoute): void {
  const s = routeStack.value;
  const root = s[0];
  const rootScroll = s.length === 1 ? currentScroll() : coveredScroll.get(root) || 0;
  const sameTab = root.name === r.name;
  if (!sameTab) rememberTab(root.name, rootScroll);
  cancelRestore();
  routeStack.value = [r];
  if (!isPlainTab(r)) restoreScroll(0);
  else if (sameTab) restoreScroll(s.length > 1 ? rootScroll : 0);
  else restoreScroll(tabScrollOf(r.name));
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
