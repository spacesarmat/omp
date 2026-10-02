import { describe, it, expect, beforeEach } from 'vitest';
import { settings, updateSettings, resetSettings, DEFAULT_SETTINGS, sanitizeSettings } from '../../src/store/settings';

beforeEach(() => {
  localStorage.clear();
  resetSettings();
});

describe('settings store', () => {
  it('updates and persists', () => {
    updateSettings({ seekStep: 30, audioLang: 'en' });
    expect(settings.value.seekStep).toBe(30);
    expect(settings.value.subLang).toBe(DEFAULT_SETTINGS.subLang);
    expect(JSON.parse(localStorage.getItem('tsp.settings')!).seekStep).toBe(30);
  });
  it('resets', () => {
    updateSettings({ autoNext: false });
    resetSettings();
    expect(settings.value).toEqual(DEFAULT_SETTINGS);
  });
});

describe('history filter setting', () => {
  it('defaults to all and rejects unknown values', () => {
    expect(DEFAULT_SETTINGS.historyFilter).toBe('all');
    expect(sanitizeSettings({ historyFilter: 'phone' }).historyFilter).toBe('phone');
    expect(sanitizeSettings({ historyFilter: 'radio' }).historyFilter).toBe('all');
    expect(sanitizeSettings({ historyFilter: 3 }).historyFilter).toBe('all');
  });
});

