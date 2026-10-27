// Stable screen codes.
// S / D: TV web UI (LG webOS and the Android TV WebView).
// P / PD: phone screens and sheets.
// A / AD: native Android TV player (PlayerActivity), not the shared web UI.
// Codes are assigned here and nowhere else. Do not renumber an existing code:
// a beta tester cites them across builds ("S05.3 does not save").
// Append a new code instead. Content rows (posters, files, search hits,
// episodes, subscriptions) have no fixed code: they change with the library.
// They get element codes counted on the page (src/testmode/elements.tsx).
import { NATIVE_DIALOGS, NATIVE_SCREENS, PHONE_DIALOGS, PHONE_SCREENS, type ExtraItem } from './extra';

export interface CodeOption {
  code: string;
  value: string;
  ru: string;
  en: string;
}

export interface RegItem {
  code: string;
  /** Focus keys, or a dialog-local anchor (value:..., index:N, input, ok, cancel). */
  anchors: string[];
  ru: string;
  en: string;
  /** Help question id. The docs take the title from the FAQ texts. */
  faqId?: string;
  options?: CodeOption[];
}

export interface ScreenDef {
  code: string;
  ru: string;
  en: string;
  items: RegItem[];
}

export interface DialogDef {
  code: string;
  id: string;
  ru: string;
  en: string;
  items: RegItem[];
}

interface Opt {
  code: string;
  value: string;
  ru: string;
  en: string;
}

function item(code: string, anchors: string[], ru: string, en: string, options?: Opt[]): RegItem {
  return { code: code, anchors: anchors, ru: ru, en: en, options: options };
}

function opt(parent: string, rows: [string, string, string][]): Opt[] {
  const out: Opt[] = [];
  for (let i = 0; i < rows.length; i++) {
    out.push({ code: parent + '.' + (i + 1), value: rows[i][0], ru: rows[i][1], en: rows[i][2] });
  }
  return out;
}

const ON_OFF: [string, string, string][] = [
  ['true', 'Вкл', 'On'],
  ['false', 'Выкл', 'Off'],
];

const LANGS: [string, string, string][] = [
  ['ru', 'Русский', 'Russian'],
  ['en', 'English', 'English'],
  ['uk', 'Українська', 'Ukrainian'],
  ['de', 'Deutsch', 'German'],
  ['fr', 'Français', 'French'],
  ['es', 'Español', 'Spanish'],
  ['ja', '日本語', 'Japanese'],
];

const UI_LANG: [string, string, string][] = [
  ['system', 'Как в системе', 'Follow the system'],
  ['ru', 'Русский', 'Russian'],
  ['en', 'English', 'English'],
];

function secs(values: number[]): [string, string, string][] {
  const out: [string, string, string][] = [];
  for (let i = 0; i < values.length; i++) {
    const n = String(values[i]);
    out.push([n, n + ' с', n + ' s']);
  }
  return out;
}

function pct(values: number[]): [string, string, string][] {
  const out: [string, string, string][] = [];
  for (let i = 0; i < values.length; i++) {
    const n = String(values[i]);
    out.push([n, n + '%', n + '%']);
  }
  return out;
}

function plainNums(values: number[], unitRu: string, unitEn: string): [string, string, string][] {
  const out: [string, string, string][] = [];
  for (let i = 0; i < values.length; i++) {
    const n = String(values[i]);
    out.push([n, unitRu ? n + ' ' + unitRu : n, unitEn ? n + ' ' + unitEn : n]);
  }
  return out;
}

/** Cache presets in bytes (64..2048 MB). Same steps as src/lib/serverSettingsOptions.ts. */
function cacheOpts(parent: string): Opt[] {
  const mb = [64, 128, 256, 512, 1024, 2048];
  const rows: [string, string, string][] = [];
  for (let i = 0; i < mb.length; i++) {
    const m = mb[i];
    const label = m >= 1024 ? m / 1024 + ' GB' : m + ' MB';
    const labelRu = m >= 1024 ? m / 1024 + ' ГБ' : m + ' МБ';
    rows.push([String(m * 1024 * 1024), labelRu, label]);
  }
  return opt(parent, rows);
}

/** Rate presets in KB/s. 0 is unlimited. Same steps as serverSettingsOptions.ts. */
function rateOpts(parent: string): Opt[] {
  const rows: [string, string, string][] = [['0', 'Без ограничения', 'Unlimited']];
  const mbps = [1, 5, 10, 25, 50];
  for (let i = 0; i < mbps.length; i++) {
    const m = mbps[i];
    rows.push([String(m * 1024), m + ' Мбит/с', m + ' Mbps']);
  }
  return opt(parent, rows);
}

/** Subtitle offset, -5..5 s by 0.5. Same range as src/player/subtitleOffset.ts. */
function offsetOpts(parent: string): Opt[] {
  const rows: [string, string, string][] = [];
  for (let i = -10; i <= 10; i++) {
    const v = i / 2;
    const value = String(v);
    let ru = '0 с';
    let en = '0 s';
    if (v > 0) {
      ru = '+' + value + ' с';
      en = '+' + value + ' s';
    } else if (v < 0) {
      ru = value + ' с';
      en = value + ' s';
    }
    rows.push([value, ru, en]);
  }
  return opt(parent, rows);
}

/** Keypad keys, in the order of src/lib/addressKeypad.ts. Append only. */
export const KP_KEYS = ['1', '2', '3', 'back', '4', '5', '6', '.', '7', '8', '9', ':', 'http', '0', 'https', 'system', 'submit'];

function kpItems(screen: string, start: number, field: string): RegItem[] {
  const names: { [k: string]: [string, string] } = {
    back: ['Стереть', 'Backspace'],
    http: ['http://', 'http://'],
    https: ['https://', 'https://'],
    system: ['Клавиатура', 'Keyboard'],
    submit: ['Готово', 'Done'],
  };
  const out: RegItem[] = [];
  for (let i = 0; i < KP_KEYS.length; i++) {
    const k = KP_KEYS[i];
    const pair = names[k] || [k, k];
    out.push(item(screen + '.' + (start + i), [field + '-kp-' + k], pair[0], pair[1]));
  }
  return out;
}

/**
 * Built-in site ids, in builtinParsers() order. Append only.
 * Phone rows use psrc-<id>. TV rows use src-<id> and src-cf-<id> (one code).
 */
export const SITE_IDS: [string, string][] = [
  ['rutor', 'Rutor'],
  ['nnmclub', 'NNM-Club'],
  ['anidub', 'Anidub'],
  ['bigfangroup', 'BigFANGroup'],
  ['torrentby', 'torrent.by'],
  ['rutracker', 'RuTracker'],
  ['kinozal', 'Kinozal'],
  ['rustorka', 'Rustorka'],
];

function phoneSites(): RegItem[] {
  const out: RegItem[] = [];
  for (let i = 0; i < SITE_IDS.length; i++) {
    out.push(item('S16.' + (4 + i), ['psrc-' + SITE_IDS[i][0]], SITE_IDS[i][1], SITE_IDS[i][1]));
  }
  return out;
}

function tvSites(): RegItem[] {
  const out: RegItem[] = [];
  for (let i = 0; i < SITE_IDS.length; i++) {
    const id = SITE_IDS[i][0];
    const name = SITE_IDS[i][1];
    const base = i * 3 + 3;
    out.push(item('S17.' + base, ['src-' + id, 'src-cf-' + id], name, name));
    out.push(item('S17.' + (base + 1), ['src-login-' + id], name + ' - вход', name + ' - sign in'));
    out.push(item('S17.' + (base + 2), ['src-bypass-' + id], name + ' - обход Cloudflare', name + ' - Cloudflare bypass'));
  }
  return out;
}

/** Help question ids, in src/faq/faq.ts order. Append only. Code is S11.(FAQ_Q_BASE + index). */
export const FAQ_Q_BASE = 10;
export const FAQ_IDS = [
  'lg-version', 'lg-root', 'lg-devmode', 'lg-hbc', 'lg-devmode-expiry', 'lg-update',
  'atv-install', 'atv-adb', 'atv-boxes', 'apk-choice', 'xiaomi', 'sber', 'yandex', 'atv-update', 'beta',
  'phone-install', 'after-install', 'samsung', 'apk-fail', 'lg-gone', 'devmgr', 'helper', 'safety',
  'lg-connect', 'atv-connect', 'xiaomi-connect', 'tv-no-server', 'wake',
  'skip', 'sound-subs', 'control', 'audiobooks', 'audiobook-player', 'audiobook-seeds',
  'player-engine', 'player-auto', 'player-audio',
  'no-server', 'no-sound', 'notifications', 'torrent-by-code', 'phone-no-control',
  'sources', 'sources-transfer', 'jackett', 'flaresolverr', 'cloudflare', 'sites-login', 'accounts',
  'discover', 'add-magnet', 'search-filters', 'tmdb-key', 'names',
  'torrserver', 'ts-phone', 'ts-settings', 'ts-covers',
  'subscriptions', 'new-episodes', 'better-quality', 'find-better', 'series-card',
  'log', 'report-bug', 'backup', 'support', 'telegram', 'omp-subscription',
];

function faqItems(): RegItem[] {
  const out: RegItem[] = [];
  for (let i = 0; i < FAQ_IDS.length; i++) {
    out.push({
      code: 'S11.' + (FAQ_Q_BASE + i),
      anchors: ['faq-' + FAQ_IDS[i]],
      ru: '',
      en: '',
      faqId: FAQ_IDS[i],
    });
  }
  return out;
}

const GENRES: [string, string, string][] = [
  ['', 'Любой', 'Any'],
  ['action', 'Боевик', 'Action'],
  ['adventure', 'Приключения', 'Adventure'],
  ['animation', 'Мультфильм', 'Animation'],
  ['comedy', 'Комедия', 'Comedy'],
  ['crime', 'Криминал', 'Crime'],
  ['documentary', 'Документальный', 'Documentary'],
  ['drama', 'Драма', 'Drama'],
  ['family', 'Семейный', 'Family'],
  ['fantasy', 'Фэнтези', 'Fantasy'],
  ['scifi', 'Фантастика', 'Sci-Fi'],
  ['history', 'История', 'History'],
  ['horror', 'Ужасы', 'Horror'],
  ['music', 'Музыка', 'Music'],
  ['mystery', 'Детектив', 'Mystery'],
  ['romance', 'Мелодрама', 'Romance'],
  ['thriller', 'Триллер', 'Thriller'],
  ['war', 'Военный', 'War'],
  ['western', 'Вестерн', 'Western'],
  ['kids', 'Детский', 'Kids'],
  ['reality', 'Реалити-шоу', 'Reality'],
  ['talk', 'Ток-шоу', 'Talk show'],
  ['news', 'Новости', 'News'],
];

const COUNTRIES: [string, string, string][] = [
  ['', 'Любая', 'Any'],
  ['RU', 'Россия', 'Russia'],
  ['US', 'США', 'USA'],
  ['GB', 'Великобритания', 'UK'],
  ['KR', 'Корея', 'Korea'],
  ['JP', 'Япония', 'Japan'],
  ['FR', 'Франция', 'France'],
  ['DE', 'Германия', 'Germany'],
  ['ES', 'Испания', 'Spain'],
  ['IT', 'Италия', 'Italy'],
  ['IN', 'Индия', 'India'],
  ['TR', 'Турция', 'Turkey'],
  ['CN', 'Китай', 'China'],
];

const SCREENS: ScreenDef[] = [];
const BY_KEY: { [k: string]: ScreenDef } = {};

function addScreen(code: string, keys: string[], ru: string, en: string, items: RegItem[]): ScreenDef {
  const s: ScreenDef = { code: code, ru: ru, en: en, items: items };
  SCREENS.push(s);
  for (let i = 0; i < keys.length; i++) BY_KEY[keys[i]] = s;
  return s;
}

addScreen('S01', ['library'], 'Главная', 'Home', [
  item('S01.1', ['tab-history'], 'История', 'History'),
  item('S01.2', ['tab-all'], 'Все', 'All'),
  item('S01.3', ['tab-movie'], 'Фильмы', 'Movies'),
  item('S01.4', ['tab-tv'], 'Сериалы', 'Series'),
  item('S01.5', ['tab-music'], 'Музыка', 'Music'),
  item('S01.6', ['tab-audiobook'], 'Аудиокниги', 'Audiobooks'),
  item('S01.7', ['tab-other'], 'Прочее', 'Other'),
  item('S01.8', ['lib-btn-search'], 'Поиск', 'Search'),
  item('S01.9', ['lib-search'], 'Строка поиска', 'Search field'),
  item('S01.10', ['lib-btn-view'], 'Вид', 'View', opt('S01.10', [
    ['large', 'Крупные постеры', 'Large posters'],
    ['small', 'Мелкие постеры', 'Small posters'],
    ['list', 'Список', 'List'],
    ['compact', 'Компактный', 'Compact'],
  ])),
  item('S01.11', ['lib-btn-sort'], 'Сортировка', 'Sort', opt('S01.11', [
    ['new', 'Новые', 'New'],
    ['title', 'По названию', 'By title'],
    ['size', 'По размеру', 'By size'],
  ])),
  item('S01.12', ['lib-btn-add'], 'Найти раздачу', 'Find a release'),
  item('S01.13', ['lib-btn-playlist'], 'Плейлисты', 'Playlists'),
  item('S01.14', ['lib-btn-settings'], 'Настройки', 'Settings'),
  item('S01.15', ['hfilter-all'], 'История - все', 'History - all'),
  item('S01.16', ['hfilter-tv'], 'История - с телевизора', 'History - from the TV'),
  item('S01.17', ['hfilter-phone'], 'История - с телефона', 'History - from the phone'),
  item('S01.18', ['lib-retry'], 'Повторить', 'Retry'),
  item('S01.19', ['lib-change-server'], 'Сменить сервер', 'Change server'),
  item('S01.20', ['lib-banner-retry'], 'Повторить загрузку', 'Retry loading'),
]);

addScreen('S02', ['library:discover'], 'Каталог', 'Catalog', [
  item('S02.1', ['tab-discover'], 'Обзор', 'Browse'),
  item('S02.2', ['disc-kind-all'], 'Все', 'All'),
  item('S02.3', ['disc-kind-movie'], 'Фильмы', 'Movies'),
  item('S02.4', ['disc-kind-tv'], 'Сериалы', 'Series'),
  item('S02.5', ['disc-kind-want'], 'Хочу', 'Want'),
  item('S02.6', ['disc-sort'], 'Сортировка', 'Sort'),
  item('S02.7', ['disc-genre'], 'Жанр', 'Genre'),
  item('S02.8', ['disc-year'], 'Год', 'Year'),
  item('S02.9', ['disc-country'], 'Страна', 'Country'),
  item('S02.10', ['disc-rating'], 'Рейтинг', 'Rating'),
  item('S02.11', ['disc-find'], 'Найти фильм', 'Find a title'),
  item('S02.12', ['disc-reset'], 'Сбросить поиск', 'Reset search'),
  item('S02.13', ['disc-retry'], 'Повторить', 'Retry'),
  item('S02.14', ['disc-more-retry'], 'Повторить загрузку', 'Retry loading more'),
]);

addScreen('S03', ['torrent'], 'Раздача', 'Release', [
  item('S03.1', ['torrent-play'], 'Смотреть', 'Watch'),
  item('S03.2', ['torrent-playlist'], 'Плейлист', 'Playlist'),
  item('S03.3', ['torrent-better'], 'Найти в лучшем качестве', 'Find better quality'),
  item('S03.4', ['torrent-reset'], 'Сбросить просмотр', 'Reset watched'),
  item('S03.5', ['torrent-rename'], 'Переименовать', 'Rename'),
  item('S03.6', ['torrent-poster'], 'Другой постер', 'Other poster'),
  item('S03.7', ['torrent-delete'], 'Удалить', 'Delete'),
  item('S03.8', ['torrent-dead-find'], 'Найти другую', 'Find another'),
  item('S03.9', ['skip-intro'], 'Пропускать заставку', 'Skip the intro'),
  item('S03.10', ['skip-credits'], 'Пропускать титры', 'Skip the credits'),
  item('S03.11', ['skip-status'], 'Заставка и титры', 'Intro and credits'),
]);

addScreen('S04', ['series'], 'Сериал', 'Series', [
  item('S04.1', ['series-watch'], 'Смотреть', 'Watch'),
  item('S04.2', ['series-releases'], 'Раздачи', 'Releases'),
  item('S04.3', ['series-better'], 'В лучшем качестве', 'Better quality'),
  item('S04.4', ['series-follow'], 'Следить за сериями', 'Follow episodes'),
  item('S04.5', ['series-dub'], 'Озвучка', 'Dub'),
  item('S04.6', ['series-find'], 'Найти раздачи', 'Find releases'),
]);

addScreen('S05', ['settings'], 'Настройки', 'Settings', [
  item('S05.1', ['set-language'], 'Язык', 'Language', opt('S05.1', UI_LANG)),
  item('S05.2', ['set-engine-auto'], 'Плеер - авто', 'Player - auto'),
  item('S05.3', ['set-engine-builtin'], 'Плеер - встроенный', 'Player - built-in'),
  item('S05.4', ['set-engine-vlc'], 'Плеер - VLC', 'Player - VLC'),
  item('S05.5', ['set-always-ffmpeg'], 'Всегда FFmpeg', 'Always FFmpeg', opt('S05.5', ON_OFF)),
  item('S05.6', ['set-videoPlayer'], 'Плеер для видео', 'Video player', opt('S05.6', [
    ['builtin', 'Встроенный', 'Built-in'],
    ['p2160', '2160 Player', '2160 Player'],
  ])),
  item('S05.7', ['set-audio'], 'Язык аудио', 'Audio language', opt('S05.7', LANGS)),
  item('S05.8', ['set-subtitlesOn'], 'Субтитры при запуске', 'Subtitles at start', opt('S05.8', ON_OFF)),
  item('S05.9', ['set-subLang'], 'Язык субтитров', 'Subtitle language', opt('S05.9', LANGS)),
  item('S05.10', ['set-seekStep'], 'Шаг перемотки', 'Seek step', opt('S05.10', secs([5, 10, 15, 30, 60]))),
  item('S05.11', ['set-edgeStep'], 'Шаг двойного клика', 'Double-click step', opt('S05.11', secs([5, 10, 15]))),
  item('S05.12', ['set-autoNext'], 'Автопереход к следующей серии', 'Auto next episode', opt('S05.12', ON_OFF)),
  item('S05.13', ['set-showStats'], 'Статистика потока при запуске', 'Stream stats at start', opt('S05.13', ON_OFF)),
  item('S05.14', ['set-subSize'], 'Размер субтитров', 'Subtitle size', opt('S05.14', [
    ['small', 'Маленький', 'Small'],
    ['medium', 'Средний', 'Medium'],
    ['large', 'Крупный', 'Large'],
  ])),
  item('S05.15', ['set-subColor'], 'Цвет субтитров', 'Subtitle color', opt('S05.15', [
    ['white', 'Белый', 'White'],
    ['yellow', 'Жёлтый', 'Yellow'],
  ])),
  item('S05.16', ['set-subBackground'], 'Подложка субтитров', 'Subtitle background', opt('S05.16', ON_OFF)),
  item('S05.17', ['set-server'], 'Сменить сервер', 'Change server'),
  item('S05.18', ['set-pair'], 'Подключить телефон', 'Pair a phone'),
  item('S05.19', ['set-sources'], 'Где искать фильмы', 'Where to search'),
  item('S05.20', ['set-live-seeds'], 'Актуальные сиды', 'Live seeds', opt('S05.20', ON_OFF)),
  item('S05.21', ['set-open-on-startup'], 'Открывать при включении', 'Open on startup', opt('S05.21', ON_OFF)),
  item('S05.22', ['set-open-on-startup-allow'], 'Разрешить показ поверх окон', 'Allow draw over other apps'),
  item('S05.23', ['set-update-check'], 'Проверить обновление', 'Check for an update'),
  item('S05.24', ['set-update'], 'Обновление', 'Update'),
  item('S05.25', ['set-addHbRepo'], 'Добавить репозиторий Homebrew', 'Add the Homebrew repository'),
  item('S05.26', ['set-faq'], 'Помощь', 'Help'),
  item('S05.27', ['set-advanced'], 'Расширенные', 'Advanced'),
  item('S05.28', ['set-onboarding'], 'Показать знакомство', 'Show the tour'),
  item('S05.29', ['set-test-mode'], 'Режим тестирования', 'Test mode', opt('S05.29', ON_OFF)),
  item('S05.30', ['set-test-size'], 'Размер меток (ползунок, px)', 'Label size (slider, px)'),
]);

addScreen('S06', ['player'], 'Плеер', 'Player', [
  item('S06.1', ['player-prev'], 'Предыдущий', 'Previous'),
  item('S06.2', ['player-play'], 'Воспроизведение', 'Play or pause'),
  item('S06.3', ['player-next'], 'Следующий', 'Next'),
  item('S06.4', ['player-menu'], 'Меню', 'Menu'),
  item('S06.5', ['player-chapters'], 'Главы', 'Chapters'),
  item('S06.6', ['player-err-another'], 'Другая раздача', 'Another release'),
  item('S06.7', ['player-err-retry'], 'Повторить', 'Retry'),
  item('S06.8', ['player-err-back'], 'Назад', 'Back'),
]);

addScreen('S07', ['add'], 'Поиск', 'Search', [
  item('S07.1', ['add-query'], 'Запрос', 'Query'),
  item('S07.2', ['add-go'], 'Найти', 'Search'),
  item('S07.3', ['add-link'], 'Magnet или ссылка', 'Magnet or link'),
  item('S07.4', ['add-sources'], 'Источники', 'Sources'),
  item('S07.5', ['search-kind-all'], 'Все типы', 'All kinds'),
  item('S07.6', ['search-kind-movie'], 'Фильмы', 'Movies'),
  item('S07.7', ['search-kind-series'], 'Сериалы', 'Series'),
  item('S07.8', ['search-kind-audiobook'], 'Аудиокниги', 'Audiobooks'),
  item('S07.9', ['search-sort'], 'Сортировка', 'Sort'),
]);

addScreen('S08', ['playlist'], 'Плейлисты', 'Playlists', [
  item('S08.1', ['pl-url'], 'Адрес плейлиста', 'Playlist URL'),
  item('S08.2', ['pl-open'], 'Открыть', 'Open'),
  item('S08.3', ['pl-all'], 'Все торренты сервера', 'All server torrents'),
  item('S08.4', ['pl-play'], 'Воспроизвести всё', 'Play all'),
  item('S08.5', ['pl-fav'], 'В избранное', 'Favorite'),
]);

addScreen('S09', ['connect'], 'Подключение', 'Connect', [
  item('S09.1', ['history-btn'], 'История серверов', 'Server history'),
  item('S09.2', ['connect-url'], 'Адрес', 'Address'),
  item('S09.3', ['connect-url-to-keypad'], 'Цифровая клавиатура', 'Keypad'),
  item('S09.4', ['connect-advanced'], 'Логин и пароль', 'Login and password'),
  item('S09.5', ['connect-user'], 'Логин', 'Login'),
  item('S09.6', ['connect-pass'], 'Пароль', 'Password'),
  item('S09.7', ['connect-btn'], 'Подключиться', 'Connect'),
  item('S09.8', ['connect-scan'], 'Найти в сети', 'Scan the network'),
].concat(kpItems('S09', 9, 'connect-url')));

addScreen('S10', ['advanced'], 'Расширенные', 'Advanced', [
  item('S10.1', ['adv-back'], 'Назад', 'Back'),
  item('S10.2', ['set-tmdb'], 'Ключ TMDB', 'TMDB key'),
  item('S10.3', ['set-cacheSize'], 'Размер кэша', 'Cache size', cacheOpts('S10.3')),
  item('S10.4', ['set-saveOnServer'], 'Сохранить на сервере', 'Save on the server'),
  item('S10.5', ['set-expert'], 'Для опытных', 'Expert'),
  item('S10.6', ['set-preload'], 'Предзагрузка', 'Preload', opt('S10.6', pct([0, 5, 10, 25, 50, 75, 95]))),
  item('S10.7', ['set-readahead'], 'Опережающее чтение', 'Read ahead', opt('S10.7', pct([5, 25, 50, 75, 95]))),
  item('S10.8', ['set-connsLimit'], 'Лимит соединений', 'Connection limit', opt('S10.8', plainNums([10, 25, 50, 100, 200], '', ''))),
  item('S10.9', ['set-downLimit'], 'Ограничение загрузки', 'Download limit', rateOpts('S10.9')),
  item('S10.10', ['set-upLimit'], 'Ограничение отдачи', 'Upload limit', rateOpts('S10.10')),
  item('S10.11', ['set-disconnectAfter'], 'Отключать неактивный торрент', 'Disconnect idle torrent', opt('S10.11', secs([30, 60, 120, 300]))),
  item('S10.12', ['set-trackTimecode'], 'Сохранять тайм-коды на сервере', 'Save timecodes on the server', opt('S10.12', ON_OFF)),
  item('S10.13', ['set-defaults'], 'По умолчанию', 'Defaults'),
  item('S10.14', ['set-updateOnStart'], 'Проверять обновления при запуске', 'Check for updates on start', opt('S10.14', ON_OFF)),
  item('S10.15', ['adv-beta'], 'Пробовать новые функции раньше всех', 'Try new features first', opt('S10.15', ON_OFF)),
  item('S10.16', ['set-log-clear'], 'Очистить журнал', 'Clear the log'),
  item('S10.17', ['set-resetApp'], 'Сбросить настройки приложения', 'Reset app settings'),
]);

const helpSections: RegItem[] = [
  item('S11.1', ['faq-answer'], 'Ответ', 'Answer'),
  item('S11.2', ['faq-sec-install'], 'Установка', 'Installation'),
  item('S11.3', ['faq-sec-connect'], 'Подключение', 'Connecting'),
  item('S11.4', ['faq-sec-player'], 'Плеер', 'Player'),
  item('S11.5', ['faq-sec-trouble'], 'Если что-то не работает', 'If something does not work'),
  item('S11.6', ['faq-sec-setup'], 'Поиск и настройка', 'Search and setup'),
  item('S11.7', ['faq-sec-about'], 'О проекте', 'About the project'),
  item('S11.8', ['faq-sec-log'], 'Журнал и резервная копия', 'Log and backup'),
  item('S11.9', ['faq-sec-news'], 'Новое и подписки', 'New and subscriptions'),
];

addScreen('S11', ['faq'], 'Помощь', 'Help', helpSections.concat(faqItems()));

addScreen('S12', ['pairPhone'], 'Телефон', 'Phone', [
  item('S12.1', ['pair-back'], 'Готово', 'Done'),
  item('S12.2', ['pair-new-code'], 'Новый код', 'New code'),
]);

addScreen('S13', ['update'], 'Обновление', 'Update', [
  item('S13.1', ['upd-check'], 'Проверить', 'Check'),
  item('S13.2', ['upd-whatsnew'], 'Что нового', "What's new"),
  item('S13.3', ['upd-beta'], 'Бета-версии', 'Beta versions'),
  item('S13.4', ['upd-install'], 'Установить', 'Install'),
  item('S13.5', ['upd-hb-open'], 'Открыть Homebrew Channel', 'Open Homebrew Channel'),
  item('S13.6', ['upd-hb-repo'], 'Добавить репозиторий OMP', 'Add the OMP repository'),
]);

addScreen('S14', ['title'], 'Карточка', 'Title', [
  item('S14.1', ['title-find'], 'Найти раздачи', 'Find releases'),
  item('S14.2', ['title-want'], 'Хочу посмотреть', 'Want to watch'),
  item('S14.3', ['title-open'], 'Открыть в медиатеке', 'Open in the library'),
  item('S14.4', ['title-retry'], 'Повторить', 'Retry'),
]);

addScreen('S15', ['person'], 'Персона', 'Person', [
  item('S15.1', ['person-bio-more'], 'Подробнее', 'More'),
  item('S15.2', ['person-job-acting'], 'Актёр', 'Actor'),
  item('S15.3', ['person-job-directing'], 'Режиссёр', 'Director'),
  item('S15.4', ['person-filter-all'], 'Все', 'All'),
  item('S15.5', ['person-filter-owned'], 'В медиатеке', 'In the library'),
  item('S15.6', ['person-sort'], 'Сортировка', 'Sort', opt('S15.6', [
    ['popular', 'Популярные', 'Popular'],
    ['year', 'По году', 'By year'],
  ])),
  item('S15.7', ['person-retry'], 'Повторить', 'Retry'),
]);

addScreen('S16', ['sources:webos'], 'Источники телефона', 'Phone sources', [
  item('S16.1', ['psrc-retry'], 'Повторить', 'Retry'),
  item('S16.2', ['psrc-forget'], 'Забыть телефон', 'Forget the phone'),
  item('S16.3', ['psrc-ts'], 'Источники TorrServer', 'TorrServer sources'),
].concat(phoneSites()));

addScreen('S17', ['sources:android', 'tsSources'], 'Источники поиска', 'Search sources', [
  item('S17.1', ['src-ts-rutor'], 'rutor (TorrServer)', 'rutor (TorrServer)'),
  item('S17.2', ['src-ts-torznab'], 'Torznab', 'Torznab'),
].concat(tvSites()));

addScreen('S18', ['library:news'], 'Новое', 'News', [
  item('S18.1', ['tab-news'], 'Новое', 'News'),
  item('S18.2', ['news-seg-feed'], 'Находки', 'Findings'),
  item('S18.3', ['news-seg-subs'], 'Подписки', 'Subscriptions'),
  item('S18.4', ['news-retry'], 'Повторить', 'Retry'),
  item('S18.5', ['news-subs-retry'], 'Повторить подписки', 'Retry subscriptions'),
  item('S18.6', ['news-subs-find'], 'Найти подписку', 'Find a subscription'),
]);

export function screens(): ScreenDef[] {
  return SCREENS;
}

/** The screen for a route. library tabs discover and news have their own codes. */
export function lookupScreen(name: string, tab: string, platform: string): ScreenDef | null {
  if (name === 'library' && tab === 'discover') return BY_KEY['library:discover'];
  if (name === 'library' && tab === 'news') return BY_KEY['library:news'];
  if (name === 'sources') return BY_KEY[platform === 'webos' ? 'sources:webos' : 'sources:android'];
  if (name === 'tsSources') return BY_KEY['tsSources'];
  return BY_KEY[name] || null;
}

const DIALOGS: DialogDef[] = [];
const BY_DIALOG: { [id: string]: DialogDef } = {};

function addDialog(code: string, id: string, ru: string, en: string, items: RegItem[]): void {
  const d: DialogDef = { code: code, id: id, ru: ru, en: en, items: items };
  DIALOGS.push(d);
  BY_DIALOG[id] = d;
}

function confirmItems(code: string, okRu: string, okEn: string): RegItem[] {
  return [
    item(code + '.1', ['value:true'], okRu, okEn),
    item(code + '.2', ['value:false'], 'Отмена', 'Cancel'),
  ];
}

function textItems(code: string, okRu: string, okEn: string): RegItem[] {
  return [
    item(code + '.1', ['input'], 'Поле', 'Field'),
    item(code + '.2', ['ok'], okRu, okEn),
    item(code + '.3', ['cancel'], 'Отмена', 'Cancel'),
  ];
}

addDialog('D01', 'exit', 'Выход', 'Exit', confirmItems('D01', 'Выйти', 'Exit'));
addDialog('D02', 'lib-delete', 'Удалить раздачу', 'Delete a release', confirmItems('D02', 'Удалить', 'Delete'));
addDialog('D03', 'lib-delete-series', 'Удалить сериал', 'Delete a series', confirmItems('D03', 'Удалить', 'Delete'));
addDialog('D04', 'lib-history', 'Убрать из истории', 'Remove from history', confirmItems('D04', 'Убрать', 'Remove'));
addDialog('D05', 'search-details', 'Подробнее о раздаче', 'Release details', [
  item('D05.1', ['search-details-add'], 'Добавить', 'Add'),
]);
addDialog('D06', 'add-link', 'Magnet или ссылка', 'Magnet or link', textItems('D06', 'Добавить', 'Add'));
addDialog('D07', 'search-sort', 'Сортировка поиска', 'Search sort', [
  item('D07.1', ['value:quality'], 'По качеству', 'By quality'),
  item('D07.2', ['value:seeds'], 'По сидам', 'By seeds'),
  item('D07.3', ['value:size'], 'По размеру', 'By size'),
  item('D07.4', ['value:date'], 'По дате', 'By date'),
]);
addDialog('D08', 'person-bio', 'Биография', 'Biography', [
  item('D08.1', ['index:0'], 'Закрыть', 'Close'),
]);
addDialog('D09', 'psrc-forget', 'Забыть телефон', 'Forget the phone', confirmItems('D09', 'Забыть', 'Forget'));
addDialog('D10', 'player-resume', 'Продолжить просмотр', 'Resume', [
  item('D10.1', ['index:0'], 'Продолжить', 'Resume'),
  item('D10.2', ['index:1'], 'Сначала', 'From the start'),
]);
addDialog('D11', 'player-chapters', 'Главы', 'Chapters', []);
addDialog('D12', 'player-audio', 'Аудио', 'Audio', []);
addDialog('D13', 'player-subs', 'Субтитры', 'Subtitles', []);
addDialog('D14', 'player-menu', 'Меню плеера', 'Player menu', [
  item('D14.1', ['value:audio'], 'Аудио', 'Audio'),
  item('D14.2', ['value:subs'], 'Субтитры', 'Subtitles'),
  item('D14.3', ['value:size'], 'Размер субтитров', 'Subtitle size'),
  item('D14.4', ['value:offset'], 'Смещение субтитров', 'Subtitle offset'),
  item('D14.5', ['value:chapters'], 'Главы', 'Chapters'),
  item('D14.6', ['value:mark-intro-start'], 'Начало заставки', 'Intro start'),
  item('D14.7', ['value:mark-intro-end'], 'Конец заставки', 'Intro end'),
  item('D14.8', ['value:mark-credits'], 'Титры', 'Credits'),
]);
addDialog('D15', 'player-size', 'Размер субтитров', 'Subtitle size', [
  item('D15.1', ['value:small'], 'Маленький', 'Small'),
  item('D15.2', ['value:medium'], 'Средний', 'Medium'),
  item('D15.3', ['value:large'], 'Крупный', 'Large'),
]);
addDialog('D16', 'player-offset', 'Смещение субтитров', 'Subtitle offset', [
  item('D16.1', ['offset'], 'Смещение', 'Offset', offsetOpts('D16.1')),
]);
addDialog('D17', 'series-dub', 'Озвучка сериала', 'Series dub', []);
addDialog('D18', 'series-better', 'В лучшем качестве', 'Better quality', []);
addDialog('D19', 'series-releases', 'Раздачи сериала', 'Series releases', []);
addDialog('D20', 'clear-log', 'Очистить журнал', 'Clear the log', confirmItems('D20', 'Очистить', 'Clear'));
addDialog('D21', 'startup-overlay', 'Показ поверх окон', 'Draw over other apps', confirmItems('D21', 'Разрешить', 'Allow'));
addDialog('D22', 'reset-server', 'Сбросить настройки сервера', 'Reset server settings', confirmItems('D22', 'Сбросить', 'Reset'));
addDialog('D23', 'tmdb-key', 'Ключ TMDB', 'TMDB key', textItems('D23', 'Сохранить', 'Save'));
addDialog('D24', 'reset-app', 'Сбросить настройки приложения', 'Reset app settings', confirmItems('D24', 'Сбросить', 'Reset'));
addDialog('D25', 'src-bypass', 'Обход Cloudflare', 'Cloudflare bypass', confirmItems('D25', 'Включить', 'Enable'));
addDialog('D26', 'src-signout', 'Выйти с сайта', 'Sign out', confirmItems('D26', 'Выйти', 'Sign out'));
addDialog('D27', 'update-allow', 'Разрешить установку', 'Allow installation', confirmItems('D27', 'Разрешить', 'Allow'));
addDialog('D28', 'delete-server', 'Удалить сервер', 'Delete the server', confirmItems('D28', 'Удалить', 'Delete'));
addDialog('D29', 'torrent-delete', 'Удалить торрент', 'Delete the torrent', confirmItems('D29', 'Удалить', 'Delete'));
addDialog('D30', 'torrent-rename', 'Переименовать', 'Rename', textItems('D30', 'Сохранить', 'Save'));
addDialog('D31', 'torrent-poster', 'Другой постер', 'Other poster', []);
addDialog('D32', 'torrent-reset', 'Сбросить просмотр', 'Reset watched', confirmItems('D32', 'Сбросить', 'Reset'));
addDialog('D33', 'discover-search', 'Поиск в каталоге', 'Catalog search', textItems('D33', 'Найти', 'Search'));
addDialog('D34', 'discover-sort', 'Сортировка каталога', 'Catalog sort', [
  item('D34.1', ['value:popular'], 'Популярные', 'Popular'),
  item('D34.2', ['value:rating'], 'По рейтингу', 'By rating'),
  item('D34.3', ['value:date'], 'По дате выхода', 'By release date'),
  item('D34.4', ['value:upcoming'], 'Самые ожидаемые', 'Most anticipated'),
  item('D34.5', ['value:digitalSoon'], 'Скоро в цифре', 'Digital soon'),
]);
addDialog('D35', 'discover-genre', 'Жанр', 'Genre', GENRES.map((g, i) => item('D35.' + (i + 1), ['value:' + g[0]], g[1], g[2])));
addDialog('D36', 'discover-year', 'Год', 'Year', [
  item('D36.1', ['value:any'], 'Любой', 'Any'),
  item('D36.2', ['value:this'], 'Этот год', 'This year'),
  item('D36.3', ['value:last'], 'Прошлый', 'Last year'),
]);
addDialog('D37', 'discover-country', 'Страна', 'Country', COUNTRIES.map((c, i) => item('D37.' + (i + 1), ['value:' + c[0]], c[1], c[2])));
addDialog('D38', 'discover-rating', 'Минимальный рейтинг', 'Minimum rating', [
  item('D38.1', ['value:0'], 'Любой', 'Any'),
  item('D38.2', ['value:6'], 'от 6', 'from 6'),
  item('D38.3', ['value:7'], 'от 7', 'from 7'),
  item('D38.4', ['value:8'], 'от 8', 'from 8'),
]);
addDialog('D39', 'news-find', 'Найти подписку', 'Find a subscription', textItems('D39', 'Найти', 'Search'));
addDialog('D40', 'update-prompt', 'Доступно обновление', 'Update available', [
  item('D40.1', ['upd-dlg-update'], 'Обновить', 'Update'),
  item('D40.2', ['upd-dlg-later'], 'Позже', 'Later'),
  item('D40.3', ['upd-dlg-skip'], 'Пропустить', 'Skip'),
]);
addDialog('D41', 'whats-new', 'Что нового', "What's new", [
  item('D41.1', ['whatsnew-ok'], 'OK', 'OK'),
]);
addDialog('D42', 'onboarding', 'Знакомство', 'Tour', [
  item('D42.1', ['onb-skip'], 'Пропустить', 'Skip'),
  item('D42.2', ['onb-next'], 'Далее', 'Next'),
  item('D42.3', ['value:welcome'], 'Приветствие', 'Welcome'),
  item('D42.4', ['value:server'], 'Сервер', 'Server'),
  item('D42.5', ['value:watch'], 'Просмотр', 'Watching'),
  item('D42.6', ['value:help'], 'Помощь', 'Help'),
  item('D42.7', ['value:ready'], 'Готово', 'Ready'),
]);
addDialog('D43', 'better', 'В лучшем качестве', 'Better quality', [
  item('D43.1', ['better-cancel'], 'Отмена', 'Cancel'),
  item('D43.2', ['better-search-all'], 'Искать везде', 'Search everywhere'),
  item('D43.3', ['better-follow'], 'Следить за лучшим качеством', 'Follow better quality'),
]);
addDialog('D44', 'marks', 'Заставка и титры', 'Intro and credits', [
  item('D44.1', ['marks-from'], 'Заставка с', 'Intro from'),
  item('D44.2', ['marks-to'], 'Заставка до', 'Intro to'),
  item('D44.3', ['marks-last'], 'Титры: последние', 'Credits: last'),
  item('D44.4', ['marks-reset'], 'Сбросить', 'Reset'),
  item('D44.5', ['marks-save'], 'Сохранить', 'Save'),
]);
addDialog('D45', 'tracker-login', 'Вход на сайт', 'Site sign-in', [
  item('D45.1', ['login-user'], 'Логин', 'Login'),
  item('D45.2', ['login-pass'], 'Пароль', 'Password'),
  item('D45.3', ['login-browser'], 'Войти через браузер', 'Sign in with the browser'),
  item('D45.4', ['login-phone'], 'Войти на телефоне', 'Sign in on the phone'),
  item('D45.5', ['login-cancel'], 'Отмена', 'Cancel'),
  item('D45.6', ['login-ok'], 'Войти', 'Sign in'),
]);
addDialog('D46', 'edit-server', 'Сервер', 'Server', [
  item('D46.1', ['edit-name'], 'Имя', 'Name'),
  item('D46.2', ['edit-url'], 'Адрес', 'Address'),
  item('D46.3', ['edit-url-to-keypad'], 'Цифровая клавиатура', 'Keypad'),
  item('D46.4', ['edit-user'], 'Логин', 'Login'),
  item('D46.5', ['edit-pass'], 'Пароль', 'Password'),
  item('D46.6', ['edit-save'], 'Сохранить', 'Save'),
  item('D46.7', ['edit-cancel'], 'Отмена', 'Cancel'),
  item('D46.8', ['edit-delete'], 'Удалить', 'Delete'),
].concat(kpItems('D46', 9, 'edit-url')));
addDialog('D47', 'server-history', 'История серверов', 'Server history', []);

export function dialogs(): DialogDef[] {
  return DIALOGS;
}

export function dialogById(id: string): DialogDef | null {
  return BY_DIALOG[id] || null;
}

function fromExtra(it: ExtraItem): RegItem {
  return { code: it.code, anchors: [], ru: it.ru, en: it.en, options: it.options };
}

/** Phone and native Android TV codes. Called once, before the registry is checked. */
function installExtra(): void {
  const lists = [PHONE_SCREENS, NATIVE_SCREENS];
  for (let n = 0; n < lists.length; n++) {
    const list = lists[n];
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      const items: RegItem[] = [];
      for (let j = 0; j < s.items.length; j++) items.push(fromExtra(s.items[j]));
      addScreen(s.code, [s.key], s.ru, s.en, items);
    }
  }
  const dialogs = [PHONE_DIALOGS, NATIVE_DIALOGS];
  for (let n = 0; n < dialogs.length; n++) {
    const list = dialogs[n];
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      const items: RegItem[] = [];
      for (let j = 0; j < d.items.length; j++) items.push(fromExtra(d.items[j]));
      addDialog(d.code, d.id, d.ru, d.en, items);
    }
  }
}

/**
 * Phone screen for a route. «Обзор» is a mode of «Каталог», not its own route,
 * and keeps a separate code so a screenshot of browse is not cited as «Мои».
 */
export function lookupPhone(name: string, mode: string): ScreenDef | null {
  if (name === 'library' && mode === 'discover') return BY_KEY['phone:library:discover'] || null;
  return BY_KEY['phone:' + name] || null;
}

const ANCHORS: { [a: string]: RegItem } = {};

function isGlobalAnchor(a: string): boolean {
  if (!a || a === 'input' || a === 'ok' || a === 'cancel') return false;
  if (a.indexOf(':') >= 0) return false;
  return true;
}

function indexItem(it: RegItem, problems: string[]): void {
  if (ANCHORS[it.code]) problems.push('duplicate code ' + it.code);
  ANCHORS[it.code] = it;
  for (let i = 0; i < it.anchors.length; i++) {
    const a = it.anchors[i];
    if (!isGlobalAnchor(a)) continue;
    if (ANCHORS['@' + a]) problems.push('duplicate anchor ' + a);
    ANCHORS['@' + a] = it;
  }
}

const PROBLEMS: string[] = [];

installExtra();

function checkCode(code: string, parent: string): void {
  // PD and AD before P and A, so the two-letter prefixes are not read as P / A.
  if (!/^(PD|AD|S|D|P|A)[0-9]+(\.[0-9]+)*$/.test(code)) PROBLEMS.push('bad code ' + code);
  if (parent && code.indexOf(parent + '.') !== 0) PROBLEMS.push(code + ' is outside ' + parent);
}

for (let s = 0; s < SCREENS.length; s++) {
  const screen = SCREENS[s];
  checkCode(screen.code, '');
  if (ANCHORS[screen.code]) PROBLEMS.push('duplicate code ' + screen.code);
  ANCHORS[screen.code] = item(screen.code, [], screen.ru, screen.en);
  for (let i = 0; i < screen.items.length; i++) {
    const it = screen.items[i];
    checkCode(it.code, screen.code);
    indexItem(it, PROBLEMS);
    const options = it.options || [];
    for (let o = 0; o < options.length; o++) {
      checkCode(options[o].code, it.code);
      if (ANCHORS[options[o].code]) PROBLEMS.push('duplicate code ' + options[o].code);
      ANCHORS[options[o].code] = it;
    }
  }
}

for (let d = 0; d < DIALOGS.length; d++) {
  const dialog = DIALOGS[d];
  checkCode(dialog.code, '');
  if (ANCHORS[dialog.code]) PROBLEMS.push('duplicate code ' + dialog.code);
  ANCHORS[dialog.code] = item(dialog.code, [], dialog.ru, dialog.en);
  if (BY_DIALOG[dialog.id] !== dialog) PROBLEMS.push('duplicate dialog ' + dialog.id);
  const local: { [a: string]: true } = {};
  for (let i = 0; i < dialog.items.length; i++) {
    const it = dialog.items[i];
    checkCode(it.code, dialog.code);
    indexItem(it, PROBLEMS);
    for (let j = 0; j < it.anchors.length; j++) {
      const a = it.anchors[j];
      if (isGlobalAnchor(a)) continue;
      if (local[a]) PROBLEMS.push('duplicate local anchor ' + dialog.id + ' ' + a);
      local[a] = true;
    }
    const options = it.options || [];
    for (let o = 0; o < options.length; o++) {
      checkCode(options[o].code, it.code);
      if (ANCHORS[options[o].code]) PROBLEMS.push('duplicate code ' + options[o].code);
      ANCHORS[options[o].code] = it;
    }
  }
}

export function registryProblems(): string[] {
  return PROBLEMS;
}

export function anchorItem(anchor: string): RegItem | null {
  if (!anchor) return null;
  return ANCHORS['@' + anchor] || null;
}
