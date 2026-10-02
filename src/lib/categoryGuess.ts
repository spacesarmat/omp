/** TorrServer category values: "" (none), movie, tv, music, other. */
export type AddCategory = '' | 'movie' | 'tv' | 'music' | 'other';

export const ADD_CATEGORIES: { id: AddCategory; label: string }[] = [
  { id: '', label: 'Без категории' },
  { id: 'movie', label: 'Фильмы' },
  { id: 'tv', label: 'Сериалы' },
  { id: 'music', label: 'Музыка' },
  { id: 'other', label: 'Прочее' },
];

export function addCategoryLabel(c: string): string {
  for (let i = 0; i < ADD_CATEGORIES.length; i++) if (ADD_CATEGORIES[i].id === c) return ADD_CATEGORIES[i].label;
  return ADD_CATEGORIES[0].label;
}

const TV = /(сезон|серии|серия|сериал|season|series|episode|\bs\d{1,2}(e\d{1,3})?\b|\b\d{1,2}x\d{1,3}\b)/i;
const MUSIC = /(flac|mp3|alac|discography|дискографи|\bost\b|альбом|album|\bkbps\b)/i;

/** Guess a category from a release title. Empty title gives "". */
export function guessCategory(title: string): AddCategory {
  const t = (title || '').trim();
  if (!t) return '';
  if (TV.test(t)) return 'tv';
  if (MUSIC.test(t)) return 'music';
  return 'movie';
}

/** Display name (`dn=`) of a magnet link, decoded; "" when absent. */
export function magnetName(link: string): string {
  const m = /[?&]dn=([^&]*)/i.exec(link || '');
  if (!m) return '';
  const raw = m[1].replace(/\+/g, ' ');
  try {
    return decodeURIComponent(raw);
  } catch (e) {
    return raw;
  }
}
