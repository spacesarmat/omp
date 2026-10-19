import { describe, it, expect, afterEach } from 'vitest';
import { applyLanguageSetting } from '../../src/i18n';
import {
  EMPTY_BYTES,
  QUIET_SPEED,
  classifyFailure,
  failureText,
  faultFromMediaCode,
  swarmFromCache,
  type SwarmStats,
} from '../../src/player/playbackFailure';
import { openAnotherRelease, pendingBetterHash } from '../../src/player/anotherRelease';
import { routeStack } from '../../src/ui/nav';
import type { CacheState } from '../../src/api/types';

afterEach(() => {
  applyLanguageSetting('ru');
  pendingBetterHash.value = null;
  routeStack.value = [{ name: 'connect' }];
});

function stats(p: Partial<SwarmStats> = {}): SwarmStats {
  return {
    activePeers: 0,
    totalPeers: 0,
    seeders: 0,
    preloadedBytes: 0,
    loadedBytes: 0,
    downloadSpeed: 0,
    ...p,
  };
}

const dead = stats({ totalPeers: 40 });
const peers = stats({ activePeers: 3, seeders: 1, totalPeers: 12 });
const flowing = stats({ activePeers: 2, seeders: 1, preloadedBytes: EMPTY_BYTES, downloadSpeed: 200000 });

describe('classifyFailure', () => {
  it('maps media error codes', () => {
    expect(faultFromMediaCode(null)).toBe('none');
    expect(faultFromMediaCode(1)).toBe('aborted');
    expect(faultFromMediaCode(2)).toBe('network');
    expect(faultFromMediaCode(3)).toBe('decode');
    expect(faultFromMediaCode(4)).toBe('format');
    expect(faultFromMediaCode(0)).toBe('other');
  });

  it('reads peers, seeders, preload and speed from a /cache answer', () => {
    const cache = {
      Capacity: 1,
      Filled: 100,
      PiecesLength: 1,
      PiecesCount: 1,
      Torrent: {
        hash: 'h',
        title: 't',
        stat: 3,
        active_peers: 4,
        total_peers: 9,
        connected_seeders: 2,
        preloaded_bytes: 50,
        loaded_size: 80,
        download_speed: 1200,
      },
    } as CacheState;
    expect(swarmFromCache('ok', cache, true)).toEqual({
      kind: 'ok',
      stats: {
        activePeers: 4,
        totalPeers: 9,
        seeders: 2,
        preloadedBytes: 50,
        loadedBytes: 100,
        downloadSpeed: 1200,
      },
    });
    expect(swarmFromCache('pending', null, true).kind).toBe('pending');
    expect(swarmFromCache('idle', null, true).kind).toBe('pending');
    expect(swarmFromCache('down', null, true).kind).toBe('unreachable');
    expect(swarmFromCache('ok', cache, false).kind).toBe('absent');
  });

  it('does not call a dead swarm an unsupported codec', () => {
    expect(classifyFailure('format', { kind: 'ok', stats: dead }, false)).toBe('no-seeders');
    expect(classifyFailure('decode', { kind: 'ok', stats: dead }, false)).toBe('no-seeders');
    expect(classifyFailure('network', { kind: 'ok', stats: dead }, false)).toBe('no-seeders');
    expect(classifyFailure('other', { kind: 'ok', stats: dead }, false)).toBe('no-seeders');
    // listed in the swarm but not connected, and nothing loaded
    expect(classifyFailure('format', { kind: 'ok', stats: stats({ totalPeers: 8 }) }, false)).toBe('no-seeders');
  });

  it('keeps waiting when peers are connected but nothing playable has arrived', () => {
    expect(classifyFailure('format', { kind: 'ok', stats: peers }, false)).toBe('buffering');
    expect(classifyFailure('network', { kind: 'ok', stats: peers }, false)).toBe('buffering');
    expect(classifyFailure('decode', { kind: 'ok', stats: stats({ seeders: 1, downloadSpeed: QUIET_SPEED }) }, false)).toBe('buffering');
    expect(classifyFailure('format', { kind: 'ok', stats: stats({ downloadSpeed: QUIET_SPEED + 1 }) }, false)).toBe('buffering');
    expect(classifyFailure('none', { kind: 'ok', stats: dead }, false)).toBe('buffering');
    expect(classifyFailure('format', { kind: 'pending' }, false)).toBe('buffering');
  });

  it('says the server is unreachable when the stat request fails', () => {
    expect(classifyFailure('format', { kind: 'unreachable' }, false)).toBe('server');
    expect(classifyFailure('network', { kind: 'unreachable' }, false)).toBe('server');
    expect(classifyFailure('decode', { kind: 'unreachable' }, true)).toBe('server');
  });

  it('keeps the codec message only once data has reached the decoder', () => {
    expect(classifyFailure('format', { kind: 'ok', stats: flowing }, false)).toBe('codec');
    expect(classifyFailure('decode', { kind: 'ok', stats: dead }, true)).toBe('codec');
    expect(classifyFailure('format', { kind: 'ok', stats: stats({ loadedBytes: EMPTY_BYTES }) }, false)).toBe('codec');
    expect(classifyFailure('network', { kind: 'ok', stats: flowing }, false)).toBe('buffering');
    expect(classifyFailure('network', { kind: 'ok', stats: stats({ loadedBytes: EMPTY_BYTES }) }, false)).toBe('server');
  });

  it('leaves a non-torrent file and an abort on the engine text', () => {
    expect(classifyFailure('format', { kind: 'absent' }, false)).toBe('codec');
    expect(classifyFailure('network', { kind: 'absent' }, false)).toBe('other');
    expect(classifyFailure('aborted', { kind: 'ok', stats: dead }, false)).toBe('other');
  });

  it('texts in Russian and English', () => {
    applyLanguageSetting('ru');
    expect(failureText('no-seeders', 4)).toBe('Нет раздающих - раздача сейчас недоступна. Попробуйте другую раздачу.');
    expect(failureText('server', 2)).toBe('Нет связи с TorrServer. Проверьте, что сервер включён и доступен в сети.');
    expect(failureText('codec', 4)).toBe('Формат или кодек не поддерживается телевизором');
    expect(failureText('codec', 3)).toBe('Ошибка декодирования - формат не поддерживается телевизором');
    expect(failureText('other', 1)).toBe('Воспроизведение прервано');
    applyLanguageSetting('en');
    expect(failureText('no-seeders', 4)).toBe('No seeders - this torrent is unavailable right now. Try another release.');
    expect(failureText('server', 2)).toBe('Cannot reach TorrServer. Check that the server is on and reachable on the network.');
    expect(failureText('codec', 4)).toBe('The TV does not support this format or codec');
    expect(failureText('codec', 3)).toBe('Decoding error - the TV does not support this format');
    expect(failureText('other', 2)).toBe('Network error while loading the video');
  });
});

describe('openAnotherRelease', () => {
  it('returns to the torrent underneath and asks it to open the replace flow', () => {
    routeStack.value = [{ name: 'library' }, { name: 'torrent', hash: 'abc' }, { name: 'player', queue: [], index: 0 }];
    openAnotherRelease('abc');
    expect(routeStack.value.map((r) => r.name)).toEqual(['library', 'torrent']);
    expect(pendingBetterHash.value).toBe('abc');
  });

  it('replaces the player with the torrent details when playback started elsewhere', () => {
    routeStack.value = [{ name: 'library' }, { name: 'player', queue: [], index: 0 }];
    openAnotherRelease('abc');
    expect(routeStack.value[routeStack.value.length - 1]).toEqual({ name: 'torrent', hash: 'abc' });
    expect(pendingBetterHash.value).toBe('abc');
  });

  it('just goes back when the item is not a torrent', () => {
    routeStack.value = [{ name: 'library' }, { name: 'player', queue: [], index: 0 }];
    openAnotherRelease(undefined);
    expect(routeStack.value.map((r) => r.name)).toEqual(['library']);
    expect(pendingBetterHash.value).toBe(null);
  });
});
