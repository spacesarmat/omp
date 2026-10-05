/** The Russian dictionary: the source of truth for the keys. Placeholders: {name}; plurals: one / few / many with {n}. */
export const ru = {
  common: {
    signInTo: 'Вход на {site}',
    torrents: { one: '{n} раздача', few: '{n} раздачи', many: '{n} раздач' },
    gb: 'ГБ',
    mb: 'МБ',
    hour: 'ч',
    min: 'мин',
  },
  date: {
    /** Short month names, space-separated (genitive where Russian needs it: «5 мая»). */
    months: 'янв. февр. мар. апр. мая июн. июл. авг. сент. окт. нояб. дек.',
    day: '{d} {month}',
    dayTime: '{day} {time}',
  },
};
