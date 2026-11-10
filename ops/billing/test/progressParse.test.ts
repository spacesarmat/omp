import { describe, expect, it } from 'vitest';
import { parseProgressBody, parseProgressQuery } from '../src/playbackProgress.mjs';

function params(q: string) {
  return new URL('http://local/v1/progress' + q).searchParams;
}

describe('progress body', () => {
  it('accepts a position and rejects an empty key', () => {
    expect(parseProgressBody({ titleKey: 'show', episodeKey: 's01e02', positionSec: '95', durationSec: '0', title: 'Show', label: 'S01E02' })).toMatchObject({
      titleKey: 'show',
      episodeKey: 's01e02',
      positionSec: 95,
      durationSec: 0,
    });
    expect(parseProgressBody({ titleKey: '', episodeKey: 's01e02', positionSec: 10 }).error).toBe('bad_body');
    expect(parseProgressBody({ titleKey: 'show', episodeKey: 's01e02', positionSec: 0 }).error).toBe('bad_body');
    expect(parseProgressBody({ titleKey: 'show', episodeKey: 's01e02', positionSec: 999999 }).error).toBe('bad_body');
  });

  it('reads the query and strips control characters', () => {
    expect(parseProgressQuery(params('?titleKey=show&episodeKey=s01e02'))).toEqual({ titleKey: 'show', episodeKey: 's01e02' });
    expect(parseProgressQuery(params('')).error).toBe('bad_query');
    const dirty = parseProgressBody({ titleKey: 'show\nname', episodeKey: 'e1', positionSec: 12 });
    expect(dirty.titleKey).toBe('showname');
  });
});
