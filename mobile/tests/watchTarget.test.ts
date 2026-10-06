// «Смотреть на ТВ»: which file a torrent continues from, counting the other releases of the series.
import { describe, it, expect, beforeEach } from 'vitest';
import { watchTarget } from '../src/lib/torrentActions';
import { torrents } from '../../src/store/library';
import { reloadProgress, saveProgress, serverViewed } from '../../src/store/progress';
import { playableFiles } from '../../src/lib/episodes';
import { torrentFiles } from '../../src/lib/torrentName';
import type { Torrent } from '../../src/api/types';

const eps = (tag: string) => [1, 2, 3, 4].map((e) => ({ id: e, path: 'Show.S01E0' + e + '.' + tag + '.mkv', length: 1 }));
const HD: Torrent = { hash: 'hd', title: 'Starbound Frontier S01 1080p', category: 'tv', stat: 3, file_stats: eps('1080p') };
const UHD: Torrent = { hash: 'uhd', title: 'Starbound Frontier S01 2160p', category: 'tv', stat: 3, file_stats: eps('2160p') };
const FILM: Torrent = {
  hash: 'film',
  title: 'Quiet Signal 2160p',
  category: 'movie',
  stat: 3,
  file_stats: [
    { id: 1, path: 'Quiet Signal.mkv', length: 9 },
    { id: 2, path: 'Extras/Making of.mkv', length: 1 },
    { id: 3, path: 'Extras/Deleted scenes.mkv', length: 1 },
  ],
};

const target = (t: Torrent) => {
  const f = watchTarget(t.hash, playableFiles(torrentFiles(t)));
  return f ? f.id : undefined;
};

beforeEach(() => {
  localStorage.clear();
  reloadProgress();
  serverViewed.value = [];
  torrents.value = [HD, UHD, FILM];
});

describe('watchTarget', () => {
  it('an episode started in one release and finished later in the other is not a place to continue', () => {
    saveProgress('hd', 3, 1200, 3600); // E03 in progress in 1080p
    saveProgress('uhd', 3, 3500, 3600); // then finished in 4K
    expect(target(HD)).toBe(4);
    expect(target(UHD)).toBe(4);
  });

  it('an episode in progress in another release is continued here', () => {
    saveProgress('uhd', 2, 1200, 3600);
    expect(target(HD)).toBe(2);
  });

  it('nothing in progress, some episodes watched (in any release): the first one not watched', () => {
    saveProgress('hd', 1, 3500, 3600);
    saveProgress('uhd', 2, 3500, 3600);
    expect(target(HD)).toBe(3);
    expect(target(UHD)).toBe(3);
  });

  it('nothing watched, or everything: the first file', () => {
    expect(target(HD)).toBe(1);
    [1, 2, 3, 4].forEach((e) => saveProgress('uhd', e, 3500, 3600));
    expect(target(HD)).toBe(1);
  });

  it('a film with extras: watching the film does not move the button on to an extra', () => {
    const first = target(FILM);
    saveProgress('film', 1, 3500, 3600);
    expect(target(FILM)).toBe(first);
    saveProgress('film', 2, 3500, 3600);
    expect(target(FILM)).toBe(first);
  });

  it('after the last watched episode comes the next one; a gap before it is filled only at the end', () => {
    [1, 2].forEach((e) => saveProgress('hd', e, 3500, 3600));
    saveProgress('uhd', 4, 3500, 3600);
    expect(target(HD)).toBe(3);
  });
});
