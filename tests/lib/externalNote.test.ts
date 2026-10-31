import { describe, it, expect, afterEach } from 'vitest';
import { applyLanguageSetting } from '../../src/i18n';
import { externalNoteText } from '../../src/lib/externalNote';
import type { TorrentFile } from '../../src/lib/episodes';

const list = (paths: string[]): TorrentFile[] => paths.map((path, i) => ({ id: i + 1, path, length: 1 }));
const dubs = (n: number, subs = false): TorrentFile[] => {
  const p = ['S/Show.S01E01.mkv', 'S/Show.S01E02.mkv'];
  for (let i = 0; i < n; i++) p.push('S/Rus Sound/Studio ' + String.fromCharCode(65 + i) + '/Show.S01E01.mka', 'S/Rus Sound/Studio ' + String.fromCharCode(65 + i) + '/Show.S01E02.mka');
  if (subs) p.push('S/Subs/Show.S01E01.srt');
  return list(p);
};

describe('externalNoteText', () => {
  afterEach(() => applyLanguageSetting('ru'));

  it('Russian plurals', () => {
    applyLanguageSetting('ru');
    expect(externalNoteText(dubs(1))).toBe('+1 озвучка');
    expect(externalNoteText(dubs(3, true))).toBe('+3 озвучки, субтитры');
    expect(externalNoteText(dubs(5))).toBe('+5 озвучек');
    expect(externalNoteText(dubs(0, true))).toBe('+субтитры');
    expect(externalNoteText(dubs(0))).toBe('');
    expect(externalNoteText([])).toBe('');
    expect(externalNoteText(null)).toBe('');
  });

  it('English', () => {
    applyLanguageSetting('en');
    expect(externalNoteText(dubs(1))).toBe('+1 dub');
    expect(externalNoteText(dubs(2, true))).toBe('+2 dubs, subtitles');
    expect(externalNoteText(dubs(0, true))).toBe('+subtitles');
  });
});
