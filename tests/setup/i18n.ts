import { beforeEach } from 'vitest';
import { applyLanguageSetting } from '../../src/i18n';

/**
 * Tests run in Russian: the browser reports Russian (so 'system', the default setting after resetSettings(),
 * resolves to Russian) and the language is pinned before every test. A test that needs another system language
 * redefines navigator.languages / navigator.language itself. A language stored in the settings by an earlier test
 * ('en') is reset to 'system' so that a later updateSettings() cannot bring it back.
 */
function stubNavigatorLanguage(): void {
  Object.defineProperty(window.navigator, 'languages', { configurable: true, get: () => ['ru-RU'] });
  Object.defineProperty(window.navigator, 'language', { configurable: true, get: () => 'ru-RU' });
}

async function resetStoredLanguage(): Promise<void> {
  let stored: Record<string, unknown> | null = null;
  try {
    const raw = window.localStorage.getItem('tsp.settings');
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && parsed.language && parsed.language !== 'system') stored = parsed;
  } catch (e) { /* no storage or not JSON: nothing to reset */ }
  if (!stored) return;
  stored.language = 'system';
  try { window.localStorage.setItem('tsp.settings', JSON.stringify(stored)); } catch (e) { /* ignore */ }
  // the store of this test file keeps its own copy of the settings; it was loaded if the language got stored
  const m = await import('../../src/store/settings');
  if (m.settings.value.language !== 'system') m.settings.value = { ...m.settings.value, language: 'system' };
}

stubNavigatorLanguage();
applyLanguageSetting('ru');

beforeEach(async () => {
  stubNavigatorLanguage();
  await resetStoredLanguage();
  applyLanguageSetting('ru');
});
