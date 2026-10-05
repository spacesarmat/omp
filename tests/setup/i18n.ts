import { beforeEach } from 'vitest';
import { applyLanguageSetting } from '../../src/i18n';

/**
 * Tests run in Russian: the browser reports Russian (so 'system', the default setting after resetSettings(),
 * resolves to Russian) and the language is pinned before every test. A test that needs another system language
 * redefines navigator.languages / navigator.language itself.
 */
function stubNavigatorLanguage(): void {
  Object.defineProperty(window.navigator, 'languages', { configurable: true, get: () => ['ru-RU'] });
  Object.defineProperty(window.navigator, 'language', { configurable: true, get: () => 'ru-RU' });
}

stubNavigatorLanguage();
applyLanguageSetting('ru');

beforeEach(() => {
  stubNavigatorLanguage();
  applyLanguageSetting('ru');
});
