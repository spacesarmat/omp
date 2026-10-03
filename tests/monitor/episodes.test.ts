import { describe, it, expect } from 'vitest';
import { parseEpisodeRange } from '../../src/monitor/episodes';

describe('parseEpisodeRange', () => {
  const cases: [string, ReturnType<typeof parseEpisodeRange>][] = [
    ['Трудно быть богом / Сезон: 1 / Серии: 1-8 из 10  [2026, фантастика, драма, WEBRip-AVC] от Aleksan55', { season: 1, from: 1, to: 8, total: 10 }],
    ['Сериал / Серии 1–10 из 10 [2025]', { from: 1, to: 10, total: 10 }],
    ['Сериал / Серии: 1-8 из 12', { from: 1, to: 8, total: 12 }],
    ['Тёмная материя / Dark Matter (2026) WEB-DL [H.264/1080p] (сезон 2, серии 1-6 из 10) LostFilm', { season: 2, from: 1, to: 6, total: 10 }],
    ['Show.S02E01-08.1080p.WEB-DL', { season: 2, from: 1, to: 8 }],
    ['Show S02E01-E08 2160p', { season: 2, from: 1, to: 8 }],
    ['Show.S03E05.720p', { season: 3, from: 5, to: 5 }],
    ['Сериал [1-10 из 10] (2026)', { from: 1, to: 10, total: 10 }],
    ['Сериал 1-10 из 10', { from: 1, to: 10, total: 10 }],
    ['Американская Амазонка / American Amazon [01-02 из 02] (2025) HDTV 1080p', { from: 1, to: 2, total: 2 }],
    ['Бэтмен: Крестоносец в плаще / Batman: Caped Crusader [02x01-04 из 10] (2026) WEB-DLRip 1080p', { season: 2, from: 1, to: 4, total: 10 }],
    ['Дом дракона / House of the Dragon [03х01-08 из 08] (2026) WEB-DL 1080p | P', { season: 3, from: 1, to: 8, total: 8 }],
    ['Однажды в России [13x01-17] (2026) WEB-DLRip', { season: 13, from: 1, to: 17 }],
    ['Большой куш. Бангкок [02x13 из 13] [Эфир от 27.09] (2026)', { season: 2, from: 13, to: 13, total: 13 }],
    ['Хочу на ТНТ [01-02] (2026) WEB-DLRip', { from: 1, to: 2 }],
    ['Сериал / Сезон 2 / 2026', { season: 2 }],
    ['Книжный / Bookish [S02] (2026) WEB-DL 1080p', { season: 2 }],
    ['Воинственный бог Асура [S01-02] (2023) WEB-DL 1080p', { season: 2 }],
    ['Show Season 4 Complete', { season: 4 }],
    ['Невский/ Сезон: 8 / Серии: 1-10 из 30  [2026, детектив]', { season: 8, from: 1, to: 10, total: 30 }],
    ['Матрица / The Matrix (1999) BDRip 1080p', {}],
    ['Матрица. Квадрология / 1999-2021 / UHD BDRemux 2160p', {}],
    ['WinPE 11-10 Sergei Strelec [x64] [08.09] (2026) PC', {}],
    ['', {}],
  ];
  cases.forEach(([title, want]) => {
    it(title || '(empty)', () => {
      expect(parseEpisodeRange(title)).toEqual(want);
    });
  });
});
