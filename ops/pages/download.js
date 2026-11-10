const FEEDS = [
  { url: '/omp/update-android.json', kind: 'stable-android', channel: 'stable' },
  { url: '/omp/update.json', kind: 'stable-webos', channel: 'stable' },
  { url: '/omp/update-android-beta.json', kind: 'beta-android', channel: 'beta' },
  { url: '/omp/update-beta.json', kind: 'beta-webos', channel: 'beta' },
  { url: '/omp/update-windows.json', kind: 'beta-windows', channel: 'beta', versionKey: 'beta-windows' },
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

function applyFeed(root, kind, versionKey, feed) {
  if (!feed || typeof feed !== 'object') return;
  if (typeof feed.version === 'string' && feed.version) {
    setText(root, `[data-version="${versionKey}"]`, feed.version, false);
    if (kind !== versionKey) setText(root, `[data-version="${kind}"]`, feed.version, false);
  }
  const fileUrl = typeof feed.url === 'string' && feed.url ? feed.url : (typeof feed.ipkUrl === 'string' ? feed.ipkUrl : '');
  if (fileUrl) {
    root.querySelectorAll(`[data-download="${kind}"]:not([data-abi])`).forEach((link) => {
      link.href = fileUrl;
    });
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

export async function updateDownloads(root, fetchImpl) {
  highlightPlatform(root, typeof navigator !== 'undefined' ? navigator.userAgent : '');
  bindHashButtons(root);
  const dates = new Map();
  await Promise.all(FEEDS.map(async ({ url, kind, channel, versionKey }) => {
    try {
      const response = await fetchImpl(url);
      if (!response || !response.ok) return;
      const feed = await response.json();
      applyFeed(root, kind, versionKey || channel, feed);
      await fillDate(root, kind, feed && feed.releaseUrl, fetchImpl, dates);
    } catch {
      // The release-page fallback remains available when a feed cannot be loaded.
    }
  }));
}

if (typeof document !== 'undefined' && document.querySelector('script[type="module"][src$="download.js"]')) {
  void updateDownloads(document, fetch);
}
