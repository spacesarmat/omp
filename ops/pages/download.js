const DESKTOP = ['windows', 'macos', 'linux'];

const FEEDS = [
  { url: '/omp/update-android.json', kind: 'stable-android', versionKey: 'stable' },
  { url: '/omp/update.json', kind: 'stable-webos', versionKey: 'stable' },
  { url: '/omp/update-android-beta.json', kind: 'beta-android', versionKey: 'beta' },
  { url: '/omp/update-beta.json', kind: 'beta-webos', versionKey: 'beta' },
  { url: '/omp/update-windows.json', kind: 'stable-windows', versionKey: 'stable-windows' },
  { url: '/omp/update-windows.json', kind: 'beta-windows', versionKey: 'beta-windows' },
  { url: '/omp/update-macos.json', kind: 'stable-macos', versionKey: 'stable-macos' },
  { url: '/omp/update-macos.json', kind: 'beta-macos', versionKey: 'beta-macos' },
  { url: '/omp/update-linux.json', kind: 'stable-linux', versionKey: 'stable-linux' },
  { url: '/omp/update-linux.json', kind: 'beta-linux', versionKey: 'beta-linux' },
];

const RELEASE_API = 'https://api.github.com/repos/spacesarmat/omp/releases/tags/';

function hashOf(feed) {
  if (!feed || typeof feed !== 'object') return '';
  if (typeof feed.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(feed.sha256)) return feed.sha256;
  if (typeof feed.ipkHash === 'string' && /^[0-9a-f]{64}$/i.test(feed.ipkHash)) return feed.ipkHash;
  if (feed.ipkHash && typeof feed.ipkHash.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(feed.ipkHash.sha256)) return feed.ipkHash.sha256;
  return '';
}

function sizeOf(feed) {
  if (!feed || typeof feed !== 'object') return null;
  if (typeof feed.ipkSize === 'number') return feed.ipkSize;
  if (typeof feed.size === 'number') return feed.size;
  return null;
}

export function formatSize(size) {
  if (typeof size !== 'number' || !isFinite(size) || size < 0) return '';
  const kb = 1024;
  const mb = kb * 1024;
  if (size < kb) return Math.round(size) + ' B';
  if (size < mb) return (size / kb).toFixed(size < 10 * kb ? 1 : 0) + ' KB';
  return (size / mb).toFixed(1) + ' MB';
}

function pageLang(root) {
  const doc = root.documentElement ? root : root.ownerDocument;
  const lang = doc && doc.documentElement && doc.documentElement.lang;
  return lang === 'en' ? 'en' : 'ru';
}

export function formatReleaseDate(iso, lang) {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return '';
  const formatted = date.toLocaleDateString(lang === 'en' ? 'en-GB' : 'ru-RU', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  return formatted.replace(/[\u2012\u2013\u2014]/g, '-');
}

function tagFrom(releaseUrl) {
  if (typeof releaseUrl !== 'string') return '';
  const match = /\/releases\/tag\/([^/?#]+)$/.exec(releaseUrl);
  return match ? decodeURIComponent(match[1]) : '';
}

function setText(root, selector, text, reveal) {
  if (!text) return;
  root.querySelectorAll(selector).forEach((el) => {
    el.textContent = text;
    if (reveal) el.hidden = false;
  });
}

// Desktop feeds are shared between channels, so a version decides which pane may use it.
function feedPasses(kind, feed) {
  const version = feed && typeof feed.version === 'string' ? feed.version : '';
  if (!DESKTOP.some((platform) => kind.endsWith('-' + platform))) return true;
  if (kind.startsWith('beta-')) return /-beta/i.test(version);
  return Boolean(version) && !/-beta/i.test(version);
}

function applyFeed(root, kind, versionKey, feed) {
  if (!feed || typeof feed !== 'object') return;
  if (typeof feed.version === 'string' && feed.version) {
    setText(root, `[data-version="${versionKey}"]`, feed.version, false);
    if (kind !== versionKey) setText(root, `[data-version="${kind}"]`, feed.version, false);
  }
  const fileUrl = typeof feed.url === 'string' && feed.url ? feed.url : (typeof feed.ipkUrl === 'string' ? feed.ipkUrl : '');
  if (fileUrl) {
    root.querySelectorAll(`[data-download="${kind}"]:not([data-abi]):not([data-asset])`).forEach((link) => {
      link.href = fileUrl;
    });
    if (kind.startsWith('beta-')) {
      root.querySelectorAll(`[data-download="${kind}"][data-direct]`).forEach((link) => {
        link.hidden = false;
        const pane = link.closest('.beta');
        const note = pane && pane.querySelector('.beta-empty');
        if (note) note.hidden = true;
      });
      root.querySelectorAll(`[data-version="${kind}"]`).forEach((el) => {
        el.hidden = false;
      });
    }
  }
  const assets = feed.assets && typeof feed.assets === 'object' ? feed.assets : null;
  if (assets) {
    root.querySelectorAll(`[data-download="${kind}"][data-asset]`).forEach((link) => {
      const key = link.getAttribute('data-asset');
      const entry = key ? assets[key] : null;
      if (!entry || typeof entry.url !== 'string' || !entry.url) return;
      link.href = entry.url;
      link.hidden = false;
    });
  }
  const tile = root.querySelector(`[data-optional="${kind}"]`);
  if (tile) {
    const extra = assets ? Object.keys(assets).some((key) => assets[key] && typeof assets[key].url === 'string' && assets[key].url) : false;
    tile.hidden = !fileUrl && !extra;
  }
  for (const abi of ['arm64', 'armv7']) {
    const url = feed.apks && feed.apks[abi] && feed.apks[abi].url;
    if (typeof url !== 'string' || !url) continue;
    root.querySelectorAll(`[data-download="${kind}"][data-abi="${abi}"]`).forEach((link) => {
      link.href = url;
    });
  }
  const hash = hashOf(feed);
  if (hash) {
    const short = 'sha256 ' + hash.slice(0, 12);
    root.querySelectorAll(`[data-sha-for="${kind}"]`).forEach((el) => {
      el.hidden = false;
      el.setAttribute('data-sha', hash);
      el.textContent = short;
      el.setAttribute('data-label-idle', short);
    });
  }
  const size = formatSize(sizeOf(feed));
  if (size) setText(root, `[data-size="${kind}"]`, size, true);
}

async function publishedAt(tag, fetchImpl, cache) {
  if (cache.has(tag)) return cache.get(tag);
  const pending = (async () => {
    try {
      const response = await fetchImpl(RELEASE_API + encodeURIComponent(tag));
      if (!response || !response.ok) return '';
      const body = await response.json();
      return body && typeof body.published_at === 'string' ? body.published_at : '';
    } catch {
      return '';
    }
  })();
  cache.set(tag, pending);
  return pending;
}

async function fillDate(root, kind, releaseUrl, fetchImpl, cache) {
  const tag = tagFrom(releaseUrl);
  if (!tag) return;
  const iso = await publishedAt(tag, fetchImpl, cache);
  const text = formatReleaseDate(iso, pageLang(root));
  if (text) setText(root, `[data-date="${kind}"]`, text, true);
}

export function detectPlatform(ua) {
  const agent = String(ua || '');
  if (/web0s|webos/i.test(agent)) return 'webos';
  if (/android/i.test(agent) && /android tv|\btv\b|aft[a-z]|bravia|googletv|mitv|mibox/i.test(agent)) return 'android-tv';
  if (/android/i.test(agent)) return 'android';
  if (/windows nt/i.test(agent)) return 'windows';
  if (/mac os x|macintosh/i.test(agent)) return 'macos';
  if (/linux|cros|x11/i.test(agent)) return 'linux';
  return '';
}

export function highlightPlatform(root, ua) {
  const id = detectPlatform(ua);
  if (!id) return '';
  const tile = root.querySelector(`[data-platform="${id}"]`);
  if (!tile) return id;
  if (tile.parentNode) tile.parentNode.prepend(tile);
  tile.classList.add('is-yours');
  const mark = tile.querySelector('.you');
  if (mark) mark.hidden = false;
  return id;
}

function bindHashButtons(root) {
  root.querySelectorAll('[data-sha-for]').forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => {
      const value = btn.getAttribute('data-sha') || '';
      if (!value) return;
      const copied = btn.getAttribute('data-label-copied') || 'Copied';
      const idle = btn.getAttribute('data-label-idle') || btn.textContent;
      const done = (ok) => {
        btn.textContent = ok ? copied : value;
        if (ok) setTimeout(() => { btn.textContent = idle; }, 1600);
      };
      const clipboard = typeof navigator !== 'undefined' && navigator.clipboard;
      if (!clipboard || !clipboard.writeText) {
        done(false);
        return;
      }
      clipboard.writeText(value).then(() => done(true), () => done(false));
    });
  });
}

export function setChannel(root, channel) {
  const next = channel === 'beta' ? 'beta' : 'stable';
  root.documentElement.setAttribute('data-channel', next);
  root.querySelectorAll('[data-channel]').forEach((button) => {
    button.classList.toggle('selected', button.getAttribute('data-channel') === next);
  });
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem('omp-channel', next);
  } catch {
    // Private mode or blocked storage: the choice stays for this page view only.
  }
}

export function initUi(root) {
  const stored = (() => {
    try {
      return typeof localStorage !== 'undefined' ? localStorage.getItem('omp-channel') : '';
    } catch {
      return '';
    }
  })();
  setChannel(root, stored === 'beta' ? 'beta' : 'stable');

  root.querySelectorAll('[data-channel]').forEach((button) => {
    if (button.dataset.uiBound) return;
    button.dataset.uiBound = '1';
    button.addEventListener('click', () => setChannel(root, button.getAttribute('data-channel')));
  });

  const toggle = root.querySelector('.menu-toggle');
  const header = root.querySelector('.site-header');
  if (toggle && header && !toggle.dataset.uiBound) {
    toggle.dataset.uiBound = '1';
    toggle.addEventListener('click', () => {
      const open = header.classList.toggle('menu-open');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open
        ? (pageLang(root) === 'en' ? 'Close menu' : 'Закрыть меню')
        : (pageLang(root) === 'en' ? 'Open menu' : 'Открыть меню'));
    });
  }

  const dialog = root.querySelector('#helper-dialog');
  if (dialog && !dialog.dataset.uiBound) {
    dialog.dataset.uiBound = '1';
    const opener = root.querySelector('#open-helper');
    if (opener) opener.addEventListener('click', () => dialog.showModal());
    const close = dialog.querySelector('.dialog-close');
    if (close) close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
    const result = dialog.querySelector('#helper-result');
    dialog.querySelectorAll('[data-choice]').forEach((button) => {
      button.addEventListener('click', () => {
        const tile = root.querySelector(`[data-platform="${button.getAttribute('data-choice')}"]`);
        if (!tile) return;
        dialog.close();
        tile.classList.add('is-recommended');
        tile.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => tile.classList.remove('is-recommended'), 2400);
        if (result) result.textContent = pageLang(root) === 'en'
          ? `Recommended build: ${button.textContent.trim()}. The card is highlighted on the page.`
          : `Подходит сборка: ${button.textContent.trim()}. Карточка выделена на странице.`;
      });
    });
  }
}

export async function updateDownloads(root, fetchImpl) {
  highlightPlatform(root, typeof navigator !== 'undefined' ? navigator.userAgent : '');
  bindHashButtons(root);
  const dates = new Map();
  const byUrl = new Map();
  for (const feed of FEEDS) {
    const group = byUrl.get(feed.url) || [];
    group.push(feed);
    byUrl.set(feed.url, group);
  }
  await Promise.all([...byUrl.entries()].map(async ([url, entries]) => {
    try {
      const response = await fetchImpl(url);
      if (!response || !response.ok) return;
      const feed = await response.json();
      for (const { kind, versionKey } of entries) {
        if (!feedPasses(kind, feed)) continue;
        applyFeed(root, kind, versionKey, feed);
        await fillDate(root, kind, feed && feed.releaseUrl, fetchImpl, dates);
      }
    } catch {
      // The release-page fallback remains available when a feed cannot be loaded.
    }
  }));
}

if (typeof document !== 'undefined' && document.querySelector('script[type="module"][src$="download.js"]')) {
  initUi(document);
  void updateDownloads(document, fetch);
}
