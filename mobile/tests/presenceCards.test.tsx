import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { applyLanguageSetting } from '../../src/i18n';
import { deviceId } from '../../src/billing/session';
import type { Torrent } from '../../src/api/types';
import { torrents } from '../../src/store/library';
import { resetDeviceDb } from '../../src/store/deviceDb';
import {
  PresenceCards,
  presenceTarget,
  setPresenceCardActions,
  type PresenceCardActions,
} from '../src/screens/PresenceCards';
import type { PlaybackPresence } from '../../src/billing/presenceClient';

function row(device: string, state: 'playing' | 'paused' = 'playing'): PlaybackPresence {
  return {
    state,
    sessionId: 'session-' + device,
    sessionSeq: 1,
    hash: 'a'.repeat(40),
    fileId: 2,
    title: 'Show',
    episode: 'S01E02',
    positionSec: 42,
    durationSec: 100,
    deviceName: device === 'tv' ? 'LG' : 'Android TV',
    platform: device === 'tv' ? 'lg' : 'androidtv',
    deviceId: device,
    updatedAt: state === 'playing' ? 200 : 100,
  };
}

const file2 = { id: 2, path: 'S01E02.mkv', length: 20 };
const torrent = {
  hash: 'a'.repeat(40),
  title: 'Show',
  file_stats: [{ id: 1, path: 'S01E01.mkv', length: 10 }, file2],
} as unknown as Torrent;

let actions: PresenceCardActions;
let host: HTMLElement;

beforeEach(() => {
  localStorage.clear();
  resetDeviceDb();
  applyLanguageSetting('ru');
  torrents.value = [torrent];
  actions = { fetch: vi.fn(() => Promise.resolve([])), play: vi.fn(() => Promise.resolve()) };
  setPresenceCardActions(actions);
  document.body.innerHTML = '<div id="app"></div>';
  host = document.getElementById('app')!;
});

afterEach(() => {
  act(() => render(null, host));
  setPresenceCardActions(null);
  torrents.value = [];
  vi.clearAllTimers();
  vi.useRealTimers();
  localStorage.clear();
});

async function mount(rows: PlaybackPresence[]) {
  actions.fetch = vi.fn(() => Promise.resolve(rows));
  await act(async () => {
    render(<PresenceCards />, host);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('presence cards', () => {
  it('hides self and renders separate playing and paused devices without autoplay', async () => {
    await mount([row(deviceId()), row('paused', 'paused'), row('tv')]);
    expect(host.querySelectorAll('[data-presence-row]')).toHaveLength(2);
    expect(host.textContent).toContain('Сейчас играет на LG');
    expect(host.textContent).toContain('Пауза: Android TV');
    expect(host.textContent).toContain('S01E02');
    expect(actions.play).not.toHaveBeenCalled();
  });

  it('continues the exact hash and file id at the presence position', async () => {
    expect(presenceTarget(row('tv'), [torrent])?.file).toBe(file2);
    await mount([row('tv')]);
    const button = host.querySelector<HTMLButtonElement>('[data-presence-continue="tv"]')!;
    await act(async () => {
      button.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(actions.play).toHaveBeenCalledWith(torrent, file2, 42, 100);
  });

  it('explains an unavailable target instead of choosing another file', async () => {
    const missing = { ...row('tv'), fileId: 99 };
    expect(presenceTarget(missing, [torrent])).toBeNull();
    await mount([missing]);
    expect(host.textContent).toContain('Файл недоступен на этом устройстве');
    expect(host.querySelector('[data-presence-continue]')).toBeNull();
    expect(actions.play).not.toHaveBeenCalled();
  });

  it('polls only while visible and stops on unmount', async () => {
    vi.useFakeTimers();
    await mount([]);
    expect(actions.fetch).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(actions.fetch).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(actions.fetch).toHaveBeenCalledTimes(2);
    act(() => render(null, host));
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(actions.fetch).toHaveBeenCalledTimes(2);
  });
});
