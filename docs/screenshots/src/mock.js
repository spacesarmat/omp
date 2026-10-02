// Fictional data and renderers shared by the static mockup pages. No real release names.
var PAL = ['#2B3A55', '#4A2E3A', '#2F4A3A', '#4A3F2A', '#3A2F55', '#2A4A4F'];
var SERIES = 'Сериал', MOVIE = 'Фильм';

var ITEMS = [
  { title: 'Starbound Frontier S02', short: 'Starbound Frontier', size: '18.4 ГБ', badges: ['1080p'], cat: SERIES },
  { title: 'Тихий сигнал', short: 'Тихий сигнал', size: '9.6 ГБ', badges: ['4K', 'HEVC'], cat: MOVIE },
  { title: 'The Last Harbor S01E08', short: 'The Last Harbor', size: '1.9 ГБ', badges: ['1080p'], cat: SERIES },
  { title: 'Северный ветер', short: 'Северный ветер', size: '2.2 ГБ', badges: ['AVC', 'WEBRip'], cat: MOVIE },
  { title: 'Neon Rivers', short: 'Neon Rivers', size: '14.7 ГБ', badges: ['1080p'], cat: SERIES },
  { title: 'Кот и космос S03E05', short: 'Кот и космос', size: '850 МБ', badges: ['720p'], cat: SERIES },
  { title: 'Iron Valley S01E04', short: 'Iron Valley', size: '2.4 ГБ', badges: ['1080p'], cat: SERIES },
  { title: 'Хранители маяка', short: 'Хранители маяка', size: '3.1 ГБ', badges: ['1080p', 'WEBRip'], cat: MOVIE },
  { title: 'Deep Archive S03E10', short: 'Deep Archive', size: '4.0 ГБ', badges: ['4K'], cat: SERIES },
  { title: 'Paper Moons', short: 'Paper Moons', size: '1.3 ГБ', badges: ['1080p'], cat: SERIES },
  { title: 'Пыльная дорога', short: 'Пыльная дорога', size: '6.8 ГБ', badges: ['4K', 'HDR'], cat: MOVIE },
  { title: 'Orbit Station S02E06', short: 'Orbit Station', size: '1.6 ГБ', badges: ['1080p'], cat: SERIES }
];

var HISTORY = [
  ['Starbound Frontier', 'Сезон 2 · Серия 3', '23:14 / 1:00:51', 'осталось 38 мин', 38],
  ['Тихий сигнал', 'Фильм', '1:12:40 / 2:04:10', 'осталось 52 мин', 58],
  ['The Last Harbor', 'Сезон 1 · Серия 8', '05:02 / 44:30', 'осталось 39 мин', 11],
  ['Северный ветер', 'Фильм', '0:28:03 / 2:57:00', 'осталось 2 ч 29 мин', 16],
  ['Neon Rivers', 'Сезон 1 · Серия 6', '41:55 / 52:18', 'осталось 10 мин', 80],
  ['Кот и космос', 'Сезон 3 · Серия 5', '12:30 / 23:40', 'осталось 11 мин', 53],
  ['Iron Valley', 'Сезон 1 · Серия 4', '18:44 / 22:10', 'осталось 3 мин', 85],
  ['Хранители маяка', 'Фильм', '02:10 / 1:47:05', 'осталось 1 ч 45 мин', 5]
];

var SERVERS = [
  { name: 'Дом', url: '192.168.1.10:8090', status: 'онлайн · MatriX.145.1', online: true, current: true, focus: true },
  { name: 'Ноутбук', url: '192.168.1.50:8090', status: 'онлайн · MatriX.140.2', online: true },
  { name: 'Дача', url: '10.0.0.12:8090', status: 'недоступен', online: false }
];

function icon(size, body, sw, color) {
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="' + (color || 'currentColor') + '" stroke-width="' + (sw || 2) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
}
var CLOCK = '<circle cx="12" cy="12" r="8"></circle><path d="M12 8v4l3 2"></path>';
var SEARCH = '<circle cx="11" cy="11" r="6"></circle><path d="M20 20l-4.5-4.5"></path>';
var CHEVRON_UP = '<path d="M6 15l6-6 6 6"></path>';

function grad(i) { return 'background: linear-gradient(160deg, ' + PAL[i % 6] + ', #14161C)'; }

function logoLarge() {
  var holes = '';
  [23, 35, 47, 59, 71].forEach(function (x) {
    [29, 66].forEach(function (y) {
      holes += '<rect x="' + x + '" y="' + y + '" width="6" height="5" rx="1.5" fill="#F5B700"></rect>';
    });
  });
  return '<svg width="132" height="132" viewBox="0 0 100 100" aria-hidden="true"><rect x="14" y="22" width="72" height="56" rx="10" fill="none" stroke="#F5B700" stroke-width="7"></rect>' + holes + '<path d="M44 41 L59 50 L44 59 Z" fill="#E8EAF0" stroke="#E8EAF0" stroke-width="4" stroke-linejoin="round"></path></svg>';
}

function topBar(active, focus, viewLabel) {
  var tabs = ['История', 'Все', 'Фильмы', 'Сериалы', 'Музыка', 'Прочее'].map(function (label) {
    var cls = 'tab' + (label === active ? (focus === 'tab' ? ' focus' : ' active') : '');
    return '<div class="' + cls + '">' + (label === 'История' ? icon(24, '<path d="M4 12a8 8 0 1 0 16 0a8 8 0 1 0 -16 0M12 8v4l3 2"></path>') : '') + label + '</div>';
  }).join('');
  var acts = [
    ['search', 'Поиск', 'M5 11a6 6 0 1 0 12 0a6 6 0 1 0 -12 0M20 20l-4.5-4.5'],
    ['view', 'Вид: ' + viewLabel, 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z'],
    ['sort', 'Сортировка: новые', 'M4 6h16M4 12h11M4 18h6'],
    ['add', 'Добавить', 'M12 5v14M5 12h14'],
    ['playlist', 'Плейлисты', 'M4 6h11M4 12h11M4 18h7M16 15l5 3-5 3z'],
    ['settings', 'Настройки', 'M4 7h10M18 7h2M4 17h4M12 17h8M14 7a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M8 17a2 2 0 1 0 4 0a2 2 0 1 0 -4 0']
  ].map(function (a) {
    var f = a[0] === focus;
    return '<button type="button" class="act' + (f ? ' focus' : '') + '" aria-label="' + a[1] + '">' + icon(28, '<path d="' + a[2] + '"></path>') + (f ? '<span>' + a[1] + '</span>' : '') + '</button>';
  }).join('');
  return '<div class="topbar"><svg width="52" height="52" viewBox="0 0 100 100" aria-hidden="true"><rect x="14" y="22" width="72" height="56" rx="10" fill="none" stroke="#F5B700" stroke-width="8"></rect><path d="M44 39 L61 50 L44 61 Z" fill="#E8EAF0" stroke="#E8EAF0" stroke-width="4" stroke-linejoin="round"></path></svg>' +
    '<span class="topbar-name">OMP</span>' + tabs + '<div class="grow"></div>' + acts + '</div>';
}

function tile(it, i, focused, withBadges) {
  var b = withBadges ? '<div class="badges">' + it.badges.map(function (x) { return '<span class="badge">' + x + '</span>'; }).join('') + '</div>' : '';
  return '<div class="tile"><div class="poster' + (focused ? ' focus' : '') + '" style="' + grad(i) + '"><div class="poster-short">' + it.short + '</div>' + b + '</div>' +
    '<div class="tile-title">' + it.title + '</div><div class="tile-size">' + it.size + '</div></div>';
}

function listRow(it, i, focused) {
  return '<div class="lrow' + (focused ? ' focus' : '') + '"><div class="thumb" style="' + grad(i) + '"></div><div class="lmain"><div class="ltitle">' + it.title + '</div>' +
    '<div class="lbadges">' + it.badges.map(function (x) { return '<span class="lbadge">' + x + '</span>'; }).join('') + '</div></div>' +
    '<div class="lcat">' + it.cat + '</div><div class="lsize">' + it.size + '</div></div>';
}

function historyCard(d, i, focused) {
  return '<div class="hcard' + (focused ? ' focus' : '') + '"><div class="hthumb" style="' + grad(i) + '"></div><div class="hmain"><div class="htitle">' + d[0] + '</div><div class="hep">' + d[1] + '</div>' +
    '<div class="hpos"><span>' + d[2] + '</span><span>' + d[3] + '</span></div><div class="hbar"><div style="width: ' + d[4] + '%"></div></div></div></div>';
}

function serverCard(s) {
  return '<div class="srv' + (s.focus ? ' focus' : '') + '"><span class="dot' + (s.online ? ' on' : '') + '"></span><div class="srv-main"><div class="srv-name-row"><span class="srv-name">' + s.name + '</span>' +
    (s.current ? '<span class="srv-cur">текущий</span>' : '') + '</div><div class="srv-url">' + s.url + ' · ' + s.status + '</div></div>' +
    '<button type="button" class="srv-edit">' + icon(20, '<path d="M4 20h4L19 9l-4-4L4 16z"></path>') + 'Изменить</button></div>';
}

function loginPage() {
  return '<button type="button" class="hist-btn">' + icon(28, CLOCK) + 'История серверов<span class="hist-count">3</span></button>' +
    '<div class="login-col"><div class="brand">' + logoLarge() + '<div><div class="brand-name">OMP</div><div class="brand-sub">Open Movie Player</div></div></div>' +
    '<div class="login-card"><label for="addr">Адрес TorrServer</label><input id="addr" value="192.168.1.10:8090">' +
    '<button type="button" class="link-btn">' + icon(22, '<path d="M6 9l6 6 6-6"></path>') + 'Дополнительно: логин и пароль</button>' +
    '<div class="row"><button type="button" class="btn-primary">Подключиться</button><button type="button" class="btn-sec">' + icon(26, SEARCH) + 'Найти в сети</button></div></div>' +
    '<div class="login-note">Поиск проверяет вашу домашнюю сеть на портах 8090 и 5665.<br>Адрес удобно вводить с клавиатуры телефона в LG ThinQ.</div></div>' +
    '<div class="hint">Стрелки — перемещение · OK — выбрать · Назад — выход</div>';
}

var SCENES = {
  login: function () { return loginPage(); },
  'login-history': function () {
    return '<div class="dim">' + loginPage() + '</div>' +
      '<button type="button" class="hist-btn open">' + icon(28, CLOCK) + 'История серверов' + icon(22, CHEVRON_UP, 2.5) + '</button>' +
      '<div class="servers">' + SERVERS.map(serverCard).join('') + '<div class="servers-hint">OK — подключиться · Назад — закрыть список</div></div>';
  },
  'library-large': function () {
    var items = ITEMS.map(function (it, i) {
      return i === 0 ? Object.assign({}, it, { title: 'Starbound Frontier S02 — Полный сезон, режиссёрская версия' }) : it;
    });
    return topBar('Все', 'none', 'Крупные постеры') + '<div class="grid">' + items.map(function (it, i) { return tile(it, i, i === 0, true); }).join('') + '</div>';
  },
  'library-list': function () {
    return topBar('Все', 'none', 'Список') + '<div class="list">' + ITEMS.slice(0, 9).map(function (it, i) { return listRow(it, i, i === 1); }).join('') + '</div>';
  },
  history: function () {
    return topBar('История', 'none', 'Крупные постеры') + '<div class="hgrid">' + HISTORY.map(function (d, i) { return historyCard(d, i, i === 0); }).join('') + '</div>';
  },
  search: function () {
    var res = [
      { title: 'Starbound Frontier S02', short: 'Starbound Frontier', size: '18.4 ГБ · 1080p' },
      { title: 'Starbound Frontier S01', short: 'Starbound Frontier', size: '17.9 ГБ · 1080p' }
    ];
    return topBar('Все', 'search', 'Крупные постеры') +
      '<div class="sbar"><div class="sbox">' + icon(28, SEARCH, 2, '#9AA1B2') + '<span>star</span><span class="caret"></span></div><div class="scount">Найдено: 2 · ищем по названию и имени файла</div></div>' +
      '<div class="sres">' + res.map(function (it, i) { return tile(it, i === 0 ? 0 : 4, false, false); }).join('') + '</div>' +
      '<div class="hint">Вниз — к результатам · Назад — очистить и закрыть поиск</div>';
  }
};

function renderScene(name) {
  document.getElementById('root').innerHTML = SCENES[name]();
}
