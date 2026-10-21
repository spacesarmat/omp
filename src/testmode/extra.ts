// Phone (P / PD) and native Android TV player (A / AD) codes.
// Same rule as the TV registry: append, do not renumber.
// Posters, files, episodes, search hits and user servers are not coded.

export interface ExtraOpt {
  code: string;
  value: string;
  ru: string;
  en: string;
}

export interface ExtraItem {
  code: string;
  ru: string;
  en: string;
  options?: ExtraOpt[];
}

export interface ExtraScreen {
  /** Lookup key. Phone routes use `phone:<route>`. */
  key: string;
  code: string;
  ru: string;
  en: string;
  items: ExtraItem[];
}

export interface ExtraDialog {
  code: string;
  id: string;
  ru: string;
  en: string;
  items: ExtraItem[];
}

function it(code: string, ru: string, en: string, options?: ExtraOpt[]): ExtraItem {
  return { code: code, ru: ru, en: en, options: options };
}

function onOff(parent: string): ExtraOpt[] {
  return [
    { code: parent + '.1', value: 'true', ru: 'Вкл', en: 'On' },
    { code: parent + '.2', value: 'false', ru: 'Выкл', en: 'Off' },
  ];
}

function confirm(code: string, id: string, ru: string, en: string, okRu: string, okEn: string): ExtraDialog {
  return {
    code: code,
    id: id,
    ru: ru,
    en: en,
    items: [it(code + '.1', okRu, okEn), it(code + '.2', 'Отмена', 'Cancel')],
  };
}

export const PHONE_SCREENS: ExtraScreen[] = [
  {
    key: 'phone:connect',
    code: 'P01',
    ru: 'Подключение',
    en: 'Connect',
    items: [
      it('P01.1', 'TorrServer на телефоне', 'TorrServer on the phone'),
      it('P01.2', 'Логин и пароль', 'Login and password'),
      it('P01.3', 'Подключиться', 'Connect'),
      it('P01.4', 'Найти в сети', 'Scan the network'),
    ],
  },
  {
    key: 'phone:library',
    code: 'P02',
    ru: 'Каталог',
    en: 'Library',
    items: [
      it('P02.1', 'Мои', 'Mine'),
      it('P02.2', 'Обзор', 'Browse'),
      it('P02.3', 'Сортировка', 'Sort'),
      it('P02.4', 'Вид', 'View'),
      it('P02.5', 'Поиск', 'Search'),
      it('P02.6', 'Отменить выбор', 'Cancel selection'),
      it('P02.7', 'Выбрать все', 'Select all'),
      it('P02.8', 'История', 'History'),
      it('P02.9', 'Все', 'All'),
      it('P02.10', 'Фильмы', 'Movies'),
      it('P02.11', 'Сериалы', 'Series'),
      it('P02.12', 'Музыка', 'Music'),
      it('P02.13', 'Аудиокниги', 'Audiobooks'),
      it('P02.14', 'Прочее', 'Other'),
      it('P02.15', 'Удалить выбранное', 'Delete selected'),
      it('P02.16', 'Повторить', 'Retry'),
      it('P02.17', 'Поддержать', 'Support'),
      it('P02.18', 'Не напоминать', 'Do not remind'),
    ],
  },
  {
    key: 'phone:news',
    code: 'P03',
    ru: 'Новое',
    en: 'News',
    items: [
      it('P03.1', 'Находки', 'Findings'),
      it('P03.2', 'Подписки', 'Subscriptions'),
      it('P03.3', 'Календарь', 'Calendar'),
    ],
  },
  { key: 'phone:subFindings', code: 'P04', ru: 'Находки подписки', en: 'Subscription findings', items: [it('P04.1', 'Назад', 'Back')] },
  { key: 'phone:monitor', code: 'P05', ru: 'Следить за новыми', en: 'Follow new episodes', items: [it('P05.1', 'Назад', 'Back'), it('P05.2', 'Как часто', 'How often')] },
  { key: 'phone:torrent', code: 'P06', ru: 'Раздача', en: 'Release', items: [it('P06.1', 'Назад', 'Back')] },
  { key: 'phone:add', code: 'P07', ru: 'Добавить', en: 'Add', items: [it('P07.1', 'Найти', 'Search'), it('P07.2', 'Magnet или ссылка', 'Magnet or link')] },
  { key: 'phone:remote', code: 'P08', ru: 'Пульт', en: 'Remote', items: [it('P08.1', 'Сменить телевизор', 'Switch TV')] },
  { key: 'phone:nowPlaying', code: 'P09', ru: 'Сейчас играет', en: 'Now playing', items: [it('P09.1', 'Свернуть', 'Collapse')] },
  { key: 'phone:tv', code: 'P10', ru: 'Телевизор', en: 'TV', items: [it('P10.1', 'Назад', 'Back')] },
  {
    key: 'phone:settings',
    code: 'P11',
    ru: 'Настройки',
    en: 'Settings',
    items: [
      it('P11.1', 'Аккаунт', 'Account'),
      it('P11.2', 'Сменить телевизор', 'Change TV'),
      it('P11.3', 'Установить OMP на телевизор', 'Install OMP on the TV'),
      it('P11.4', 'Поиск с телевизора', 'Search from the TV'),
      it('P11.5', 'Откуда смотреть', 'Watch from'),
      it('P11.6', 'Плеер для видео', 'Video player'),
      it('P11.7', 'Язык', 'Language'),
      it('P11.8', 'Аудиокниги', 'Audiobooks'),
      it('P11.9', 'Где искать', 'Where to search'),
      it('P11.10', 'Актуальные сиды', 'Live seeds'),
      it('P11.11', 'Следить за новыми', 'Follow new episodes'),
      it('P11.12', 'Версия', 'Version'),
      it('P11.13', 'Проверить обновление', 'Check for an update'),
      it('P11.14', 'Помощь', 'Help'),
      it('P11.15', 'Показать знакомство', 'Show the tour'),
      it('P11.16', 'Подсказки снова', 'Hints again'),
      it('P11.17', 'Поддержать', 'Support'),
      it('P11.18', 'Расширенные', 'Advanced'),
      it('P11.19', 'Режим тестирования', 'Test mode', onOff('P11.19')),
    ],
  },
  { key: 'phone:account', code: 'P12', ru: 'Аккаунт', en: 'Account', items: [it('P12.1', 'Назад', 'Back')] },
  {
    key: 'phone:advanced',
    code: 'P13',
    ru: 'Расширенные',
    en: 'Advanced',
    items: [
      it('P13.1', 'Назад', 'Back'),
      it('P13.2', 'TorrServer на телефоне', 'TorrServer on the phone'),
      it('P13.3', 'Запускать вместе с OMP', 'Start with OMP'),
      it('P13.4', 'Очистить кэш', 'Clear cache'),
      it('P13.5', 'Настройки сервера', 'Server settings'),
      it('P13.6', 'Проверять обновления при запуске', 'Check for updates on start'),
      it('P13.7', 'Бета-версии', 'Beta versions'),
      it('P13.8', 'Резервная копия', 'Backup'),
      it('P13.9', 'Журнал', 'Log'),
      it('P13.10', 'Страница проекта', 'Project page'),
    ],
  },
  {
    key: 'phone:videoPlayer',
    code: 'P14',
    ru: 'Плеер для видео',
    en: 'Video player',
    items: [
      it('P14.1', 'Назад', 'Back'),
      it('P14.2', 'Встроенный', 'Built-in'),
      it('P14.3', '2160 Player', '2160 Player'),
      it('P14.4', 'Выбор приложения', 'App chooser'),
      it('P14.5', 'Звук в фоне', 'Background audio'),
      it('P14.6', '2160 Player не установлен', '2160 Player is not installed'),
    ],
  },
  { key: 'phone:serverSettings', code: 'P15', ru: 'Настройки сервера', en: 'Server settings', items: [it('P15.1', 'Назад', 'Back')] },
  { key: 'phone:localServer', code: 'P16', ru: 'TorrServer на телефоне', en: 'TorrServer on the phone', items: [it('P16.1', 'Назад', 'Back')] },
  { key: 'phone:faq', code: 'P17', ru: 'Помощь', en: 'Help', items: [it('P17.1', 'Назад', 'Back')] },
  { key: 'phone:install', code: 'P18', ru: 'Установка на телевизор', en: 'Install on the TV', items: [it('P18.1', 'Назад', 'Back')] },
  { key: 'phone:log', code: 'P19', ru: 'Журнал', en: 'Log', items: [it('P19.1', 'Назад', 'Back')] },
  { key: 'phone:backup', code: 'P20', ru: 'Резервная копия', en: 'Backup', items: [it('P20.1', 'Назад', 'Back')] },
  {
    key: 'phone:sources',
    code: 'P21',
    ru: 'Источники поиска',
    en: 'Search sources',
    items: [
      it('P21.1', 'Назад', 'Back'),
      it('P21.2', 'FlareSolverr', 'FlareSolverr'),
      it('P21.3', 'Аккаунт', 'Account'),
    ],
  },
  { key: 'phone:flaresolverr', code: 'P22', ru: 'FlareSolverr', en: 'FlareSolverr', items: [it('P22.1', 'Назад', 'Back')] },
  { key: 'phone:sourceSite', code: 'P23', ru: 'Сайт', en: 'Site', items: [it('P23.1', 'Назад', 'Back')] },
  { key: 'phone:title', code: 'P24', ru: 'Карточка', en: 'Title', items: [it('P24.1', 'Назад', 'Back')] },
  { key: 'phone:seasonCard', code: 'P25', ru: 'Сезон', en: 'Season', items: [it('P25.1', 'Назад', 'Back')] },
  { key: 'phone:series', code: 'P26', ru: 'Сериал', en: 'Series', items: [it('P26.1', 'Назад', 'Back')] },
  { key: 'phone:person', code: 'P27', ru: 'Персона', en: 'Person', items: [it('P27.1', 'Назад', 'Back')] },
  {
    key: 'phone:audiobooks',
    code: 'P28',
    ru: 'Аудиокниги',
    en: 'Audiobooks',
    items: [
      it('P28.1', 'Назад', 'Back'),
      it('P28.2', 'Поиск', 'Search'),
      it('P28.3', 'Мои книги', 'My books'),
    ],
  },
  { key: 'phone:audiobookSearch', code: 'P29', ru: 'Поиск аудиокниг', en: 'Audiobook search', items: [it('P29.1', 'Назад', 'Back')] },
  { key: 'phone:audiobookMine', code: 'P30', ru: 'Мои книги', en: 'My books', items: [it('P30.1', 'Назад', 'Back')] },
  { key: 'phone:audiobook', code: 'P31', ru: 'Книга', en: 'Book', items: [it('P31.1', 'Назад', 'Back')] },
  { key: 'phone:audiobookPlayer', code: 'P32', ru: 'Плеер аудиокниги', en: 'Audiobook player', items: [it('P32.1', 'Назад', 'Back')] },
  {
    key: 'phone:tabs',
    code: 'P33',
    ru: 'Нижняя панель',
    en: 'Tab bar',
    items: [
      it('P33.1', 'Каталог', 'Library'),
      it('P33.2', 'Новое', 'News'),
      it('P33.3', 'Добавить', 'Add'),
      it('P33.4', 'Пульт', 'Remote'),
      it('P33.5', 'Настройки', 'Settings'),
    ],
  },
  {
    key: 'phone:library:discover',
    code: 'P34',
    ru: 'Обзор',
    en: 'Browse',
    items: [
      it('P34.1', 'Мои', 'Mine'),
      it('P34.2', 'Обзор', 'Browse'),
      it('P34.3', 'Сортировка', 'Sort'),
      it('P34.4', 'Поиск', 'Search'),
      it('P34.5', 'Все', 'All'),
      it('P34.6', 'Фильмы', 'Movies'),
      it('P34.7', 'Сериалы', 'Series'),
      it('P34.8', 'Фильтры', 'Filters'),
    ],
  },
];

export const PHONE_DIALOGS: ExtraDialog[] = [
  {
    code: 'PD01',
    id: 'p-language',
    ru: 'Язык',
    en: 'Language',
    items: [
      it('PD01.1', 'Как в системе', 'Follow the system'),
      it('PD01.2', 'Русский', 'Russian'),
      it('PD01.3', 'English', 'English'),
    ],
  },
  { code: 'PD02', id: 'p-series-menu', ru: 'Меню сериала', en: 'Series menu', items: [] },
  { code: 'PD03', id: 'p-sub-sources', ru: 'Источники подписки', en: 'Subscription sources', items: [] },
  { code: 'PD04', id: 'p-sub', ru: 'Подписка', en: 'Subscription', items: [] },
  { code: 'PD05', id: 'p-subs-limit', ru: 'Лимит подписок', en: 'Subscription limit', items: [] },
  { code: 'PD06', id: 'p-torrent-menu', ru: 'Меню раздачи', en: 'Release menu', items: [] },
  { code: 'PD07', id: 'p-torrent-rename', ru: 'Переименовать', en: 'Rename', items: [] },
  { code: 'PD08', id: 'p-touchpad', ru: 'Тачпад', en: 'Touchpad', items: [] },
  { code: 'PD09', id: 'p-tracker-login', ru: 'Вход на сайт', en: 'Site sign-in', items: [] },
  { code: 'PD10', id: 'p-tracks', ru: 'Дорожки', en: 'Tracks', items: [] },
  { code: 'PD11', id: 'p-update', ru: 'Обновление', en: 'Update', items: [] },
  { code: 'PD12', id: 'p-whats-new', ru: 'Что нового', en: "What's new", items: [] },
  { code: 'PD13', id: 'p-add-indexer', ru: 'Индексатор', en: 'Indexer', items: [] },
  { code: 'PD14', id: 'p-torrent-where', ru: 'Где смотреть', en: 'Where to watch', items: [] },
  { code: 'PD15', id: 'p-marks', ru: 'Заставка и титры', en: 'Intro and credits', items: [] },
  { code: 'PD16', id: 'p-discover-sort', ru: 'Сортировка обзора', en: 'Browse sort', items: [] },
  { code: 'PD17', id: 'p-discover-filters', ru: 'Фильтры обзора', en: 'Browse filters', items: [] },
  { code: 'PD18', id: 'p-poster', ru: 'Постер', en: 'Poster', items: [] },
  { code: 'PD19', id: 'p-want', ru: 'Хочу посмотреть', en: 'Want to watch', items: [] },
  { code: 'PD20', id: 'p-better-replace', ru: 'Заменить на лучшее', en: 'Replace with better', items: [] },
  { code: 'PD21', id: 'p-better', ru: 'В лучшем качестве', en: 'Better quality', items: [] },
  { code: 'PD22', id: 'p-box-code', ru: 'Код приставки', en: 'Box code', items: [] },
  { code: 'PD23', id: 'p-cert', ru: 'Сертификат изменился', en: 'Certificate changed', items: [] },
  { code: 'PD24', id: 'p-code', ru: 'Код', en: 'Code', items: [] },
  { code: 'PD25', id: 'p-donate', ru: 'Поддержать', en: 'Support', items: [] },
  { code: 'PD26', id: 'p-filters', ru: 'Фильтры', en: 'Filters', items: [] },
  { code: 'PD27', id: 'p-local-update', ru: 'Обновление TorrServer', en: 'TorrServer update', items: [] },
  { code: 'PD28', id: 'p-rename', ru: 'Переименовать', en: 'Rename', items: [] },
  { code: 'PD29', id: 'p-replace-other', ru: 'Другая замена', en: 'Another replacement', items: [] },
  { code: 'PD30', id: 'p-replace', ru: 'Замена', en: 'Replacement', items: [] },
  { code: 'PD31', id: 'p-result-more', ru: 'Подробнее', en: 'Details', items: [] },
  { code: 'PD32', id: 'p-resume', ru: 'Продолжить', en: 'Resume', items: [] },
  { code: 'PD33', id: 'p-add-sources', ru: 'Источники поиска', en: 'Search sources', items: [] },
  { code: 'PD34', id: 'p-add-sort', ru: 'Сортировка поиска', en: 'Search sort', items: [] },
  { code: 'PD35', id: 'p-install-sheet', ru: 'Установка', en: 'Installation', items: [] },
  { code: 'PD36', id: 'p-monitor-hours', ru: 'Как часто', en: 'How often', items: [] },
  { code: 'PD37', id: 'p-remote-switch', ru: 'Сменить телевизор', en: 'Switch TV', items: [] },
  { code: 'PD38', id: 'p-server-choice', ru: 'Параметр сервера', en: 'Server option', items: [] },
  { code: 'PD39', id: 'p-tmdb', ru: 'Ключ TMDB', en: 'TMDB key', items: [] },
  { code: 'PD40', id: 'p-clear-key', ru: 'Очистить ключ', en: 'Clear the key', items: [] },
  { code: 'PD41', id: 'p-reset-server', ru: 'Сбросить сервер', en: 'Reset the server', items: [] },
  { code: 'PD42', id: 'p-old-tv', ru: 'Старая версия на телевизоре', en: 'Old version on the TV', items: [] },
  { code: 'PD43', id: 'p-onboarding', ru: 'Знакомство', en: 'Tour', items: [] },
  { code: 'PD44', id: 'p-setup', ru: 'Первый запуск', en: 'First run', items: [] },
  confirm('PD45', 'p-confirm-lib-delete', 'Удалить выбранное', 'Delete selected', 'Удалить', 'Delete'),
  confirm('PD46', 'p-confirm-series-delete', 'Удалить сериал', 'Delete the series', 'Удалить', 'Delete'),
  confirm('PD47', 'p-confirm-sub-delete', 'Удалить подписку', 'Delete the subscription', 'Удалить', 'Delete'),
  confirm('PD48', 'p-confirm-torrent-menu-delete', 'Удалить раздачу', 'Delete the release', 'Удалить', 'Delete'),
  confirm('PD49', 'p-confirm-torrent-delete', 'Удалить раздачу', 'Delete the release', 'Удалить', 'Delete'),
  confirm('PD50', 'p-confirm-log', 'Очистить журнал', 'Clear the log', 'Очистить', 'Clear'),
  confirm('PD51', 'p-confirm-power', 'Выключить телевизор', 'Turn the TV off', 'Выключить', 'Turn off'),
  confirm('PD52', 'p-confirm-keep', 'Оставить одну раздачу', 'Keep one release', 'Оставить', 'Keep'),
  {
    code: 'PD53',
    id: 'native-cf-phone',
    ru: 'Проверка Cloudflare',
    en: 'Cloudflare check',
    items: [
      it('PD53.1', 'Проверить ещё раз', 'Check again'),
      it('PD53.2', 'Отмена', 'Cancel'),
    ],
  },
];

/** Native Android TV player (PlayerActivity). The shared web UI on the box stays on S / D. */
export const NATIVE_SCREENS: ExtraScreen[] = [
  {
    key: 'native:player',
    code: 'A01',
    ru: 'Нативный плеер',
    en: 'Native player',
    items: [
      it('A01.1', 'Пауза', 'Pause'),
      it('A01.2', 'Аудио', 'Audio'),
      it('A01.3', 'Субтитры', 'Subtitles'),
      it('A01.4', 'Следующий', 'Next'),
      it('A01.5', 'Пропустить заставку', 'Skip the intro'),
      it('A01.6', 'Следующая серия', 'Next episode'),
      it('A01.7', 'Основное действие ошибки', 'Error primary action'),
      it('A01.8', 'Повторить', 'Retry'),
      it('A01.9', 'Назад', 'Back'),
      it('A01.10', 'Вернуть пропуск', 'Undo skip'),
      it('A01.11', 'Поддержать', 'Support'),
      it('A01.12', 'Инфо', 'Info'),
    ],
  },
];

export const NATIVE_DIALOGS: ExtraDialog[] = [
  {
    code: 'AD01',
    id: 'native-menu',
    ru: 'Меню плеера',
    en: 'Player menu',
    items: [
      it('AD01.1', 'Плеер', 'Player'),
      it('AD01.2', 'Аудио', 'Audio'),
      it('AD01.3', 'Субтитры', 'Subtitles'),
      it('AD01.4', 'Ночной звук', 'Night sound'),
      it('AD01.5', 'Инфо', 'Info'),
      it('AD01.6', 'Главы', 'Chapters'),
      it('AD01.7', 'Начало заставки', 'Intro start'),
      it('AD01.8', 'Конец заставки', 'Intro end'),
      it('AD01.9', 'Титры', 'Credits'),
    ],
  },
  { code: 'AD02', id: 'native-audio', ru: 'Аудио', en: 'Audio', items: [] },
  { code: 'AD03', id: 'native-subs', ru: 'Субтитры', en: 'Subtitles', items: [] },
  { code: 'AD04', id: 'native-chapters', ru: 'Главы', en: 'Chapters', items: [] },
  {
    code: 'AD05',
    id: 'native-vlc',
    ru: 'VLC не справляется',
    en: 'VLC is stuck',
    items: [
      it('AD05.1', 'Вернуться к встроенному', 'Back to the built-in player'),
      it('AD05.2', 'Ждать', 'Wait'),
    ],
  },
  {
    code: 'AD06',
    id: 'native-cf',
    ru: 'Проверка Cloudflare',
    en: 'Cloudflare check',
    items: [
      it('AD06.1', 'Пройти на телефоне', 'Pass it on the phone'),
      it('AD06.2', 'Отметить пультом', 'Mark it with the remote'),
      it('AD06.3', 'Проверить ещё раз', 'Check again'),
      it('AD06.4', 'Отмена', 'Cancel'),
    ],
  },
];
