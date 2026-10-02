import { describe, it, expect, beforeEach } from 'vitest';
import { mockFetch } from '../helpers/fetchMock';
import {
  checkForUpdate, skipVersion, dismissPrompt, reloadUpdateState, sanitizeUpdateState,
  latestUpdate, updatePrompt, CHECK_INTERVAL_MS,
} from '../../src/store/updates';
import { updateSettings, resetSettings } from '../../src/store/settings';

const feed = (version: string) => JSON.stringify({
  version,
  ipkUrl: 'https://github.com/spacesarmat/omp/releases/download/v' + version + '/a.ipk',
  ipkHash: 'b'.repeat(64),
  notes: ['Новое'],
});
const NOW = 1_800_000_000_000;

beforeEach(() => {
  localStorage.clear();
  resetSettings();
  reloadUpdateState();
});

describe('checkForUpdate', () => {
  it('finds a newer version and prompts once per run', async () => {
    const f = mockFetch(() => ({ body: feed('0.6.1') }));
    expect(await checkForUpdate({ manual: false, now: NOW, current: '0.6.0' })).toBe('update');
    expect(f.mock.calls[0][0]).toBe('https://raw.githubusercontent.com/spacesarmat/omp/gh-pages/update.json');
    expect(latestUpdate.value!.version).toBe('0.6.1');
    expect(updatePrompt.value!.version).toBe('0.6.1');
    expect(JSON.parse(localStorage.getItem('tsp.update')!).lastCheck).toBe(NOW);
    dismissPrompt();
    expect(updatePrompt.value).toBeNull();
    expect(latestUpdate.value).not.toBeNull();
  });
  it('respects the 6-hour interval and the setting, manual ignores both', async () => {
    const f = mockFetch(() => ({ body: feed('0.6.1') }));
    await checkForUpdate({ manual: false, now: NOW, current: '0.6.0' });
    expect(await checkForUpdate({ manual: false, now: NOW + CHECK_INTERVAL_MS - 1, current: '0.6.0' })).toBe('skipped');
    expect(f).toHaveBeenCalledTimes(1);
    updateSettings({ updateCheck: false });
    expect(await checkForUpdate({ manual: false, now: NOW + CHECK_INTERVAL_MS * 2, current: '0.6.0' })).toBe('skipped');
    expect(await checkForUpdate({ manual: true, now: NOW + 1, current: '0.6.0' })).toBe('update');
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('reports latest for same/older/broken feeds', async () => {
    mockFetch(() => ({ body: feed('0.6.0') }));
    expect(await checkForUpdate({ manual: true, now: NOW, current: '0.6.0' })).toBe('latest');
    expect(latestUpdate.value).toBeNull();
    mockFetch(() => ({ body: '{"version":"9.9.9"}' }));
    expect(await checkForUpdate({ manual: true, now: NOW, current: '0.6.0' })).toBe('latest');
  });
  it('reports network errors without touching lastCheck', async () => {
    mockFetch(() => ({ status: 500, body: '' }));
    expect(await checkForUpdate({ manual: false, now: NOW, current: '0.6.0' })).toBe('error');
    expect(localStorage.getItem('tsp.update')).toBeNull();
  });
  it('skipped version does not prompt automatically but manual check still does', async () => {
    mockFetch(() => ({ body: feed('0.6.1') }));
    skipVersion('0.6.1');
    expect(JSON.parse(localStorage.getItem('tsp.update')!).skipped).toBe('0.6.1');
    expect(await checkForUpdate({ manual: false, now: NOW, current: '0.6.0' })).toBe('update');
    expect(updatePrompt.value).toBeNull();
    expect(latestUpdate.value!.version).toBe('0.6.1');
    await checkForUpdate({ manual: true, now: NOW, current: '0.6.0' });
    expect(updatePrompt.value!.version).toBe('0.6.1');
  });
});

describe('sanitizeUpdateState', () => {
  it('keeps only valid fields', () => {
    expect(sanitizeUpdateState({ lastCheck: 5, skipped: '0.6.1', x: 1 })).toEqual({ lastCheck: 5, skipped: '0.6.1' });
    expect(sanitizeUpdateState({ lastCheck: 'x', skipped: 3 })).toEqual({ lastCheck: 0 });
    expect(sanitizeUpdateState(null)).toEqual({ lastCheck: 0 });
  });
});
