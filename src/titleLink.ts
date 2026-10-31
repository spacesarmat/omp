// Android TV: a shared https://omp-player.online/t/... link opens the title card.
// The TV card lists every season, so a season link opens that series card.
// webOS never calls this. Chromium 53 safe.
import { parseTitleUrl, type TitleRef } from './lib/shareLink';
import { activeServer } from './store/servers';
import { currentRoute, navigate, resetTo } from './ui/nav';

let pending: TitleRef | null = null;

/** Remembers a title link. False when the URL is not one of ours. */
export function queueTvTitleLink(url: string): boolean {
  const ref = parseTitleUrl(url);
  if (!ref) return false;
  pending = ref;
  return true;
}

/** Opens the remembered card. Waits while there is no server or the connect screen is up. */
export function flushTvTitleLink(): void {
  if (!pending || !activeServer.value) return;
  if (currentRoute.peek().name === 'connect') return;
  const ref = pending;
  pending = null;
  resetTo({ name: 'library' });
  navigate({ name: 'title', kind: ref.kind, id: ref.id });
}

/** Tests: drop a link that was not opened. */
export function resetTvTitleLink(): void {
  pending = null;
}

/** Cold start and a link opened while OMP is already running. No-op off Android. */
export function installTvTitleLinks(): void {
  import('@capacitor/app').then(
    (m) => {
      const App = m.App;
      App.getLaunchUrl().then(
        (res) => {
          if (res && res.url && queueTvTitleLink(res.url)) flushTvTitleLink();
        },
        () => undefined,
      );
      App.addListener('appUrlOpen', (ev) => {
        if (ev && ev.url && queueTvTitleLink(ev.url)) flushTvTitleLink();
      }).then(undefined, () => undefined);
    },
    () => undefined,
  );
}
