import { nowPlaying } from './tv/playerLink';
import type { PlayerState } from '../../src/phone/protocol';
import {
  subscribeBillingAccount,
  subscribeLibraryDownloads,
  subscribeNetworkOnline,
  subscribeServerConnected,
} from '../../src/productionFlowPublishers';
import type { PlaybackFlowUpdate, ProductionFlowPublishers } from '../../design/production-flow';

// A playback ends as finished when the last state sat near the end of the item; the player's
// own 'open' progress marker (a stop, not a finish) wins.
const FINISHED_RATIO = 0.9;

function finishedStop(state: PlayerState): PlaybackFlowUpdate {
  const finished = state.duration > 0
    && state.time >= state.duration * FINISHED_RATIO
    && state.time > 0;
  return { state: 'stopped', event: finished ? 'playback.finished' : 'playback.stopped' };
}

// The phone mirrors the playing item through the player link state: appearing starts, the
// pause flag pauses and resumes, and a file change (auto-advance) starts the next item.
export function subscribePhonePlayback(notify: (update: PlaybackFlowUpdate) => void): () => void {
  let previous: PlayerState | null = nowPlaying.value;
  return nowPlaying.subscribe((next) => {
    try {
      if (!previous && next) {
        notify({ state: 'playing', event: 'playback.started' });
      } else if (previous && !next) {
        notify(finishedStop(previous));
      } else if (previous && next) {
        if (previous.hash !== next.hash || previous.file !== next.file) {
          notify({ state: 'playing', event: 'playback.started' });
        } else if (previous.paused !== next.paused) {
          notify(next.paused
            ? { state: 'paused', event: 'playback.paused' }
            : { state: 'playing', event: 'playback.started' });
        }
      }
    } finally {
      previous = next;
    }
  });
}

export function createPhoneFlowPublishers(): ProductionFlowPublishers {
  return {
    subscribeNetwork: subscribeNetworkOnline,
    subscribeServer: subscribeServerConnected,
    subscribeAccount: subscribeBillingAccount,
    subscribePlayback: subscribePhonePlayback,
    subscribeDownload: subscribeLibraryDownloads,
  };
}
