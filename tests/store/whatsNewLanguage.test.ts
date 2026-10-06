import { describe, it, expect, afterEach } from 'vitest';
import { applyLanguageSetting } from '../../src/i18n';
import { checkWhatsNew, whatsNew, closeWhatsNew } from '../../src/store/whatsNew';
import { CHANGELOG_EN, getChangelog, setChangelogPlatform } from '../../src/lib/changelogData';
import { APP_VERSION } from '../../src/version';

afterEach(() => {
  closeWhatsNew();
  applyLanguageSetting('ru');
});

describe('the automatic «What\'s new» notice follows a language change', () => {
  it('its title and entries are rebuilt in English', () => {
    localStorage.clear();
    localStorage.setItem('tsp.x', '1');
    setChangelogPlatform('phone');
    // 0.17.0: the 0.18.0 betas have no bullet for the phone (TV screens and the LG's search through the phone)
    checkWhatsNew(getChangelog(), '0.17.0');
    expect(whatsNew.value).not.toBeNull();
    expect(whatsNew.value!.title).toMatch(/Что нового/);
    applyLanguageSetting('en');
    expect(whatsNew.value!.title).toMatch(/What/);
    expect(whatsNew.value!.entries[0].items.join(' ')).not.toMatch(/[А-Яа-яЁё]/);
  });

  it('the rebuilt entries keep the platform: no phone-only bullet on the TV, no marker shown', () => {
    localStorage.clear();
    localStorage.setItem('tsp.x', '1');
    setChangelogPlatform('tv');
    checkWhatsNew(getChangelog(), APP_VERSION);
    applyLanguageSetting('en');
    const items = (whatsNew.value ? whatsNew.value.entries : []).map((e) => e.items.join('\n')).join('\n');
    expect(items).not.toMatch(/\[(tv|lg|atv|phone)\]/i);
    expect(items).not.toContain('Calendar');
    expect(items).not.toMatch(/[А-Яа-яЁё]/);
  });

  it('on Android TV the rebuilt entries keep its own bullets: none of the LG-only search through the phone', () => {
    localStorage.clear();
    localStorage.setItem('tsp.x', '1');
    setChangelogPlatform('atv');
    checkWhatsNew(getChangelog(), APP_VERSION);
    applyLanguageSetting('en');
    const items = (whatsNew.value ? whatsNew.value.entries : []).map((e) => e.items.join('\n')).join('\n');
    expect(items).not.toMatch(/\[(tv|lg|atv|phone)\]/i);
    expect(items).not.toContain('The LG TV searches torrent sites');
    expect(items).not.toContain('Search sources');
    expect(items).not.toMatch(/[А-Яа-яЁё]/);
    setChangelogPlatform('tv');
  });

  it('the English changelog has no Cyrillic in any bullet', () => {
    expect(CHANGELOG_EN.map((e) => e.items.join(' ')).join(' ')).not.toMatch(/[А-Яа-яЁё]/);
  });
});
