import { describe, expect, it } from 'vitest';
import { applyLanguageSetting } from '../../src/i18n';
import { cachedEpisodeName, rememberEpisodeName, resetEpisodeNames } from '../../src/lib/episodeNames';
import { seriesMatchVersion } from '../../src/lib/seriesMatch';

describe('episode name cache for a TV launch', () => {
  it('keeps a loaded title, drops it when the language or the show match changes, and forgets an empty name', () => {
    resetEpisodeNames();
    applyLanguageSetting('ru');
    rememberEpisodeName('h', 4, 1, 'Что тебя не убивает');
    expect(cachedEpisodeName('h', 4, 1)).toBe('Что тебя не убивает');
    applyLanguageSetting('en');
    expect(cachedEpisodeName('h', 4, 1)).toBe('');
    rememberEpisodeName('h', 4, 1, 'What does not kill you');
    expect(cachedEpisodeName('h', 4, 1)).toBe('What does not kill you');
    seriesMatchVersion.value++;
    expect(cachedEpisodeName('h', 4, 1)).toBe('');
    rememberEpisodeName('h', 4, 1, 'What does not kill you');
    rememberEpisodeName('h', 4, 1, '');
    expect(cachedEpisodeName('h', 4, 1)).toBe('');
    applyLanguageSetting('ru');
    resetEpisodeNames();
  });
});
