export type Category = 'movie' | 'tv' | 'music' | 'other';

export const CATEGORY_TABS: { id: 'all' | Category; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'movie', label: 'Фильмы' },
  { id: 'tv', label: 'Сериалы' },
  { id: 'music', label: 'Музыка' },
  { id: 'other', label: 'Прочее' },
];

export function categoryOf(c?: string): Category {
  if (c === 'movie' || c === 'tv' || c === 'music') return c;
  return 'other';
}

export function mapSearchCategory(c: string): string {
  const v = (c || '').toLowerCase();
  if (v.indexOf('movie') >= 0 || v.indexOf('фильм') >= 0) return 'movie';
  if (v === 'tv' || v.indexOf('series') >= 0 || v.indexOf('сериал') >= 0) return 'tv';
  if (v.indexOf('music') >= 0 || v.indexOf('музык') >= 0) return 'music';
  return '';
}
