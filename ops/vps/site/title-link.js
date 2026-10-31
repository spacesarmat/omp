// Title link page (/t/movie/ID, /t/tv/ID, /t/tv/ID/s/N). No tracking, no magnets.
(function (root) {
  var ORIGIN = 'https://omp-player.online';
  var PKG = 'com.spacesarmat.omp';
  var RELEASES = 'https://github.com/spacesarmat/omp/releases/latest';

  var COPY = {
    ru: {
      film: 'Фильм',
      series: 'Сериал',
      season: 'Сезон {n}',
      lead: 'Карточка откроется в OMP. Если приложения ещё нет, скачайте его.',
      badTitle: 'Ссылка не распознана',
      badLead: 'Такой карточки в ссылке нет. Скачайте OMP или вернитесь на главную.',
      open: 'Открыть в OMP',
      download: 'Скачать для Android',
      platforms: 'Все платформы',
      home: 'На главную',
      lang: 'EN',
    },
    en: {
      film: 'Film',
      series: 'Series',
      season: 'Season {n}',
      lead: 'The card opens in OMP. If you do not have the app yet, download it.',
      badTitle: 'Link not recognized',
      badLead: 'This link does not point at a card. Download OMP or go back home.',
      open: 'Open in OMP',
      download: 'Download for Android',
      platforms: 'All platforms',
      home: 'Home',
      lang: 'RU',
    },
  };

  function parsePath(path) {
    var m = /^\/t\/(movie|tv)\/(\d+)(?:\/s\/(\d+))?\/?$/.exec(path || '');
    if (!m) return null;
    var id = +m[2];
    if (!(id > 0) || id > 1000000000) return null;
    var ref = { kind: m[1], id: id, season: null };
    if (m[3] !== undefined) {
      if (ref.kind !== 'tv') return null;
      var season = +m[3];
      if (season < 0 || season > 500) return null;
      ref.season = season;
    }
    return ref;
  }

  function pageUrl(ref) {
    var path = '/t/' + ref.kind + '/' + ref.id;
    if (ref.season !== null) path += '/s/' + ref.season;
    return ORIGIN + path;
  }

  function intentUrl(ref) {
    var url = pageUrl(ref);
    var path = url.slice(ORIGIN.length);
    return 'intent://omp-player.online' + path + '#Intent;scheme=https;package=' + PKG + ';S.browser_fallback_url=' + encodeURIComponent(url) + ';end';
  }

  function fill(doc, path, lang) {
    var copy = COPY[lang] || COPY.ru;
    var ref = parsePath(path);
    var kicker = doc.getElementById('share-kicker');
    var heading = doc.getElementById('share-heading');
    var line = doc.getElementById('share-line');
    var open = doc.getElementById('share-open');
    var download = doc.getElementById('share-download');
    var platforms = doc.getElementById('share-platforms');
    var home = doc.getElementById('share-home');
    var langBtn = doc.getElementById('share-lang');
    if (download) download.textContent = copy.download;
    if (platforms) platforms.textContent = copy.platforms;
    if (home) home.textContent = copy.home;
    if (langBtn) langBtn.textContent = copy.lang;
    if (!ref) {
      if (kicker) kicker.textContent = 'OMP';
      if (heading) heading.textContent = copy.badTitle;
      if (line) line.textContent = copy.badLead;
      if (open) open.hidden = true;
      if (doc.title !== undefined) doc.title = copy.badTitle + ' - OMP';
      return;
    }
    var kindName = ref.kind === 'tv' ? copy.series : copy.film;
    var title = ref.season === null ? kindName : copy.season.replace('{n}', String(ref.season));
    if (kicker) kicker.textContent = kindName;
    if (heading) heading.textContent = title;
    if (line) line.textContent = copy.lead;
    if (open) {
      open.hidden = false;
      open.textContent = copy.open;
      open.setAttribute('href', intentUrl(ref));
    }
    if (doc.title !== undefined) doc.title = title + ' - OMP';
  }

  root.ompTitlePage = { parsePath: parsePath, intentUrl: intentUrl, fill: fill, pageUrl: pageUrl };

  if (typeof document !== 'undefined' && document.getElementById && document.getElementById('share-card')) {
    var lang = 'ru';
    fill(document, location.pathname, lang);
    var btn = document.getElementById('share-lang');
    if (btn) {
      btn.addEventListener('click', function () {
        lang = lang === 'ru' ? 'en' : 'ru';
        fill(document, location.pathname, lang);
      });
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
