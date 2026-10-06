import { describe, it, expect, beforeEach } from 'vitest';
import { forPlatform, itemPlatform, parseChangelog, releasesUpTo, stripPlatform } from '../../src/lib/changelog';
import { checkWhatsNew, whatsNew, openWhatsNew, closeWhatsNew, SEEN_KEY } from '../../src/store/whatsNew';
import { CHANGELOG } from '../../src/lib/changelogData';
import { APP_VERSION } from '../../src/version';
import { markWhatsNewShown } from '../../src/store/whatsNew';

const TEXT = '# Изменения\n\n## 0.2.0\n\n- Первое\n- Второе\n\n## 0.10.0\r\n\r\n- Новое\r\n\n## мусор\n- не версия\n\n## 0.1.0\n- Старое\n\n## 0.0.9\n\nбез пунктов\n';

describe('platform markers', () => {
  const MD = '## 0.3.0\n- [phone] Календарь\n- Общее\n- [tv] Пульт на ТВ\n- [TV] Ещё для ТВ\n\n## 0.2.0\n- [phone] Только телефон\n';
  it('each app keeps the unmarked bullets and its own, without the marker; an emptied version goes', () => {
    const list = parseChangelog(MD);
    expect(itemPlatform(list[0].items[0])).toBe('phone');
    expect(itemPlatform(list[0].items[1])).toBe('');
    expect(stripPlatform('[tv] Пульт')).toBe('Пульт');
    expect(forPlatform(list, 'phone')).toEqual([
      { version: '0.3.0', items: ['Календарь', 'Общее'] },
      { version: '0.2.0', items: ['Только телефон'] },
    ]);
    expect(forPlatform(list, 'tv')).toEqual([{ version: '0.3.0', items: ['Общее', 'Пульт на ТВ', 'Ещё для ТВ'] }]);
  });
});

describe('parseChangelog', () => {
  it('parses versions newest first with bullets, skipping malformed sections', () => {
    const l = parseChangelog(TEXT);
    expect(l.map((e) => e.version)).toEqual(['0.10.0', '0.2.0', '0.1.0']);
    expect(l[1].items).toEqual(['Первое', 'Второе']);
    expect(l[0].items).toEqual(['Новое']);
  });
  it('accepts dated headings, flattens ### subheadings, strips bold, keeps indented bullets', () => {
    const l = parseChangelog('## 0.3.0 (2026-10-03)\n\n### Новое\n- **Жирное** раз\n  - вложенное\n### Исправлено\n- Два\n\n## 0.2.0 — осень\n- Старое\n');
    expect(l.map((e) => e.version)).toEqual(['0.3.0', '0.2.0']);
    expect(l[0].items).toEqual(['Жирное раз', 'вложенное', 'Два']);
  });
  it('returns an empty list for garbage', () => {
    expect(parseChangelog('')).toEqual([]);
    expect(parseChangelog('hello\n- x')).toEqual([]);
  });
  it('releasesUpTo ignores newer versions and caps the count', () => {
    const l = parseChangelog(TEXT);
    expect(releasesUpTo(l, '0.2.0').map((e) => e.version)).toEqual(['0.2.0', '0.1.0']);
    expect(releasesUpTo(l, '9.0.0', 2)).toHaveLength(2);
  });
  it('the real CHANGELOG is embedded and parsed', () => {
    expect(CHANGELOG.length).toBeGreaterThan(0);
    expect(CHANGELOG[0].items.length).toBeGreaterThan(0);
    // a release must not ship without its changelog section
    expect(CHANGELOG[0].version).toBe(APP_VERSION);
  });
});

describe('checkWhatsNew', () => {
  const list = parseChangelog(TEXT);
  beforeEach(() => {
    localStorage.clear();
    closeWhatsNew();
  });
  it('fresh install (empty storage): stores the version, shows nothing', () => {
    checkWhatsNew(list, '0.2.0');
    expect(whatsNew.value).toBeNull();
    expect(JSON.parse(localStorage.getItem(SEEN_KEY)!)).toBe('0.2.0');
  });
  it('missing key but other tsp.* data: an update from before the feature, current version queued', () => {
    localStorage.setItem('tsp.servers', '[]');
    checkWhatsNew(list, '0.10.0');
    expect(whatsNew.value!.auto).toBe(true);
    expect(whatsNew.value!.entries.map((e) => e.version)).toEqual(['0.10.0']);
    expect(localStorage.getItem(SEEN_KEY)).toBeNull();
    markWhatsNewShown();
    expect(JSON.parse(localStorage.getItem(SEEN_KEY)!)).toBe('0.10.0');
  });
  it('multi-version jump lists only versions newer than the seen one', () => {
    localStorage.setItem(SEEN_KEY, JSON.stringify('0.1.0'));
    checkWhatsNew(list, '0.10.0');
    expect(whatsNew.value!.entries.map((e) => e.version)).toEqual(['0.10.0', '0.2.0']);
  });
  it('after an update: shows once, then not again', () => {
    localStorage.setItem(SEEN_KEY, JSON.stringify('0.1.0'));
    checkWhatsNew(list, '0.2.0');
    expect(JSON.parse(localStorage.getItem(SEEN_KEY)!)).toBe('0.1.0');
    markWhatsNewShown();
    expect(whatsNew.value!.title).toBe('Что нового в 0.2.0');
    expect(whatsNew.value!.auto).toBe(true);
    expect(whatsNew.value!.entries[0].version).toBe('0.2.0');
    closeWhatsNew();
    checkWhatsNew(list, '0.2.0');
    expect(whatsNew.value).toBeNull();
  });
  it('same or older version shows nothing; corrupt value acts like a fresh install', () => {
    localStorage.setItem(SEEN_KEY, JSON.stringify('0.10.0'));
    checkWhatsNew(list, '0.2.0');
    expect(whatsNew.value).toBeNull();
    expect(JSON.parse(localStorage.getItem(SEEN_KEY)!)).toBe('0.2.0');
    localStorage.setItem(SEEN_KEY, '{"a":1}');
    checkWhatsNew(list, '0.10.0');
    expect(whatsNew.value).toBeNull();
  });
  it('no changelog entry for the new version: nothing shown, version remembered', () => {
    localStorage.setItem(SEEN_KEY, JSON.stringify('0.1.0'));
    checkWhatsNew(list, '0.5.0');
    expect(whatsNew.value).toBeNull();
    expect(JSON.parse(localStorage.getItem(SEEN_KEY)!)).toBe('0.5.0');
  });
  it('openWhatsNew by tap lists current first', () => {
    openWhatsNew(list, '0.2.0');
    expect(whatsNew.value!.auto).toBe(false);
    expect(whatsNew.value!.title).toBe('Что нового');
    expect(whatsNew.value!.entries.map((e) => e.version)).toEqual(['0.2.0', '0.1.0']);
  });
});

describe('beta versions', () => {
  it('a «## 0.16.0-beta.1» section keeps its beta suffix and sorts before the release', () => {
    const list = parseChangelog('## 0.16.0\n\n- a\n\n## 0.16.0-beta.1\n\n- b\n\n## 0.15.5\n\n- c\n');
    expect(list.map((e) => e.version)).toEqual(['0.16.0', '0.16.0-beta.1', '0.15.5']);
  });
  it('a beta install remembers its version and is told about it once', () => {
    localStorage.clear();
    localStorage.setItem('tsp.x', '1');
    const list = parseChangelog('## 0.16.0-beta.1\n\n- b\n\n## 0.15.5\n\n- c\n');
    checkWhatsNew(list, '0.16.0-beta.1');
    expect(whatsNew.value?.entries[0].version).toBe('0.16.0-beta.1');
    markWhatsNewShown();
    closeWhatsNew();
    checkWhatsNew(list, '0.16.0-beta.1');
    expect(whatsNew.value).toBeNull();
  });
});
