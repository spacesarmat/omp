import { currentRoute, goBack, navigate, openPlayer, extendPlayerQueue, type Route } from './ui/nav';
import { toast } from './ui/toast';
import { confirmWithBody } from './ui/dialog';
import { BILLING_BOT_URL } from './billing/config';
import { activeServer, client } from './store/servers';
import { torrents } from './store/library';
import { buildTorrentQueue } from './player/queue';
import { tvSourceContext } from './sources/tvContext';
import type { SearchHandle } from './sources/search';
import { createFlowSourceSearch } from './flowSourceSearch';
import { connectServer } from '../mobile/src/connect/connectServer';
import type { SourceContext } from './sources/types';
import {
  createProductionDispatcher,
  unavailableProductionAction,
  type FlowDispatcher,
  type FlowDispatchOutcome,
} from '../design/production-flow';

export interface TvFlowDispatcherOptions {
  /** Search source context; defaults to the TV's existing search context. */
  sourceContext?: () => SourceContext;
}

function reportSearchCount(handle: SearchHandle): void {
  if (handle.pending().length === 0) {
    toast(String(handle.results().length));
    return;
  }
  const timer = setInterval(() => {
    if (handle.pending().length > 0) return;
    clearInterval(timer);
    toast(String(handle.results().length));
  }, 500);
  setTimeout(() => clearInterval(timer), 120000);
}

// Production flow actions on top of the existing TV shell APIs. The interpreter stays
// synchronous: async app APIs (server connect, search) fire through their existing helpers
// and report failures the way the TV's own screens do, never through the flow error branches.
export function createTvFlowDispatcher(options: TvFlowDispatcherOptions = {}): FlowDispatcher {
  const context = () => options.sourceContext?.() ?? tvSourceContext();
  const serverAction = (action: string): FlowDispatchOutcome => {
    const server = activeServer.value;
    if (!server) return { ok: false, error: `${action} is unavailable on tv: no active server configured` };
    void connectServer({ url: server.url }).then((result) => {
      if (!result.ok) toast(result.error, 'error');
    });
    return { ok: true };
  };
  // The active torrent screen is the queue context. queue.replace builds the player queue
  // with the existing builder and opens the player route, replacing what played before.
  const torrentQueue = (action: string): { error: FlowDispatchOutcome } | { queue: import('./player/types').PlayItem[] } => {
    const route = currentRoute.value;
    if (route.name !== 'torrent') {
      return { error: { ok: false, error: `${action} is unavailable on tv: open the torrent screen of what should play` } };
    }
    const torrent = torrents.value.find((entry) => entry.hash === route.hash);
    if (!torrent) return { error: { ok: false, error: `${action}: the torrent is not in the library yet` } };
    const c = client.value;
    if (!c) return { error: { ok: false, error: `${action} is unavailable on tv: no active server` } };
    const files = c.files(torrent);
    if (!files.length) return { error: { ok: false, error: `${action}: the torrent has no files yet` } };
    const queue = buildTorrentQueue(c, torrent, files);
    if (!queue.length) return { error: { ok: false, error: `${action}: the torrent has no playable files` } };
    return { queue };
  };
  // queue.add appends to the open player route in place: the route object keeps its identity
  // (no screen remount, no playback restart) and the stack signal still notifies subscribers.
  const queueAdd = (): FlowDispatchOutcome => {
    const built = torrentQueue('queue.add');
    if ('error' in built) return built.error;
    if (!extendPlayerQueue(built.queue)) {
      return { ok: false, error: 'queue.add is unavailable on tv: no open player queue; use queue.replace to start playback' };
    }
    return { ok: true };
  };
  const sourceSearch = createFlowSourceSearch({
    platform: 'tv',
    query: () => {
      const route = currentRoute.value;
      return route.name === 'add' ? route.query : undefined;
    },
    context,
    report: reportSearchCount,
  });
  return createProductionDispatcher({
    navigate: (screenId) => {
      navigate({ name: screenId } as Route);
      return { ok: true };
    },
    openScreen: (screenId) => {
      navigate({ name: screenId } as Route);
      return { ok: true };
    },
    back: () => ({ ok: goBack() }),
    toast: (message) => {
      toast(message);
      return { ok: true };
    },
    dialog: (title, message) => {
      void confirmWithBody(title, message, 'OK');
      return { ok: true };
    },
    linkOpen: (url) => {
      window.open(url, '_blank', 'noopener');
      return { ok: true };
    },
    telegramOpen: (target) => {
      window.open(target === 'billing-bot' ? BILLING_BOT_URL : 'https://t.me/ompplyaer', '_blank', 'noopener');
      return { ok: true };
    },
    serverConnect: () => serverAction('server.connect'),
    serverReconnect: () => serverAction('server.reconnect'),
    serverRetry: () => serverAction('server.retry'),
    playbackPlayPause: () => unavailableProductionAction('playback.playPause', 'tv', 'transport keys are handled by the player screen'),
    playbackNextEpisode: () => unavailableProductionAction('playback.nextEpisode', 'tv', 'transport keys are handled by the player screen'),
    // Closing the player route is the TV's existing stop semantics: the player unmounts
    // and playback ends. The route transition publishes playback.stopped.
    playbackStop: () => {
      if (currentRoute.value.name !== 'player') {
        return unavailableProductionAction('playback.stop', 'tv', 'the player screen is not open');
      }
      return { ok: goBack() };
    },
    queueReplace: () => {
      const built = torrentQueue('queue.replace');
      if ('error' in built) return built.error;
      openPlayer({ name: 'player', queue: built.queue, index: 0 });
      return { ok: true };
    },
    queueAdd,
    sourceRetry: () => sourceSearch.retry(),
    sourceNext: () => sourceSearch.next(),
  });
}
