import { describe, it, expect, afterEach } from 'vitest';
import { applyLanguageSetting } from '../../src/i18n';
import { forPlatform, parseChangelog } from '../../src/lib/changelog';
import { CHANGELOG, CHANGELOG_EN, getChangelog, mergeChangelog, setChangelogPlatform, tvChangelogPlatform } from '../../src/lib/changelogData';

const asAndroidTv = (on: boolean) => {
  const w = window as unknown as { Capacitor?: { getPlatform: () => string } };
  if (on) w.Capacitor = { getPlatform: () => 'android' };
  else delete w.Capacitor;
};

afterEach(() => {
  applyLanguageSetting('ru');
  setChangelogPlatform('tv');
  asAndroidTv(false);
});

describe('changelogData', () => {
  it('Russian UI gets the Russian entries, the TV ones by default', () => {
    expect(tvChangelogPlatform()).toBe('lg');
    expect(getChangelog()).toEqual(forPlatform(CHANGELOG, 'lg'));
    expect(getChangelog()).toBe(getChangelog());
  });

  it('the TV never shows a «[phone]» bullet, the phone never a «[tv]» one; no marker is shown', () => {
    const tv = getChangelog();
    setChangelogPlatform('phone');
    const phone = getChangelog();
    const all = (l: typeof tv) => l.map((e) => e.items.join('\n')).join('\n');
    expect(all(tv)).not.toMatch(/\[(tv|lg|atv|phone)\]/i);
    expect(all(phone)).not.toMatch(/\[(tv|lg|atv|phone)\]/i);
    // 0.17.0 calendar bullet: phone only
    expect(all(phone)).toContain('«Новое» → «Календарь»');
    expect(all(tv)).not.toContain('«Новое» → «Календарь»');
    // 0.18.0: mostly TV screens; the phone sees only its own «Search for the TV» bullets
    expect(tv.map((e) => e.version)).toContain('0.18.0');
    expect(all(tv)).toContain('Телевизор LG ищет раздачи');
    expect(all(phone)).not.toContain('Телевизор LG ищет раздачи');
    expect(phone.filter((e) => e.version === '0.18.0')[0].items).toHaveLength(3);
    const raw = CHANGELOG.filter((e) => e.version === '0.19.0-beta.2')[0].items;
    expect(raw.some((i) => /^\[phone\] /.test(i))).toBe(true);
  });

  it('Android TV shows the unmarked, «[tv]» and «[atv]» bullets, never the LG-only ones', () => {
    const lg = getChangelog();
    asAndroidTv(true);
    expect(tvChangelogPlatform()).toBe('atv');
    const atv = getChangelog();
    expect(atv).toEqual(forPlatform(CHANGELOG, 'atv'));
    const all = (l: typeof atv) => l.map((e) => e.items.join('\n')).join('\n');
    expect(all(lg)).toContain('Телевизор LG ищет раздачи');
    expect(all(atv)).not.toContain('Телевизор LG ищет раздачи');
    expect(all(atv)).not.toContain('Новый экран поиска на ТВ');
    expect(atv.map((e) => e.version)).toContain('0.18.0');
    expect(all(atv)).toContain('Значок «Управление с телефона»');
    expect(all(lg)).not.toContain('Значок «Управление с телефона»');
    expect(all(atv)).not.toMatch(/\[(tv|lg|atv|phone)\]/i);
    // the raw 0.18.0 bullets carry the LG marker (the highlight and the four search bullets)
    expect(CHANGELOG.filter((e) => e.version === '0.18.0')[0].items.filter((i) => /^\[lg\] /.test(i))).toHaveLength(5);
    expect(CHANGELOG_EN.filter((e) => e.version === '0.18.0')[0].items.filter((i) => /^\[lg\] /.test(i))).toHaveLength(5);
  });

  it('English UI gets the English entries, Russian where a version is not translated', () => {
    applyLanguageSetting('en');
    setChangelogPlatform('phone');
    const list = getChangelog();
    // a version with TV-only bullets alone (the 0.18.0 betas) is not on the phone
    expect(list.map((e) => e.version)).toEqual(forPlatform(CHANGELOG, 'phone').map((e) => e.version));
    expect(list.map((e) => e.version)).not.toContain('0.18.0-beta.2');
    const en = CHANGELOG_EN.map((e) => e.version);
    expect(en.length).toBeGreaterThanOrEqual(6);
    list.forEach((e) => {
      const ru = CHANGELOG.filter((r) => r.version === e.version)[0];
      if (en.indexOf(e.version) >= 0) expect(e.items).not.toEqual(ru.items);
      else expect(e.items).toEqual(ru.items);
    });
    const release = list.filter((e) => e.version === '0.17.0')[0];
    expect(release.items.join(' ')).not.toMatch(/[А-Яа-яЁё]/);
    expect(CHANGELOG_EN.map((e) => e.items.join(' ')).join(' ')).not.toMatch(/[А-Яа-яЁё]/);
  });

  it('mergeChangelog falls back to the Russian entry for a missing version', () => {
    const ru = parseChangelog('## 0.2.0\n- Второе\n\n## 0.1.0\n- Первое\n');
    const en = parseChangelog('## 0.2.0\n- Second\n');
    const merged = mergeChangelog(ru, en);
    expect(merged[0].items).toEqual(['Second']);
    expect(merged[1].items).toEqual(['Первое']);
  });
});
