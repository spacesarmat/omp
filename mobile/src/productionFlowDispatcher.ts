import { goBack, navigate, type MRoute } from './nav';
import { showToast } from './ui/toast';
import { askConfirm } from './ui/confirm';
import { BILLING_BOT_URL } from '../../src/billing/config';
import { activeServer } from '../../src/store/servers';
import { connectServer } from './connect/connectServer';
import { nowPlaying, sendCmd } from './tv/playerLink';
import {
  createProductionDispatcher,
  unavailableProductionAction,
  type FlowDispatcher,
  type FlowDispatchOutcome,
} from '../../design/production-flow';

export interface PhoneFlowDispatcherOptions {
  /** The existing app URL opener (Capacitor '_system' on device, a plain window on desktop). */
  openUrl(url: string): void;
}

// Production flow actions on top of the existing phone app APIs. The interpreter stays
// synchronous: async app APIs (server connect) fire through their existing helpers and
// report failures the way the app's own screens do, never through the flow error branches.
export function createPhoneFlowDispatcher(options: PhoneFlowDispatcherOptions): FlowDispatcher {
  const serverAction = (action: string): FlowDispatchOutcome => {
    const server = activeServer.value;
    if (!server) return { ok: false, error: `${action} is unavailable on phone: no active server configured` };
    void connectServer({ url: server.url }).then((result) => {
      if (!result.ok) showToast(result.error);
    });
    return { ok: true };
  };
  const playback = () => nowPlaying.value;
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
      const state = playback();
      if (!state) return unavailableProductionAction('playback.playPause', 'phone', 'no active playback');
      sendCmd({ type: state.paused ? 'play' : 'pause' });
      return { ok: true };
    },
    playbackNextEpisode: () => {
      const state = playback();
      if (!state) return unavailableProductionAction('playback.nextEpisode', 'phone', 'no active playback');
      if (!state.next) return unavailableProductionAction('playback.nextEpisode', 'phone', 'no next episode');
      sendCmd({ type: 'next' });
      return { ok: true };
    },
    // The player command protocol has no stop command; closing playback is a player UI action.
    playbackStop: () => unavailableProductionAction('playback.stop', 'phone', 'the player protocol exposes no stop command'),
    // Queue and source actions need an episode/source context the app shell does not have.
    queueAdd: () => unavailableProductionAction('queue.add', 'phone', 'queue actions need an episode context the app shell does not have'),
    queueReplace: () => unavailableProductionAction('queue.replace', 'phone', 'queue actions need an episode context the app shell does not have'),
    sourceRetry: () => unavailableProductionAction('source.retry', 'phone', 'playback sources are managed inside the player'),
    sourceNext: () => unavailableProductionAction('source.next', 'phone', 'playback sources are managed inside the player'),
  });
}
