import type { EnDict } from './types';
import type { ru } from './ru';

/** The English dictionary: same keys as Russian (enforced by the type), plurals one / other. */
export const en: EnDict<typeof ru> = {
  common: {
    signInTo: 'Sign in to {site}',
    torrents: { one: '{n} torrent', other: '{n} torrents' },
    gb: 'GB',
    mb: 'MB',
    hour: 'h',
    min: 'min',
  },
  date: {
    months: 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec',
    day: '{month} {d}',
    dayTime: '{day}, {time}',
  },
  settings: {
    language: {
      title: 'Language',
      system: 'As on the device',
      ru: 'Русский',
      en: 'English',
    },
  },
};
