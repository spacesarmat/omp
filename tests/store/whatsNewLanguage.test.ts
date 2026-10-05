import { describe, it, expect, afterEach } from 'vitest';
import { applyLanguageSetting } from '../../src/i18n';
import { checkWhatsNew, whatsNew, closeWhatsNew } from '../../src/store/whatsNew';
import { getChangelog } from '../../src/lib/changelogData';
import { APP_VERSION } from '../../src/version';

afterEach(() => {
  closeWhatsNew();
  applyLanguageSetting('ru');
});

describe('the automatic «What\'s new» notice follows a language change', () => {
  it('its title and entries are rebuilt in English', () => {
    localStorage.clear();
    localStorage.setItem('tsp.x', '1');
    checkWhatsNew(getChangelog(), APP_VERSION);
    expect(whatsNew.value).not.toBeNull();
    expect(whatsNew.value!.title).toMatch(/Что нового/);
    applyLanguageSetting('en');
    expect(whatsNew.value!.title).toMatch(/What/);
    expect(whatsNew.value!.entries[0].items.join(' ')).not.toMatch(/[А-Яа-яЁё]/);
  });
});
