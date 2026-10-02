import { describe, it, expect } from 'vitest';
import { displayTitle } from '../src/ui/displayTitle';

describe('displayTitle', () => {
  it('cleans file-name titles', () => {
    expect(displayTitle('Trudno.byt.bogom.S01.E07.2026.WEB-DL.1080p.ExKinoRay.mkv')).toBe('Trudno byt bogom S01 E07 2026 WEB-DL 1080p ExKinoRay');
    expect(displayTitle('My_Movie_2020.MP4')).toBe('My Movie 2020');
  });
  it('keeps normal titles', () => {
    expect(displayTitle('Тишина в эфире')).toBe('Тишина в эфире');
    expect(displayTitle('Mr. Robot')).toBe('Mr. Robot');
  });
});
