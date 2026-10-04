// Telegram story slides (1080x1920 PNG) about OMP, rendered from the README screenshots with headless Chrome.
// Usage: node scripts/stories.mjs  →  docs/stories/omp-story-1.png … omp-story-7.png
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import QRCode from 'qrcode';

const OUT = resolve('docs/stories');
const SHOTS = pathToFileURL(resolve('docs/screenshots')).href + '/';
const logo = readFileSync('assets/logo.svg', 'utf8').replace(/<svg[^>]*>/, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">');
const qr = await QRCode.toString('https://t.me/ompplyaer', { type: 'svg', margin: 1, color: { dark: '#0F1115', light: '#FFFFFF' } });

const css = `
*{box-sizing:border-box}html,body{margin:0;width:1080px;height:1920px;overflow:hidden}
body{background:#0F1115;color:#E8EAF0;font-family:'Manrope','Segoe UI',Arial,sans-serif;position:relative}
.glow{position:absolute;width:1400px;height:1400px;border-radius:50%;background:radial-gradient(circle,rgba(245,183,0,.16),rgba(245,183,0,0) 60%);top:-500px;left:-160px}
.top{position:absolute;top:230px;left:90px;right:90px}
.kicker{font-size:34px;font-weight:700;color:#F5B700;letter-spacing:.06em;text-transform:uppercase}
h1{font-size:92px;line-height:1.05;margin:24px 0 0;font-weight:800}
p{font-size:42px;line-height:1.35;color:#C9CEDA;margin:28px 0 0}
.shot{position:absolute;left:90px;right:90px;border-radius:36px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.6),0 0 0 3px #252A35}
.shot img{display:block;width:100%}
.phone{position:absolute;width:470px;height:800px;border-radius:52px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.6),0 0 0 6px #252A35}
.phone img{display:block;width:100%}
`;

const slides = [
  // 1 — cover
  `<div class="glow"></div>
   <div style="position:absolute;top:330px;left:0;right:0;display:flex;justify-content:center"><div style="width:420px;height:420px">${logo}</div></div>
   <div style="position:absolute;top:840px;left:90px;right:90px;text-align:center">
     <h1 style="font-size:150px">OMP</h1>
     <p style="font-size:50px;color:#E8EAF0;font-weight:700">Торренты на телевизоре —<br>сразу смотреть, без скачивания</p>
     <p>LG webOS · Android TV · телефон</p>
   </div>`,
  // 2 — TV catalog
  `<div class="top"><div class="kicker">Каталог на ТВ</div><h1>Ваш TorrServer как красивая медиатека</h1><p>Обложки, сериалы по сезонам, «Продолжить просмотр» — всё с пульта.</p></div>
   <div class="shot" style="top:880px;left:-260px;right:-260px;transform:rotate(-2deg)"><img src="${SHOTS}library-large.png"></div>`,
  // 3 — phone as remote
  `<div class="top"><div class="kicker">Телефон-пульт</div><h1>Нашли на телефоне — смотрите на ТВ</h1><p>Поиск по трекерам, тачпад и пульт в одном приложении.</p></div>
   <div class="phone" style="top:830px;left:80px;transform:rotate(-4deg)"><img src="${SHOTS}android-search.png"></div>
   <div class="phone" style="top:860px;right:80px;transform:rotate(4deg)"><img src="${SHOTS}android-remote.png"></div>`,
  // 4 — player
  `<div class="top"><div class="kicker">Плеер</div><h1>Главы, пропуск заставки и титров</h1><p>Продолжение с того же места, выбор озвучки и субтитров, «Следующая серия».</p></div>
   <div class="shot" style="top:800px;right:200px"><img src="${SHOTS}androidtv-skip.png"></div>
   <div class="shot" style="top:1180px;left:200px;right:40px;transform:rotate(-3deg)"><img src="${SHOTS}androidtv-chapters.png"></div>`,
  // 5 — new episodes
  `<div class="top"><div class="kicker">Ничего не пропустите</div><h1>Новые серии и раздачи — уведомлением</h1><p>Подписки на запросы и «Заменить» одной кнопкой: история и место остановки переезжают сами.</p></div>
   <div class="phone" style="top:860px;left:305px"><img src="${SHOTS}android-news.png"></div>`,
  // 6 — install assistant
  `<div class="top"><div class="kicker">Установка</div><h1>Телефон сам поставит OMP на ТВ</h1><p>Помощник найдёт LG или Android TV в сети и покажет шаги под вашу модель.</p></div>
   <div class="phone" style="top:830px;left:80px;transform:rotate(-4deg)"><img src="${SHOTS}android-install-find.png"></div>
   <div class="phone" style="top:860px;right:80px;transform:rotate(4deg)"><img src="${SHOTS}android-install-steps.png"></div>`,
  // 7 — finale
  `<div class="glow" style="top:auto;bottom:-600px"></div>
   <div class="top" style="top:200px;text-align:center"><div class="kicker">Бесплатно и без рекламы</div><h1>Открытый код.<br>Новые версии — в канале</h1></div>
   <div style="position:absolute;top:780px;left:0;right:0;display:flex;justify-content:center"><div style="width:480px;height:480px;padding:28px;background:#fff;border-radius:40px">${qr}</div></div>
   <div style="position:absolute;top:1320px;left:90px;right:90px;text-align:center">
     <p style="color:#E8EAF0;font-weight:700;font-size:48px;margin:0">t.me/ompplyaer</p>
     <p style="font-size:36px">github.com/spacesarmat/omp · Поддержать: boosty.to/djmaker</p>
   </div>`,
];

const candidates = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean);
const chrome = candidates.find((p) => existsSync(p));
if (!chrome) throw new Error('Chrome not found; set CHROME_PATH');

mkdirSync(join(OUT, 'src'), { recursive: true });
slides.forEach((body, i) => {
  const n = i + 1;
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;700;800&display=swap" rel="stylesheet"><style>${css}</style></head><body>${body}</body></html>`;
  const src = join(OUT, 'src', `omp-story-${n}.html`);
  writeFileSync(src, html);
  const profile = mkdtempSync(join(tmpdir(), 'omp-story-'));
  try {
    execFileSync(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', `--user-data-dir=${profile}`, '--window-size=1080,1920', '--allow-file-access-from-files', '--virtual-time-budget=6000', `--screenshot=${join(OUT, `omp-story-${n}.png`)}`, pathToFileURL(src).href], { timeout: 60000, stdio: 'ignore' });
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
  console.log('wrote', `docs/stories/omp-story-${n}.png`);
});
