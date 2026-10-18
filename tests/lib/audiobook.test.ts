import { describe, expect, it } from 'vitest';
import { categoryOf, mapSearchCategory } from '../../src/lib/category';
import { guessCategory } from '../../src/lib/categoryGuess';
import { categoryKind, releaseKind } from '../../src/lib/releaseKind';
import { resultKindLabel } from '../../src/sources/releaseRow';

// Titles follow the usual RuTracker / NNM-Club audiobook line:
// «Автор - Название (читает Имя) [год, жанр, MP3/M4B/AAC, kbps]».
const BULGAKOV = 'Булгаков Михаил - Мастер и Маргарита (читает Владимир Самойлов) [2020, аудиокнига, MP3, 128 kbps]';
const LUKYANENKO = 'Лукьяненко Сергей - Ночной дозор (читает Александр Клюквин) [2005, фантастика, MP3, 96kbps]';
const SAPKOWSKI = 'Сапковский Анджей - Ведьмак. Последнее желание [2022, M4B, 64 kbps]';
const ROWLING = 'Роулинг Дж. К. - Гарри Поттер и философский камень [читают Сергей Чонишвили] [2018, AAC, 128 kbps]';
const KING = 'Кинг Стивен - Оно (Майкл С. Джадж) [2017, хоррор, MP3, 56 kbps]';
const HARARI = 'Харари Юваль Ной - Sapiens. Краткая история человечества [исполнитель: Владимир Левашев] [2019, AAC, 96 kbps]';
const STRUGATSKY = 'Стругацкий Аркадий - Пикник на обочине [2014, FB2]';
const WISHMASTER = 'Исполнитель желаний / Wishmaster (1997) BDRip 1080p';

describe('audiobook release kind', () => {
  it('reads an audiobook from a realistic Russian title', () => {
    expect(releaseKind({ Title: BULGAKOV })).toEqual({ kind: 'audiobook', year: 2020, by: 'title' });
    expect(releaseKind({ Title: LUKYANENKO }).kind).toBe('audiobook');
    expect(releaseKind({ Title: LUKYANENKO }).year).toBe(2005);
    expect(releaseKind({ Title: SAPKOWSKI })).toMatchObject({ kind: 'audiobook', year: 2022, by: 'title' });
    expect(releaseKind({ Title: ROWLING }).kind).toBe('audiobook');
    expect(guessCategory(BULGAKOV)).toBe('audiobook');
    expect(guessCategory(LUKYANENKO)).toBe('audiobook');
    expect(guessCategory(SAPKOWSKI)).toBe('audiobook');
    expect(guessCategory(ROWLING)).toBe('audiobook');
    expect(resultKindLabel({ Title: BULGAKOV })).toBe('Аудиокнига');
  });

  it('Torznab 3030 is an audiobook even when the title omits the word', () => {
    expect(categoryKind('3030')).toBe('audiobook');
    expect(releaseKind({ Title: KING, Categories: '3030' })).toEqual({ kind: 'audiobook', year: 2017, by: 'category' });
    expect(releaseKind({ Title: 'Без названия', Categories: '3030, Audio/Audiobook' }).kind).toBe('audiobook');
    expect(categoryOf('audiobook')).toBe('audiobook');
    expect(mapSearchCategory('Аудиокниги')).toBe('audiobook');
    expect(mapSearchCategory('Audio/Audiobook')).toBe('audiobook');
  });

  it('NNM-Club 7000, RuTor 8000 and MegaPeer 8010 need a title hint', () => {
    expect(releaseKind({ Title: KING, Categories: '7000' })).toMatchObject({ kind: 'audiobook', by: 'title' });
    expect(releaseKind({ Title: KING, Categories: '8000' }).kind).toBe('audiobook');
    expect(releaseKind({ Title: KING, Categories: '8010' }).kind).toBe('audiobook');
    expect(releaseKind({ Title: HARARI, Categories: '7000' }).kind).toBe('audiobook');
    expect(releaseKind({ Title: STRUGATSKY, Categories: '7000' }).kind).toBe('ebook');
    expect(releaseKind({ Title: KING }).kind).toBe(null);
    expect(guessCategory(KING)).toBe('music');
  });

  it('a film category loses to an audiobook title; a film named «Исполнитель» stays a film', () => {
    expect(releaseKind({ Title: BULGAKOV, Categories: '2000' }).kind).toBe('audiobook');
    expect(releaseKind({ Title: WISHMASTER, Categories: '2000' }).kind).toBe('movie');
    expect(releaseKind({ Title: WISHMASTER })).toMatchObject({ kind: 'movie', year: 1997, by: 'title' });
    expect(guessCategory(WISHMASTER)).toBe('movie');
    expect(releaseKind({ Title: 'Metallica - Discography (1983-2023) MP3 320 kbps' }).kind).toBe(null);
    expect(releaseKind({ Title: 'Metallica - Discography (1983-2023) MP3 320 kbps', Categories: '2000' }).kind).toBe('movie');
  });

  it('Cyrillic «МР3», «чит.» and «радиоспектакль» are audiobooks even in a movie section', () => {
    const god = 'Трудно быть богом [чит. Клюквин] (2024) МР3';
    expect(releaseKind({ Title: god, Categories: '2000' })).toMatchObject({ kind: 'audiobook', year: 2024, by: 'title' });
    expect(releaseKind({ Title: god, Categories: 'Фильм' }).kind).toBe('audiobook');
    expect(guessCategory(god)).toBe('audiobook');
    expect(releaseKind({ Title: 'Стругацкие - Пикник на обочине (2020) MP3', Categories: '2000' }).kind).toBe('audiobook');
    expect(releaseKind({ Title: 'Булгаков - Собачье сердце (радиоспектакль) (1968)' }).kind).toBe('audiobook');
    expect(releaseKind({ Title: 'Книга (2014) FB2' }).kind).toBe('ebook');
    expect(resultKindLabel({ Title: 'Книга (2014) EPUB' })).toBe('Электронная книга');
    expect(releaseKind({ Title: 'Акира / Akira (1988) BDRemux 1080p | FLAC', Categories: '2000' }).kind).toBe('movie');
  });
});
