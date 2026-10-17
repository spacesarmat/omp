import { describe, it, expect, beforeEach } from 'vitest';
import { applyLanguageSetting } from '../../src/i18n';
import type { FfprobeResult } from '../../src/api/types';
import type { TorrentFile } from '../../src/lib/episodes';
import {
  audiobookSections,
  audiobookTracks,
  compareAudiobookPaths,
  isAudiobookAudio,
  m4bChapters,
  singleM4bFile,
  trackLabel,
  trackMark,
} from '../../src/lib/audiobookTracks';

const f = (id: number, path: string, length = 1000): TorrentFile => ({ id, path, length });
const paths = (files: TorrentFile[]) => audiobookTracks(files).map((t) => t.file.path);

beforeEach(() => applyLanguageSetting('ru'));

describe('audiobook audio', () => {
  it('keeps the book extensions and drops the rest', () => {
    expect(isAudiobookAudio('a/Book.MP3')).toBe(true);
    expect(isAudiobookAudio('a/Book.m4b')).toBe(true);
    expect(isAudiobookAudio('a/Book.M4A')).toBe(true);
    expect(isAudiobookAudio('a/Book.ogg')).toBe(true);
    expect(isAudiobookAudio('a/Book.opus')).toBe(true);
    expect(isAudiobookAudio('a/Book.AAC')).toBe(true);
    expect(isAudiobookAudio('a/Book.flac')).toBe(true);
    expect(isAudiobookAudio('a/cover.jpg')).toBe(false);
    expect(isAudiobookAudio('a/book.cue')).toBe(false);
    expect(isAudiobookAudio('a/extra.mkv')).toBe(false);
    expect(isAudiobookAudio('a/notes.wav')).toBe(false);
    const list = audiobookTracks([
      f(1, 'Book/cover.jpg'),
      f(2, 'Book/01.mp3'),
      f(3, 'Book/notes.txt'),
      f(4, 'Book/02.flac'),
    ]);
    expect(list.map((t) => t.file.id)).toEqual([2, 4]);
  });
});

describe('listening order', () => {
  it('orders 01, 2, 10', () => {
    expect(paths([f(1, 'Book/10.mp3'), f(2, 'Book/2.mp3'), f(3, 'Book/01.mp3')])).toEqual([
      'Book/01.mp3',
      'Book/2.mp3',
      'Book/10.mp3',
    ]);
    expect(compareAudiobookPaths('01.mp3', '2.mp3')).toBeLessThan(0);
    expect(compareAudiobookPaths('2.mp3', '10.mp3')).toBeLessThan(0);
  });

  it('orders «Часть» and «Глава», including a flat «Часть 1 / Глава 3»', () => {
    expect(
      paths([
        f(1, 'Книга/Часть 2/Глава 1.mp3'),
        f(2, 'Книга/Часть 1/Глава 10.mp3'),
        f(3, 'Книга/Часть 1/Глава 3.mp3'),
        f(4, 'Книга/Часть 10/Глава 1.mp3'),
      ]),
    ).toEqual([
      'Книга/Часть 1/Глава 3.mp3',
      'Книга/Часть 1/Глава 10.mp3',
      'Книга/Часть 2/Глава 1.mp3',
      'Книга/Часть 10/Глава 1.mp3',
    ]);
    expect(paths([f(1, 'Часть 1 - Глава 10.mp3'), f(2, 'Часть 1 - Глава 3.mp3'), f(3, 'Часть 2 - Глава 1.mp3')])).toEqual([
      'Часть 1 - Глава 3.mp3',
      'Часть 1 - Глава 10.mp3',
      'Часть 2 - Глава 1.mp3',
    ]);
  });

  it('orders nested discs before the tracks inside them', () => {
    expect(
      paths([
        f(1, 'Автор/Диск 10/01.mp3'),
        f(2, 'Автор/Диск 2/03.mp3'),
        f(3, 'Автор/Диск 2/01.mp3'),
        f(4, 'Автор/CD1/10.flac'),
        f(5, 'Автор/CD1/2.flac'),
      ]),
    ).toEqual([
      'Автор/CD1/2.flac',
      'Автор/CD1/10.flac',
      'Автор/Диск 2/01.mp3',
      'Автор/Диск 2/03.mp3',
      'Автор/Диск 10/01.mp3',
    ]);
  });
});

describe('labels and groups', () => {
  it('names a part and a chapter, and groups by the folders that differ', () => {
    expect(trackLabel('Книга/Часть 1/Глава 3.mp3')).toBe('Глава 3');
    expect(trackLabel('Часть 1 - Глава 3.mp3')).toBe('Часть 1 / Глава 3');
    expect(trackLabel('Book/01. Intro.mp3')).toBe('01. Intro');
    expect(trackMark('Автор/Диск 2/Часть 1/Глава 3.mp3')).toEqual({ disc: 2, part: 1, chapter: 3 });
    const sections = audiobookSections([
      f(1, 'Книга/Часть 1/Глава 10.mp3'),
      f(2, 'Книга/Часть 1/Глава 3.mp3'),
      f(3, 'Книга/Часть 2/Глава 1.mp3'),
      f(4, 'Книга/cover.jpg'),
    ]);
    expect(sections.map((s) => s.title)).toEqual(['Часть 1', 'Часть 2']);
    expect(sections[0].tracks.map((t) => t.label)).toEqual(['Глава 3', 'Глава 10']);
    expect(sections[1].tracks.map((t) => t.label)).toEqual(['Глава 1']);
  });

  it('drops the folder every file shares', () => {
    const tracks = audiobookTracks([f(1, 'Book/02.mp3'), f(2, 'Book/01.mp3')]);
    expect(tracks.map((t) => t.group)).toEqual(['', '']);
  });
});

describe('single m4b chapters', () => {
  const probe: FfprobeResult = {
    streams: [{ index: 0, codec_type: 'audio', codec_name: 'aac' }],
    chapters: [
      { start_time: '0', end_time: '90', tags: { title: 'Пролог' } },
      { start_time: '90', end_time: '200', tags: { title: '' } },
      { start_time: '50', end_time: '40', tags: { title: 'битая' } },
    ],
  };

  it('is the one m4b, covers included, and reads chapters from ffprobe', () => {
    const m4b = f(7, 'Book/Мастер.m4b');
    expect(singleM4bFile([m4b, f(8, 'Book/cover.jpg')])).toEqual(m4b);
    expect(singleM4bFile([m4b, f(9, 'Book/02.mp3')])).toBeNull();
    expect(singleM4bFile([f(1, 'Book/01.mp3')])).toBeNull();
    const chapters = m4bChapters(m4b, probe);
    expect(chapters.map((c) => c.title)).toEqual(['Пролог', 'Глава 2']);
    expect(chapters.map((c) => c.start)).toEqual([0, 90]);
    expect(chapters[1].file).toBe(m4b);
    expect(m4bChapters(m4b, null)).toEqual([]);
    expect(m4bChapters(f(1, 'Book/01.mp3'), probe)).toEqual([]);
  });
});
