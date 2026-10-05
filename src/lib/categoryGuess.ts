import { t } from '../i18n';

/** TorrServer category values: "" (none), movie, tv, music, other. */
export type AddCategory = '' | 'movie' | 'tv' | 'music' | 'other';

export const addCategories = (): { id: AddCategory; label: string }[] => [
  { id: '', label: t('category.none') },
  { id: 'movie', label: t('category.movie') },
  { id: 'tv', label: t('category.tv') },
  { id: 'music', label: t('category.music') },
  { id: 'other', label: t('category.other') },
];

export function addCategoryLabel(c: string): string {
  const list = addCategories();
  for (let i = 0; i < list.length; i++) if (list[i].id === c) return list[i].label;
  return list[0].label;
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
