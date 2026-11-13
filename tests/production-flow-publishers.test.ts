import { beforeEach, describe, expect, it, vi } from 'vitest';

const generated = vi.hoisted(() => ({
  flow: {
    schemaVersion: 1,
    id: 'desktop-default',
    baseCommit: '0'.repeat(40),
    rules: [],
  } as import('../design/schema').FlowDocument,
}));

vi.mock('../design/generated/flow.ts', () => ({ PRODUCTION_FLOW: generated.flow }));
vi.mock('../mobile/src/tv/playerLink', async () => {
  const { signal } = await import('@preact/signals');
  return { nowPlaying: signal(null as import('../src/phone/protocol').PlayerState | null), sendCmd: vi.fn() };
});

import { installProductionFlow, type ProductionFlowOptions } from '../design/production-flow';
import { createPhoneFlowPublishers, subscribePhonePlayback } from '../mobile/src/productionFlowPublishers';
import { createTvFlowPublishers } from '../src/productionFlowPublishers';
import { saveBillingAccess } from '../src/billing/entitlement';
import { SESSION_KEY } from '../src/billing/session';
import { torrents } from '../src/store/library';
import { routeStack as phoneStack } from '../mobile/src/nav';
import { routeStack as tvStack } from '../src/ui/nav';
import { tvPlayerState } from '../src/phone/link';
import { nowPlaying } from '../mobile/src/tv/playerLink';

function rule(id: string, event: import('../design/schema').FlowEventType, message: string): import('../design/schema').InteractionRule {
  return {
    id,
    screenId: '*',
    elementId: 'status',
    event,
    action: { type: 'back' },
    steps: [{ id: `${id}-s1`, action: { type: 'toast', message } }],
    graph: {
      nodes: [
        { id: `${id}-n1`, kind: 'trigger', x: 0, y: 0 },
        { id: `${id}-n2`, kind: 'action', stepId: `${id}-s1`, x: 1, y: 0 },
      ],
      edges: [{ id: `${id}-e1`, from: `${id}-n1`, to: `${id}-n2`, branch: 'default' }],
    },
  };
}

function playing(patch: Partial<import('../src/phone/protocol').PlayerState> = {}): import('../src/phone/protocol').PlayerState {
  return {
    hash: 'h',
    file: 1,
    title: 'T',
    subtitle: '',
    time: 10,
    duration: 100,
    paused: false,
    buffering: false,
    audio: { list: [], sel: 0 },
    subs: { list: [], sel: '' },
    next: null,
    ...patch,
  };
}

function install(publishers: ProductionFlowOptions['publishers']) {
  const calls: string[] = [];
  const root = document.createElement('div');
  document.body.appendChild(root);
  const stop = installProductionFlow(root, {
    target: 'android-phone',
    screenOf: () => 'library',
    environment: () => ({ serverConnected: false, networkOnline: true, accountSignedIn: false, playbackState: 'idle', downloadState: 'idle' }),
    publishers,
    dispatcher: {
      navigate: (screenId) => {
        calls.push(`navigate:${screenId}`);
        return { ok: true };
      },
      back: () => {
        calls.push('back');
        return { ok: true };
      },
      openScreen: (screenId) => {
        calls.push(`openScreen:${screenId}`);
        return { ok: true };
      },
      toast: (message) => {
        calls.push(`toast:${message}`);
        return { ok: true };
      },
      dialog: () => ({ ok: true }),
      playbackPlayPause: () => ({ ok: true }),
      playbackStop: () => ({ ok: true }),
      playbackNextEpisode: () => ({ ok: true }),
      queueAdd: () => ({ ok: true }),
      queueReplace: () => ({ ok: true }),
      serverConnect: () => ({ ok: true }),
      serverReconnect: () => ({ ok: true }),
      serverRetry: () => ({ ok: true }),
      sourceRetry: () => ({ ok: true }),
      sourceNext: () => ({ ok: true }),
      linkOpen: () => ({ ok: true }),
      telegramOpen: () => ({ ok: true }),
    },
  });
  return { calls, stop };
}

beforeEach(() => {
  generated.flow.rules = [];
  localStorage.clear();
  torrents.value = [];
  nowPlaying.value = null;
  tvPlayerState.value = null;
  phoneStack.value = [{ name: 'library' }];
  tvStack.value = [{ name: 'library' }];
  document.body.innerHTML = '';
});

describe('production flow publishers (main-entry subscriptions)', () => {
  it('fires account signed-in and signed-out from real billing access writes', () => {
    generated.flow.rules = [
      rule('acc-in', 'account.signed-in', 'signed in'),
      rule('acc-out', 'account.signed-out', 'signed out'),
    ];
    const { calls, stop } = install(createPhoneFlowPublishers());
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token: 'tok', paidUntil: 0 }));
    saveBillingAccess({ active: true, checkedAt: Date.now() });
    expect(calls).toEqual(['toast:signed in']);
    saveBillingAccess(null);
    expect(calls).toEqual(['toast:signed in', 'toast:signed out']);
    stop();
  });

  it('fires playback started, paused, stopped and finished from the player link state', () => {
    generated.flow.rules = [
      rule('pb-start', 'playback.started', 'started'),
      rule('pb-pause', 'playback.paused', 'paused'),
      rule('pb-stop', 'playback.stopped', 'stopped'),
      rule('pb-finish', 'playback.finished', 'finished'),
    ];
    const { calls, stop } = install(createPhoneFlowPublishers());
    nowPlaying.value = playing();
    nowPlaying.value = playing({ paused: true });
    nowPlaying.value = playing({ paused: true, time: 20 });
    nowPlaying.value = null;
    expect(calls).toEqual(['toast:started', 'toast:paused', 'toast:stopped']);
    nowPlaying.value = playing({ time: 95 });
    nowPlaying.value = null;
    expect(calls).toEqual(['toast:started', 'toast:paused', 'toast:stopped', 'toast:started', 'toast:finished']);
    stop();
  });

  it('fires download started, completed and failed from the library torrent list', () => {
    generated.flow.rules = [
      rule('dl-start', 'download.started', 'download started'),
      rule('dl-done', 'download.completed', 'download completed'),
      rule('dl-fail', 'download.failed', 'download failed'),
    ];
    const { calls, stop } = install(createPhoneFlowPublishers());
    const active = { hash: 'h1', title: 'T', stat: 1, stat_string: 'Torrent working', torrent_size: 100, loaded_size: 10 };
    torrents.value = [active as never];
    expect(calls).toEqual(['toast:download started']);
    torrents.value = [{ ...active, stat_string: 'Done', loaded_size: 100 } as never];
    expect(calls).toEqual(['toast:download started', 'toast:download completed']);
    // A completed torrent vanishing silently is a deletion, not a failure.
    torrents.value = [];
    expect(calls).toEqual(['toast:download started', 'toast:download completed']);
    const second = { hash: 'h2', title: 'T2', stat: 1, stat_string: 'Torrent working', torrent_size: 100, loaded_size: 5 };
    torrents.value = [second as never];
    torrents.value = [];
    expect(calls).toEqual(['toast:download started', 'toast:download completed', 'toast:download started', 'toast:download failed']);
    stop();
  });

  it('derives phone playback updates with finished distinguished from stopped', () => {
    const updates: string[] = [];
    const stop = subscribePhonePlayback((update) => updates.push(`${update.state}:${update.event}`));
    nowPlaying.value = playing();
    nowPlaying.value = playing({ paused: true });
    nowPlaying.value = playing({ paused: true, time: 30 });
    nowPlaying.value = null;
    nowPlaying.value = playing({ hash: 'h2', file: 2, time: 99 });
    nowPlaying.value = null;
    expect(updates).toEqual([
      'playing:playback.started',
      'paused:playback.paused',
      'stopped:playback.stopped',
      'playing:playback.started',
      'stopped:playback.finished',
    ]);
    stop();
  });

  it('fires started, stopped, paused and finished from the TV route and player state', () => {
    generated.flow.rules = [
      rule('tv-start', 'playback.started', 'tv started'),
      rule('tv-pause', 'playback.paused', 'tv paused'),
      rule('tv-stop', 'playback.stopped', 'tv stopped'),
      rule('tv-finish', 'playback.finished', 'tv finished'),
    ];
    const { calls, stop } = install(createTvFlowPublishers());
    tvStack.value = [{ name: 'library' }, { name: 'player', queue: [], index: 0 }];
    tvPlayerState.value = playing();
    tvPlayerState.value = playing({ paused: true });
    tvPlayerState.value = null;
    tvStack.value = [{ name: 'library' }];
    expect(calls).toEqual(['toast:tv started', 'toast:tv paused', 'toast:tv finished', 'toast:tv stopped']);
    stop();
  });
});
