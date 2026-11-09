const FEEDS = [
  { url: '/omp/update-android.json', kind: 'stable-android', channel: 'stable' },
  { url: '/omp/update.json', kind: 'stable-webos', channel: 'stable' },
  { url: '/omp/update-android-beta.json', kind: 'beta-android', channel: 'beta' },
  { url: '/omp/update-beta.json', kind: 'beta-webos', channel: 'beta' },
  { url: '/omp/update-windows.json', kind: 'beta-windows', channel: 'beta' },
];

function applyFeed(root, kind, channel, feed) {
  if (!feed || typeof feed !== 'object') return;
  if (typeof feed.version === 'string' && feed.version) {
    const label = root.querySelector(`[data-version="${channel}"]`);
    if (label) label.textContent = feed.version;
  }
  if (typeof feed.ipkUrl === 'string' && feed.ipkUrl) {
    const link = root.querySelector(`[data-download="${kind}"]:not([data-abi])`);
    if (link) link.href = feed.ipkUrl;
  }
  if (typeof feed.url === 'string' && feed.url) {
    const link = root.querySelector(`[data-download="${kind}"]:not([data-abi])`);
    if (link) link.href = feed.url;
  }
  for (const abi of ['arm64', 'armv7']) {
    const url = feed.apks && feed.apks[abi] && feed.apks[abi].url;
    if (typeof url !== 'string' || !url) continue;
    const link = root.querySelector(`[data-download="${kind}"][data-abi="${abi}"]`);
    if (link) link.href = url;
  }
}

export async function updateDownloads(root, fetchImpl) {
  await Promise.all(FEEDS.map(async ({ url, kind, channel }) => {
    try {
      const response = await fetchImpl(url);
      if (!response.ok) return;
      applyFeed(root, kind, channel, await response.json());
    } catch {
      // The release-page fallback remains available when a feed cannot be loaded.
    }
  }));
}

if (typeof document !== 'undefined' && document.querySelector('script[type="module"][src$="download.js"]')) {
  void updateDownloads(document, fetch);
}
