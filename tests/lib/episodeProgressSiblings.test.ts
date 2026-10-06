// Shared progress groups releases like the library: a rutracker title whose Russian name has «(3 сезон…)» joins
// the English-only releases through its English name after the brackets.
import { describe, it, expect } from 'vitest';
import { seriesSiblings } from '../../src/lib/episodeProgress';
import type { Torrent } from '../../src/api/types';

const files = (names: string[]) => names.map((p, i) => ({ id: i + 1, path: p, length: 1000 }));
const tv = (hash: string, title: string, names: string[]): Torrent => ({ hash, title, category: 'tv', stat: 3, file_stats: files(names) });

const RU3 = tv(
  'r3',
  'Звёздный путь: Странные новые миры (3 сезон: 1-10 серии) / Star Trek: Strange New Worlds / 2025 / 6 x ПМ, ЛМ, СТ / 4K, HEVC, HDR, DV / Hybrid (2160p)',
  ['S03E01.mkv'],
);
const EN2 = tv('e2', 'Star Trek: Strange New Worlds / S2E1-10 of 10 [2023, WEB-DL 2160p]', ['S02E01.mkv']);
const EN4 = tv('e4', 'Star Trek: Strange New Worlds / S4E1-10 of 10 [2026, WEB-DL 2160p]', ['S04E01.mkv']);
const OTHER = tv('ot', 'Другой сериал / Another Show / 2025 / 6 x ПМ, ЛМ, СТ / 4K, HEVC, HDR, DV / Hybrid (2160p)', ['S01E01.mkv']);

describe('seriesSiblings', () => {
  it('the three Star Trek releases are siblings; a series sharing only the release details is not', () => {
    const list = [RU3, OTHER, EN2, EN4];
    expect(seriesSiblings(list, RU3).map((t) => t.hash)).toEqual(['r3', 'e2', 'e4']);
    expect(seriesSiblings(list, EN4).map((t) => t.hash)).toEqual(['r3', 'e2', 'e4']);
    expect(seriesSiblings(list, OTHER).map((t) => t.hash)).toEqual(['ot']);
  });

  it('series sharing only the network after the original title are not siblings', () => {
    const TWD = tv('twd', 'Ходячие мертвецы (Сезон 1) / The Walking Dead / AMC / 2010', ['S01E01.mkv']);
    const BB = tv('bb', 'Во все тяжкие (Сезон 1) / Breaking Bad / AMC / 2008', ['S01E01.mkv']);
    const SH = tv('sh', 'Шерлок (Сезон 1) / Sherlock / BBC / 2010', ['S01E01.mkv']);
    const KD = tv('kd', 'Убивая Еву (Сезон 2) / Killing Eve / BBC / 2019', ['S02E01.mkv']);
    const list = [TWD, BB, SH, KD];
    list.forEach((t) => expect(seriesSiblings(list, t).map((x) => x.hash)).toEqual([t.hash]));
  });
});
