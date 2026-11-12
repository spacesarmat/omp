import { billingSignedIn, onBillingAccessChange, ACCESS_KEY } from './billing/entitlement';
import { SESSION_KEY } from './billing/session';
import { activeServer } from './store/servers';
import { torrents } from './store/library';
import { currentRoute, routeStack } from './ui/nav';
import { tvPlayerState } from './phone/link';
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

// TV playback: the player route gives started/stopped; the registered player's own snapshot
// (refreshed on the existing phone-link cadence and on player state jumps) gives paused and
// finished. A state that ends while the player screen stays open is a finished item; leaving
// the route is a stopped playback. Without a registered player no pause/finish events are
// published - none are invented.
export function subscribeTvPlayback(notify: (update: PlaybackFlowUpdate) => void): () => void {
  let routePlaying = currentRoute.value.name === 'player';
  let previous = tvPlayerState.value;
  const unsubscribeRoute = routeStack.subscribe(() => {
    const next = currentRoute.value.name === 'player';
    if (next === routePlaying) return;
    routePlaying = next;
    notify(next
      ? { state: 'playing', event: 'playback.started' }
      : { state: 'stopped', event: 'playback.stopped' });
  });
  const unsubscribeState = tvPlayerState.subscribe((next) => {
    const last = previous;
    previous = next;
    if (!last && next) return;
    if (last && !next) {
      if (currentRoute.value.name === 'player') notify({ state: 'stopped', event: 'playback.finished' });
      return;
    }
    if (!last || !next) return;
    if (last.hash !== next.hash || last.file !== next.file) {
      notify({ state: 'playing', event: 'playback.started' });
    } else if (last.paused !== next.paused) {
      notify(next.paused
        ? { state: 'paused', event: 'playback.paused' }
        : { state: 'playing', event: 'playback.started' });
    }
  });
  return () => {
    unsubscribeRoute();
    unsubscribeState();
  };
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
