import { describe, it, expect, afterEach } from 'vitest';
import { applyLanguageSetting } from '../../src/i18n';
import { parseChangelog } from '../../src/lib/changelog';
import { CHANGELOG, CHANGELOG_EN, getChangelog, mergeChangelog } from '../../src/lib/changelogData';

afterEach(() => applyLanguageSetting('ru'));

describe('changelogData', () => {
  it('Russian UI gets the Russian entries', () => {
    expect(getChangelog()).toBe(CHANGELOG);
  });

  it('English UI gets the English entries, Russian where a version is not translated', () => {
    applyLanguageSetting('en');
    const list = getChangelog();
    expect(list.map((e) => e.version)).toEqual(CHANGELOG.map((e) => e.version));
    const en = CHANGELOG_EN.map((e) => e.version);
    expect(en.length).toBeGreaterThanOrEqual(6);
    list.forEach((e) => {
      const ru = CHANGELOG.filter((r) => r.version === e.version)[0];
      if (en.indexOf(e.version) >= 0) expect(e.items).not.toEqual(ru.items);
      else expect(e.items).toEqual(ru.items);
    });
    const v0170 = list.filter((e) => e.version === '0.17.0-beta.1')[0];
    expect(v0170.items[0]).toMatch(/^“Discover” in “Catalog”/);
  });

  it('mergeChangelog falls back to the Russian entry for a missing version', () => {
    const ru = parseChangelog('## 0.2.0\n- Второе\n\n## 0.1.0\n- Первое\n');
    const en = parseChangelog('## 0.2.0\n- Second\n');
    const merged = mergeChangelog(ru, en);
    expect(merged[0].items).toEqual(['Second']);
    expect(merged[1].items).toEqual(['Первое']);
  });
});
