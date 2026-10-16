import { t } from '../i18n';

export type Category = 'movie' | 'tv' | 'music' | 'audiobook' | 'other';

export const categoryTabs = (): { id: 'all' | Category; label: string }[] => [
  { id: 'all', label: t('common.all') },
  { id: 'movie', label: t('category.movie') },
  { id: 'tv', label: t('category.tv') },
  { id: 'music', label: t('category.music') },
  { id: 'audiobook', label: t('category.audiobook') },
  { id: 'other', label: t('category.other') },
];

export function categoryOf(c?: string): Category {
  if (c === 'movie' || c === 'tv' || c === 'music' || c === 'audiobook') return c;
  return 'other';
}

// Russian words of tracker category names (tracker data, not copy)
const RU_MOVIE = /фильм/;
const RU_TV = /сериал/;
const RU_MUSIC = /музык/;
const RU_AUDIOBOOK = /аудиокниг/;

export function mapSearchCategory(c: string): string {
  const v = (c || '').toLowerCase();
  if (v.indexOf('audiobook') >= 0 || RU_AUDIOBOOK.test(v)) return 'audiobook';
  if (v.indexOf('movie') >= 0 || RU_MOVIE.test(v)) return 'movie';
  if (v === 'tv' || v.indexOf('series') >= 0 || RU_TV.test(v)) return 'tv';
  if (v.indexOf('music') >= 0 || RU_MUSIC.test(v)) return 'music';
  return '';
}
