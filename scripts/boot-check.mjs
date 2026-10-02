// Loads dist/index.html from file:// in headless Chrome (as webOS does) and checks the app rendered.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

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

const page = pathToFileURL(resolve('dist/index.html')).href;
const profile = mkdtempSync(join(tmpdir(), 'boot-check-'));
let dom = '';
try {
  dom = execFileSync(
    chrome,
    ['--headless=new', '--disable-gpu', '--no-sandbox', `--user-data-dir=${profile}`, '--virtual-time-budget=8000', '--dump-dom', page],
    { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'ignore'] },
  );
} finally {
  rmSync(profile, { recursive: true, force: true });
}
if (!dom.includes('class="screen connect"')) {
  console.error(dom.slice(0, 2000));
  throw new Error('app did not render from file:// (expected the connect screen)');
}
console.log('boot check OK: app renders from file://');
