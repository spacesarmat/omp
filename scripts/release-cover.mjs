// Release cover for the Telegram channel post (1280x720 PNG): OMP logo, version, two highlight lines over the
// dimmed catalog screenshot, rendered with headless Chrome. telegram-post.mjs picks it up by name.
// Usage: node scripts/release-cover.mjs <version> "<line 1>" "<line 2>"  →  docs/screenshots/release-<version>.png
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [version, ...lines] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version || '') || !lines.length) {
  throw new Error('usage: release-cover.mjs <x.y.z> "<line 1>" ["<line 2>"]');
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const shown = version.replace(/\.0$/, '');
const logo = readFileSync('assets/logo.svg', 'utf8').replace(/<svg[^>]*>/, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">');
const shot = pathToFileURL(resolve('docs/screenshots/library-large.png')).href;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;width:1280px;height:720px;overflow:hidden}
body{background:#0F1115;color:#E8EAF0;font-family:'Manrope','Segoe UI',Arial,sans-serif;position:relative}
</style></head><body>
<img src="${shot}" style="position:absolute;left:-40px;top:-40px;width:1360px;opacity:.35">
<div style="position:absolute;inset:0;background:linear-gradient(90deg,#0F1115 35%,rgba(15,17,21,.4))"></div>
<div style="position:absolute;left:80px;top:150px;display:flex;align-items:center;gap:36px">
  <div style="width:190px;height:190px">${logo}</div>
  <div><div style="font-size:120px;font-weight:800;line-height:1">OMP</div>
  <div style="font-size:64px;font-weight:800;color:#F5B700">версия ${esc(shown)}</div></div>
</div>
<div style="position:absolute;left:80px;right:80px;top:440px;font-size:34px;color:#C9CEDA;line-height:1.45">${lines.map(esc).join('<br>')}</div>
</body></html>`;

const candidates = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean);
const chrome = candidates.find((p) => existsSync(p));
if (!chrome) throw new Error('Chrome not found; set CHROME_PATH');

const tmp = mkdtempSync(join(tmpdir(), 'omp-cover-'));
try {
  const src = join(tmp, 'cover.html');
  writeFileSync(src, html);
  const out = resolve(`docs/screenshots/release-${version}.png`);
  execFileSync(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', `--user-data-dir=${join(tmp, 'profile')}`, '--window-size=1280,720', '--allow-file-access-from-files', '--virtual-time-budget=4000', `--screenshot=${out}`, pathToFileURL(src).href], { timeout: 60000, stdio: 'ignore' });
  console.log(out);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
