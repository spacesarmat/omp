// Invite page /r/<code>. The code stays in the address. No tracking.
(function () {
  var CODE = /^OMP-[A-Z0-9]+$/;
  var COPY = {
    ru: {
      title: 'Приглашение в OMP',
      heading: 'Вас пригласили в OMP',
      line: 'Промокод на этой странице вводится в приложении, в разделе аккаунта. Если OMP ещё не установлен, сначала скачайте его.',
      badHeading: 'Приглашение не распознано',
      badLine: 'В ссылке нет промокода. Попросите новую ссылку или скачайте OMP.',
      code: 'Промокод {code}',
      download: 'Скачать для Android',
      platforms: 'Все платформы',
      home: 'На главную',
      lang: 'EN',
    },
    en: {
      title: 'Invitation to OMP',
      heading: 'You are invited to OMP',
      line: 'Enter the code from this page in the app, on the account screen. Download OMP first if it is not installed yet.',
      badHeading: 'Invitation not recognized',
      badLine: 'This link has no code. Ask for a new link or download OMP.',
      code: 'Code {code}',
      download: 'Download for Android',
      platforms: 'All platforms',
      home: 'Home',
      lang: 'RU',
    },
  };

  function codeFrom(path) {
    var parts = String(path || '').split('/').filter(Boolean);
    if (parts[0] !== 'r' || !parts[1]) return '';
    var raw = parts[1];
    try {
      raw = decodeURIComponent(raw);
    } catch (e) {
      raw = parts[1];
    }
    return CODE.test(raw) ? raw : '';
  }

  function text(id, value) {
    var node = document.getElementById(id);
    if (node) node.textContent = value;
  }

  function paint(lang, code) {
    var copy = COPY[lang] || COPY.ru;
    document.documentElement.lang = lang === 'en' ? 'en' : 'ru';
    document.title = copy.title;
    text('ref-heading', code ? copy.heading : copy.badHeading);
    text('ref-line', code ? copy.line : copy.badLine);
    text('ref-code', code ? copy.code.replace('{code}', code) : '');
    text('ref-download', copy.download);
    text('ref-platforms', copy.platforms);
    text('ref-home', copy.home);
    text('ref-lang', copy.lang);
  }

  var code = codeFrom(location.pathname);
  var lang = 'ru';
  paint(lang, code);
  var button = document.getElementById('ref-lang');
  if (button) {
    button.addEventListener('click', function () {
      lang = lang === 'ru' ? 'en' : 'ru';
      paint(lang, code);
    });
  }
})();
