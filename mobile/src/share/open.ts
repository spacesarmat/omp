// A shared https (or omp://t/...) link opens the title card, or the season, once a server is connected.
import { activeServer } from '../../../src/store/servers';
import { parseTitleUrl, type TitleRef } from '../../../src/lib/shareLink';
import { currentRoute, navigate, switchTab } from '../nav';

let pending: TitleRef | null = null;

/** Remembers a title link. False when the URL is not one of ours. */
export function queueTitleLink(url: string): boolean {
  const ref = parseTitleUrl(url);
  if (!ref) return false;
  pending = ref;
  return true;
}

/** Opens the remembered card. Waits while there is no server or the connect screen is up. */
export function flushTitleLink(): void {
  if (!pending || !activeServer.value) return;
  if (currentRoute.peek().name === 'connect') return;
  const ref = pending;
  pending = null;
  switchTab({ name: 'library' });
  if (ref.kind === 'tv' && typeof ref.season === 'number') navigate({ name: 'seasonCard', id: ref.id, season: ref.season });
  else navigate({ name: 'title', kind: ref.kind, id: ref.id });
}

/** Tests: drop a link that was not opened. */
export function resetTitleLink(): void {
  pending = null;
}
