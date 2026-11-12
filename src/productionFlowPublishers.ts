import { billingSignedIn, onBillingAccessChange, ACCESS_KEY } from './billing/entitlement';
import { SESSION_KEY } from './billing/session';
import { activeServer } from './store/servers';
import { torrents } from './store/library';
import { currentRoute, routeStack } from './ui/nav';
import type { Torrent } from './api/types';
import type {
  DownloadFlowUpdate,
  PlaybackFlowUpdate,
  ProductionFlowPublishers,
} from '../design/production-flow';

// Real typed event sources for the production flow runtime, built on the app's existing
// state: billing access writes, the library torrent list, the TV route stack and window
// network events. Publishers report transitions only - the state present at install time
// never fires events.

export function subscribeNetworkOnline(notify: (online: boolean) => void): () => void {
  const update = () => notify(navigator.onLine);
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  return () => {
    window.removeEventListener('online', update);
    window.removeEventListener('offline', update);
  };
}

export function subscribeServerConnected(notify: (connected: boolean) => void): () => void {
  return activeServer.subscribe(() => notify(Boolean(activeServer.value)));
}

// Signed-in means the current session has a remembered /v1/me answer. Writes from this page
// arrive through onBillingAccessChange; writes from another page (monitor, rpc) through the
// window 'storage' event.
export function subscribeBillingAccount(notify: (signedIn: boolean) => void): () => void {
  let current = billingSignedIn();
  const update = () => {
    const next = billingSignedIn();
    if (next === current) return;
    current = next;
    notify(next);
  };
  const unsubscribe = onBillingAccessChange(update);
  const onStorage = (event: StorageEvent) => {
    if (event.key === ACCESS_KEY || event.key === SESSION_KEY || event.key === null) update();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    unsubscribe();
    window.removeEventListener('storage', onStorage);
  };
}

function torrentDone(t: Torrent): boolean {
  if (typeof t.stat_string === 'string' && /done/i.test(t.stat_string)) return true;
  const size = t.torrent_size ?? 0;
  return size > 0 && (t.loaded_size ?? 0) >= size;
}

// A torrent that is not done yet is an active download. A torrent vanishing before
// completion reports download.failed - the store cannot tell a user deletion from a lost
// download, and rules should scope on screen.current anyway.
export function subscribeLibraryDownloads(notify: (update: DownloadFlowUpdate) => void): () => void {
  const known = new Map<string, boolean>();
  for (const torrent of torrents.value) known.set(torrent.hash, torrentDone(torrent));
  return torrents.subscribe((list) => {
    const seen = new Set<string>();
    for (const torrent of list) {
      const done = torrentDone(torrent);
      const wasDone = known.get(torrent.hash);
      seen.add(torrent.hash);
      if (wasDone === undefined) {
        if (!done) notify({ state: 'active', event: 'download.started' });
      } else if (!wasDone && done) {
        notify({ state: 'completed', event: 'download.completed' });
      }
      known.set(torrent.hash, done);
    }
    for (const [hash, done] of known) {
      if (seen.has(hash)) continue;
      known.delete(hash);
      if (!done) notify({ state: 'idle', event: 'download.failed' });
    }
  });
}

// The TV player is a route of its own: entering it starts playback, leaving it stops
// playback. Pause and finish are not observable at the shell, so no events are invented.
export function subscribeTvPlayback(notify: (update: PlaybackFlowUpdate) => void): () => void {
  let playing = currentRoute.value.name === 'player';
  return routeStack.subscribe(() => {
    const next = currentRoute.value.name === 'player';
    if (next === playing) return;
    playing = next;
    notify(next
      ? { state: 'playing', event: 'playback.started' }
      : { state: 'stopped', event: 'playback.stopped' });
  });
}

export function createTvFlowPublishers(): ProductionFlowPublishers {
  return {
    subscribeNetwork: subscribeNetworkOnline,
    subscribeServer: subscribeServerConnected,
    subscribeAccount: subscribeBillingAccount,
    subscribePlayback: subscribeTvPlayback,
    subscribeDownload: subscribeLibraryDownloads,
  };
}
