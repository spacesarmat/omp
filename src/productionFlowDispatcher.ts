import { goBack, navigate, type Route } from './ui/nav';
import { toast } from './ui/toast';
import { confirmWithBody } from './ui/dialog';
import { BILLING_BOT_URL } from './billing/config';
import { activeServer } from './store/servers';
import { connectServer } from '../mobile/src/connect/connectServer';
import {
  createProductionDispatcher,
  unavailableProductionAction,
  type FlowDispatcher,
  type FlowDispatchOutcome,
} from '../design/production-flow';

// Production flow actions on top of the existing TV shell APIs. The interpreter stays
// synchronous: the async server connect fires through the existing connect helper and
// reports failures the way the TV's own screens do. Playback and sources belong to the
// player screen on the TV, so those actions answer with documented platform errors.
export function createTvFlowDispatcher(): FlowDispatcher {
  const serverAction = (action: string): FlowDispatchOutcome => {
    const server = activeServer.value;
    if (!server) return { ok: false, error: `${action} is unavailable on tv: no active server configured` };
    void connectServer({ url: server.url }).then((result) => {
      if (!result.ok) toast(result.error, 'error');
    });
    return { ok: true };
  };
  const playerOwned = (action: string): FlowDispatchOutcome =>
    unavailableProductionAction(action, 'tv', 'playback and sources are controlled by the player screen');
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
    playbackPlayPause: () => playerOwned('playback.playPause'),
    playbackStop: () => playerOwned('playback.stop'),
    playbackNextEpisode: () => playerOwned('playback.nextEpisode'),
    queueAdd: () => unavailableProductionAction('queue.add', 'tv', 'queue actions need an episode context the app shell does not have'),
    queueReplace: () => unavailableProductionAction('queue.replace', 'tv', 'queue actions need an episode context the app shell does not have'),
    sourceRetry: () => playerOwned('source.retry'),
    sourceNext: () => playerOwned('source.next'),
  });
}
