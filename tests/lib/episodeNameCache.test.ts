import { describe, expect, it } from 'vitest';
import { applyLanguageSetting } from '../../src/i18n';
import { cachedEpisodeName, forgetEpisodeNames, rememberEpisodeName, resetEpisodeNames } from '../../src/lib/episodeNames';
import { seriesMatchVersion } from '../../src/lib/seriesMatch';

describe('episode name cache for a TV launch', () => {
  it('keeps a loaded title across other show lookups, and drops it for a language change, a corrected show, or an empty name', () => {
    resetEpisodeNames();
    applyLanguageSetting('ru');
    rememberEpisodeName('h', 4, 1, 'Что тебя не убивает');
    rememberEpisodeName('other', 1, 1, 'Другое');
    expect(cachedEpisodeName('h', 4, 1)).toBe('Что тебя не убивает');
    seriesMatchVersion.value++;
    expect(cachedEpisodeName('h', 4, 1)).toBe('Что тебя не убивает');
    forgetEpisodeNames(['h']);
    expect(cachedEpisodeName('h', 4, 1)).toBe('');
    expect(cachedEpisodeName('other', 1, 1)).toBe('Другое');
    applyLanguageSetting('en');
    expect(cachedEpisodeName('other', 1, 1)).toBe('');
    rememberEpisodeName('h', 4, 1, 'What does not kill you');
    rememberEpisodeName('h', 4, 1, '');
    expect(cachedEpisodeName('h', 4, 1)).toBe('');
    applyLanguageSetting('ru');
    resetEpisodeNames();
  });
});
