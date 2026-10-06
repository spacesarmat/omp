// Narrow screens and large system text on Android: a bigger display size narrows the window, and the WebView
// multiplies every font size by the system font scale (textZoom). This opens the phone app on mocked data
// (mobile/overflow.html) in headless Chrome at several widths (and, on request, text sizes), walks the main screens and
// fails when anything is wider than the window, text spills out of its box, or the remote sits under the tab bar.
// The page itself never zooms (viewport meta, PhoneWebZoom); --zooms only emulates the system font scale.
//
//   npm run check:overflow                       412 / 360 / 320px at the normal text size (must pass)
//   npm run check:overflow -- --widths 412,360,320,280 --zooms 1,1.3,1.6,2
//                                                a report for 280px and large system text (not every screen adapts yet)
//   npm run check:overflow -- --shots out/dir    also saves a screenshot of every case
//   npm run check:overflow -- --widths 360 --zooms 1,2 --scenes add,remote-buttons
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';

const arg = (name) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const list = (v, d) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : d);
const WIDTHS = list(arg('widths'), ['412', '360', '320']).map(Number);
const ZOOMS = list(arg('zooms'), ['1']).map(Number);
const ONLY = list(arg('scenes'), null);
const SHOTS = arg('shots');
const JSON_OUT = arg('json');
// phone heights for those widths (Pixel 7, Galaxy S21, a small phone, Galaxy Z Fold cover)
const HEIGHT = { 412: 915, 360: 800, 320: 700, 280: 653 };

const candidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const chrome = candidates.find((p) => existsSync(p));
if (!chrome) throw new Error('Chrome not found; set CHROME_PATH');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- a tiny Chrome DevTools Protocol client over the built-in WebSocket
function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
    if (m.id && pending.has(m.id)) {
      const { ok, fail } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) fail(new Error(m.error.message));
      else ok(m.result);
    }
  });
  const open = new Promise((r, j) => {
    ws.addEventListener('open', r);
    ws.addEventListener('error', j);
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((ok, fail) => {
      const n = ++id;
      pending.set(n, { ok, fail });
      ws.send(JSON.stringify({ id: n, method, params, sessionId }));
    });
  return { open, send, close: () => ws.close() };
}

const server = await createServer({ configFile: resolve('vite.mobile.config.ts'), server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const addr = server.httpServer.address();
const pageUrl = `http://127.0.0.1:${addr.port}/overflow.html`;

const profile = mkdtempSync(join(tmpdir(), 'omp-overflow-'));
const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
let exitCode = 0;
try {
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100);
  const [port, path] = readFileSync(portFile, 'utf8').trim().split('\n');
  const c = cdp(`ws://127.0.0.1:${port}${path}`);
  await c.open;
  const { targetId } = await c.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await c.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (m, p) => c.send(m, p, sessionId);
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text);
    return r.result.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  // mobile: false keeps the layout viewport at the given width (mobile emulation would widen it to wide content and
  // zoom out, hiding exactly the overflow this looks for)
  await send('Emulation.setDeviceMetricsOverride', { width: WIDTHS[0], height: HEIGHT[WIDTHS[0]] || 800, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url: pageUrl });
  for (let i = 0; i < 300; i++) {
    if (await evaluate('!!(window.__omp && window.__omp.ready)').catch(() => false)) break;
    await sleep(100);
  }
  await evaluate('document.fonts.ready.then(() => true)');
  const scenes = (await evaluate('window.__omp.scenes')).filter((s) => !ONLY || ONLY.includes(s));
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });

  const results = []; // { scene, width, zoom, ok, scrollWidth, offenders }
  for (const width of WIDTHS) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: HEIGHT[width] || Math.round(width * 2.1), deviceScaleFactor: 2, mobile: false });
    for (const zoom of ZOOMS) {
      await evaluate(`window.__omp.setTextZoom(${zoom})`);
      for (const scene of scenes) {
        await evaluate(`window.__omp.go(${JSON.stringify(scene)})`);
        await sleep(350);
        await evaluate('window.scrollTo(0, 0)');
        const o = await evaluate('window.__omp.overflow()');
        const ok = o.scrollWidth <= o.innerWidth && o.offenders.length === 0;
        results.push({ scene, width, zoom, ok, scrollWidth: o.scrollWidth, offenders: o.offenders });
        if (SHOTS) {
          const shot = await send('Page.captureScreenshot', { format: 'png' });
          writeFileSync(join(SHOTS, `${scene}-${width}-${zoom}.png`), Buffer.from(shot.data, 'base64'));
        }
      }
    }
  }
  await evaluate('window.__omp.setTextZoom(1)');

  // the table: one row per screen, one column per width × text size
  const cols = [];
  for (const w of WIDTHS) for (const z of ZOOMS) cols.push([w, z]);
  const head = ['screen'.padEnd(16)].concat(cols.map(([w, z]) => `${w}@${z}`.padStart(8)));
  const lines = [head.join(' ')];
  for (const scene of scenes) {
    const cells = cols.map(([w, z]) => {
      const r = results.find((x) => x.scene === scene && x.width === w && x.zoom === z);
      return (r.ok ? 'ok' : 'FAIL+' + Math.max(0, r.scrollWidth - w)).padStart(8);
    });
    lines.push([scene.padEnd(16)].concat(cells).join(' '));
  }
  console.log(lines.join('\n'));
  const bad = results.filter((r) => !r.ok);
  for (const r of bad) {
    console.log(`\n${r.scene} ${r.width}px × ${r.zoom}: scrollWidth ${r.scrollWidth}`);
    for (const o of r.offenders.slice(0, 8)) console.log('  ' + o);
    if (r.offenders.length > 8) console.log(`  … ${r.offenders.length - 8} more`);
  }
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(results, null, 2));
  console.log(`\n${results.length - bad.length}/${results.length} cases fit`);
  if (bad.length) exitCode = 1;
  c.close();
} finally {
  proc.kill();
  await server.close();
  await sleep(300);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    /* Chrome may still hold the profile for a moment */
  }
}
process.exit(exitCode);
