import { describe, it, expect, afterEach } from 'vitest';
import { applyLanguageSetting } from '../../src/i18n';
import { forPlatform, parseChangelog } from '../../src/lib/changelog';
import { CHANGELOG, CHANGELOG_EN, getChangelog, mergeChangelog, setChangelogPlatform } from '../../src/lib/changelogData';

afterEach(() => {
  applyLanguageSetting('ru');
  setChangelogPlatform('tv');
});

describe('changelogData', () => {
  it('Russian UI gets the Russian entries, the TV ones by default', () => {
    expect(getChangelog()).toEqual(forPlatform(CHANGELOG, 'tv'));
    expect(getChangelog()).toBe(getChangelog());
  });

  it('the TV never shows a «[phone]» bullet, the phone never a «[tv]» one; no marker is shown', () => {
    const tv = getChangelog();
    setChangelogPlatform('phone');
    const phone = getChangelog();
    const all = (l: typeof tv) => l.map((e) => e.items.join('\n')).join('\n');
    expect(all(tv)).not.toMatch(/\[(tv|phone)\]/);
    expect(all(phone)).not.toMatch(/\[(tv|phone)\]/);
    // the phone-only 0.17.0 betas: the calendar is on the phone only
    expect(all(phone)).toContain('«Новое» → «Календарь»');
    expect(all(tv)).not.toContain('«Новое» → «Календарь»');
    const raw = CHANGELOG.filter((e) => e.version === '0.17.0-beta.6')[0].items;
    expect(raw.some((i) => /^\[phone\] /.test(i))).toBe(true);
  });

  it('English UI gets the English entries, Russian where a version is not translated', () => {
    applyLanguageSetting('en');
    setChangelogPlatform('phone');
    const list = getChangelog();
    expect(list.map((e) => e.version)).toEqual(CHANGELOG.map((e) => e.version));
    const en = CHANGELOG_EN.map((e) => e.version);
    expect(en.length).toBeGreaterThanOrEqual(6);
    list.forEach((e) => {
      const ru = CHANGELOG.filter((r) => r.version === e.version)[0];
      if (en.indexOf(e.version) >= 0) expect(e.items).not.toEqual(ru.items);
      else expect(e.items).toEqual(ru.items);
    });
    const v0160 = list.filter((e) => e.version === '0.16.0')[0];
    expect(v0160.items[0]).toMatch(/^English: the whole app/);
  });

  it('mergeChangelog falls back to the Russian entry for a missing version', () => {
    const ru = parseChangelog('## 0.2.0\n- Второе\n\n## 0.1.0\n- Первое\n');
    const en = parseChangelog('## 0.2.0\n- Second\n');
    const merged = mergeChangelog(ru, en);
    expect(merged[0].items).toEqual(['Second']);
    expect(merged[1].items).toEqual(['Первое']);
  });
});
