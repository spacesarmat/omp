// Pairing page (/pair?v=1&url=...). No tracking. The password stays in the link, not in the page text.
(function (root) {
  var ORIGIN = 'https://omp-player.online';
  var PKG = 'com.spacesarmat.omp';
  var RELEASES = 'https://github.com/spacesarmat/omp/releases/latest';

  var COPY = {
    ru: {
      kicker: 'Телевизор',
      title: 'Подключить телевизор',
      lead: 'Ссылка с телевизора откроет OMP и подключит сервер. Если приложения ещё нет, скачайте его: адрес уже подставлен.',
      badTitle: 'Ссылка не распознана',
      badLead: 'В ссылке нет адреса сервера. Скачайте OMP или откройте код на телевизоре ещё раз.',
      url: 'Адрес сервера',
      user: 'Логин',
      pass: 'Пароль',
      open: 'Открыть в OMP',
      download: 'Скачать для Android',
      home: 'На главную',
      lang: 'EN',
    },
    en: {
      kicker: 'TV',
      title: 'Connect the TV',
      lead: 'The link from the TV opens OMP and connects the server. If you do not have the app yet, download it: the address is already filled in.',
      badTitle: 'Link not recognized',
      badLead: 'This link has no server address. Download OMP or open the code on the TV again.',
      url: 'Server address',
      user: 'Login',
      pass: 'Password',
      open: 'Open in OMP',
      download: 'Download for Android',
      home: 'Home',
      lang: 'RU',
    },
  };

  function parseSearch(search) {
    var q = String(search || '');
    if (q.charAt(0) === '?') q = q.slice(1);
    var out = { v: '', url: '', name: '', user: '', password: '' };
    q.split('&').forEach(function (part) {
      var eq = part.indexOf('=');
      if (eq < 0) return;
      var k = part.slice(0, eq);
      var v = '';
      try {
        v = decodeURIComponent(part.slice(eq + 1).replace(/\+/g, ' '));
      } catch (e) {
        v = '';
      }
      if (Object.prototype.hasOwnProperty.call(out, k)) out[k] = v;
    });
    if (out.v !== '1' || !out.url) return null;
    return out;
  }

  function pageUrl(data) {
    var s = ORIGIN + '/pair?v=1&url=' + encodeURIComponent(data.url);
    if (data.name) s += '&name=' + encodeURIComponent(data.name);
    if (data.user) s += '&user=' + encodeURIComponent(data.user);
    if (data.password) s += '&password=' + encodeURIComponent(data.password);
    return s;
  }

  function intentUrl(data) {
    var url = pageUrl(data);
    var path = url.slice(ORIGIN.length);
    return 'intent://omp-player.online' + path + '#Intent;scheme=https;package=' + PKG + ';S.browser_fallback_url=' + encodeURIComponent(url) + ';end';
  }

  function setText(node, text) {
    if (node) node.textContent = text;
  }

  function fill(doc, search, lang) {
    var copy = COPY[lang] || COPY.ru;
    var data = parseSearch(search);
    setText(doc.getElementById('pair-download'), copy.download);
    setText(doc.getElementById('pair-home'), copy.home);
    setText(doc.getElementById('pair-lang'), copy.lang);
    var download = doc.getElementById('pair-download');
    if (download) download.setAttribute('href', RELEASES);
    var open = doc.getElementById('pair-open');
    var urlInput = doc.getElementById('pair-url');
    var userLabel = doc.getElementById('pair-user-label');
    var passLabel = doc.getElementById('pair-pass-label');
    var userInput = doc.getElementById('pair-user');
    var passInput = doc.getElementById('pair-pass');
    if (!data) {
      setText(doc.getElementById('pair-kicker'), 'OMP');
      setText(doc.getElementById('pair-heading'), copy.badTitle);
      setText(doc.getElementById('pair-line'), copy.badLead);
      if (open) open.hidden = true;
      if (urlInput) urlInput.value = '';
      if (doc.title !== undefined) doc.title = copy.badTitle + ' - OMP';
      return null;
    }
    setText(doc.getElementById('pair-kicker'), copy.kicker);
    setText(doc.getElementById('pair-heading'), data.name || copy.title);
    setText(doc.getElementById('pair-line'), copy.lead);
    setText(doc.getElementById('pair-url-label'), copy.url);
    if (urlInput) urlInput.value = data.url;
    if (userLabel) userLabel.hidden = !data.user;
    if (userInput) userInput.value = data.user || '';
    setText(userLabel && userLabel.firstChild, copy.user);
    if (passLabel) passLabel.hidden = !data.password;
    if (passInput) {
      passInput.value = data.password || '';
      passInput.type = 'password';
    }
    if (open) {
      open.hidden = false;
      open.textContent = copy.open;
      open.setAttribute('href', intentUrl(data));
    }
    if (doc.title !== undefined) doc.title = (data.name || copy.title) + ' - OMP';
    return data;
  }

  root.ompPairPage = { parseSearch: parseSearch, pageUrl: pageUrl, intentUrl: intentUrl, fill: fill };

  if (typeof document !== 'undefined' && document.getElementById && document.getElementById('pair-card')) {
    var lang = 'ru';
    var search = typeof location !== 'undefined' ? location.search : '';
    fill(document, search, lang);
    var btn = document.getElementById('pair-lang');
    if (btn) {
      btn.addEventListener('click', function () {
        lang = lang === 'ru' ? 'en' : 'ru';
        fill(document, search, lang);
      });
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
