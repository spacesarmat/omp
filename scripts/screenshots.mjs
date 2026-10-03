// Renders README/release images from the static mockups in docs/screenshots/src with headless Chrome.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SCENES = ['login', 'login-history', 'library-large', 'library-list', 'history', 'search'];
// Android client scenes: phone viewport at 2x.
const ANDROID_SCENES = ['android-library', 'android-torrent', 'android-watch', 'android-remote', 'android-nowplaying', 'android-server', 'android-tvlist', 'android-skip', 'android-chapters', 'android-search', 'android-sources'];
// Android TV scene: 1280x720 like the TV UI.
const ANDROIDTV_SCENES = ['androidtv-player', 'androidtv-chapters', 'androidtv-skip'];

const candidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);
const chrome = candidates.find((p) => existsSync(p));
if (!chrome) throw new Error('Chrome not found; set CHROME_PATH');

for (const scene of [...SCENES, ...ANDROID_SCENES, ...ANDROIDTV_SCENES]) {
  const android = scene.startsWith('android-');
  const tv720 = ANDROIDTV_SCENES.includes(scene);
  const page = pathToFileURL(resolve('docs/screenshots/src', scene + '.html')).href;
  const out = resolve('docs/screenshots', scene + '.png');
  const profile = mkdtempSync(join(tmpdir(), 'omp-shot-'));
  try {
    execFileSync(
      chrome,
      ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', `--user-data-dir=${profile}`,
        android ? '--window-size=390,844' : tv720 ? '--window-size=1280,720' : '--window-size=1920,1080', ...(android ? ['--force-device-scale-factor=2'] : []), '--virtual-time-budget=5000', `--screenshot=${out}`, page],
      { timeout: 60000, stdio: 'ignore' },
    );
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
  if (!existsSync(out)) throw new Error('no screenshot for ' + scene);
  console.log('saved', out);
}
