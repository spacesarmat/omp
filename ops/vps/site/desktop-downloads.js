// Desktop buttons start at the v0.30.0 files. The desktop workflow already
// republishes these feeds on gh-pages, so the next stable build updates the
// hrefs without editing this site.
const FEEDS = [
  { url: 'https://spacesarmat.github.io/omp/update-windows.json', kind: 'desktop-windows' },
  { url: 'https://spacesarmat.github.io/omp/update-macos.json', kind: 'desktop-macos' },
  { url: 'https://spacesarmat.github.io/omp/update-linux.json', kind: 'desktop-linux' },
];

const RELEASE_FILE = /^https:\/\/github\.com\/spacesarmat\/omp\/releases\/download\/[A-Za-z0-9._~-]+\/OMP-[A-Za-z0-9._~-]+$/;

function releaseFile(value) {
  return typeof value === 'string' && RELEASE_FILE.test(value) ? value : '';
}

function applyOne(root, kind, feed) {
  if (!feed || typeof feed !== 'object') return;
  const fileUrl = releaseFile(feed.url);
  if (fileUrl) {
    root.querySelectorAll(`[data-download="${kind}"]:not([data-asset])`).forEach((link) => {
      link.href = fileUrl;
    });
  }
  const assets = feed.assets && typeof feed.assets === 'object' ? feed.assets : null;
  if (!assets) return;
  root.querySelectorAll(`[data-download="${kind}"][data-asset]`).forEach((link) => {
    const key = link.getAttribute('data-asset');
    const entry = key ? assets[key] : null;
    const assetUrl = releaseFile(entry && entry.url);
    if (!assetUrl) return;
    link.href = assetUrl;
  });
}

export async function applyDesktopFeeds(root, fetchImpl) {
  await Promise.all(FEEDS.map(async ({ url, kind }) => {
    try {
      const response = await fetchImpl(url);
      if (!response || !response.ok) return;
      const feed = await response.json();
      // The same feeds also carry desktop betas. A beta version must not replace the stable buttons.
      if (!feed || typeof feed.version !== 'string' || /-beta/.test(feed.version)) return;
      applyOne(root, kind, feed);
    } catch {
      // The v0.30.0 href stays in the page when a feed cannot be loaded.
    }
  }));
}

if (typeof document !== 'undefined' && document.querySelector('script[type="module"][src*="desktop-downloads.js"]')) {
  void applyDesktopFeeds(document, fetch);
}
