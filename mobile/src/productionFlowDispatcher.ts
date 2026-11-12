import { currentRoute, goBack, navigate, type MRoute } from './nav';
import { showToast } from './ui/toast';
import { askConfirm } from './ui/confirm';
import { watchOnPhone, filesOf } from './watch';
import { phoneSourceContext } from './searchContext';
import { BILLING_BOT_URL } from '../../src/billing/config';
import { activeServer, client } from '../../src/store/servers';
import { torrents } from '../../src/store/library';
import { getLocalProgress, isWatched } from '../../src/store/progress';
import { baseName } from '../../src/lib/episodes';
import { connectServer } from './connect/connectServer';
import type { SearchHandle } from '../../src/sources/search';
import { createFlowSourceSearch } from '../../src/flowSourceSearch';
import { nowPlaying, sendCmd } from './tv/playerLink';
import type { SourceContext } from '../../src/sources/types';
import {
  createProductionDispatcher,
  unavailableProductionAction,
  type FlowDispatcher,
  type FlowDispatchOutcome,
} from '../../design/production-flow';

export interface PhoneFlowDispatcherOptions {
  /** The existing app URL opener (Capacitor '_system' on device, a plain window on desktop). */
  openUrl(url: string): void;
  /** Search source context; defaults to the phone's existing unified search context. */
  sourceContext?: () => SourceContext;
}

function reportSearchCount(handle: SearchHandle): void {
  if (handle.pending().length === 0) {
    showToast(String(handle.results().length));
    return;
  }
  const timer = setInterval(() => {
    if (handle.pending().length > 0) return;
    clearInterval(timer);
    showToast(String(handle.results().length));
  }, 500);
  setTimeout(() => clearInterval(timer), 120000);
}

// Production flow actions on top of the existing phone app APIs. The interpreter stays
// synchronous: async app APIs (server connect, playback, search) fire through their existing
// helpers and report failures the way the app's own screens do, never through the flow error
// branches.
export function createPhoneFlowDispatcher(options: PhoneFlowDispatcherOptions): FlowDispatcher {
  const context = () => options.sourceContext?.() ?? phoneSourceContext();
  const serverAction = (action: string): FlowDispatchOutcome => {
    const server = activeServer.value;
    if (!server) return { ok: false, error: `${action} is unavailable on phone: no active server configured` };
    void connectServer({ url: server.url }).then((result) => {
      if (!result.ok) showToast(result.error);
    });
    return { ok: true };
  };
  // The active torrent screen is the queue context: queue.replace plays its first unwatched
  // file (the whole player queue is rebuilt, which is what "replace" means for 2160 Player).
  const queueReplace = (action: string): FlowDispatchOutcome => {
    const route = currentRoute.value;
    if (route.name !== 'torrent') {
      return { ok: false, error: `${action} is unavailable on phone: open the torrent screen of what should play` };
    }
    const torrent = torrents.value.find((entry) => entry.hash === route.hash);
    if (!torrent) return { ok: false, error: `${action}: the torrent is not in the library yet` };
    const c = client.value;
    if (!c) return { ok: false, error: `${action} is unavailable on phone: no active server` };
    const files = filesOf(torrent);
    if (!files.length) return { ok: false, error: `${action}: the torrent has no files yet` };
    const file = files.find((entry) => !isWatched(route.hash, entry.id)) ?? files[0];
    const progress = getLocalProgress(route.hash, file.id);
    void watchOnPhone(c, torrent, {
      hash: route.hash,
      file,
      title: baseName(file.path),
      at: progress ? Math.floor(progress.time) : 0,
      duration: progress ? Math.floor(progress.duration) : 0,
    }).catch((error) => showToast(error instanceof Error ? error.message : String(error)));
    return { ok: true };
  };
  const sourceSearch = createFlowSourceSearch({
    platform: 'phone',
    query: () => {
      const route = currentRoute.value;
      return route.name === 'add' ? route.query : undefined;
    },
    context,
    report: reportSearchCount,
  });
  return createProductionDispatcher({
    navigate: (screenId) => {
      navigate({ name: screenId } as MRoute);
      return { ok: true };
    },
    openScreen: (screenId) => {
      navigate({ name: screenId } as MRoute);
      return { ok: true };
    },
    back: () => ({ ok: goBack() }),
    toast: (message) => {
      showToast(message);
      return { ok: true };
    },
    dialog: (title, message) => {
      void askConfirm(title ? `${title}. ${message}` : message, 'OK');
      return { ok: true };
    },
    linkOpen: (url) => {
      options.openUrl(url);
      return { ok: true };
    },
    telegramOpen: (target) => {
      options.openUrl(target === 'billing-bot' ? BILLING_BOT_URL : 'https://t.me/ompplyaer');
      return { ok: true };
    },
    serverConnect: () => serverAction('server.connect'),
    serverReconnect: () => serverAction('server.reconnect'),
    serverRetry: () => serverAction('server.retry'),
    playbackPlayPause: () => {
      const state = nowPlaying.value;
      if (!state) return unavailableProductionAction('playback.playPause', 'phone', 'no active playback');
      sendCmd({ type: state.paused ? 'play' : 'pause' });
      return { ok: true };
    },
    playbackNextEpisode: () => {
      const state = nowPlaying.value;
      if (!state) return unavailableProductionAction('playback.nextEpisode', 'phone', 'no active playback');
      if (!state.next) return unavailableProductionAction('playback.nextEpisode', 'phone', 'no next episode');
      sendCmd({ type: 'next' });
      return { ok: true };
    },
    // The player protocol has no stop command: end the item with the player's own
    // end-of-item semantics - pause, then seek to the end, like the built-in auto-skip.
    // The following state transition publishes playback.stopped (or playback.finished).
    playbackStop: () => {
      const state = nowPlaying.value;
      if (!state) return unavailableProductionAction('playback.stop', 'phone', 'no active playback');
      sendCmd({ type: 'pause' });
      if (state.duration > 0) sendCmd({ type: 'seek', t: state.duration });
      return { ok: true };
    },
    queueReplace: () => queueReplace('queue.replace'),
    // The phone player takes a whole queue per launch (Open2160Options) and the player-link
    // protocol has no append command, so an append without forcing playback genuinely does
    // not exist on the phone; use queue.replace from the torrent screen.
    queueAdd: () => unavailableProductionAction('queue.add', 'phone', 'the player takes a whole queue per launch and the player-link protocol has no append; use queue.replace from a torrent screen'),
    sourceRetry: () => sourceSearch.retry(),
    sourceNext: () => sourceSearch.next(),
  });
}
