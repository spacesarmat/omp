import { describe, it, expect, beforeEach } from 'vitest';
import { parseChangelog, releasesUpTo } from '../../src/lib/changelog';
import { checkWhatsNew, whatsNew, openWhatsNew, closeWhatsNew, SEEN_KEY } from '../../src/store/whatsNew';
import { CHANGELOG } from '../../src/lib/changelogData';

const TEXT = '# Изменения\n\n## 0.2.0\n\n- Первое\n- Второе\n\n## 0.10.0\r\n\r\n- Новое\r\n\n## мусор\n- не версия\n\n## 0.1.0\n- Старое\n\n## 0.0.9\n\nбез пунктов\n';

describe('parseChangelog', () => {
  it('parses versions newest first with bullets, skipping malformed sections', () => {
    const l = parseChangelog(TEXT);
    expect(l.map((e) => e.version)).toEqual(['0.10.0', '0.2.0', '0.1.0']);
    expect(l[1].items).toEqual(['Первое', 'Второе']);
    expect(l[0].items).toEqual(['Новое']);
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
  });
});

describe('checkWhatsNew', () => {
  const list = parseChangelog(TEXT);
  beforeEach(() => {
    localStorage.clear();
    closeWhatsNew();
  });
  it('fresh install: stores the version, shows nothing', () => {
    checkWhatsNew(list, '0.2.0');
    expect(whatsNew.value).toBeNull();
    expect(JSON.parse(localStorage.getItem(SEEN_KEY)!)).toBe('0.2.0');
  });
  it('after an update: shows once, then not again', () => {
    localStorage.setItem(SEEN_KEY, JSON.stringify('0.1.0'));
    checkWhatsNew(list, '0.2.0');
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
