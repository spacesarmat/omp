import { describe, it, expect, beforeEach } from 'vitest';
import {
  checkComponentUpdates,
  laterComponent,
  dismissComponent,
  reloadComponentUpdates,
  componentPrompt,
  COMPONENT_CHECK_INTERVAL_MS,
} from '../../src/store/componentUpdates';
import { PLAYER_LATEST_URL, TORR_LATEST_URL } from '../../src/lib/componentVersions';
import { updateSettings, resetSettings } from '../../src/store/settings';

const sha = 'ab'.repeat(32);
const player = {
  tag_name: 'v0.2.25',
  assets: [{
    name: '2160player-0.2.25-arm-release.apk',
    size: 19_000_000,
    digest: 'sha256:' + sha,
    browser_download_url: 'https://github.com/spacesarmat/2160player/releases/download/v0.2.25/2160player-0.2.25-arm-release.apk',
  }],
};
const torr = { tag_name: 'MatriX.150' };
const NOW = 1_800_000_000_000;

beforeEach(() => {
  localStorage.clear();
  resetSettings();
  reloadComponentUpdates();
});

describe('checkComponentUpdates', () => {
  it('prompts for a newer player, and Later hides that version', async () => {
    const seen: string[] = [];
    const result = await checkComponentUpdates({
      now: NOW,
      playerVersion: async () => '0.2.24',
      torr: async () => null,
      abi: async () => null,
      fetchJson: async (url) => {
        seen.push(url);
        return player;
      },
    });
    expect(result).toBe('update');
    expect(seen).toEqual([PLAYER_LATEST_URL]);
    expect(componentPrompt.value?.latest).toBe('0.2.25');
    laterComponent();
    expect(componentPrompt.value).toBeNull();
    expect(JSON.parse(localStorage.getItem('omp.componentUpdate')!).player).toBe('0.2.25');
    reloadComponentUpdates();
    const again = await checkComponentUpdates({
      now: NOW + 10,
      manual: true,
      playerVersion: async () => '0.2.24',
      torr: async () => null,
      abi: async () => null,
      fetchJson: async () => player,
    });
    expect(again).toBe('latest');
    expect(componentPrompt.value).toBeNull();
  });

  it('asks TorrServer after the player is dismissed for this launch only', async () => {
    await checkComponentUpdates({
      now: NOW,
      manual: true,
      playerVersion: async () => '0.2.24',
      torr: async () => ({ version: 'MatriX.149', source: 'remote' }),
      abi: async () => 'arm64',
      fetchJson: async (url) => (url === TORR_LATEST_URL ? torr : player),
    });
    expect(componentPrompt.value?.kind).toBe('player');
    dismissComponent();
    expect(componentPrompt.value?.kind).toBe('torrserver');
    expect(localStorage.getItem('omp.componentUpdate')).not.toContain('MatriX.150');
  });

  it('stays quiet when the version is unknown or the check is turned off', async () => {
    let called = 0;
    expect(await checkComponentUpdates({
      now: NOW,
      playerVersion: async () => 'not-a-version',
      torr: async () => ({ version: '<html>', source: 'remote' }),
      abi: async () => null,
      fetchJson: async () => {
        called++;
        return player;
      },
    })).toBe('latest');
    expect(called).toBe(0);
    expect(componentPrompt.value).toBeNull();
    updateSettings({ updateCheck: false });
    expect(await checkComponentUpdates({
      now: NOW,
      playerVersion: async () => '0.2.24',
      torr: async () => null,
      abi: async () => null,
      fetchJson: async () => player,
    })).toBe('skipped');
  });

  it('does not stamp the hour when GitHub does not answer', async () => {
    expect(await checkComponentUpdates({
      now: NOW,
      playerVersion: async () => '0.2.24',
      torr: async () => null,
      abi: async () => null,
      fetchJson: async () => {
        throw new Error('offline');
      },
    })).toBe('error');
    expect(await checkComponentUpdates({
      now: NOW + 1000,
      minIntervalMs: COMPONENT_CHECK_INTERVAL_MS,
      playerVersion: async () => '0.2.24',
      torr: async () => null,
      abi: async () => null,
      fetchJson: async () => player,
    })).toBe('update');
  });
});
