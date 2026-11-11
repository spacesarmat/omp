import { describe, it, expect } from 'vitest';
import { continueCards, deviceKind, continueSourceLine, mainButtonLines, type ContinueFile, type ContinueWatch } from '../../src/lib/phoneContinue';

const NOW = new Date(2026, 10, 11, 12, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;

function file(id: number, path: string): ContinueFile {
  return { id, path };
}

function watch(p: Partial<ContinueWatch> & { hash: string; fileIndex: number }): ContinueWatch {
  return {
    time: 600,
    duration: 2400,
    updated: NOW - 3600_000,
    src: 'tv',
    showKey: 'show',
    ...p,
  };
}

const files = {
  h: [
    file(1, 'Show/S01E03.mkv'),
    file(2, 'Show/S01E04.mkv'),
    file(3, 'Show/S01E01-E02.mkv'),
  ],
};

describe('continueCards', () => {
  it('keeps a started unfinished item between 2% and 90%', () => {
    const cards = continueCards([watch({ hash: 'h', fileIndex: 1, time: 600, duration: 2400 })], { h: files.h }, NOW);
    expect(cards).toHaveLength(1);
    expect(cards[0].kind).toBe('resume');
    expect(cards[0].code).toBe('S01E03');
    expect(cards[0].fileIndex).toBe(1);
  });

  it('drops a barely started item and a finished show with no next episode', () => {
    const early = continueCards([watch({ hash: 'h', fileIndex: 1, time: 20, duration: 2400 })], { h: files.h }, NOW);
    expect(early).toHaveLength(0);
    const done = continueCards([watch({ hash: 'h', fileIndex: 2, time: 2300, duration: 2400 })], { h: files.h }, NOW);
    expect(done).toHaveLength(0);
  });

  it('advances a finished episode to the next file', () => {
    const cards = continueCards([watch({ hash: 'h', fileIndex: 1, time: 2300, duration: 2400 })], { h: files.h }, NOW);
    expect(cards).toHaveLength(1);
    expect(cards[0].kind).toBe('next');
    expect(cards[0].code).toBe('S01E04');
    expect(cards[0].fileIndex).toBe(2);
    expect(cards[0].time).toBe(0);
  });

  it('does not treat a combined file as missing the episodes it holds', () => {
    const cards = continueCards(
      [watch({ hash: 'h', fileIndex: 3, time: 1000, duration: 4000 })],
      { h: files.h },
      NOW,
    );
    expect(cards[0].kind).toBe('resume');
    expect(cards[0].code).toBe('S01E01-E02');
  });

  it('does not treat another torrent file with the same id as the current episode', () => {
    const both = {
      show: [
        { id: 1, path: 'Show/S01E01.mkv', hash: 'a' },
        { id: 1, path: 'Show/S02E01.mkv', hash: 'b' },
        { id: 2, path: 'Show/S02E02.mkv', hash: 'b' },
        { id: 3, path: 'Show/S02E02.srt', hash: 'b', playable: false },
      ],
    };
    const cards = continueCards([watch({ hash: 'b', fileIndex: 1, showKey: 'show', time: 2300, duration: 2400 })], both, NOW);
    expect(cards[0].code).toBe('S02E02');
    expect(cards[0].hash).toBe('b');
    expect(cards[0].fileIndex).toBe(2);
  });

  it('hides an item untouched for more than 30 days', () => {
    const cards = continueCards(
      [watch({ hash: 'h', fileIndex: 1, updated: NOW - 31 * DAY })],
      { h: files.h },
      NOW,
    );
    expect(cards).toHaveLength(0);
  });
});

describe('continue source line', () => {
  it('marks a desktop name as a PC and a TV as TV', () => {
    expect(deviceKind('phone', 'OMP Desktop')).toBe('pc');
    expect(deviceKind('tv', undefined)).toBe('tv');
    expect(deviceKind('phone', 'Pixel 7')).toBe('phone');
  });

  it('formats the short device line', () => {
    const at = new Date(2026, 10, 10, 22, 10).getTime();
    expect(continueSourceLine('tv', undefined, at, NOW)).toBe('ТВ · вчера в 22:10');
  });
});

describe('mainButtonLines', () => {
  it('splits the continue label into a title and a device line', () => {
    expect(mainButtonLines({ onTv: true, code: 'S01E04', at: 26 })).toEqual({
      title: 'Продолжить S01E04',
      sub: 'на ТВ · с 0:26',
    });
    expect(mainButtonLines({ onTv: false, code: '', at: 0 }).title).toBe('Смотреть');
  });
});
