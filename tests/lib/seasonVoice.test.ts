import { describe, it, expect } from 'vitest';
import { pickSeasonVoice, readVoice, withSeasonVoice, voiceDiffers } from '../../src/lib/seasonVoice';
import { withSeriesTracks } from '../../src/lib/seriesTracks';

function dataWith(studio: string, at = 10): string {
  const obj = withSeriesTracks({}, { at, l: studio, g: 'ru', k: [{ l: studio, g: 'ru' }, { l: 'NewStudio', g: 'ru' }] });
  return JSON.stringify(obj);
}

describe('season voice', () => {
  it('migrates a series-wide studio onto a season that has no own choice', () => {
    const picked = pickSeasonVoice({
      season: 2,
      available: ['LostFilm', 'NewStudio'],
      data: [dataWith('LostFilm')],
    });
    expect(picked.studio).toBe('LostFilm');
    expect(picked.source).toBe('series');
    expect(picked.toast).toBe('');
  });

  it('keeps a manual season choice and tells when the inherited studio is missing', () => {
    const base = JSON.parse(dataWith('LostFilm')) as { [k: string]: unknown };
    const saved = withSeasonVoice(base, 3, { at: 20, l: 'NewStudio', m: true });
    const manual = pickSeasonVoice({
      season: 3,
      available: ['LostFilm', 'NewStudio'],
      data: [JSON.stringify(saved)],
    });
    expect(manual.studio).toBe('NewStudio');
    expect(manual.source).toBe('manual');

    const other = pickSeasonVoice({
      season: 4,
      available: ['NewStudio'],
      data: [dataWith('LostFilm')],
      priority: [],
    });
    expect(other.studio).toBe('NewStudio');
    expect(other.toast).toContain('LostFilm');
    expect(other.toast).toContain('NewStudio');
  });

  it('follows the series priority list before the inherited studio', () => {
    const base = JSON.parse(dataWith('LostFilm')) as { [k: string]: unknown };
    const saved = withSeasonVoice(base, 1, { at: 5, l: 'LostFilm' }, ['NewStudio', 'LostFilm']);
    const picked = pickSeasonVoice({
      season: 2,
      available: ['LostFilm', 'NewStudio'],
      data: [JSON.stringify(saved)],
    });
    expect(picked.studio).toBe('NewStudio');
    expect(picked.source).toBe('priority');
    expect(readVoice([JSON.stringify(saved)]).priority).toEqual(['NewStudio', 'LostFilm']);
  });

  it('marks a season whose studio differs', () => {
    expect(voiceDiffers('NewStudio', ['LostFilm', 'LostFilm'])).toBe(true);
    expect(voiceDiffers('LostFilm', ['LostFilm'])).toBe(false);
  });
});
