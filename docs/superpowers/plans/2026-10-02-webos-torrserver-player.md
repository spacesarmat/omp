# webOS TorrServer Player — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** webOS-приложение (.ipk), которое подключается к TorrServer в локальной сети, показывает его торренты, воспроизводит файлы и M3U-плейлисты нативным плеером ТВ и управляется пультом LG / Magic Remote / LG ThinQ.

**Architecture:** Preact SPA, собранная Vite в legacy-бандл (SystemJS, без ES-модулей) для Chromium 53+. Чистая логика (`src/lib`, `src/api`, `src/store`) покрыта Vitest-тестами; UI (`src/ui`, `src/screens`, `src/player`) использует Norigin Spatial Navigation для пульта и hover/click для указателя. Воспроизведение — `<video>` с URL `/stream` TorrServer; дорожки через `audioTracks`/`textTracks` с fallback на Luna (`PalmServiceBridge`).

**Tech Stack:** Preact 10, @preact/signals, TypeScript, Vite + @preact/preset-vite + @vitejs/plugin-legacy, @noriginmedia/norigin-spatial-navigation, Vitest + jsdom, @webos-tools/cli.

**Spec:** `docs/superpowers/specs/2026-10-02-webos-torrserver-player-design.md`

## Global Constraints

- Целевая платформа: webOS 4.0+ → Chromium 53. Сборка: `@vitejs/plugin-legacy` с `targets: ['chrome >= 53']`, `renderModernChunks: false`. В `dist/index.html` не должно быть `type="module"`.
- CSS: **без CSS Grid и без `gap` у flex** (нет в Chrome 53) — только flexbox + margin. CSS-переменные можно.
- JS: не наследоваться от `Error` (ломается `instanceof` после транспиляции) — ошибки создаются фабрикой `apiError()`. Не использовать `AbortController` (нет в Chrome 53) — таймауты через `Promise.race`. Прокрутка к элементу — только через `scrollIntoViewSafe()` (`scrollIntoViewIfNeeded` / `scrollIntoView(false)`).
- Разрешение интерфейса 1920×1080, тёмная тема, все тексты UI — на русском.
- Ключи localStorage — с префиксом `tsp.`.
- ID приложения webOS: `com.spacesarmat.torrplayer`, версия `0.1.0`.
- Реальный сервер для ручной проверки: `http://192.168.1.191:5665` (TorrServer MatriX.145.1, CORS `*`).
- Особенности API (проверено): поиск — `GET /search/?query=` и `GET /torznab/search/?query=` (со слешем, иначе 301); у неактивного торрента нет `file_stats`, файлы — в JSON-строке `data` (`{"TorrServer":{"Files":[...]}}`); `/viewed` принимает `timecode`, но на сервере может быть `TrackTimecode=false` → прогресс дублируется в localStorage.
- Коммиты: после каждой задачи, сообщение в стиле Conventional Commits, только тема; без строк соавторства (Co-Author) и подписей ИИ.

## Карта файлов

```
package.json, tsconfig.json, vite.config.ts, index.html, .gitignore, README.md
webos/appinfo.json, webos/icon.png, webos/largeIcon.png
scripts/make-icons.mjs   — генерация PNG-иконок без зависимостей
scripts/package.mjs      — dist + appinfo → build/*.ipk
scripts/tv.mjs           — ares-install / ares-launch
src/main.tsx             — init spatial nav + render
src/app.tsx              — роутинг экранов, глобальный Back
src/styles.css           — все стили
src/lib/format.ts        — байты/скорость/длительность
src/lib/episodes.ts      — тип файла, SxxEyy, группировка по сезонам, сопоставление субтитров
src/lib/category.ts      — категории торрентов и результатов поиска
src/lib/m3u.ts           — парсер M3U, HLS-детект, разбор stream-URL
src/lib/subtitles.ts     — SRT/VTT/ASS → cues, декодирование UTF-8/CP1251
src/lib/tracks.ts        — языки, дорожки из ffprobe, выбор по языку
src/api/types.ts         — типы ответов TorrServer
src/api/http.ts          — fetch с таймаутом и типизированными ошибками
src/api/torrserver.ts    — клиент TorrServer
src/api/discovery.ts     — поиск серверов в подсети
src/platform/keys.ts     — коды клавиш пульта → действия
src/platform/luna.ts     — вызовы Luna через PalmServiceBridge
src/platform/webosMedia.ts — выбор аудио/текстовых дорожек
src/store/storage.ts     — безопасный localStorage
src/store/servers.ts     — сохранённые серверы, активный клиент
src/store/settings.ts    — настройки приложения
src/store/progress.ts    — прогресс просмотра (локально + /viewed)
src/store/library.ts     — кэш списка торрентов
src/ui/keys.ts           — стек обработчиков клавиш, глобальный listener
src/ui/nav.ts            — стек маршрутов + память фокуса
src/ui/focus.ts          — restoreFocus, scrollIntoViewSafe
src/ui/components.tsx    — Focusable, FocusGroup, Button, TextInput, ChoiceRow, Spinner, ErrorView, ProgressBar
src/ui/dialog.tsx        — choose()/confirmDialog() + DialogHost
src/ui/toast.tsx         — toast() + ToastHost
src/player/types.ts      — PlayItem, ExternalSub
src/player/queue.ts      — очередь воспроизведения из торрента
src/player/seek.ts       — накопитель перемотки с ускорением
src/player/stats.ts      — строки статистики, HDR-метка
src/player/trackOptions.ts — списки дорожек для меню
src/player/useVideoState.ts, useProgressSync.ts, useNextEpisode.ts, useCacheStats.ts
src/player/Controls.tsx, StatsOverlay.tsx, SubtitleOverlay.tsx, NextBanner.tsx, PlayerError.tsx
src/screens/Player.tsx, Connect.tsx, Library.tsx, Torrent.tsx, Add.tsx, Playlist.tsx, Settings.tsx
tests/**                 — Vitest
```

---

### Task 1: Каркас проекта, сборка под webOS, иконки, упаковка

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/styles.css` (минимальный), `webos/appinfo.json`, `scripts/make-icons.mjs`, `scripts/package.mjs`, `scripts/tv.mjs`, `tests/smoke.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Produces: npm-скрипты `dev`, `build`, `test`, `icons`, `package`, `tv:install`, `tv:launch`; `dist/` — legacy-бандл; `build/com.spacesarmat.torrplayer_0.1.0_all.ipk`.

- [ ] **Step 1: Создать package.json**

```json
{
  "name": "webos-torrserver-player",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Media player for LG webOS TVs backed by TorrServer",
  "scripts": {
    "dev": "vite --host",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "icons": "node scripts/make-icons.mjs",
    "package": "npm run build && node scripts/package.mjs",
    "tv:install": "node scripts/tv.mjs install",
    "tv:launch": "node scripts/tv.mjs launch"
  }
}
```

- [ ] **Step 2: Установить зависимости**

```bash
npm install preact @preact/signals @noriginmedia/norigin-spatial-navigation
npm install -D typescript vite @preact/preset-vite @vitejs/plugin-legacy terser vitest jsdom @webos-tools/cli
```
Если npm сообщит о конфликте peer-зависимостей между `vite` и `@preact/preset-vite`/`@vitejs/plugin-legacy`, установить `vite` той мажорной версии, которую требуют плагины (`npm install -D vite@<major>`), не используя `--force`.

- [ ] **Step 3: tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "allowSyntheticDefaultImports": true,
    "lib": ["DOM", "DOM.Iterable", "ES2020"],
    "types": ["vite/client"],
    "paths": {
      "react": ["./node_modules/preact/compat/"],
      "react-dom": ["./node_modules/preact/compat/"]
    }
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 4: vite.config.ts**

```ts
import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import legacy from '@vitejs/plugin-legacy';

export default defineConfig({
  base: './',
  plugins: [
    preact(),
    legacy({
      targets: ['chrome >= 53'],
      renderModernChunks: false,
    }),
  ],
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
});
```

- [ ] **Step 5: index.html, src/main.tsx, src/styles.css**

`index.html`:
```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <title>TorrServer Player</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/main.tsx` (временный, заменяется в Task 10):
```tsx
import { render } from 'preact';
import './styles.css';

render(<div class="app">TorrServer Player</div>, document.getElementById('app')!);
```

`src/styles.css` (временный, заменяется в Task 10):
```css
html, body { margin: 0; background: #0f1115; color: #e8eaf0; font-family: sans-serif; }
.app { width: 1920px; height: 1080px; }
```

- [ ] **Step 6: webos/appinfo.json**

```json
{
  "id": "com.spacesarmat.torrplayer",
  "version": "0.1.0",
  "vendor": "spacesarmat",
  "type": "web",
  "main": "index.html",
  "title": "TorrServer Player",
  "icon": "icon.png",
  "largeIcon": "largeIcon.png",
  "bgColor": "#0f1115",
  "resolution": "1920x1080",
  "disableBackHistoryAPI": true
}
```

- [ ] **Step 7: scripts/make-icons.mjs — PNG без зависимостей (оранжевый фон, белый треугольник «play»)**

```js
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function icon(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const r = size * 0.12;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const o = y * (size * 4 + 1) + 1 + x * 4;
      // rounded square
      const cx = Math.min(Math.max(x, r), size - 1 - r);
      const cy = Math.min(Math.max(y, r), size - 1 - r);
      const inside = (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
      // play triangle
      const tx = (x - size * 0.36) / (size * 0.36);
      const ty = Math.abs(y - size / 2) / (size * 0.3);
      const tri = tx >= 0 && tx <= 1 && ty <= 1 - tx;
      const [R, G, B] = tri ? [255, 255, 255] : [242, 112, 36];
      raw[o] = R; raw[o + 1] = G; raw[o + 2] = B; raw[o + 3] = inside ? 255 : 0;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
mkdirSync('webos', { recursive: true });
writeFileSync('webos/icon.png', icon(80));
writeFileSync('webos/largeIcon.png', icon(130));
console.log('icons written');
```

- [ ] **Step 8: scripts/package.mjs и scripts/tv.mjs**

`scripts/package.mjs`:
```js
import { cpSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

if (!existsSync('dist/index.html')) throw new Error('dist/ not found — run vite build first');
for (const f of ['appinfo.json', 'icon.png', 'largeIcon.png']) cpSync(`webos/${f}`, `dist/${f}`);
mkdirSync('build', { recursive: true });
execSync('npx ares-package dist -o build --no-minify', { stdio: 'inherit' });
const { id, version } = JSON.parse(readFileSync('webos/appinfo.json', 'utf8'));
console.log(`built build/${id}_${version}_all.ipk`);
```

`scripts/tv.mjs`:
```js
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const { id, version } = JSON.parse(readFileSync('webos/appinfo.json', 'utf8'));
const device = process.env.WEBOS_DEVICE || 'tv';
const cmd = process.argv[2];
if (cmd === 'install') execSync(`npx ares-install --device ${device} build/${id}_${version}_all.ipk`, { stdio: 'inherit' });
else if (cmd === 'launch') execSync(`npx ares-launch --device ${device} ${id}`, { stdio: 'inherit' });
else throw new Error('usage: node scripts/tv.mjs install|launch');
```

- [ ] **Step 9: .gitignore — добавить build/**

Итоговое содержимое `.gitignore`:
```
node_modules/
dist/
build/
*.ipk
.vite/
coverage/
```

- [ ] **Step 10: Smoke-тест**

`tests/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('runs in jsdom', () => {
    expect(typeof document.createElement).toBe('function');
    expect(typeof localStorage.setItem).toBe('function');
  });
});
```

- [ ] **Step 11: Проверка**

Run: `npm run icons && npm test && npm run build`
Expected: `icons written`; 1 тест PASS; сборка без ошибок.

Run: `node -e "const h=require('fs').readFileSync('dist/index.html','utf8'); if(/type=\"module\"/.test(h)) {console.error('FAIL: module script present'); process.exit(1)} console.log('OK legacy-only')"`
Expected: `OK legacy-only`. Если FAIL — остановиться и сообщить (не обходить вручную).

Run: `npm run package`
Expected: `built build/com.spacesarmat.torrplayer_0.1.0_all.ipk`.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "chore: scaffold Preact + Vite project with webOS legacy build and packaging"
```

---

### Task 2: lib/format и lib/category

**Files:**
- Create: `src/lib/format.ts`, `src/lib/category.ts`
- Test: `tests/lib/format.test.ts`, `tests/lib/category.test.ts`

**Interfaces:**
- Produces:
  - `formatBytes(n: number): string`, `formatSpeed(bytesPerSec: number): string`, `formatDuration(sec: number): string`
  - `type Category = 'movie' | 'tv' | 'music' | 'other'`, `categoryOf(c?: string): Category`, `CATEGORY_TABS: { id: 'all' | Category; label: string }[]`, `mapSearchCategory(c: string): string`

- [ ] **Step 1: Тесты**

`tests/lib/format.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { formatBytes, formatSpeed, formatDuration } from '../../src/lib/format';

describe('formatBytes', () => {
  it('formats sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(150 * 1024 * 1024)).toBe('150 MB');
    expect(formatBytes(2376597238)).toBe('2.2 GB');
    expect(formatBytes(21697042007)).toBe('20.2 GB');
  });
  it('handles invalid input', () => {
    expect(formatBytes(NaN)).toBe('0 B');
    expect(formatBytes(-5)).toBe('0 B');
  });
});

describe('formatSpeed', () => {
  it('appends /s', () => expect(formatSpeed(1048576)).toBe('1.0 MB/s'));
});

describe('formatDuration', () => {
  it('formats m:ss and h:mm:ss', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3644.33)).toBe('1:00:44');
  });
  it('clamps invalid', () => expect(formatDuration(NaN)).toBe('0:00'));
});
```

`tests/lib/category.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { categoryOf, mapSearchCategory, CATEGORY_TABS } from '../../src/lib/category';

describe('categoryOf', () => {
  it('maps TorrServer categories', () => {
    expect(categoryOf('movie')).toBe('movie');
    expect(categoryOf('tv')).toBe('tv');
    expect(categoryOf('music')).toBe('music');
    expect(categoryOf('')).toBe('other');
    expect(categoryOf(undefined)).toBe('other');
    expect(categoryOf('anime')).toBe('other');
  });
});

describe('mapSearchCategory', () => {
  it('maps search result categories', () => {
    expect(mapSearchCategory('Movie')).toBe('movie');
    expect(mapSearchCategory('TV')).toBe('tv');
    expect(mapSearchCategory('Series')).toBe('tv');
    expect(mapSearchCategory('Music')).toBe('music');
    expect(mapSearchCategory('')).toBe('');
  });
});

describe('CATEGORY_TABS', () => {
  it('starts with all', () => expect(CATEGORY_TABS[0].id).toBe('all'));
});
```

- [ ] **Step 2: Run — FAIL**

Run: `npx vitest run tests/lib`
Expected: FAIL (modules not found)

- [ ] **Step 3: Реализация**

`src/lib/format.ts`:
```ts
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(n: number): string {
  if (!isFinite(n) || n <= 0) return '0 B';
  let i = 0;
  let v = n;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  const num = i === 0 ? String(Math.round(v)) : v.toFixed(v >= 100 ? 0 : 1);
  return num + ' ' + UNITS[i];
}

export function formatSpeed(bytesPerSec: number): string {
  return formatBytes(bytesPerSec) + '/s';
}

export function formatDuration(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60) % 60;
  const h = Math.floor(sec / 3600);
  const pad = (x: number) => (x < 10 ? '0' : '') + x;
  return h > 0 ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
}
```

`src/lib/category.ts`:
```ts
export type Category = 'movie' | 'tv' | 'music' | 'other';

export const CATEGORY_TABS: { id: 'all' | Category; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'movie', label: 'Фильмы' },
  { id: 'tv', label: 'Сериалы' },
  { id: 'music', label: 'Музыка' },
  { id: 'other', label: 'Прочее' },
];

export function categoryOf(c?: string): Category {
  if (c === 'movie' || c === 'tv' || c === 'music') return c;
  return 'other';
}

export function mapSearchCategory(c: string): string {
  const v = (c || '').toLowerCase();
  if (v.indexOf('movie') >= 0 || v.indexOf('фильм') >= 0) return 'movie';
  if (v === 'tv' || v.indexOf('series') >= 0 || v.indexOf('сериал') >= 0) return 'tv';
  if (v.indexOf('music') >= 0 || v.indexOf('музык') >= 0) return 'music';
  return '';
}
```

- [ ] **Step 4: Run — PASS**

Run: `npx vitest run tests/lib`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib tests/lib
git commit -m "feat: add formatting and category helpers"
```

---

### Task 3: lib/episodes — типы файлов, серии, сезоны, субтитры

**Files:**
- Create: `src/lib/episodes.ts`
- Test: `tests/lib/episodes.test.ts`

**Interfaces:**
- Produces:
  - `interface TorrentFile { id: number; path: string; length: number }`
  - `type FileKind = 'video' | 'audio' | 'subtitle' | 'playlist' | 'other'`
  - `extOf(path: string): string`, `baseName(path: string): string`, `stripExt(name: string): string`, `fileKind(path: string): FileKind`
  - `interface EpisodeInfo { season: number | null; episode: number | null }`, `parseEpisode(path: string): EpisodeInfo`, `episodeLabel(path: string): string` (`"S01E02"` или `""`)
  - `naturalCompare(a: string, b: string): number`
  - `interface Season { season: number | null; files: TorrentFile[] }`, `groupBySeason(files: TorrentFile[]): Season[]`
  - `playableFiles(files: TorrentFile[]): TorrentFile[]` — видео, иначе аудио; упорядочено по сезонам/сериям
  - `matchSubtitles(video: TorrentFile, subs: TorrentFile[]): TorrentFile[]`, `subtitleLabel(sub: TorrentFile, video: TorrentFile): string`

- [ ] **Step 1: Тесты**

`tests/lib/episodes.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  extOf, baseName, stripExt, fileKind, parseEpisode, episodeLabel, naturalCompare,
  groupBySeason, playableFiles, matchSubtitles, subtitleLabel, TorrentFile,
} from '../../src/lib/episodes';

const f = (id: number, path: string): TorrentFile => ({ id, path, length: 100 });

describe('path helpers', () => {
  it('extOf/baseName/stripExt', () => {
    expect(extOf('a/b/Movie.MKV')).toBe('mkv');
    expect(extOf('noext')).toBe('');
    expect(baseName('a/b/c.mkv')).toBe('c.mkv');
    expect(stripExt('c.rus.srt')).toBe('c.rus');
  });
  it('fileKind', () => {
    expect(fileKind('x.mkv')).toBe('video');
    expect(fileKind('x.m2ts')).toBe('video');
    expect(fileKind('x.flac')).toBe('audio');
    expect(fileKind('x.srt')).toBe('subtitle');
    expect(fileKind('x.ass')).toBe('subtitle');
    expect(fileKind('x.m3u8')).toBe('playlist');
    expect(fileKind('x.nfo')).toBe('other');
  });
});

describe('parseEpisode', () => {
  it('SxxEyy', () => expect(parseEpisode('Show/Show.S04E01.1080p.mkv')).toEqual({ season: 4, episode: 1 }));
  it('s1.e2 with separator', () => expect(parseEpisode('show.s01.e12.mkv')).toEqual({ season: 1, episode: 12 }));
  it('1x05', () => expect(parseEpisode('Show 1x05 Title.avi')).toEqual({ season: 1, episode: 5 }));
  it('season folder + leading number', () => expect(parseEpisode('Show/Season 2/03. Title.mkv')).toEqual({ season: 2, episode: 3 }));
  it('russian folders', () => expect(parseEpisode('Сезон 3/Серия 7.avi')).toEqual({ season: 3, episode: 7 }));
  it('movie has none', () => expect(parseEpisode('Movie.2021.1080p.mkv')).toEqual({ season: null, episode: null }));
  it('episodeLabel', () => {
    expect(episodeLabel('Show.S04E01.mkv')).toBe('S04E01');
    expect(episodeLabel('Movie.2021.mkv')).toBe('');
  });
});

describe('naturalCompare', () => {
  it('orders numbers naturally', () => {
    expect(['ep10', 'ep2', 'ep1'].sort(naturalCompare)).toEqual(['ep1', 'ep2', 'ep10']);
  });
});

describe('groupBySeason', () => {
  it('groups and sorts', () => {
    const groups = groupBySeason([
      f(1, 'S/Show.S02E01.mkv'), f(2, 'S/Show.S01E02.mkv'), f(3, 'S/Show.S01E01.mkv'),
    ]);
    expect(groups.map((g) => g.season)).toEqual([1, 2]);
    expect(groups[0].files.map((x) => x.id)).toEqual([3, 2]);
    expect(groups[1].files.map((x) => x.id)).toEqual([1]);
  });
  it('puts unknown season last', () => {
    const groups = groupBySeason([f(1, 'extra.mkv'), f(2, 'Show.S01E01.mkv')]);
    expect(groups.map((g) => g.season)).toEqual([1, null]);
  });
});

describe('playableFiles', () => {
  it('prefers video', () => {
    const r = playableFiles([f(1, 'a.mp3'), f(2, 'b.S01E02.mkv'), f(3, 'b.S01E01.mkv'), f(4, 'b.srt')]);
    expect(r.map((x) => x.id)).toEqual([3, 2]);
  });
  it('falls back to audio', () => {
    const r = playableFiles([f(1, '02 b.mp3'), f(2, '01 a.mp3'), f(3, 'cover.jpg')]);
    expect(r.map((x) => x.id)).toEqual([2, 1]);
  });
});

describe('subtitles matching', () => {
  const video = f(1, 'Show/Show.S01E01.mkv');
  const subs = [f(2, 'Show/Show.S01E01.rus.srt'), f(3, 'Show/Show.S01E02.rus.srt'), f(4, 'Show/Subs/Eng/Show.S01E01.srt')];
  it('matches by base name prefix', () => {
    expect(matchSubtitles(video, subs).map((s) => s.id)).toEqual([2, 4]);
  });
  it('movie without matches gets all subs', () => {
    const movie = f(1, 'Movie/Movie.2020.mkv');
    const ms = [f(2, 'Movie/Subs/rus.srt'), f(3, 'Movie/Subs/eng.srt')];
    expect(matchSubtitles(movie, ms).map((s) => s.id)).toEqual([2, 3]);
  });
  it('episode without matches gets none', () => {
    expect(matchSubtitles(f(9, 'Show.S05E05.mkv'), subs)).toEqual([]);
  });
  it('labels', () => {
    expect(subtitleLabel(subs[0], video)).toBe('rus');
    expect(subtitleLabel(subs[2], video)).toBe('Eng');
    expect(subtitleLabel(f(5, 'rus.srt'), f(1, 'Movie.mkv'))).toBe('rus');
  });
});
```

- [ ] **Step 2: Run — FAIL**

Run: `npx vitest run tests/lib/episodes.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Реализация**

`src/lib/episodes.ts`:
```ts
export interface TorrentFile {
  id: number;
  path: string;
  length: number;
}

export type FileKind = 'video' | 'audio' | 'subtitle' | 'playlist' | 'other';

const VIDEO = ['mkv', 'mp4', 'm4v', 'avi', 'mov', 'ts', 'm2ts', 'mts', 'webm', 'wmv', 'mpg', 'mpeg', 'vob', 'flv', '3gp', 'ogv'];
const AUDIO = ['mp3', 'flac', 'aac', 'm4a', 'ogg', 'opus', 'wav', 'ac3', 'dts', 'eac3', 'mka', 'wma', 'ape'];
const SUBS = ['srt', 'vtt', 'ass', 'ssa'];
const PLAYLISTS = ['m3u', 'm3u8'];

export function extOf(path: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(path);
  return m ? m[1].toLowerCase() : '';
}

export function baseName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

export function stripExt(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, '');
}

export function fileKind(path: string): FileKind {
  const e = extOf(path);
  if (VIDEO.indexOf(e) >= 0) return 'video';
  if (AUDIO.indexOf(e) >= 0) return 'audio';
  if (SUBS.indexOf(e) >= 0) return 'subtitle';
  if (PLAYLISTS.indexOf(e) >= 0) return 'playlist';
  return 'other';
}

export interface EpisodeInfo {
  season: number | null;
  episode: number | null;
}

export function parseEpisode(path: string): EpisodeInfo {
  const name = baseName(path);
  let m = /s(\d{1,2})[ ._-]?e(\d{1,3})/i.exec(name);
  if (m) return { season: +m[1], episode: +m[2] };
  m = /(?:^|[^\d])(\d{1,2})x(\d{2,3})(?:[^\d]|$)/i.exec(name);
  if (m) return { season: +m[1], episode: +m[2] };

  const dir = path.split('/').slice(0, -1).join('/');
  const sm = /(?:season|сезон)[ ._-]?(\d{1,2})/i.exec(dir) || /(?:^|\/)s(\d{1,2})(?:\/|$)/i.exec(dir);
  const season = sm ? +sm[1] : null;
  const named = /(?:^|[ ._-])(?:ep?|episode|серия)[ ._-]?(\d{1,3})(?:[^\d]|$)/i.exec(name);
  // a bare leading number counts as an episode only inside a season folder (otherwise it's a track number)
  const leading = /^(\d{1,3})[ ._-]/.exec(name);
  const episode = named ? +named[1] : season !== null && leading ? +leading[1] : null;
  return { season, episode };
}

export function episodeLabel(path: string): string {
  const e = parseEpisode(path);
  if (e.episode === null) return '';
  const pad = (n: number) => (n < 10 ? '0' : '') + n;
  return (e.season !== null ? 'S' + pad(e.season) : '') + 'E' + pad(e.episode);
}

export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export interface Season {
  season: number | null;
  files: TorrentFile[];
}

export function groupBySeason(files: TorrentFile[]): Season[] {
  const map: { [k: string]: Season } = {};
  const keys: string[] = [];
  files.forEach((file) => {
    const s = parseEpisode(file.path).season;
    const k = s === null ? 'none' : String(s);
    if (!map[k]) {
      map[k] = { season: s, files: [] };
      keys.push(k);
    }
    map[k].files.push(file);
  });
  const groups = keys.map((k) => map[k]);
  groups.forEach((g) =>
    g.files.sort((a, b) => {
      const ea = parseEpisode(a.path).episode;
      const eb = parseEpisode(b.path).episode;
      if (ea !== null && eb !== null && ea !== eb) return ea - eb;
      return naturalCompare(a.path, b.path);
    }),
  );
  groups.sort((a, b) => {
    if (a.season === null) return 1;
    if (b.season === null) return -1;
    return a.season - b.season;
  });
  return groups;
}

export function playableFiles(files: TorrentFile[]): TorrentFile[] {
  const videos = files.filter((x) => fileKind(x.path) === 'video');
  const list = videos.length ? videos : files.filter((x) => fileKind(x.path) === 'audio');
  return groupBySeason(list).reduce((acc: TorrentFile[], g) => acc.concat(g.files), []);
}

export function matchSubtitles(video: TorrentFile, subs: TorrentFile[]): TorrentFile[] {
  const vb = stripExt(baseName(video.path)).toLowerCase();
  const matched = subs.filter((s) => stripExt(baseName(s.path)).toLowerCase().indexOf(vb) === 0);
  if (matched.length) return matched;
  return parseEpisode(video.path).episode === null ? subs.slice() : [];
}

export function subtitleLabel(sub: TorrentFile, video: TorrentFile): string {
  const vb = stripExt(baseName(video.path));
  const sb = stripExt(baseName(sub.path));
  let rest = sb.toLowerCase().indexOf(vb.toLowerCase()) === 0 ? sb.slice(vb.length).replace(/^[ ._-]+/, '') : '';
  if (!rest) {
    const parts = sub.path.split('/');
    rest = parts.length > 1 && sb.toLowerCase() === vb.toLowerCase() ? parts[parts.length - 2] : sb;
  }
  return rest;
}
```

- [ ] **Step 4: Run — PASS**

Run: `npx vitest run tests/lib/episodes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/episodes.ts tests/lib/episodes.test.ts
git commit -m "feat: add file kind, episode parsing and subtitle matching"
```

---

### Task 4: lib/m3u — плейлисты

**Files:**
- Create: `src/lib/m3u.ts`
- Test: `tests/lib/m3u.test.ts`

**Interfaces:**
- Consumes: `baseName` из `src/lib/episodes.ts`
- Produces:
  - `interface PlaylistEntry { url: string; title: string; duration: number; logo?: string; group?: string }`
  - `parseM3U(text: string, baseUrl?: string): PlaylistEntry[]`
  - `isHlsPlaylist(text: string): boolean`
  - `parseStreamUrl(url: string): { hash: string; fileIndex: number } | null`

- [ ] **Step 1: Тесты**

`tests/lib/m3u.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseM3U, isHlsPlaylist, parseStreamUrl } from '../../src/lib/m3u';

const TS = `#EXTM3U
#EXTINF:0,Star.Trek.S04E01.mkv
http://192.168.1.191:5665/stream/Star.Trek.S04E01.mkv?link=c4c4bd6a4618e1042aa89649d629f85951eff546&index=1&play
#EXTINF:0,Star.Trek.S04E02.mkv
http://192.168.1.191:5665/stream/Star.Trek.S04E02.mkv?link=c4c4bd6a4618e1042aa89649d629f85951eff546&index=2&play
`;

describe('parseM3U', () => {
  it('parses TorrServer playlist', () => {
    const r = parseM3U(TS);
    expect(r).toHaveLength(2);
    expect(r[0].title).toBe('Star.Trek.S04E01.mkv');
    expect(r[0].duration).toBe(0);
    expect(r[1].url).toContain('index=2');
  });
  it('parses attributes with commas in quotes', () => {
    const r = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-logo="http://x/l.png" group-title="Кино, HD",Первый канал\nhttp://x/1.m3u8\n');
    expect(r[0]).toEqual({ url: 'http://x/1.m3u8', title: 'Первый канал', duration: -1, logo: 'http://x/l.png', group: 'Кино, HD' });
  });
  it('resolves relative URLs and strips BOM', () => {
    const r = parseM3U('﻿#EXTM3U\r\n#EXTINF:10,A\r\nsub/a.mp4\r\n', 'http://host/list/p.m3u');
    expect(r[0].url).toBe('http://host/list/sub/a.mp4');
  });
  it('uses file name when EXTINF missing', () => {
    const r = parseM3U('http://h/x/My%20Video.mp4\n');
    expect(r[0].title).toBe('My Video.mp4');
    expect(r[0].duration).toBe(-1);
  });
  it('applies EXTGRP', () => {
    const r = parseM3U('#EXTM3U\n#EXTGRP:News\n#EXTINF:-1,A\nhttp://a\n');
    expect(r[0].group).toBe('News');
  });
});

describe('isHlsPlaylist', () => {
  it('detects HLS media and master playlists', () => {
    expect(isHlsPlaylist('#EXTM3U\n#EXT-X-TARGETDURATION:10\n')).toBe(true);
    expect(isHlsPlaylist('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nlow.m3u8')).toBe(true);
    expect(isHlsPlaylist(TS)).toBe(false);
  });
});

describe('parseStreamUrl', () => {
  it('extracts hash and index', () => {
    expect(parseStreamUrl('http://h:5665/stream/x.mkv?link=c4c4bd6a4618e1042aa89649d629f85951eff546&index=2&play'))
      .toEqual({ hash: 'c4c4bd6a4618e1042aa89649d629f85951eff546', fileIndex: 2 });
    expect(parseStreamUrl('http://h:5665/play/c4c4bd6a4618e1042aa89649d629f85951eff546/3'))
      .toEqual({ hash: 'c4c4bd6a4618e1042aa89649d629f85951eff546', fileIndex: 3 });
  });
  it('returns null for other urls', () => {
    expect(parseStreamUrl('http://x/a.mp4')).toBeNull();
    expect(parseStreamUrl('http://h/stream?link=magnet:?xt=1&index=1')).toBeNull();
  });
});
```

- [ ] **Step 2: Run — FAIL**

Run: `npx vitest run tests/lib/m3u.test.ts`
Expected: FAIL

- [ ] **Step 3: Реализация**

`src/lib/m3u.ts`:
```ts
import { baseName } from './episodes';

export interface PlaylistEntry {
  url: string;
  title: string;
  duration: number;
  logo?: string;
  group?: string;
}

function findTitleComma(s: string): number {
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i);
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ',' && !inQuotes) return i;
  }
  return -1;
}

function parseAttrs(s: string): { [k: string]: string } {
  const out: { [k: string]: string } = {};
  const re = /([a-zA-Z0-9-]+)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out[m[1].toLowerCase()] = m[2];
  return out;
}

function resolveUrl(u: string, base?: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(u) || !base) return u;
  try {
    return new URL(u, base).href;
  } catch (e) {
    return u;
  }
}

function titleFromUrl(u: string): string {
  const path = u.split('?')[0];
  try {
    return decodeURIComponent(baseName(path));
  } catch (e) {
    return baseName(path);
  }
}

export function parseM3U(text: string, baseUrl?: string): PlaylistEntry[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const out: PlaylistEntry[] = [];
  let pending: { title: string; duration: number; logo?: string; group?: string } | null = null;
  let extGroup: string | undefined;
  lines.forEach((raw) => {
    const line = raw.trim();
    if (!line) return;
    if (line.indexOf('#EXTINF:') === 0) {
      const body = line.slice(8);
      const comma = findTitleComma(body);
      const head = comma >= 0 ? body.slice(0, comma) : body;
      const title = comma >= 0 ? body.slice(comma + 1).trim() : '';
      const dur = parseFloat(head);
      const attrs = parseAttrs(head);
      pending = { title, duration: isNaN(dur) ? -1 : dur, logo: attrs['tvg-logo'], group: attrs['group-title'] };
      return;
    }
    if (line.indexOf('#EXTGRP:') === 0) {
      extGroup = line.slice(8).trim();
      return;
    }
    if (line.charAt(0) === '#') return;
    const url = resolveUrl(line, baseUrl);
    const p = pending as { title: string; duration: number; logo?: string; group?: string } | null;
    const entry: PlaylistEntry = {
      url,
      title: (p && p.title) || titleFromUrl(url),
      duration: p ? p.duration : -1,
    };
    if (p && p.logo) entry.logo = p.logo;
    const group = (p && p.group) || extGroup;
    if (group) entry.group = group;
    out.push(entry);
    pending = null;
    extGroup = undefined;
  });
  return out;
}

export function isHlsPlaylist(text: string): boolean {
  return /#EXT-X-(TARGETDURATION|STREAM-INF|MEDIA-SEQUENCE)/.test(text);
}

export function parseStreamUrl(url: string): { hash: string; fileIndex: number } | null {
  const play = /\/play\/([0-9a-f]{40})\/(\d+)/i.exec(url);
  if (play) return { hash: play[1].toLowerCase(), fileIndex: +play[2] };
  if (!/\/stream(\/|\?)/.test(url)) return null;
  const link = /[?&]link=([0-9a-f]{40})(?:&|$)/i.exec(url);
  const index = /[?&]index=(\d+)/.exec(url);
  if (!link || !index) return null;
  return { hash: link[1].toLowerCase(), fileIndex: +index[1] };
}
```

- [ ] **Step 4: Run — PASS**

Run: `npx vitest run tests/lib/m3u.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/m3u.ts tests/lib/m3u.test.ts
git commit -m "feat: add M3U playlist parser"
```

---

### Task 5: lib/subtitles — SRT/VTT/ASS и кодировки

**Files:**
- Create: `src/lib/subtitles.ts`
- Test: `tests/lib/subtitles.test.ts`

**Interfaces:**
- Produces:
  - `interface Cue { start: number; end: number; text: string }`
  - `parseTime(s: string): number`
  - `parseSrt(text: string): Cue[]` (также для VTT), `parseAss(text: string): Cue[]`, `parseSubtitles(text: string, ext: string): Cue[]`
  - `cueAt(cues: Cue[], t: number): string`
  - `decodeText(buf: ArrayBuffer): string` — UTF-8, при ошибке windows-1251

- [ ] **Step 1: Тесты**

`tests/lib/subtitles.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseTime, parseSrt, parseAss, parseSubtitles, cueAt, decodeText } from '../../src/lib/subtitles';

const SRT = `1
00:00:01,000 --> 00:00:03,500
Привет, <i>мир</i>

2
00:00:04,000 --> 00:00:06,000
Строка 1
Строка 2
`;

const VTT = `WEBVTT

00:01.000 --> 00:02.000 align:start
Hello

00:00:03.000 --> 00:00:04.000
World
`;

const ASS = `[Script Info]
Title: test

[V4+ Styles]
Format: Name, Fontname

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.50,0:00:02.00,Default,,0,0,0,,{\\i1}Привет,\\Nмир
Dialogue: 0,0:00:00.50,0:00:01.00,Default,,0,0,0,,Первая
`;

describe('parseTime', () => {
  it('parses formats', () => {
    expect(parseTime('00:01:02,500')).toBe(62.5);
    expect(parseTime('01:02.250')).toBe(62.25);
    expect(parseTime('0:00:01.50')).toBe(1.5);
  });
});

describe('parseSrt', () => {
  it('parses cues and strips tags', () => {
    const c = parseSrt(SRT);
    expect(c).toEqual([
      { start: 1, end: 3.5, text: 'Привет, мир' },
      { start: 4, end: 6, text: 'Строка 1\nСтрока 2' },
    ]);
  });
  it('parses vtt', () => {
    const c = parseSrt(VTT);
    expect(c.map((x) => x.text)).toEqual(['Hello', 'World']);
    expect(c[0].start).toBe(1);
  });
});

describe('parseAss', () => {
  it('parses dialogue lines sorted by start', () => {
    const c = parseAss(ASS);
    expect(c).toEqual([
      { start: 0.5, end: 1, text: 'Первая' },
      { start: 1.5, end: 2, text: 'Привет,\nмир' },
    ]);
  });
});

describe('parseSubtitles/cueAt', () => {
  it('dispatches by ext and finds active cue', () => {
    const c = parseSubtitles(SRT, 'srt');
    expect(cueAt(c, 2)).toBe('Привет, мир');
    expect(cueAt(c, 3.7)).toBe('');
    expect(parseSubtitles(ASS, 'ass')).toHaveLength(2);
  });
});

describe('decodeText', () => {
  it('decodes utf-8', () => {
    const buf = new TextEncoder().encode('Привет').buffer;
    expect(decodeText(buf as ArrayBuffer)).toBe('Привет');
  });
  it('falls back to windows-1251', () => {
    // "Привет" in CP1251
    const bytes = new Uint8Array([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]);
    expect(decodeText(bytes.buffer)).toBe('Привет');
  });
});
```

- [ ] **Step 2: Run — FAIL**

Run: `npx vitest run tests/lib/subtitles.test.ts`
Expected: FAIL

- [ ] **Step 3: Реализация**

`src/lib/subtitles.ts`:
```ts
export interface Cue {
  start: number;
  end: number;
  text: string;
}

export function parseTime(s: string): number {
  const parts = s.trim().replace(',', '.').split(':');
  let sec = 0;
  for (let i = 0; i < parts.length; i++) sec = sec * 60 + parseFloat(parts[i]);
  return Math.round(sec * 1000) / 1000;
}

function cleanText(t: string): string {
  return t.replace(/<[^>]+>/g, '').replace(/\{[^}]*\}/g, '').trim();
}

export function parseSrt(text: string): Cue[] {
  const blocks = text.replace(/^﻿/, '').replace(/\r/g, '').split(/\n{2,}/);
  const cues: Cue[] = [];
  blocks.forEach((block) => {
    const lines = block.split('\n');
    const ti = lines.findIndex((l) => l.indexOf('-->') >= 0);
    if (ti < 0) return;
    const m = /([\d:.,]+)\s*-->\s*([\d:.,]+)/.exec(lines[ti]);
    if (!m) return;
    const body = cleanText(lines.slice(ti + 1).join('\n'));
    if (!body) return;
    cues.push({ start: parseTime(m[1]), end: parseTime(m[2]), text: body });
  });
  return cues.sort((a, b) => a.start - b.start);
}

export function parseAss(text: string): Cue[] {
  const lines = text.replace(/\r/g, '').split('\n');
  let inEvents = false;
  let fields: string[] = [];
  const cues: Cue[] = [];
  lines.forEach((line) => {
    const l = line.trim();
    if (/^\[.*\]$/.test(l)) {
      inEvents = l.toLowerCase() === '[events]';
      return;
    }
    if (!inEvents) return;
    if (l.indexOf('Format:') === 0) {
      fields = l.slice(7).split(',').map((x) => x.trim().toLowerCase());
      return;
    }
    if (l.indexOf('Dialogue:') !== 0 || !fields.length) return;
    const rest = l.slice(9).replace(/^\s+/, '');
    const values: string[] = [];
    let cur = rest;
    for (let i = 0; i < fields.length - 1; i++) {
      const c = cur.indexOf(',');
      if (c < 0) return;
      values.push(cur.slice(0, c));
      cur = cur.slice(c + 1);
    }
    values.push(cur);
    const get = (name: string) => values[fields.indexOf(name)];
    const raw = get('text') || '';
    const body = raw.replace(/\{[^}]*\}/g, '').replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' ').trim();
    if (!body) return;
    cues.push({ start: parseTime(get('start')), end: parseTime(get('end')), text: body });
  });
  return cues.sort((a, b) => a.start - b.start);
}

export function parseSubtitles(text: string, ext: string): Cue[] {
  const e = ext.toLowerCase();
  return e === 'ass' || e === 'ssa' ? parseAss(text) : parseSrt(text);
}

export function cueAt(cues: Cue[], t: number): string {
  const active: string[] = [];
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    if (c.start > t) break;
    if (t < c.end) active.push(c.text);
  }
  return active.join('\n');
}

export function decodeText(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '');
  } catch (e) {
    return new TextDecoder('windows-1251').decode(buf);
  }
}
```

- [ ] **Step 4: Run — PASS**

Run: `npx vitest run tests/lib/subtitles.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/subtitles.ts tests/lib/subtitles.test.ts
git commit -m "feat: add SRT/VTT/ASS subtitle parsing with CP1251 fallback"
```


---

### Task 6: API — типы, HTTP-слой, клиент TorrServer

**Files:**
- Create: `src/api/types.ts`, `src/api/http.ts`, `src/api/torrserver.ts`
- Test: `tests/api/http.test.ts`, `tests/api/torrserver.test.ts`, `tests/helpers/fetchMock.ts`

**Interfaces:**
- Consumes: `TorrentFile` из `src/lib/episodes.ts`
- Produces:
  - Типы `Torrent`, `CacheState`, `ViewedEntry`, `SearchResult`, `FfprobeStream`, `FfprobeResult`, `ServerSettings` (`src/api/types.ts`)
  - `type ApiErrorKind = 'network' | 'timeout' | 'http' | 'parse'`, `interface ApiError { kind; message; status? }`, `apiError(kind, message, status?)`, `isApiError(e): e is ApiError`, `errorMessage(e: unknown): string`, `request<T>(url: string, opts?: HttpOptions): Promise<T>`, `interface HttpOptions { method?: 'GET' | 'POST'; body?: unknown; timeoutMs?: number; auth?: string; responseType?: 'json' | 'text' | 'arraybuffer' }`
  - `interface ServerConfig { url: string; user?: string; password?: string }`, `type SearchSource = 'rutor' | 'torznab'`, `normalizeServerUrl(input: string): string`, `parseTorrentData(data?: string): TorrentFile[]`
  - `class TorrServerClient` — `baseUrl`, `echo()`, `list()`, `get(hash)`, `add({link,title?,poster?,category?})`, `remove(hash)`, `loadInfo(hash)`, `files(t)`, `streamUrl(hash, fileIndex, name?)`, `videoSrc(url)`, `playlistUrl(hash)`, `allPlaylistUrl()`, `fetchText(url, timeoutMs?)`, `fetchBytes(url, timeoutMs?)`, `ffprobeAvailable()`, `probe(hash, fileIndex)`, `cache(hash)`, `viewedList()`, `setViewed(hash, fileIndex, timecode?)`, `removeViewed(hash, fileIndex?)`, `search(query, source)`, `getSettings()`, `setSettings(sets)`, `resetSettings()`

- [ ] **Step 1: Хелпер мока fetch**

`tests/helpers/fetchMock.ts`:
```ts
import { vi } from 'vitest';

export interface MockResponse {
  status?: number;
  body: string;
}

export function mockFetch(handler: (url: string, init: any) => MockResponse | Promise<MockResponse>) {
  const fn = vi.fn((url: string, init?: any) =>
    Promise.resolve(handler(url, init || {})).then((r) => {
      const status = r.status === undefined ? 200 : r.status;
      return {
        ok: status >= 200 && status < 300,
        status,
        text: () => Promise.resolve(r.body),
        arrayBuffer: () => Promise.resolve(new TextEncoder().encode(r.body).buffer),
      };
    }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}
```

- [ ] **Step 2: Тесты HTTP-слоя**

`tests/api/http.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { request, errorMessage, isApiError, apiError } from '../../src/api/http';
import { mockFetch } from '../helpers/fetchMock';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('request', () => {
  it('parses json and sends body as POST', async () => {
    const fn = mockFetch(() => ({ body: '{"a":1}' }));
    const r = await request<{ a: number }>('http://h/x', { body: { action: 'list' } });
    expect(r).toEqual({ a: 1 });
    const init = fn.mock.calls[0][1];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"action":"list"}');
    expect(init.headers['Content-Type']).toBe('application/json');
  });
  it('returns null on empty body', async () => {
    mockFetch(() => ({ body: '' }));
    expect(await request('http://h/x')).toBeNull();
  });
  it('returns text when asked', async () => {
    mockFetch(() => ({ body: 'MatriX.145.1' }));
    expect(await request('http://h/echo', { responseType: 'text' })).toBe('MatriX.145.1');
  });
  it('adds basic auth header', async () => {
    const fn = mockFetch(() => ({ body: '1' }));
    await request('http://h/x', { auth: 'dTpw' });
    expect(fn.mock.calls[0][1].headers.Authorization).toBe('Basic dTpw');
  });
  it('rejects with http error', async () => {
    mockFetch(() => ({ status: 500, body: 'oops' }));
    await expect(request('http://h/x')).rejects.toMatchObject({ kind: 'http', status: 500 });
  });
  it('rejects with parse error', async () => {
    mockFetch(() => ({ body: '<html>' }));
    await expect(request('http://h/x')).rejects.toMatchObject({ kind: 'parse' });
  });
  it('rejects with network error', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(request('http://h/x')).rejects.toMatchObject({ kind: 'network' });
  });
  it('rejects with timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const p = request('http://h/x', { timeoutMs: 1000 });
    vi.advanceTimersByTime(1001);
    await expect(p).rejects.toMatchObject({ kind: 'timeout' });
  });
});

describe('errors', () => {
  it('maps messages', () => {
    expect(errorMessage(apiError('network', 'x'))).toBe('Сервер недоступен');
    expect(errorMessage(apiError('timeout', 'x'))).toBe('Сервер не отвечает');
    expect(errorMessage(apiError('http', 'x', 404))).toBe('Ошибка сервера (404)');
    expect(errorMessage(apiError('parse', 'x'))).toBe('Некорректный ответ сервера');
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(isApiError(apiError('http', 'x'))).toBe(true);
    expect(isApiError(new Error('x'))).toBe(false);
  });
});
```

- [ ] **Step 3: Тесты клиента**

`tests/api/torrserver.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { TorrServerClient, normalizeServerUrl, parseTorrentData } from '../../src/api/torrserver';
import { mockFetch } from '../helpers/fetchMock';

afterEach(() => vi.unstubAllGlobals());

const HASH = 'c4c4bd6a4618e1042aa89649d629f85951eff546';

describe('normalizeServerUrl', () => {
  it('adds scheme and default port', () => {
    expect(normalizeServerUrl(' 192.168.1.191 ')).toBe('http://192.168.1.191:8090');
    expect(normalizeServerUrl('192.168.1.191:5665')).toBe('http://192.168.1.191:5665');
    expect(normalizeServerUrl('http://192.168.1.191:5665/')).toBe('http://192.168.1.191:5665');
    expect(normalizeServerUrl('https://ts.local')).toBe('https://ts.local');
  });
});

describe('parseTorrentData', () => {
  it('reads files from data json', () => {
    const data = JSON.stringify({ TorrServer: { Files: [{ id: 1, path: 'a/b.mkv', length: 5 }] } });
    expect(parseTorrentData(data)).toEqual([{ id: 1, path: 'a/b.mkv', length: 5 }]);
    expect(parseTorrentData('')).toEqual([]);
    expect(parseTorrentData('garbage')).toEqual([]);
    expect(parseTorrentData(undefined)).toEqual([]);
  });
});

describe('TorrServerClient', () => {
  const c = new TorrServerClient({ url: '192.168.1.191:5665' });

  it('lists torrents', async () => {
    const fn = mockFetch(() => ({ body: JSON.stringify([{ hash: HASH, title: 'T', stat: 5 }]) }));
    const list = await c.list();
    expect(list[0].hash).toBe(HASH);
    expect(fn.mock.calls[0][0]).toBe('http://192.168.1.191:5665/torrents');
    expect(JSON.parse(fn.mock.calls[0][1].body)).toEqual({ action: 'list' });
  });

  it('list returns [] for null', async () => {
    mockFetch(() => ({ body: 'null' }));
    expect(await c.list()).toEqual([]);
  });

  it('sends auth header when configured', async () => {
    const fn = mockFetch(() => ({ body: 'MatriX.145.1' }));
    const ac = new TorrServerClient({ url: 'h:1', user: 'u', password: 'p' });
    expect(await ac.echo()).toBe('MatriX.145.1');
    expect(fn.mock.calls[0][1].headers.Authorization).toBe('Basic ' + btoa('u:p'));
  });

  it('adds torrent', async () => {
    const fn = mockFetch(() => ({ body: JSON.stringify({ hash: HASH, title: 'X', stat: 1 }) }));
    await c.add({ link: 'magnet:?xt=urn:btih:' + HASH, title: 'X', category: 'movie' });
    expect(JSON.parse(fn.mock.calls[0][1].body)).toEqual({
      action: 'add', link: 'magnet:?xt=urn:btih:' + HASH, title: 'X', poster: '', category: 'movie', save_to_db: true,
    });
  });

  it('files() prefers file_stats then data', () => {
    expect(c.files({ hash: HASH, title: 'T', stat: 3, file_stats: [{ id: 2, path: 'x.mkv', length: 1 }] })[0].id).toBe(2);
    const data = JSON.stringify({ TorrServer: { Files: [{ id: 7, path: 'y.mkv', length: 1 }] } });
    expect(c.files({ hash: HASH, title: 'T', stat: 5, data })[0].id).toBe(7);
  });

  it('builds stream urls', () => {
    expect(c.streamUrl(HASH, 2, 'Ep 01.mkv')).toBe(`http://192.168.1.191:5665/stream/Ep%2001.mkv?link=${HASH}&index=2&play`);
    expect(c.playlistUrl(HASH)).toBe(`http://192.168.1.191:5665/playlist?hash=${HASH}`);
    expect(c.allPlaylistUrl()).toBe('http://192.168.1.191:5665/playlistall/all.m3u');
  });

  it('videoSrc injects credentials only for own server', () => {
    const ac = new TorrServerClient({ url: 'http://h:1', user: 'u', password: 'p w' });
    expect(ac.videoSrc('http://h:1/stream/a?link=x')).toBe('http://u:p%20w@h:1/stream/a?link=x');
    expect(ac.videoSrc('http://other/a.mp4')).toBe('http://other/a.mp4');
    expect(c.videoSrc('http://192.168.1.191:5665/x')).toBe('http://192.168.1.191:5665/x');
  });

  it('searches with trailing slash path', async () => {
    const fn = mockFetch(() => ({ body: '[]' }));
    await c.search('matrix x', 'rutor');
    await c.search('matrix', 'torznab');
    expect(fn.mock.calls[0][0]).toBe('http://192.168.1.191:5665/search/?query=matrix%20x');
    expect(fn.mock.calls[1][0]).toBe('http://192.168.1.191:5665/torznab/search/?query=matrix');
  });

  it('sets viewed with timecode', async () => {
    const fn = mockFetch(() => ({ body: '' }));
    await c.setViewed(HASH, 3, 125);
    expect(JSON.parse(fn.mock.calls[0][1].body)).toEqual({ action: 'set', hash: HASH, file_index: 3, timecode: 125 });
  });

  it('probe returns null on failure', async () => {
    mockFetch(() => ({ status: 500, body: '' }));
    expect(await c.probe(HASH, 1)).toBeNull();
  });

  it('fetchBytes returns ArrayBuffer', async () => {
    mockFetch(() => ({ body: 'abc' }));
    const b = await c.fetchBytes('http://192.168.1.191:5665/stream/s.srt?link=x&index=1&play');
    expect(b.byteLength).toBe(3);
  });
});
```

- [ ] **Step 4: Run — FAIL**

Run: `npx vitest run tests/api`
Expected: FAIL (modules not found)

- [ ] **Step 5: src/api/types.ts**

```ts
import type { TorrentFile } from '../lib/episodes';

export type { TorrentFile };

export interface Torrent {
  hash: string;
  title: string;
  name?: string;
  category?: string;
  poster?: string;
  data?: string;
  timestamp?: number;
  stat: number;
  stat_string?: string;
  torrent_size?: number;
  loaded_size?: number;
  preloaded_bytes?: number;
  download_speed?: number;
  upload_speed?: number;
  total_peers?: number;
  active_peers?: number;
  connected_seeders?: number;
  file_stats?: TorrentFile[];
}

export interface CacheState {
  Hash?: string;
  Capacity: number;
  Filled: number;
  PiecesLength: number;
  PiecesCount: number;
  Torrent?: Torrent;
}

export interface ViewedEntry {
  hash: string;
  file_index: number;
  timecode?: number;
}

export interface SearchResult {
  Title: string;
  Categories: string;
  Size: string;
  CreateDate: string;
  Tracker: string;
  Link: string;
  Magnet: string;
  Hash: string;
  Peer: number;
  Seed: number;
}

export interface FfprobeStream {
  index: number;
  codec_type: string;
  codec_name: string;
  codec_tag_string?: string;
  profile?: string;
  channels?: number;
  width?: number;
  height?: number;
  color_transfer?: string;
  disposition?: { default?: number; forced?: number };
  tags?: { [k: string]: string };
}

export interface FfprobeResult {
  streams: FfprobeStream[];
  format?: { duration?: string; bit_rate?: string; format_name?: string };
}

export interface ServerSettings {
  CacheSize: number;
  PreloadCache: number;
  ReaderReadAHead: number;
  ConnectionsLimit: number;
  DownloadRateLimit: number;
  UploadRateLimit: number;
  TorrentDisconnectTimeout: number;
  TrackTimecode?: boolean;
  [key: string]: unknown;
}
```

- [ ] **Step 6: src/api/http.ts**

```ts
export type ApiErrorKind = 'network' | 'timeout' | 'http' | 'parse';

export interface ApiError {
  kind: ApiErrorKind;
  message: string;
  status?: number;
}

// Plain Error + fields: subclassing Error breaks instanceof after ES5 transpilation.
export function apiError(kind: ApiErrorKind, message: string, status?: number): Error & ApiError {
  const e = new Error(message) as Error & ApiError;
  e.kind = kind;
  if (status !== undefined) e.status = status;
  return e;
}

export function isApiError(e: unknown): e is ApiError {
  return !!e && typeof (e as ApiError).kind === 'string';
}

export function errorMessage(e: unknown): string {
  if (isApiError(e)) {
    switch (e.kind) {
      case 'network': return 'Сервер недоступен';
      case 'timeout': return 'Сервер не отвечает';
      case 'http': return 'Ошибка сервера (' + e.status + ')';
      case 'parse': return 'Некорректный ответ сервера';
    }
  }
  if (e && typeof (e as Error).message === 'string') return (e as Error).message;
  return 'Неизвестная ошибка';
}

export interface HttpOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  timeoutMs?: number;
  auth?: string;
  responseType?: 'json' | 'text' | 'arraybuffer';
}

export function request<T>(url: string, opts: HttpOptions = {}): Promise<T> {
  const headers: { [k: string]: string } = {};
  const hasBody = opts.body !== undefined;
  if (hasBody) headers['Content-Type'] = 'application/json';
  if (opts.auth) headers['Authorization'] = 'Basic ' + opts.auth;
  const type = opts.responseType || 'json';

  const p = fetch(url, {
    method: opts.method || (hasBody ? 'POST' : 'GET'),
    headers,
    body: hasBody ? JSON.stringify(opts.body) : undefined,
  }).then(
    (res) => {
      if (!res.ok) throw apiError('http', 'HTTP ' + res.status, res.status);
      return type === 'arraybuffer' ? res.arrayBuffer() : res.text();
    },
    () => {
      throw apiError('network', 'Network error');
    },
  ).then((data: string | ArrayBuffer) => {
    if (type !== 'json') return data as unknown as T;
    const text = data as string;
    if (!text) return null as unknown as T;
    try {
      return JSON.parse(text) as T;
    } catch (e) {
      throw apiError('parse', 'Bad JSON');
    }
  });

  const timeout = opts.timeoutMs === undefined ? 5000 : opts.timeoutMs;
  if (timeout <= 0) return p;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(apiError('timeout', 'Timeout')), timeout);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}
```

- [ ] **Step 7: src/api/torrserver.ts**

```ts
import { request, HttpOptions } from './http';
import type { Torrent, CacheState, ViewedEntry, SearchResult, FfprobeResult, ServerSettings } from './types';
import type { TorrentFile } from '../lib/episodes';

export interface ServerConfig {
  url: string;
  user?: string;
  password?: string;
}

export type SearchSource = 'rutor' | 'torznab';

export function normalizeServerUrl(input: string): string {
  let u = input.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(u)) {
    u = 'http://' + u;
    if (!/:\d+$/.test(u)) u += ':8090';
  }
  return u;
}

export function parseTorrentData(data?: string): TorrentFile[] {
  if (!data) return [];
  try {
    const d = JSON.parse(data);
    return (d && d.TorrServer && d.TorrServer.Files) || [];
  } catch (e) {
    return [];
  }
}

export class TorrServerClient {
  readonly baseUrl: string;
  private readonly auth?: string;
  private readonly cfg: ServerConfig;

  constructor(cfg: ServerConfig) {
    this.cfg = cfg;
    this.baseUrl = normalizeServerUrl(cfg.url);
    this.auth = cfg.user ? btoa(unescape(encodeURIComponent(cfg.user + ':' + (cfg.password || '')))) : undefined;
  }

  private call<T>(path: string, opts: HttpOptions = {}): Promise<T> {
    return request<T>(this.baseUrl + path, { ...opts, auth: this.auth });
  }

  private ownAuth(url: string): string | undefined {
    return url.indexOf(this.baseUrl) === 0 ? this.auth : undefined;
  }

  echo(): Promise<string> {
    return this.call<string>('/echo', { responseType: 'text' }).then((s) => (s || '').trim());
  }

  list(): Promise<Torrent[]> {
    return this.call<Torrent[] | null>('/torrents', { body: { action: 'list' } }).then((r) => r || []);
  }

  get(hash: string): Promise<Torrent> {
    return this.call<Torrent>('/torrents', { body: { action: 'get', hash } });
  }

  add(p: { link: string; title?: string; poster?: string; category?: string }): Promise<Torrent> {
    return this.call<Torrent>('/torrents', {
      body: { action: 'add', link: p.link, title: p.title || '', poster: p.poster || '', category: p.category || '', save_to_db: true },
      timeoutMs: 30000,
    });
  }

  remove(hash: string): Promise<void> {
    return this.call<unknown>('/torrents', { body: { action: 'rem', hash } }).then(() => undefined);
  }

  /** Activates the torrent and waits for metadata (file list). */
  loadInfo(hash: string): Promise<Torrent> {
    return this.call<Torrent>('/stream?link=' + hash + '&stat', { timeoutMs: 60000 });
  }

  files(t: Torrent): TorrentFile[] {
    return t.file_stats && t.file_stats.length ? t.file_stats : parseTorrentData(t.data);
  }

  streamUrl(hash: string, fileIndex: number, name = 'file'): string {
    return this.baseUrl + '/stream/' + encodeURIComponent(name) + '?link=' + hash + '&index=' + fileIndex + '&play';
  }

  /** URL for <video>: media elements can't send headers, so credentials go into the URL. */
  videoSrc(url: string): string {
    if (!this.cfg.user || url.indexOf(this.baseUrl) !== 0) return url;
    const cred = encodeURIComponent(this.cfg.user) + ':' + encodeURIComponent(this.cfg.password || '') + '@';
    return url.replace(/^(https?:\/\/)/i, '$1' + cred);
  }

  playlistUrl(hash: string): string {
    return this.baseUrl + '/playlist?hash=' + hash;
  }

  allPlaylistUrl(): string {
    return this.baseUrl + '/playlistall/all.m3u';
  }

  fetchText(url: string, timeoutMs = 15000): Promise<string> {
    return request<string>(url, { responseType: 'text', timeoutMs, auth: this.ownAuth(url) });
  }

  fetchBytes(url: string, timeoutMs = 30000): Promise<ArrayBuffer> {
    return request<ArrayBuffer>(url, { responseType: 'arraybuffer', timeoutMs, auth: this.ownAuth(url) });
  }

  ffprobeAvailable(): Promise<boolean> {
    return this.call<{ available: boolean } | null>('/ffp/status').then((r) => !!(r && r.available), () => false);
  }

  probe(hash: string, fileIndex: number): Promise<FfprobeResult | null> {
    return this.call<FfprobeResult | null>('/ffp/' + hash + '/' + fileIndex, { timeoutMs: 30000 }).then(
      (r) => (r && r.streams ? r : null),
      () => null,
    );
  }

  cache(hash: string): Promise<CacheState> {
    return this.call<CacheState>('/cache', { body: { action: 'get', hash } });
  }

  viewedList(): Promise<ViewedEntry[]> {
    return this.call<ViewedEntry[] | null>('/viewed', { body: { action: 'list' } }).then((r) => r || []);
  }

  setViewed(hash: string, fileIndex: number, timecode = 0): Promise<void> {
    return this.call<unknown>('/viewed', { body: { action: 'set', hash, file_index: fileIndex, timecode } }).then(() => undefined);
  }

  removeViewed(hash: string, fileIndex?: number): Promise<void> {
    const body = fileIndex === undefined ? { action: 'rem', hash } : { action: 'rem', hash, file_index: fileIndex };
    return this.call<unknown>('/viewed', { body }).then(() => undefined);
  }

  search(query: string, source: SearchSource): Promise<SearchResult[]> {
    const path = source === 'torznab' ? '/torznab/search/' : '/search/';
    return this.call<SearchResult[] | null>(path + '?query=' + encodeURIComponent(query), { timeoutMs: 45000 }).then((r) => r || []);
  }

  getSettings(): Promise<ServerSettings> {
    return this.call<ServerSettings>('/settings', { body: { action: 'get' } });
  }

  setSettings(sets: ServerSettings): Promise<void> {
    return this.call<unknown>('/settings', { body: { action: 'set', sets } }).then(() => undefined);
  }

  resetSettings(): Promise<void> {
    return this.call<unknown>('/settings', { body: { action: 'def' } }).then(() => undefined);
  }
}
```

- [ ] **Step 8: Run — PASS**

Run: `npx vitest run tests/api`
Expected: PASS

- [ ] **Step 9: Проверка против реального сервера (ручная)**

Run:
```bash
npx tsx -e "import('./src/api/torrserver.ts').then(async m=>{const c=new m.TorrServerClient({url:'192.168.1.191:5665'});console.log(await c.echo());const l=await c.list();console.log(l.length, c.files(l[0]).length);console.log((await c.search('matrix','rutor')).length)})"
```
Expected: версия `MatriX...`, число торрентов > 0, файлов > 0, результатов поиска > 0. (Если `tsx` не установлен, npx установит его временно. Если сервер недоступен — пропустить шаг и указать это в отчёте.)

- [ ] **Step 10: Commit**

```bash
git add src/api tests/api tests/helpers
git commit -m "feat: add TorrServer API client with timeouts and typed errors"
```

---

### Task 7: lib/tracks — языки и дорожки

**Files:**
- Create: `src/lib/tracks.ts`
- Test: `tests/lib/tracks.test.ts`

**Interfaces:**
- Consumes: `FfprobeResult`, `FfprobeStream` из `src/api/types.ts`
- Produces:
  - `normalizeLang(s?: string): string` (`'rus'|'Russian'|'русский'` → `'ru'`)
  - `guessLangFromName(name: string): string`
  - `interface TrackInfo { index: number; kind: 'audio' | 'subtitle'; codec: string; language: string; title: string; channels?: number; isDefault: boolean; forced: boolean }` — `index` = порядковый номер среди дорожек того же типа
  - `tracksFromProbe(probe: FfprobeResult | null): TrackInfo[]`
  - `describeTrack(t: TrackInfo): string`
  - `pickTrack(tracks: { language: string; isDefault?: boolean }[], preferred: string): number` — индекс или -1
  - `findLang(tracks: { language: string }[], lang: string): number` — строгое совпадение или -1
  - `LANG_OPTIONS: { value: string; label: string }[]`

- [ ] **Step 1: Тесты**

`tests/lib/tracks.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { normalizeLang, guessLangFromName, tracksFromProbe, describeTrack, pickTrack, findLang } from '../../src/lib/tracks';
import type { FfprobeResult } from '../../src/api/types';

const probe: FfprobeResult = {
  streams: [
    { index: 0, codec_type: 'video', codec_name: 'hevc' },
    { index: 1, codec_type: 'audio', codec_name: 'ac3', channels: 6, tags: { language: 'rus', title: 'Дубляж' }, disposition: { default: 1 } },
    { index: 2, codec_type: 'audio', codec_name: 'eac3', channels: 8, tags: { language: 'eng' } },
    { index: 3, codec_type: 'subtitle', codec_name: 'subrip', tags: { language: 'rus', title: 'Forced' }, disposition: { forced: 1 } },
  ],
};

describe('normalizeLang', () => {
  it('normalizes codes and names', () => {
    expect(normalizeLang('rus')).toBe('ru');
    expect(normalizeLang('Russian')).toBe('ru');
    expect(normalizeLang('русский')).toBe('ru');
    expect(normalizeLang('eng')).toBe('en');
    expect(normalizeLang('ukr')).toBe('uk');
    expect(normalizeLang('und')).toBe('');
    expect(normalizeLang(undefined)).toBe('');
    expect(normalizeLang('pt-BR')).toBe('pt');
  });
});

describe('guessLangFromName', () => {
  it('finds language token', () => {
    expect(guessLangFromName('rus.forced')).toBe('ru');
    expect(guessLangFromName('Show.S01E01.English')).toBe('en');
    expect(guessLangFromName('Subs')).toBe('');
  });
});

describe('tracksFromProbe', () => {
  it('extracts audio and subtitle tracks with per-kind index', () => {
    const t = tracksFromProbe(probe);
    expect(t).toEqual([
      { index: 0, kind: 'audio', codec: 'ac3', language: 'ru', title: 'Дубляж', channels: 6, isDefault: true, forced: false },
      { index: 1, kind: 'audio', codec: 'eac3', language: 'en', title: '', channels: 8, isDefault: false, forced: false },
      { index: 0, kind: 'subtitle', codec: 'subrip', language: 'ru', title: 'Forced', channels: undefined, isDefault: false, forced: true },
    ]);
    expect(tracksFromProbe(null)).toEqual([]);
  });
  it('describes tracks', () => {
    const t = tracksFromProbe(probe);
    expect(describeTrack(t[0])).toBe('RU · AC3 5.1 · Дубляж');
    expect(describeTrack(t[1])).toBe('EN · EAC3 7.1');
    expect(describeTrack(t[2])).toBe('RU · SUBRIP · Forced');
  });
});

describe('pickTrack / findLang', () => {
  const list = [{ language: 'en', isDefault: true }, { language: 'ru' }];
  it('prefers language, then default, then first', () => {
    expect(pickTrack(list, 'ru')).toBe(1);
    expect(pickTrack(list, 'de')).toBe(0);
    expect(pickTrack([{ language: 'en' }, { language: 'de', isDefault: true }], 'fr')).toBe(1);
    expect(pickTrack([], 'ru')).toBe(-1);
  });
  it('findLang is strict', () => {
    expect(findLang(list, 'ru')).toBe(1);
    expect(findLang(list, 'de')).toBe(-1);
  });
});
```

- [ ] **Step 2: Run — FAIL**

Run: `npx vitest run tests/lib/tracks.test.ts`
Expected: FAIL

- [ ] **Step 3: Реализация**

`src/lib/tracks.ts`:
```ts
import type { FfprobeResult } from '../api/types';

const LANG: { [k: string]: string } = {
  ru: 'ru', rus: 'ru', russian: 'ru', 'русский': 'ru',
  en: 'en', eng: 'en', english: 'en', 'английский': 'en',
  uk: 'uk', ukr: 'uk', ukrainian: 'uk', 'украинский': 'uk',
  de: 'de', ger: 'de', deu: 'de', german: 'de',
  fr: 'fr', fre: 'fr', fra: 'fr', french: 'fr',
  es: 'es', spa: 'es', spanish: 'es',
  it: 'it', ita: 'it', italian: 'it',
  ja: 'ja', jpn: 'ja', japanese: 'ja',
  zh: 'zh', chi: 'zh', zho: 'zh', chinese: 'zh',
  ko: 'ko', kor: 'ko', korean: 'ko',
  und: '',
};

export const LANG_OPTIONS: { value: string; label: string }[] = [
  { value: 'ru', label: 'Русский' },
  { value: 'en', label: 'English' },
  { value: 'uk', label: 'Українська' },
  { value: 'de', label: 'Deutsch' },
  { value: 'fr', label: 'Français' },
  { value: 'es', label: 'Español' },
  { value: 'ja', label: '日本語' },
];

export function normalizeLang(s?: string): string {
  if (!s) return '';
  const k = s.toLowerCase().trim();
  if (Object.prototype.hasOwnProperty.call(LANG, k)) return LANG[k];
  return k.split(/[-_]/)[0].slice(0, 2);
}

export function guessLangFromName(name: string): string {
  const tokens = name.toLowerCase().split(/[ ._\-()[\]]+/);
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (Object.prototype.hasOwnProperty.call(LANG, tokens[i]) && LANG[tokens[i]]) return LANG[tokens[i]];
  }
  return '';
}

export interface TrackInfo {
  index: number;
  kind: 'audio' | 'subtitle';
  codec: string;
  language: string;
  title: string;
  channels?: number;
  isDefault: boolean;
  forced: boolean;
}

export function tracksFromProbe(probe: FfprobeResult | null): TrackInfo[] {
  if (!probe) return [];
  const counters = { audio: 0, subtitle: 0 };
  const out: TrackInfo[] = [];
  probe.streams.forEach((s) => {
    if (s.codec_type !== 'audio' && s.codec_type !== 'subtitle') return;
    const kind = s.codec_type as 'audio' | 'subtitle';
    const tags = s.tags || {};
    const disp = s.disposition || {};
    out.push({
      index: counters[kind]++,
      kind,
      codec: s.codec_name || '',
      language: normalizeLang(tags.language),
      title: tags.title || '',
      channels: s.channels,
      isDefault: disp.default === 1,
      forced: disp.forced === 1,
    });
  });
  return out;
}

function channelLabel(n?: number): string {
  if (!n) return '';
  if (n === 1) return 'mono';
  if (n === 2) return '2.0';
  if (n === 6) return '5.1';
  if (n === 8) return '7.1';
  return n + 'ch';
}

export function describeTrack(t: TrackInfo): string {
  const codec = (t.codec.toUpperCase() + ' ' + channelLabel(t.channels)).trim();
  return [t.language.toUpperCase(), codec, t.title].filter(Boolean).join(' · ');
}

export function findLang(tracks: { language: string }[], lang: string): number {
  if (!lang) return -1;
  for (let i = 0; i < tracks.length; i++) if (normalizeLang(tracks[i].language) === lang) return i;
  return -1;
}

export function pickTrack(tracks: { language: string; isDefault?: boolean }[], preferred: string): number {
  if (!tracks.length) return -1;
  const byLang = findLang(tracks, preferred);
  if (byLang >= 0) return byLang;
  for (let i = 0; i < tracks.length; i++) if (tracks[i].isDefault) return i;
  return 0;
}
```

- [ ] **Step 4: Run — PASS**

Run: `npx vitest run tests/lib/tracks.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/tracks.ts tests/lib/tracks.test.ts
git commit -m "feat: add track language helpers"
```

---

### Task 8: Платформа — клавиши пульта, Luna, автопоиск серверов

**Files:**
- Create: `src/platform/keys.ts`, `src/platform/luna.ts`, `src/platform/webosMedia.ts`, `src/api/discovery.ts`
- Test: `tests/platform/keys.test.ts`, `tests/api/discovery.test.ts`, `tests/platform/webosMedia.test.ts`

**Interfaces:**
- Consumes: `request` из `src/api/http.ts`
- Produces:
  - `type KeyAction = 'left' | 'right' | 'up' | 'down' | 'enter' | 'back' | 'play' | 'pause' | 'playpause' | 'stop' | 'ff' | 'rw' | 'next' | 'prev' | 'red' | 'green' | 'yellow' | 'blue' | 'info'`, `keyAction(e: { keyCode: number; key?: string }): KeyAction | null`
  - `hasLuna(): boolean`, `lunaCall<T>(uri: string, params?: object, timeoutMs?: number): Promise<T>`
  - `selectAudioTrack(video: HTMLVideoElement, index: number): boolean`, `selectTextTrack(video: HTMLVideoElement, index: number): boolean` (index -1 = выключить), `audioTrackList(video): { language: string; label: string }[]`, `textTrackList(video): { language: string; label: string }[]`
  - `interface FoundServer { url: string; version: string }`, `DEFAULT_PORTS`, `subnetOf(ip: string): string | null`, `candidateSubnets(localIp: string | null, knownUrls: string[]): string[]`, `probeEcho(url: string, timeoutMs: number): Promise<string | null>`, `discover(opts: DiscoverOptions): Promise<FoundServer[]>`, `getLocalIp(): Promise<string | null>`

- [ ] **Step 1: Тесты**

`tests/platform/keys.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { keyAction } from '../../src/platform/keys';

describe('keyAction', () => {
  it('maps remote codes', () => {
    expect(keyAction({ keyCode: 37 })).toBe('left');
    expect(keyAction({ keyCode: 13 })).toBe('enter');
    expect(keyAction({ keyCode: 461 })).toBe('back');
    expect(keyAction({ keyCode: 415 })).toBe('play');
    expect(keyAction({ keyCode: 19 })).toBe('pause');
    expect(keyAction({ keyCode: 413 })).toBe('stop');
    expect(keyAction({ keyCode: 417 })).toBe('ff');
    expect(keyAction({ keyCode: 412 })).toBe('rw');
    expect(keyAction({ keyCode: 33 })).toBe('next');
    expect(keyAction({ keyCode: 34 })).toBe('prev');
    expect(keyAction({ keyCode: 403 })).toBe('red');
    expect(keyAction({ keyCode: 404 })).toBe('green');
    expect(keyAction({ keyCode: 405 })).toBe('yellow');
    expect(keyAction({ keyCode: 406 })).toBe('blue');
    expect(keyAction({ keyCode: 457 })).toBe('info');
  });
  it('maps desktop keys for development', () => {
    expect(keyAction({ keyCode: 27 })).toBe('back');
    expect(keyAction({ keyCode: 8 })).toBe('back');
    expect(keyAction({ keyCode: 32 })).toBe('playpause');
    expect(keyAction({ keyCode: 112 })).toBe('red');
    expect(keyAction({ keyCode: 73 })).toBe('info');
  });
  it('returns null for others', () => expect(keyAction({ keyCode: 65 })).toBeNull());
});
```

`tests/api/discovery.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { subnetOf, candidateSubnets, discover } from '../../src/api/discovery';

describe('subnet helpers', () => {
  it('subnetOf', () => {
    expect(subnetOf('192.168.1.191')).toBe('192.168.1');
    expect(subnetOf('bad')).toBeNull();
  });
  it('candidateSubnets dedups and orders', () => {
    expect(candidateSubnets('10.0.0.7', ['http://192.168.1.191:5665', 'http://10.0.0.2:8090'])).toEqual([
      '10.0.0', '192.168.1', '192.168.0',
    ]);
    expect(candidateSubnets(null, [])).toEqual(['192.168.1', '192.168.0']);
  });
});

describe('discover', () => {
  it('scans hosts and ports with injected probe', async () => {
    const progress: number[] = [];
    const found = await discover({
      subnets: ['10.0.0'],
      probe: (url) => Promise.resolve(url === 'http://10.0.0.5:8090' ? 'MatriX.145.1' : null),
      onProgress: (done, total) => { if (done === total) progress.push(total); },
    });
    expect(found).toEqual([{ url: 'http://10.0.0.5:8090', version: 'MatriX.145.1' }]);
    expect(progress).toEqual([508]);
  });
  it('treats probe rejection as miss', async () => {
    const found = await discover({ subnets: ['10.0.1'], ports: [8090], probe: () => Promise.reject(new Error('x')) });
    expect(found).toEqual([]);
  });
});
```

`tests/platform/webosMedia.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { selectAudioTrack, selectTextTrack, audioTrackList } from '../../src/platform/webosMedia';

function fakeVideo(audio: any[], text: any[]): HTMLVideoElement {
  const at: any = audio.slice();
  const tt: any = text.slice();
  return { audioTracks: at, textTracks: tt } as unknown as HTMLVideoElement;
}

describe('webosMedia', () => {
  it('enables only the chosen audio track', () => {
    const v = fakeVideo([{ enabled: true, language: 'en', label: '' }, { enabled: false, language: 'ru', label: 'Dub' }], []);
    expect(selectAudioTrack(v, 1)).toBe(true);
    expect((v as any).audioTracks.map((t: any) => t.enabled)).toEqual([false, true]);
    expect(audioTrackList(v)).toEqual([{ language: 'en', label: 'Дорожка 1' }, { language: 'ru', label: 'Dub' }]);
  });
  it('shows chosen text track and disables others', () => {
    const v = fakeVideo([], [{ mode: 'showing' }, { mode: 'disabled' }]);
    expect(selectTextTrack(v, 1)).toBe(true);
    expect((v as any).textTracks.map((t: any) => t.mode)).toEqual(['disabled', 'showing']);
    selectTextTrack(v, -1);
    expect((v as any).textTracks.map((t: any) => t.mode)).toEqual(['disabled', 'disabled']);
  });
  it('returns false without track APIs and Luna', () => {
    const v = {} as HTMLVideoElement;
    expect(selectAudioTrack(v, 0)).toBe(false);
    expect(selectTextTrack(v, 0)).toBe(false);
  });
});
```

- [ ] **Step 2: Run — FAIL**

Run: `npx vitest run tests/platform tests/api/discovery.test.ts`
Expected: FAIL

- [ ] **Step 3: src/platform/keys.ts**

```ts
export type KeyAction =
  | 'left' | 'right' | 'up' | 'down' | 'enter' | 'back'
  | 'play' | 'pause' | 'playpause' | 'stop' | 'ff' | 'rw' | 'next' | 'prev'
  | 'red' | 'green' | 'yellow' | 'blue' | 'info';

const MAP: { [code: number]: KeyAction } = {
  37: 'left', 38: 'up', 39: 'right', 40: 'down', 13: 'enter',
  461: 'back', 27: 'back', 8: 'back',
  415: 'play', 19: 'pause', 179: 'playpause', 10252: 'playpause', 32: 'playpause',
  413: 'stop', 417: 'ff', 412: 'rw', 33: 'next', 34: 'prev', 78: 'next', 80: 'prev',
  403: 'red', 404: 'green', 405: 'yellow', 406: 'blue',
  112: 'red', 113: 'green', 114: 'yellow', 115: 'blue',
  457: 'info', 73: 'info',
};

export function keyAction(e: { keyCode: number; key?: string }): KeyAction | null {
  return MAP[e.keyCode] || null;
}
```

- [ ] **Step 4: src/platform/luna.ts**

```ts
declare global {
  interface Window {
    PalmServiceBridge?: new () => {
      onservicecallback: (msg: string) => void;
      call: (uri: string, params: string) => void;
    };
  }
}

export function hasLuna(): boolean {
  return typeof window !== 'undefined' && typeof window.PalmServiceBridge === 'function';
}

export function lunaCall<T = any>(uri: string, params: object = {}, timeoutMs = 3000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (!hasLuna()) {
      reject(new Error('Luna unavailable'));
      return;
    }
    const bridge = new window.PalmServiceBridge!();
    const timer = setTimeout(() => reject(new Error('Luna timeout')), timeoutMs);
    bridge.onservicecallback = (msg: string) => {
      clearTimeout(timer);
      try {
        const r = JSON.parse(msg);
        if (r.returnValue === false) reject(new Error(r.errorText || 'Luna error'));
        else resolve(r as T);
      } catch (e) {
        reject(e);
      }
    };
    bridge.call(uri, JSON.stringify(params));
  });
}
```

- [ ] **Step 5: src/platform/webosMedia.ts**

```ts
import { hasLuna, lunaCall } from './luna';

interface TrackLike {
  enabled?: boolean;
  mode?: string;
  language?: string;
  label?: string;
}

function list(x: unknown): TrackLike[] | null {
  const l = x as { length?: number } | undefined;
  if (!l || typeof l.length !== 'number') return null;
  const out: TrackLike[] = [];
  for (let i = 0; i < (l.length as number); i++) out.push((l as any)[i]);
  return out;
}

function mediaId(video: HTMLVideoElement): string | undefined {
  return (video as any).mediaId;
}

export function audioTrackList(video: HTMLVideoElement): { language: string; label: string }[] {
  const at = list((video as any).audioTracks) || [];
  return at.map((t, i) => ({ language: t.language || '', label: t.label || 'Дорожка ' + (i + 1) }));
}

export function textTrackList(video: HTMLVideoElement): { language: string; label: string }[] {
  const tt = list((video as any).textTracks) || [];
  return tt.map((t, i) => ({ language: t.language || '', label: t.label || 'Субтитры ' + (i + 1) }));
}

export function selectAudioTrack(video: HTMLVideoElement, index: number): boolean {
  const at = list((video as any).audioTracks);
  if (at && at.length > index) {
    at.forEach((t, i) => { t.enabled = i === index; });
    return true;
  }
  const id = mediaId(video);
  if (id && hasLuna()) {
    lunaCall('luna://com.webos.media/selectTrack', { mediaId: id, type: 'audio', index }).catch(() => undefined);
    return true;
  }
  return false;
}

export function selectTextTrack(video: HTMLVideoElement, index: number): boolean {
  const tt = list((video as any).textTracks);
  if (tt && tt.length > 0) {
    tt.forEach((t, i) => { t.mode = i === index ? 'showing' : 'disabled'; });
    return true;
  }
  const id = mediaId(video);
  if (id && hasLuna()) {
    if (index < 0) {
      lunaCall('luna://com.webos.media/setSubtitleEnable', { mediaId: id, enable: false }).catch(() => undefined);
    } else {
      lunaCall('luna://com.webos.media/selectTrack', { mediaId: id, type: 'text', index })
        .then(() => lunaCall('luna://com.webos.media/setSubtitleEnable', { mediaId: id, enable: true }))
        .catch(() => undefined);
    }
    return true;
  }
  return false;
}
```

- [ ] **Step 6: src/api/discovery.ts**

```ts
import { request } from './http';
import { lunaCall } from '../platform/luna';

export interface FoundServer {
  url: string;
  version: string;
}

export const DEFAULT_PORTS = [8090, 5665];

export function subnetOf(ip: string): string | null {
  const m = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/.exec(ip);
  return m ? m[1] : null;
}

export function candidateSubnets(localIp: string | null, knownUrls: string[]): string[] {
  const out: string[] = [];
  const add = (s: string | null) => { if (s && out.indexOf(s) < 0) out.push(s); };
  add(localIp ? subnetOf(localIp) : null);
  knownUrls.forEach((u) => {
    const m = /^https?:\/\/([\d.]+)(?::\d+)?/.exec(u);
    add(m ? subnetOf(m[1]) : null);
  });
  add('192.168.1');
  add('192.168.0');
  return out;
}

export function probeEcho(url: string, timeoutMs: number): Promise<string | null> {
  return request<string>(url + '/echo', { responseType: 'text', timeoutMs }).then(
    (t) => {
      const v = (t || '').trim();
      return v && v.length < 64 && v.indexOf('<') < 0 ? v : null;
    },
    () => null,
  );
}

export interface DiscoverOptions {
  subnets: string[];
  ports?: number[];
  concurrency?: number;
  timeoutMs?: number;
  probe?: (url: string, timeoutMs: number) => Promise<string | null>;
  onProgress?: (done: number, total: number) => void;
  onFound?: (s: FoundServer) => void;
}

export function discover(o: DiscoverOptions): Promise<FoundServer[]> {
  const ports = o.ports || DEFAULT_PORTS;
  const urls: string[] = [];
  o.subnets.forEach((sn) => {
    for (let i = 1; i <= 254; i++) ports.forEach((p) => urls.push('http://' + sn + '.' + i + ':' + p));
  });
  const probe = o.probe || probeEcho;
  const timeout = o.timeoutMs || 1200;
  const conc = o.concurrency || 32;
  const found: FoundServer[] = [];
  let next = 0;
  let done = 0;
  let active = 0;
  return new Promise((resolve) => {
    if (!urls.length) {
      resolve(found);
      return;
    }
    const launch = () => {
      while (active < conc && next < urls.length) {
        const url = urls[next++];
        active++;
        probe(url, timeout)
          .then((v) => v, () => null)
          .then((version) => {
            active--;
            done++;
            if (version) {
              const s = { url, version };
              found.push(s);
              if (o.onFound) o.onFound(s);
            }
            if (o.onProgress) o.onProgress(done, urls.length);
            if (done === urls.length) resolve(found);
            else launch();
          });
      }
    };
    launch();
  });
}

export function getLocalIp(): Promise<string | null> {
  return lunaCall<any>('luna://com.webos.service.connectionmanager/getStatus', {}, 2000).then(
    (r) => (r.wired && r.wired.ipAddress) || (r.wifi && r.wifi.ipAddress) || null,
    () => null,
  );
}
```

- [ ] **Step 7: Run — PASS**

Run: `npx vitest run tests/platform tests/api/discovery.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/platform src/api/discovery.ts tests/platform tests/api/discovery.test.ts
git commit -m "feat: add remote key mapping, Luna bridge, track selection and server discovery"
```

---

### Task 9: Хранилище — серверы, настройки, прогресс, кэш библиотеки

**Files:**
- Create: `src/store/storage.ts`, `src/store/servers.ts`, `src/store/settings.ts`, `src/store/progress.ts`, `src/store/library.ts`
- Test: `tests/store/servers.test.ts`, `tests/store/settings.test.ts`, `tests/store/progress.test.ts`, `tests/store/library.test.ts`

**Interfaces:**
- Consumes: `TorrServerClient`, `normalizeServerUrl` (Task 6); `Torrent`, `ViewedEntry` (Task 6)
- Produces:
  - `loadJson<T>(key: string, fallback: T): T`, `saveJson(key: string, value: unknown): void`
  - `interface SavedServer { id: string; name: string; url: string; user?: string; password?: string }`; signals `servers`, `activeServerId`, computed `activeServer`, `client` (`TorrServerClient | null`); `addServer(input: { name?: string; url: string; user?: string; password?: string }): SavedServer`, `removeServer(id)`, `setActiveServer(id: string | null)`, `requireClient(): TorrServerClient`
  - `interface AppSettings { audioLang: string; subLang: string; subtitlesOn: boolean; seekStep: number; autoNext: boolean; subSize: 'small' | 'medium' | 'large'; subColor: 'white' | 'yellow'; subBackground: boolean; showStats: boolean }`, `DEFAULT_SETTINGS`, signal `settings`, `updateSettings(patch)`, `resetSettings()`
  - `interface Progress { time: number; duration: number; updated: number }`, `WATCHED_RATIO = 0.9`, `MIN_RESUME = 10`, signals `progressVersion`, `serverViewed`; `reloadProgress()`, `getLocalProgress(hash, idx)`, `isWatched(hash, idx)`, `resumePosition(hash, idx)`, `progressRatio(hash, idx)`, `saveProgress(hash, idx, time, duration)`, `markWatched(hash, idx)`, `clearProgress(hash, idx?)`, `refreshViewed(c)`, `continueWatching(list: Torrent[], limit?): { torrent: Torrent; fileIndex: number; progress: Progress }[]`
  - signal `torrents: Signal<Torrent[]>`, `refreshTorrents(c: { list(): Promise<Torrent[]> }): Promise<Torrent[]>`

- [ ] **Step 1: Тесты**

`tests/store/servers.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { servers, activeServerId, activeServer, client, addServer, removeServer, setActiveServer, requireClient } from '../../src/store/servers';

beforeEach(() => {
  localStorage.clear();
  servers.value = [];
  activeServerId.value = null;
});

describe('servers store', () => {
  it('adds with normalized url and dedups', () => {
    const a = addServer({ url: '192.168.1.191:5665' });
    expect(a.url).toBe('http://192.168.1.191:5665');
    expect(a.name).toBe('192.168.1.191:5665');
    const b = addServer({ url: 'http://192.168.1.191:5665/', name: 'Дом' });
    expect(b.id).toBe(a.id);
    expect(servers.value).toHaveLength(1);
    expect(servers.value[0].name).toBe('Дом');
    expect(JSON.parse(localStorage.getItem('tsp.servers')!)).toHaveLength(1);
  });
  it('sets active and builds client', () => {
    const a = addServer({ url: '10.0.0.2' });
    setActiveServer(a.id);
    expect(activeServer.value!.id).toBe(a.id);
    expect(client.value!.baseUrl).toBe('http://10.0.0.2:8090');
    expect(requireClient().baseUrl).toBe('http://10.0.0.2:8090');
    expect(JSON.parse(localStorage.getItem('tsp.activeServer')!)).toBe(a.id);
  });
  it('removing active clears it', () => {
    const a = addServer({ url: '10.0.0.2' });
    setActiveServer(a.id);
    removeServer(a.id);
    expect(activeServer.value).toBeNull();
    expect(() => requireClient()).toThrow();
  });
});
```

`tests/store/settings.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { settings, updateSettings, resetSettings, DEFAULT_SETTINGS } from '../../src/store/settings';

beforeEach(() => {
  localStorage.clear();
  resetSettings();
});

describe('settings store', () => {
  it('updates and persists', () => {
    updateSettings({ seekStep: 30, audioLang: 'en' });
    expect(settings.value.seekStep).toBe(30);
    expect(settings.value.subLang).toBe(DEFAULT_SETTINGS.subLang);
    expect(JSON.parse(localStorage.getItem('tsp.settings')!).seekStep).toBe(30);
  });
  it('resets', () => {
    updateSettings({ autoNext: false });
    resetSettings();
    expect(settings.value).toEqual(DEFAULT_SETTINGS);
  });
});
```

`tests/store/progress.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  reloadProgress, saveProgress, getLocalProgress, isWatched, resumePosition, progressRatio,
  markWatched, clearProgress, serverViewed, continueWatching, refreshViewed,
} from '../../src/store/progress';
import type { Torrent } from '../../src/api/types';

const H = 'a'.repeat(40);
const H2 = 'b'.repeat(40);

beforeEach(() => {
  localStorage.clear();
  reloadProgress();
  serverViewed.value = [];
});

describe('progress store', () => {
  it('saves and resumes', () => {
    saveProgress(H, 1, 120, 1000);
    expect(getLocalProgress(H, 1)!.time).toBe(120);
    expect(resumePosition(H, 1)).toBe(120);
    expect(isWatched(H, 1)).toBe(false);
    expect(progressRatio(H, 1)).toBeCloseTo(0.12);
    reloadProgress();
    expect(resumePosition(H, 1)).toBe(120);
  });
  it('does not resume tiny or finished positions', () => {
    saveProgress(H, 1, 5, 1000);
    expect(resumePosition(H, 1)).toBe(0);
    saveProgress(H, 1, 950, 1000);
    expect(resumePosition(H, 1)).toBe(0);
    expect(isWatched(H, 1)).toBe(true);
  });
  it('uses server viewed when no local data', () => {
    serverViewed.value = [{ hash: H, file_index: 2, timecode: 0 }, { hash: H, file_index: 3, timecode: 300 }];
    expect(isWatched(H, 2)).toBe(true);
    expect(isWatched(H, 3)).toBe(false);
    expect(resumePosition(H, 3)).toBe(300);
    expect(isWatched(H, 4)).toBe(false);
  });
  it('marks and clears', () => {
    markWatched(H, 1);
    expect(isWatched(H, 1)).toBe(true);
    saveProgress(H, 2, 100, 1000);
    clearProgress(H);
    expect(getLocalProgress(H, 1)).toBeNull();
    expect(getLocalProgress(H, 2)).toBeNull();
  });
  it('builds continue watching list', () => {
    const list = [{ hash: H, title: 'A', stat: 5 }, { hash: H2, title: 'B', stat: 5 }] as Torrent[];
    saveProgress(H, 1, 100, 1000);
    saveProgress(H, 2, 200, 1000);
    saveProgress(H2, 1, 960, 1000);
    saveProgress('c'.repeat(40), 1, 100, 1000);
    const r = continueWatching(list);
    expect(r).toHaveLength(1);
    expect(r[0].torrent.hash).toBe(H);
    expect(r[0].fileIndex).toBe(2);
  });
  it('refreshViewed loads from client and ignores errors', async () => {
    await refreshViewed({ viewedList: () => Promise.resolve([{ hash: H, file_index: 1 }]) } as any);
    expect(serverViewed.value).toHaveLength(1);
    await refreshViewed({ viewedList: () => Promise.reject(new Error('x')) } as any);
    expect(serverViewed.value).toHaveLength(1);
  });
});
```

`tests/store/library.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { torrents, refreshTorrents } from '../../src/store/library';

beforeEach(() => {
  localStorage.clear();
  torrents.value = [];
});

describe('library store', () => {
  it('refreshes, sorts newest first and caches slim copy', async () => {
    await refreshTorrents({
      list: () => Promise.resolve([
        { hash: '1', title: 'Old', stat: 5, timestamp: 1, download_speed: 5 },
        { hash: '2', title: 'New', stat: 5, timestamp: 2 },
      ]),
    });
    expect(torrents.value.map((t) => t.hash)).toEqual(['2', '1']);
    const cached = JSON.parse(localStorage.getItem('tsp.torrents')!);
    expect(cached[1].download_speed).toBeUndefined();
    expect(cached[1].title).toBe('Old');
  });
});
```

- [ ] **Step 2: Run — FAIL**

Run: `npx vitest run tests/store`
Expected: FAIL

- [ ] **Step 3: src/store/storage.ts**

```ts
export function loadJson<T>(key: string, fallback: T): T {
  try {
    const s = localStorage.getItem(key);
    return s === null ? fallback : (JSON.parse(s) as T);
  } catch (e) {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // storage full or unavailable — state stays in memory
  }
}
```

- [ ] **Step 4: src/store/servers.ts**

```ts
import { signal, computed } from '@preact/signals';
import { loadJson, saveJson } from './storage';
import { TorrServerClient, normalizeServerUrl } from '../api/torrserver';

export interface SavedServer {
  id: string;
  name: string;
  url: string;
  user?: string;
  password?: string;
}

const KEY = 'tsp.servers';
const ACTIVE_KEY = 'tsp.activeServer';

export const servers = signal<SavedServer[]>(loadJson<SavedServer[]>(KEY, []));
export const activeServerId = signal<string | null>(loadJson<string | null>(ACTIVE_KEY, null));
export const activeServer = computed(() => servers.value.find((s) => s.id === activeServerId.value) || null);
export const client = computed(() => (activeServer.value ? new TorrServerClient(activeServer.value) : null));

function persist() {
  saveJson(KEY, servers.value);
  saveJson(ACTIVE_KEY, activeServerId.value);
}

export function addServer(input: { name?: string; url: string; user?: string; password?: string }): SavedServer {
  const url = normalizeServerUrl(input.url);
  const name = input.name || url.replace(/^https?:\/\//, '');
  const existing = servers.value.find((s) => s.url === url);
  if (existing) {
    const updated: SavedServer = { ...existing, name: input.name || existing.name, user: input.user, password: input.password };
    servers.value = servers.value.map((s) => (s.id === existing.id ? updated : s));
    persist();
    return updated;
  }
  const server: SavedServer = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    url,
    user: input.user,
    password: input.password,
  };
  servers.value = servers.value.concat(server);
  persist();
  return server;
}

export function removeServer(id: string): void {
  servers.value = servers.value.filter((s) => s.id !== id);
  if (activeServerId.value === id) activeServerId.value = null;
  persist();
}

export function setActiveServer(id: string | null): void {
  activeServerId.value = id;
  persist();
}

export function requireClient(): TorrServerClient {
  const c = client.value;
  if (!c) throw new Error('Сервер не выбран');
  return c;
}
```

- [ ] **Step 5: src/store/settings.ts**

```ts
import { signal } from '@preact/signals';
import { loadJson, saveJson } from './storage';

export interface AppSettings {
  audioLang: string;
  subLang: string;
  subtitlesOn: boolean;
  seekStep: number;
  autoNext: boolean;
  subSize: 'small' | 'medium' | 'large';
  subColor: 'white' | 'yellow';
  subBackground: boolean;
  showStats: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  audioLang: 'ru',
  subLang: 'ru',
  subtitlesOn: false,
  seekStep: 10,
  autoNext: true,
  subSize: 'medium',
  subColor: 'white',
  subBackground: true,
  showStats: false,
};

const KEY = 'tsp.settings';

export const settings = signal<AppSettings>({ ...DEFAULT_SETTINGS, ...loadJson<Partial<AppSettings>>(KEY, {}) });

export function updateSettings(patch: Partial<AppSettings>): void {
  settings.value = { ...settings.value, ...patch };
  saveJson(KEY, settings.value);
}

export function resetSettings(): void {
  settings.value = { ...DEFAULT_SETTINGS };
  saveJson(KEY, settings.value);
}
```

- [ ] **Step 6: src/store/progress.ts**

```ts
import { signal } from '@preact/signals';
import { loadJson, saveJson } from './storage';
import type { Torrent, ViewedEntry } from '../api/types';
import type { TorrServerClient } from '../api/torrserver';

export interface Progress {
  time: number;
  duration: number;
  updated: number;
}

const KEY = 'tsp.progress';
export const WATCHED_RATIO = 0.9;
export const MIN_RESUME = 10;

let local: { [k: string]: Progress } = loadJson(KEY, {});
export const progressVersion = signal(0);
export const serverViewed = signal<ViewedEntry[]>([]);

const key = (hash: string, idx: number) => hash + ':' + idx;

// strictly increasing timestamps keep 'continue watching' order deterministic
let lastStamp = 0;
function stamp(): number {
  const now = Date.now();
  lastStamp = now > lastStamp ? now : lastStamp + 1;
  return lastStamp;
}

function persist() {
  saveJson(KEY, local);
  progressVersion.value++;
}

export function reloadProgress(): void {
  local = loadJson(KEY, {});
  progressVersion.value++;
}

export function getLocalProgress(hash: string, idx: number): Progress | null {
  return local[key(hash, idx)] || null;
}

function serverEntry(hash: string, idx: number): ViewedEntry | null {
  return serverViewed.value.find((e) => e.hash === hash && e.file_index === idx) || null;
}

function ratio(p: Progress): number {
  return p.duration > 0 ? p.time / p.duration : 0;
}

export function isWatched(hash: string, idx: number): boolean {
  const p = getLocalProgress(hash, idx);
  if (p && p.duration > 0) return ratio(p) >= WATCHED_RATIO;
  const s = serverEntry(hash, idx);
  return !!s && !(s.timecode && s.timecode >= MIN_RESUME);
}

export function resumePosition(hash: string, idx: number): number {
  const p = getLocalProgress(hash, idx);
  if (p && p.duration > 0) return ratio(p) < WATCHED_RATIO && p.time >= MIN_RESUME ? p.time : 0;
  const s = serverEntry(hash, idx);
  return s && s.timecode && s.timecode >= MIN_RESUME ? s.timecode : 0;
}

export function progressRatio(hash: string, idx: number): number {
  const p = getLocalProgress(hash, idx);
  return p ? Math.min(1, ratio(p)) : 0;
}

export function saveProgress(hash: string, idx: number, time: number, duration: number): void {
  local[key(hash, idx)] = { time, duration, updated: stamp() };
  persist();
}

export function markWatched(hash: string, idx: number): void {
  saveProgress(hash, idx, 1, 1);
}

export function clearProgress(hash: string, idx?: number): void {
  if (idx === undefined) {
    Object.keys(local).forEach((k) => { if (k.indexOf(hash + ':') === 0) delete local[k]; });
  } else {
    delete local[key(hash, idx)];
  }
  persist();
}

export function refreshViewed(c: Pick<TorrServerClient, 'viewedList'>): Promise<void> {
  return c.viewedList().then(
    (list) => { serverViewed.value = list; },
    () => undefined,
  );
}

export function continueWatching(list: Torrent[], limit = 10): { torrent: Torrent; fileIndex: number; progress: Progress }[] {
  const byHash: { [h: string]: Torrent } = {};
  list.forEach((t) => { byHash[t.hash] = t; });
  const entries = Object.keys(local)
    .map((k) => {
      const sep = k.lastIndexOf(':');
      return { hash: k.slice(0, sep), fileIndex: +k.slice(sep + 1), progress: local[k] };
    })
    .filter((e) => byHash[e.hash] && e.progress.time >= MIN_RESUME && ratio(e.progress) < WATCHED_RATIO)
    .sort((a, b) => b.progress.updated - a.progress.updated);
  const seen: { [h: string]: boolean } = {};
  const out: { torrent: Torrent; fileIndex: number; progress: Progress }[] = [];
  entries.forEach((e) => {
    if (seen[e.hash] || out.length >= limit) return;
    seen[e.hash] = true;
    out.push({ torrent: byHash[e.hash], fileIndex: e.fileIndex, progress: e.progress });
  });
  return out;
}
```

- [ ] **Step 7: src/store/library.ts**

```ts
import { signal } from '@preact/signals';
import { loadJson, saveJson } from './storage';
import type { Torrent } from '../api/types';

const KEY = 'tsp.torrents';

export const torrents = signal<Torrent[]>(loadJson<Torrent[]>(KEY, []));

export function refreshTorrents(c: { list(): Promise<Torrent[]> }): Promise<Torrent[]> {
  return c.list().then((list) => {
    const sorted = list.slice().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    torrents.value = sorted;
    saveJson(
      KEY,
      sorted.map((t) => ({
        hash: t.hash, title: t.title, category: t.category, poster: t.poster,
        torrent_size: t.torrent_size, data: t.data, stat: t.stat, timestamp: t.timestamp,
      })),
    );
    return sorted;
  });
}
```

- [ ] **Step 8: Run — PASS**

Run: `npx vitest run tests/store`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/store tests/store
git commit -m "feat: add stores for servers, settings, watch progress and library cache"
```


---

### Task 10: UI-основа — клавиши, маршруты, фокус, компоненты, диалоги, стили, App

**Files:**
- Create: `src/player/types.ts`, `src/ui/keys.ts`, `src/ui/nav.ts`, `src/ui/focus.ts`, `src/ui/components.tsx`, `src/ui/dialog.tsx`, `src/ui/toast.tsx`, `src/app.tsx`
- Modify: `src/main.tsx` (полная замена), `src/styles.css` (полная замена)
- Test: `tests/ui/keys.test.ts`, `tests/ui/nav.test.ts`

**Interfaces:**
- Consumes: `keyAction`, `KeyAction` (Task 8); `activeServer` (Task 9)
- Produces:
  - `interface ExternalSub { url: string; label: string; ext: string }`, `interface PlayItem { url: string; title: string; hash?: string; fileIndex?: number; poster?: string; subtitles?: ExternalSub[] }`
  - `type KeyResult = boolean | 'spatial'`, `type KeyHandler = (a: KeyAction, e: KeyboardEvent) => KeyResult`, `pushKeyHandler(h, prio?): () => void`, `dispatchKey(a, e): KeyResult`, `useKeys(handler, prio?)`, `installKeyListener(onUnhandledBack: () => void): () => void`
  - `type Route = { name: 'connect' } | { name: 'library' } | { name: 'torrent'; hash: string } | { name: 'player'; queue: PlayItem[]; index: number; startAt?: number } | { name: 'add' } | { name: 'playlist'; url?: string; title?: string } | { name: 'settings' }`; signals `routeStack`, `currentRoute`; `navigate(r)`, `replaceRoute(r)`, `resetTo(r)`, `goBack(): boolean`, `takeSavedFocus(): string | undefined`
  - `scrollIntoViewSafe(el)`, `restoreFocus(fallbackKey: string)`
  - Компоненты: `Focusable`, `FocusGroup`, `Button`, `TextInput`, `ChoiceRow`, `Spinner`, `ErrorView`, `ProgressBar`
  - `choose<T>(title: string, options: { label: string; value: T }[], current?: T): Promise<T | null>`, `confirmDialog(text: string, okLabel?: string): Promise<boolean>`, `DialogHost`
  - `toast(text: string, kind?: 'info' | 'error')`, `ToastHost`
  - `App` — экраны подключаются в `renderRoute()` в последующих задачах

- [ ] **Step 1: Тесты**

`tests/ui/keys.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { pushKeyHandler, dispatchKey, installKeyListener } from '../../src/ui/keys';

function press(keyCode: number, target: EventTarget = document.body): Event {
  const e = new Event('keydown', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'keyCode', { value: keyCode });
  target.dispatchEvent(e);
  return e;
}

const cleanups: (() => void)[] = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); document.body.innerHTML = ''; });

describe('dispatchKey', () => {
  it('calls newest handler first and respects priority', () => {
    const calls: string[] = [];
    cleanups.push(pushKeyHandler(() => { calls.push('low-old'); return false; }));
    cleanups.push(pushKeyHandler(() => { calls.push('low-new'); return false; }));
    cleanups.push(pushKeyHandler(() => { calls.push('high'); return false; }, 10));
    dispatchKey('enter', {} as KeyboardEvent);
    expect(calls).toEqual(['high', 'low-new', 'low-old']);
  });
  it('stops at first truthy result', () => {
    const later = vi.fn(() => false);
    cleanups.push(pushKeyHandler(later));
    cleanups.push(pushKeyHandler(() => 'spatial'));
    expect(dispatchKey('up', {} as KeyboardEvent)).toBe('spatial');
    expect(later).not.toHaveBeenCalled();
  });
});

describe('installKeyListener', () => {
  it('calls back fallback when nobody handles back', () => {
    const back = vi.fn();
    cleanups.push(installKeyListener(back));
    const e = press(461);
    expect(back).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });
  it('consumed keys are prevented', () => {
    cleanups.push(installKeyListener(() => undefined));
    cleanups.push(pushKeyHandler((a) => a === 'red'));
    expect(press(403).defaultPrevented).toBe(true);
    expect(press(404).defaultPrevented).toBe(false);
  });
  it('inside text input: backspace untouched, back blurs', () => {
    const back = vi.fn();
    cleanups.push(installKeyListener(back));
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    press(8, input);
    expect(back).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
    const e = press(461, input);
    expect(document.activeElement).not.toBe(input);
    expect(back).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(true);
  });
});
```

`tests/ui/nav.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({ focusKey: null as string | null }));
vi.mock('@noriginmedia/norigin-spatial-navigation', () => ({ getCurrentFocusKey: () => state.focusKey }));

import { routeStack, currentRoute, navigate, goBack, replaceRoute, resetTo, takeSavedFocus } from '../../src/ui/nav';

beforeEach(() => {
  resetTo({ name: 'library' });
  state.focusKey = null;
});

describe('nav', () => {
  it('pushes and pops', () => {
    navigate({ name: 'torrent', hash: 'x' });
    expect(currentRoute.value).toEqual({ name: 'torrent', hash: 'x' });
    expect(goBack()).toBe(true);
    expect(currentRoute.value.name).toBe('library');
    expect(goBack()).toBe(false);
  });
  it('remembers focus of the screen we left', () => {
    state.focusKey = 'torrent-abc';
    navigate({ name: 'torrent', hash: 'abc' });
    expect(takeSavedFocus()).toBeUndefined();
    goBack();
    expect(takeSavedFocus()).toBe('torrent-abc');
    expect(takeSavedFocus()).toBeUndefined();
  });
  it('replace and reset', () => {
    navigate({ name: 'add' });
    replaceRoute({ name: 'torrent', hash: 'h' });
    expect(routeStack.value.map((r) => r.name)).toEqual(['library', 'torrent']);
    resetTo({ name: 'connect' });
    expect(routeStack.value).toEqual([{ name: 'connect' }]);
  });
});
```

- [ ] **Step 2: Run — FAIL**

Run: `npx vitest run tests/ui`
Expected: FAIL

- [ ] **Step 3: src/player/types.ts**

```ts
export interface ExternalSub {
  url: string;
  label: string;
  ext: string;
}

export interface PlayItem {
  url: string;
  title: string;
  hash?: string;
  fileIndex?: number;
  poster?: string;
  subtitles?: ExternalSub[];
}
```

- [ ] **Step 4: src/ui/keys.ts**

```ts
import { useEffect, useRef } from 'preact/hooks';
import { keyAction, KeyAction } from '../platform/keys';

/** true = consumed; 'spatial' = stop other handlers but let spatial navigation process the key. */
export type KeyResult = boolean | 'spatial';
export type KeyHandler = (a: KeyAction, e: KeyboardEvent) => KeyResult;

interface Entry {
  h: KeyHandler;
  prio: number;
  seq: number;
}

let entries: Entry[] = [];
let seq = 0;

export function pushKeyHandler(h: KeyHandler, prio = 0): () => void {
  const entry: Entry = { h, prio, seq: ++seq };
  entries.push(entry);
  return () => {
    entries = entries.filter((x) => x !== entry);
  };
}

export function dispatchKey(a: KeyAction, e: KeyboardEvent): KeyResult {
  const sorted = entries.slice().sort((x, y) => y.prio - x.prio || y.seq - x.seq);
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i].h(a, e);
    if (r) return r;
  }
  return false;
}

export function useKeys(handler: KeyHandler, prio = 0): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => pushKeyHandler((a, e) => ref.current(a, e), prio), [prio]);
}

function isTextInput(t: EventTarget | null): t is HTMLInputElement {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
}

export function installKeyListener(onUnhandledBack: () => void): () => void {
  const listener = (e: KeyboardEvent) => {
    const a = keyAction(e);
    if (!a) return;
    if (isTextInput(e.target)) {
      if (e.keyCode === 8) return; // Backspace edits text
      if (a === 'back' || a === 'up' || a === 'down') e.target.blur();
      if (a === 'back') {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    const r = dispatchKey(a, e);
    if (r === true) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (r === 'spatial') return;
    if (a === 'back') {
      e.preventDefault();
      e.stopPropagation();
      onUnhandledBack();
    }
  };
  // capture phase: runs before the spatial-navigation listener on window
  window.addEventListener('keydown', listener, true);
  return () => window.removeEventListener('keydown', listener, true);
}
```

- [ ] **Step 5: src/ui/nav.ts**

```ts
import { signal, computed } from '@preact/signals';
import { getCurrentFocusKey } from '@noriginmedia/norigin-spatial-navigation';
import type { PlayItem } from '../player/types';

export type Route =
  | { name: 'connect' }
  | { name: 'library' }
  | { name: 'torrent'; hash: string }
  | { name: 'player'; queue: PlayItem[]; index: number; startAt?: number }
  | { name: 'add' }
  | { name: 'playlist'; url?: string; title?: string }
  | { name: 'settings' };

export const routeStack = signal<Route[]>([{ name: 'connect' }]);
export const currentRoute = computed(() => routeStack.value[routeStack.value.length - 1]);

// focus key that was active on each stack level when we navigated away from it
const focusMemory: (string | undefined)[] = [];

function currentFocus(): string | undefined {
  try {
    return getCurrentFocusKey() || undefined;
  } catch (e) {
    return undefined;
  }
}

export function navigate(r: Route): void {
  focusMemory[routeStack.value.length - 1] = currentFocus();
  routeStack.value = routeStack.value.concat(r);
}

export function replaceRoute(r: Route): void {
  focusMemory[routeStack.value.length - 1] = undefined;
  routeStack.value = routeStack.value.slice(0, -1).concat(r);
}

export function resetTo(r: Route): void {
  focusMemory.length = 0;
  routeStack.value = [r];
}

export function goBack(): boolean {
  if (routeStack.value.length <= 1) return false;
  focusMemory[routeStack.value.length - 1] = undefined;
  routeStack.value = routeStack.value.slice(0, -1);
  return true;
}

export function takeSavedFocus(): string | undefined {
  const i = routeStack.value.length - 1;
  const k = focusMemory[i];
  focusMemory[i] = undefined;
  return k;
}
```

Проверить в `node_modules/@noriginmedia/norigin-spatial-navigation/dist/index.d.ts`, что экспортируются `getCurrentFocusKey`, `setFocus`, `doesFocusableExist`, `pause`, `resume`, `useFocusable`, `FocusContext`, `init`. Если какое-то имя отличается — использовать фактическое и указать в отчёте.

- [ ] **Step 6: src/ui/focus.ts**

```ts
import { setFocus, doesFocusableExist } from '@noriginmedia/norigin-spatial-navigation';
import { takeSavedFocus } from './nav';

export function scrollIntoViewSafe(el: Element | null): void {
  if (!el) return;
  const anyEl = el as any;
  if (typeof anyEl.scrollIntoViewIfNeeded === 'function') anyEl.scrollIntoViewIfNeeded(false);
  else el.scrollIntoView(false);
}

/** Restores focus saved when the user left this screen, otherwise focuses fallbackKey. */
export function restoreFocus(fallbackKey: string): void {
  const k = takeSavedFocus();
  if (k && doesFocusableExist(k)) setFocus(k);
  else if (doesFocusableExist(fallbackKey)) setFocus(fallbackKey);
}
```

- [ ] **Step 7: src/ui/components.tsx**

```tsx
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { useFocusable, FocusContext, pause, resume } from '@noriginmedia/norigin-spatial-navigation';
import { scrollIntoViewSafe } from './focus';

interface FocusableProps {
  focusKey?: string;
  onPress?: () => void;
  onArrow?: (direction: string) => boolean;
  onFocused?: () => void;
  className?: string;
  disabled?: boolean;
  children?: ComponentChildren;
}

export function Focusable(p: FocusableProps) {
  const { ref, focused, focusSelf } = useFocusable({
    focusKey: p.focusKey,
    focusable: !p.disabled,
    onEnterPress: () => { if (p.onPress) p.onPress(); },
    onArrowPress: (direction: string) => (p.onArrow ? p.onArrow(direction) : true),
    onFocus: () => {
      scrollIntoViewSafe(ref.current);
      if (p.onFocused) p.onFocused();
    },
  });
  const cls = 'focusable ' + (p.className || '') + (focused ? ' focused' : '') + (p.disabled ? ' disabled' : '');
  return (
    <div
      ref={ref}
      class={cls}
      onMouseEnter={() => { if (!p.disabled) focusSelf(); }}
      onClick={() => { if (!p.disabled && p.onPress) p.onPress(); }}
    >
      {p.children}
    </div>
  );
}

interface FocusGroupProps {
  focusKey: string;
  className?: string;
  boundary?: boolean;
  autoFocus?: boolean;
  preferredChildFocusKey?: string;
  children?: ComponentChildren;
}

export function FocusGroup(p: FocusGroupProps) {
  const { ref, focusKey, focusSelf } = useFocusable({
    focusKey: p.focusKey,
    trackChildren: true,
    saveLastFocusedChild: true,
    isFocusBoundary: !!p.boundary,
    preferredChildFocusKey: p.preferredChildFocusKey,
  });
  useEffect(() => {
    if (p.autoFocus) focusSelf();
  }, []);
  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} class={p.className}>{p.children}</div>
    </FocusContext.Provider>
  );
}

export function Button(p: { label: string; onPress: () => void; focusKey?: string; className?: string; disabled?: boolean }) {
  return (
    <Focusable focusKey={p.focusKey} className={'button ' + (p.className || '')} onPress={p.onPress} disabled={p.disabled}>
      {p.label}
    </Focusable>
  );
}

interface TextInputProps {
  focusKey?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  onSubmit?: () => void;
  type?: 'text' | 'password' | 'url';
}

/** Spatial-nav item that opens the system keyboard (TV or LG ThinQ phone keyboard) on OK. */
export function TextInput(p: TextInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { ref, focused, focusSelf } = useFocusable({
    focusKey: p.focusKey,
    onEnterPress: () => { if (inputRef.current) inputRef.current.focus(); },
    onFocus: () => scrollIntoViewSafe(ref.current),
  });
  return (
    <div
      ref={ref}
      class={'focusable text-input' + (focused ? ' focused' : '')}
      onMouseEnter={() => focusSelf()}
      onClick={() => { if (inputRef.current) inputRef.current.focus(); }}
    >
      <input
        ref={inputRef}
        type={p.type || 'text'}
        value={p.value}
        placeholder={p.placeholder}
        onInput={(e) => p.onChange((e.target as HTMLInputElement).value)}
        onFocus={() => pause()}
        onBlur={() => resume()}
        onKeyDown={(e) => {
          if (e.keyCode === 13) {
            e.preventDefault();
            e.stopPropagation();
            if (inputRef.current) inputRef.current.blur();
            if (p.onSubmit) p.onSubmit();
          }
        }}
      />
    </div>
  );
}

interface ChoiceRowProps<T> {
  focusKey?: string;
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}

/** Settings row: OK / ← / → cycle through options. */
export function ChoiceRow<T>(p: ChoiceRowProps<T>) {
  let idx = 0;
  for (let i = 0; i < p.options.length; i++) if (p.options[i].value === p.value) idx = i;
  const step = (d: number) => {
    const n = p.options.length;
    p.onChange(p.options[(idx + d + n) % n].value);
  };
  return (
    <Focusable
      focusKey={p.focusKey}
      className="choice-row"
      onPress={() => step(1)}
      onArrow={(dir) => {
        if (dir === 'left') { step(-1); return false; }
        if (dir === 'right') { step(1); return false; }
        return true;
      }}
    >
      <span class="choice-label">{p.label}</span>
      <span class="choice-value">‹ {p.options[idx] ? p.options[idx].label : ''} ›</span>
    </Focusable>
  );
}

export const ON_OFF = [
  { value: true, label: 'Вкл' },
  { value: false, label: 'Выкл' },
];

export function Spinner(p: { text?: string }) {
  return (
    <div class="spinner-wrap">
      <div class="spinner" />
      {p.text && <div class="spinner-text">{p.text}</div>}
    </div>
  );
}

export function ErrorView(p: { message: string; actions: { label: string; onPress: () => void }[] }) {
  return (
    <div class="error-view">
      <div class="message">{p.message}</div>
      <FocusGroup focusKey="ERROR-ACTIONS" className="actions" autoFocus>
        {p.actions.map((a) => <Button key={a.label} label={a.label} onPress={a.onPress} />)}
      </FocusGroup>
    </div>
  );
}

export function ProgressBar(p: { ratio: number }) {
  return (
    <div class="progress">
      <div class="progress-fill" style={{ width: Math.round(Math.max(0, Math.min(1, p.ratio)) * 100) + '%' }} />
    </div>
  );
}
```

- [ ] **Step 8: src/ui/toast.tsx**

```tsx
import { signal } from '@preact/signals';

interface ToastItem {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

const toasts = signal<ToastItem[]>([]);
let tid = 0;

export function toast(text: string, kind: 'info' | 'error' = 'info'): void {
  const id = ++tid;
  toasts.value = toasts.value.concat({ id, text, kind });
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }, 3500);
}

export function ToastHost() {
  return (
    <div class="toasts">
      {toasts.value.map((t) => <div key={t.id} class={'toast toast-' + t.kind}>{t.text}</div>)}
    </div>
  );
}
```

- [ ] **Step 9: src/ui/dialog.tsx**

```tsx
import { signal } from '@preact/signals';
import { getCurrentFocusKey, setFocus, doesFocusableExist } from '@noriginmedia/norigin-spatial-navigation';
import { FocusGroup, Focusable } from './components';
import { useKeys } from './keys';

interface DialogState {
  id: number;
  title: string;
  options: { label: string; value: unknown }[];
  current?: unknown;
  resolve: (v: unknown) => void;
  prevFocus?: string;
}

const dialog = signal<DialogState | null>(null);
let dialogSeq = 0;

export function choose<T>(title: string, options: { label: string; value: T }[], current?: T): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    if (dialog.value) dialog.value.resolve(null);
    dialog.value = {
      id: ++dialogSeq,
      title,
      options,
      current,
      resolve: resolve as (v: unknown) => void,
      prevFocus: getCurrentFocusKey() || undefined,
    };
  });
}

export function confirmDialog(text: string, okLabel = 'Да'): Promise<boolean> {
  return choose(text, [
    { label: okLabel, value: true },
    { label: 'Отмена', value: false },
  ]).then((v) => v === true);
}

function close(v: unknown) {
  const d = dialog.value;
  if (!d) return;
  dialog.value = null;
  if (d.prevFocus && doesFocusableExist(d.prevFocus)) setFocus(d.prevFocus);
  d.resolve(v);
}

export function DialogHost() {
  // highest priority: while a dialog is open, screens never see keys
  useKeys((a) => {
    if (!dialog.value) return false;
    if (a === 'back') {
      close(null);
      return true;
    }
    return 'spatial';
  }, 100);
  const d = dialog.value;
  if (!d) return null;
  let preferred: string | undefined;
  d.options.forEach((o, i) => { if (o.value === d.current) preferred = 'dialog-opt-' + i; });
  return (
    <div class="dialog-backdrop">
      <FocusGroup key={d.id} focusKey={'DIALOG-' + d.id} className="dialog" boundary autoFocus preferredChildFocusKey={preferred}>
        <div class="dialog-title">{d.title}</div>
        {d.options.map((o, i) => (
          <Focusable
            key={i}
            focusKey={'dialog-opt-' + i}
            className={'dialog-option' + (o.value === d.current ? ' current' : '')}
            onPress={() => close(o.value)}
          >
            {o.label}
          </Focusable>
        ))}
      </FocusGroup>
    </div>
  );
}
```

- [ ] **Step 10: src/app.tsx**

```tsx
import { useEffect } from 'preact/hooks';
import { routeStack, currentRoute, goBack, Route } from './ui/nav';
import { installKeyListener } from './ui/keys';
import { DialogHost, confirmDialog } from './ui/dialog';
import { ToastHost } from './ui/toast';

function renderRoute(r: Route) {
  switch (r.name) {
    // screens are registered here by later tasks
    default:
      return null;
  }
}

function exitApp() {
  confirmDialog('Выйти из приложения?', 'Выйти').then((ok) => {
    if (ok) window.close();
  });
}

export function App() {
  useEffect(() => installKeyListener(() => { if (!goBack()) exitApp(); }), []);
  const r = currentRoute.value;
  return (
    <div class="app">
      <div class="screen-host" key={routeStack.value.length + ':' + r.name}>{renderRoute(r)}</div>
      <DialogHost />
      <ToastHost />
    </div>
  );
}
```

- [ ] **Step 11: src/main.tsx (замена)**

```tsx
import { render } from 'preact';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import './styles.css';
import { App } from './app';
import { activeServer } from './store/servers';
import { resetTo } from './ui/nav';

init({ debug: false, visualDebug: false });

if (activeServer.value) resetTo({ name: 'library' });

render(<App />, document.getElementById('app')!);
```

- [ ] **Step 12: src/styles.css (замена) — без CSS Grid и без flex `gap`**

```css
:root {
  --bg: #0f1115;
  --panel: #181b22;
  --panel2: #252a35;
  --text: #e8eaf0;
  --muted: #9aa1b2;
  --accent: #f27024;
  --focus: #ffffff;
  --danger: #e5484d;
  --ok: #3fb950;
}
* { box-sizing: border-box; }
html, body {
  margin: 0; padding: 0; width: 1920px; height: 1080px; overflow: hidden;
  background: var(--bg); color: var(--text);
  font-family: 'LG Smart UI', 'Museo Sans', Roboto, Arial, sans-serif; font-size: 28px;
}
.app, .screen-host { position: relative; width: 1920px; height: 1080px; overflow: hidden; }
.screen { position: absolute; top: 0; left: 0; right: 0; bottom: 0; padding: 48px 80px 96px; overflow-y: auto; overflow-x: hidden; }
h1 { font-size: 56px; margin: 0 0 32px; }
h2 { font-size: 32px; margin: 32px 0 16px; color: var(--muted); font-weight: normal; }
.row { display: flex; align-items: center; margin-bottom: 16px; }
.row > * { margin-right: 16px; margin-bottom: 0; }
.row > *:last-child { margin-right: 0; }
.grow { flex: 1; }
.spacer { flex: 1; }
.muted { color: var(--muted); }

.focusable { transition: transform .12s, box-shadow .12s, background-color .12s; outline: none; cursor: pointer; }
.focusable.focused { box-shadow: 0 0 0 4px var(--focus); transform: scale(1.04); }
.focusable.disabled { opacity: .4; }

.button { display: inline-block; padding: 16px 32px; background: var(--panel2); border-radius: 12px; white-space: nowrap; }
.button.focused { background: var(--accent); color: #fff; box-shadow: none; transform: scale(1.06); }

.list-item { padding: 20px 28px; background: var(--panel); border-radius: 12px; margin-bottom: 12px; }
.list-item.focused { background: var(--panel2); transform: scale(1.01); }
.list-item .title { font-size: 30px; }
.list-item .meta { font-size: 24px; color: var(--muted); margin-top: 6px; }

.text-input { flex: 1; background: var(--panel); border-radius: 12px; padding: 4px; margin-bottom: 16px; }
.text-input.focused { transform: none; }
.text-input input { width: 100%; font-size: 30px; padding: 16px 20px; background: transparent; color: var(--text); border: none; outline: none; }

.choice-row { display: flex; justify-content: space-between; padding: 20px 28px; background: var(--panel); border-radius: 12px; margin-bottom: 10px; }
.choice-row.focused { background: var(--panel2); transform: none; }
.choice-value { color: var(--accent); }

.header { display: flex; align-items: center; margin-bottom: 24px; }
.header > * { margin-right: 16px; }
.tab { padding: 12px 28px; border-radius: 30px; color: var(--muted); }
.tab.active { color: var(--text); background: var(--panel2); }
.tab.focused { background: var(--accent); color: #fff; box-shadow: none; }

.grid { display: flex; flex-wrap: wrap; margin-right: -24px; }
.card { width: 256px; margin: 0 24px 32px 0; border-radius: 14px; }
.card.focused { box-shadow: none; transform: scale(1.07); }
.card .poster { width: 256px; height: 384px; border-radius: 14px; overflow: hidden; background: var(--panel2); }
.card.focused .poster { box-shadow: 0 0 0 5px var(--focus); }
.card .poster img { width: 100%; height: 100%; object-fit: cover; }
.poster-fallback { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 120px; color: var(--muted); }
.card-title { margin-top: 10px; font-size: 24px; max-height: 62px; overflow: hidden; }
.card-meta { font-size: 22px; color: var(--muted); }

.hscroll { display: flex; overflow: hidden; padding: 8px 0; }
.wide-card { width: 440px; flex-shrink: 0; margin-right: 24px; padding: 20px 24px; background: var(--panel); border-radius: 14px; }
.wide-card.focused { background: var(--panel2); }
.wide-card .title { font-size: 26px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wide-card .meta { font-size: 22px; color: var(--muted); margin-top: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.progress { height: 8px; background: rgba(255, 255, 255, .15); border-radius: 4px; overflow: hidden; margin-top: 10px; }
.progress-fill { height: 100%; background: var(--accent); }

.hints { position: absolute; bottom: 24px; left: 80px; color: var(--muted); font-size: 22px; }
.empty { color: var(--muted); padding: 60px 0; text-align: center; }
.banner-error { background: rgba(229, 72, 77, .2); color: #ffb4b6; padding: 14px 24px; border-radius: 10px; margin-bottom: 16px; }

.torrent-head { display: flex; margin-bottom: 24px; }
.torrent-head img { width: 220px; height: 330px; object-fit: cover; border-radius: 14px; margin-right: 40px; background: var(--panel2); }
.torrent-head .info { flex: 1; }
.torrent-head h1 { font-size: 44px; margin-bottom: 16px; }
.file-row { display: flex; align-items: center; }
.file-row .ep { width: 150px; color: var(--accent); }
.file-row .name { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.file-row .size { width: 170px; text-align: right; color: var(--muted); }
.file-row .check { width: 60px; text-align: center; color: var(--ok); }
.file-row .bar { width: 160px; margin: 0 0 8px 20px; }

.spinner-wrap { display: flex; align-items: center; padding: 24px 0; }
.spinner { width: 48px; height: 48px; border: 5px solid rgba(255, 255, 255, .2); border-top-color: var(--accent); border-radius: 50%; animation: spin 1s linear infinite; margin-right: 20px; }
@keyframes spin { to { transform: rotate(360deg); } }

.error-view { padding: 160px 0; text-align: center; }
.error-view .message { font-size: 36px; margin-bottom: 40px; white-space: pre-line; }
.error-view .actions { display: flex; justify-content: center; }
.error-view .actions > * { margin: 0 12px; }

.dialog-backdrop { position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, .6); display: flex; align-items: center; justify-content: center; z-index: 50; }
.dialog { min-width: 720px; max-width: 1200px; max-height: 900px; overflow-y: auto; background: var(--panel); border-radius: 18px; padding: 40px; }
.dialog-title { font-size: 34px; margin-bottom: 24px; }
.dialog-option { padding: 18px 24px; border-radius: 10px; margin-bottom: 8px; }
.dialog-option.current { color: var(--accent); }
.dialog-option.focused { background: var(--accent); color: #fff; transform: none; box-shadow: none; }

.toasts { position: absolute; top: 40px; right: 60px; z-index: 60; }
.toast { background: var(--panel2); padding: 18px 28px; border-radius: 12px; margin-bottom: 12px; max-width: 800px; }
.toast-error { background: var(--danger); }

/* player */
.player { position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: #000; overflow: hidden; }
.player video { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: #000; }
.player-controls { position: absolute; left: 0; right: 0; bottom: 0; padding: 60px 80px 56px; background: linear-gradient(rgba(0, 0, 0, 0), rgba(0, 0, 0, .85)); }
.player-title { font-size: 36px; margin-bottom: 20px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.player-bar { position: relative; height: 10px; background: rgba(255, 255, 255, .25); border-radius: 5px; cursor: pointer; }
.player-bar-fill { height: 100%; background: var(--accent); border-radius: 5px; }
.player-bar-target { position: absolute; top: -8px; width: 4px; height: 26px; margin-left: -2px; background: #fff; }
.player-row { display: flex; align-items: center; margin-top: 18px; font-size: 26px; }
.player-row > * { margin-right: 24px; }
.player-btn { padding: 8px 20px; border-radius: 8px; background: rgba(255, 255, 255, .12); cursor: pointer; }
.player-hints { color: var(--muted); font-size: 22px; }
.player-stats { position: absolute; top: 40px; left: 60px; background: rgba(0, 0, 0, .7); padding: 20px 28px; border-radius: 12px; font-size: 24px; line-height: 1.5; }
.player-buffer { position: absolute; top: 0; left: 0; right: 0; bottom: 0; display: flex; align-items: center; justify-content: center; }
.subtitles { position: absolute; left: 10%; right: 10%; bottom: 80px; text-align: center; white-space: pre-line; }
.subtitles.raised { bottom: 260px; }
.subtitles span { display: inline-block; padding: 4px 14px; border-radius: 6px; line-height: 1.3; }
.sub-small { font-size: 36px; }
.sub-medium { font-size: 46px; }
.sub-large { font-size: 58px; }
.sub-white { color: #fff; }
.sub-yellow { color: #ffd54a; }
.sub-bg span { background: rgba(0, 0, 0, .6); }
.sub-nobg span { text-shadow: 0 0 6px #000, 0 0 3px #000; }
.next-banner { position: absolute; right: 80px; bottom: 240px; background: rgba(0, 0, 0, .85); padding: 24px 32px; border-radius: 14px; border: 2px solid var(--accent); max-width: 700px; }
.next-banner .meta { color: var(--muted); font-size: 22px; margin-top: 8px; }
.player-error { position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, .85); }
.player-error .details { color: var(--muted); font-size: 24px; margin-top: 16px; }
```

- [ ] **Step 13: Run tests and build**

Run: `npx vitest run && npm run build`
Expected: все тесты PASS, сборка без ошибок типов.

- [ ] **Step 14: Ручная проверка**

Run: `npm run dev`, открыть `http://localhost:5173` в браузере.
Expected: тёмный экран без ошибок в консоли; Esc показывает диалог «Выйти из приложения?», стрелки ↑/↓ переключают кнопки, Esc закрывает диалог.

- [ ] **Step 15: Commit**

```bash
git add -A
git commit -m "feat: add UI foundation (key handling, routing, focus, components, dialogs, styles)"
```

---

### Task 11: Экран «Подключение» (серверы, ручной ввод, автопоиск)

**Files:**
- Create: `src/screens/Connect.tsx`
- Modify: `src/app.tsx` (импорт + case `connect`)

**Interfaces:**
- Consumes: `servers`, `addServer`, `removeServer`, `setActiveServer`, `SavedServer` (Task 9); `TorrServerClient` (Task 6); `errorMessage` (Task 6); `discover`, `candidateSubnets`, `getLocalIp`, `FoundServer` (Task 8); `resetTo` (Task 10); UI-компоненты, `toast`, `confirmDialog`, `restoreFocus` (Task 10)
- Produces: `ConnectScreen()`

- [ ] **Step 1: src/screens/Connect.tsx**

```tsx
import { useEffect, useState } from 'preact/hooks';
import { servers, addServer, removeServer, setActiveServer, SavedServer } from '../store/servers';
import { TorrServerClient } from '../api/torrserver';
import { errorMessage } from '../api/http';
import { discover, candidateSubnets, getLocalIp, FoundServer } from '../api/discovery';
import { resetTo } from '../ui/nav';
import { FocusGroup, Focusable, Button, TextInput, Spinner } from '../ui/components';
import { restoreFocus } from '../ui/focus';
import { toast } from '../ui/toast';
import { confirmDialog } from '../ui/dialog';

export function ConnectScreen() {
  const [status, setStatus] = useState<{ [id: string]: string }>({});
  const [url, setUrl] = useState('');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState<{ done: number; total: number } | null>(null);
  const [found, setFound] = useState<FoundServer[]>([]);

  useEffect(() => {
    restoreFocus('CONNECT');
    servers.value.forEach((s) => {
      new TorrServerClient(s).echo().then(
        (v) => setStatus((p) => ({ ...p, [s.id]: 'онлайн · ' + v })),
        (e) => setStatus((p) => ({ ...p, [s.id]: '⚠ ' + errorMessage(e) })),
      );
    });
  }, []);

  const open = (s: SavedServer) => {
    setActiveServer(s.id);
    resetTo({ name: 'library' });
  };

  const connect = (address = url) => {
    if (!address.trim()) {
      toast('Введите адрес сервера', 'error');
      return;
    }
    const cfg = { url: address, user: user || undefined, password: password || undefined };
    setBusy(true);
    new TorrServerClient(cfg).echo().then(
      (v) => {
        toast('Подключено: ' + v);
        open(addServer(cfg));
      },
      (e) => {
        setBusy(false);
        toast(errorMessage(e), 'error');
      },
    );
  };

  const scanNetwork = () => {
    setFound([]);
    setScan({ done: 0, total: 1 });
    getLocalIp()
      .then((ip) =>
        discover({
          subnets: candidateSubnets(ip, servers.value.map((s) => s.url)),
          onProgress: (done, total) => { if (done % 16 === 0 || done === total) setScan({ done, total }); },
          onFound: (s) => setFound((f) => f.concat(s)),
        }),
      )
      .then((list) => {
        setScan(null);
        if (!list.length) toast('Серверы TorrServer не найдены', 'error');
      });
  };

  const remove = (s: SavedServer) => {
    confirmDialog('Удалить сервер «' + s.name + '»?', 'Удалить').then((ok) => {
      if (ok) removeServer(s.id);
    });
  };

  return (
    <FocusGroup focusKey="CONNECT" className="screen connect">
      <h1>TorrServer Player</h1>
      {servers.value.length > 0 && (
        <section>
          <h2>Сохранённые серверы</h2>
          {servers.value.map((s) => (
            <div class="row" key={s.id}>
              <Focusable focusKey={'server-' + s.id} className="list-item grow" onPress={() => open(s)}>
                <div class="title">{s.name}</div>
                <div class="meta">{s.url} · {status[s.id] || 'проверка…'}</div>
              </Focusable>
              <Button label="Удалить" onPress={() => remove(s)} />
            </div>
          ))}
        </section>
      )}
      <section>
        <h2>Новый сервер</h2>
        <TextInput focusKey="connect-url" value={url} onChange={setUrl} placeholder="Адрес, например 192.168.1.191:8090" onSubmit={() => connect()} />
        <div class="row">
          <TextInput value={user} onChange={setUser} placeholder="Логин (если включена авторизация)" />
          <TextInput value={password} onChange={setPassword} placeholder="Пароль" type="password" />
        </div>
        <div class="row">
          <Button label={busy ? 'Подключение…' : 'Подключиться'} onPress={() => connect()} disabled={busy} />
          <Button label="Найти в сети" onPress={scanNetwork} disabled={!!scan} />
        </div>
        {scan && <Spinner text={'Поиск серверов… ' + Math.round((scan.done * 100) / scan.total) + '%'} />}
        {found.map((f) => (
          <Focusable key={f.url} className="list-item" onPress={() => connect(f.url)}>
            <div class="title">{f.url}</div>
            <div class="meta">{f.version}</div>
          </Focusable>
        ))}
      </section>
    </FocusGroup>
  );
}
```

- [ ] **Step 2: Подключить в src/app.tsx**

Добавить импорт:
```tsx
import { ConnectScreen } from './screens/Connect';
```
В `renderRoute` перед `default:`:
```tsx
    case 'connect':
      return <ConnectScreen />;
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: без ошибок.

- [ ] **Step 4: Ручная проверка в браузере**

Run: `npm run dev`, открыть `http://localhost:5173`, очистить localStorage (DevTools → Application) и перезагрузить.
Expected: экран «Подключение»; ввод `192.168.1.191:5665` + Enter → тост «Подключено: MatriX…» (экран библиотеки пока пустой — ок). Перезагрузка → снова экран подключения нельзя увидеть, т.к. сервер активен: очистить `tsp.activeServer` → сервер виден в «Сохранённых» со статусом «онлайн». «Найти в сети» находит `http://192.168.1.191:5665` (из браузера ПК Luna недоступна — используются подсети сохранённых серверов + 192.168.1/0).

- [ ] **Step 5: Commit**

```bash
git add src/screens/Connect.tsx src/app.tsx
git commit -m "feat: add connect screen with saved servers and LAN discovery"
```

---

### Task 12: Очередь воспроизведения и экран «Торрент»

**Files:**
- Create: `src/player/queue.ts`, `src/screens/Torrent.tsx`
- Modify: `src/app.tsx` (импорт + case `torrent`)
- Test: `tests/player/queue.test.ts`

**Interfaces:**
- Consumes: `TorrServerClient` (Task 6); `Torrent` (Task 6); `TorrentFile`, `fileKind`, `baseName`, `extOf`, `playableFiles`, `groupBySeason`, `matchSubtitles`, `subtitleLabel`, `episodeLabel` (Task 3); store `client`, `torrents`, progress API (Task 9); UI (Task 10)
- Produces:
  - `buildTorrentQueue(c: TorrServerClient, t: Torrent, files: TorrentFile[]): PlayItem[]`
  - `TorrentScreen({ hash }: { hash: string })`

- [ ] **Step 1: Тест очереди**

`tests/player/queue.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildTorrentQueue } from '../../src/player/queue';
import { TorrServerClient } from '../../src/api/torrserver';
import type { Torrent } from '../../src/api/types';

const H = 'c4c4bd6a4618e1042aa89649d629f85951eff546';
const c = new TorrServerClient({ url: 'h:1' });

describe('buildTorrentQueue', () => {
  it('orders episodes and attaches matching subtitles', () => {
    const t: Torrent = { hash: H, title: 'Show', stat: 5, poster: 'p.jpg' };
    const q = buildTorrentQueue(c, t, [
      { id: 2, path: 'Show/Show.S01E02.mkv', length: 10 },
      { id: 1, path: 'Show/Show.S01E01.mkv', length: 10 },
      { id: 3, path: 'Show/Show.S01E01.rus.srt', length: 1 },
      { id: 4, path: 'Show/readme.txt', length: 1 },
    ]);
    expect(q.map((i) => i.fileIndex)).toEqual([1, 2]);
    expect(q[0]).toEqual({
      url: c.streamUrl(H, 1, 'Show.S01E01.mkv'),
      title: 'Show.S01E01.mkv',
      hash: H,
      fileIndex: 1,
      poster: 'p.jpg',
      subtitles: [{ url: c.streamUrl(H, 3, 'Show.S01E01.rus.srt'), label: 'rus', ext: 'srt' }],
    });
    expect(q[1].subtitles).toEqual([]);
  });
  it('uses torrent title for single-file torrents', () => {
    const q = buildTorrentQueue(c, { hash: H, title: 'Фильм (2020)', stat: 5 }, [{ id: 1, path: 'Movie.2020.mkv', length: 1 }]);
    expect(q[0].title).toBe('Фильм (2020)');
  });
});
```

- [ ] **Step 2: Run — FAIL**

Run: `npx vitest run tests/player/queue.test.ts`
Expected: FAIL

- [ ] **Step 3: src/player/queue.ts**

```ts
import type { TorrServerClient } from '../api/torrserver';
import type { Torrent } from '../api/types';
import { TorrentFile, fileKind, baseName, extOf, playableFiles, matchSubtitles, subtitleLabel } from '../lib/episodes';
import type { PlayItem } from './types';

export function buildTorrentQueue(c: TorrServerClient, t: Torrent, files: TorrentFile[]): PlayItem[] {
  const subs = files.filter((f) => fileKind(f.path) === 'subtitle');
  const playable = playableFiles(files);
  return playable.map((f) => ({
    url: c.streamUrl(t.hash, f.id, baseName(f.path)),
    title: playable.length > 1 ? baseName(f.path) : t.title || baseName(f.path),
    hash: t.hash,
    fileIndex: f.id,
    poster: t.poster,
    subtitles: matchSubtitles(f, subs).map((s) => ({
      url: c.streamUrl(t.hash, s.id, baseName(s.path)),
      label: subtitleLabel(s, f),
      ext: extOf(s.path),
    })),
  }));
}
```

- [ ] **Step 4: Run — PASS**

Run: `npx vitest run tests/player/queue.test.ts`
Expected: PASS

- [ ] **Step 5: src/screens/Torrent.tsx**

```tsx
import { useEffect, useMemo, useState } from 'preact/hooks';
import { client } from '../store/servers';
import { torrents } from '../store/library';
import { progressVersion, serverViewed, refreshViewed, isWatched, resumePosition, progressRatio, clearProgress } from '../store/progress';
import type { Torrent } from '../api/types';
import { errorMessage } from '../api/http';
import { TorrentFile, baseName, groupBySeason, playableFiles, episodeLabel } from '../lib/episodes';
import { formatBytes, formatDuration, formatSpeed } from '../lib/format';
import { buildTorrentQueue } from '../player/queue';
import { navigate, goBack } from '../ui/nav';
import { FocusGroup, Focusable, Button, Spinner, ProgressBar } from '../ui/components';
import { restoreFocus } from '../ui/focus';
import { confirmDialog } from '../ui/dialog';
import { toast } from '../ui/toast';
import { useKeys } from '../ui/keys';

export function TorrentScreen({ hash }: { hash: string }) {
  const c = client.value!;
  const cached = torrents.value.find((t) => t.hash === hash) || null;
  const [t, setT] = useState<Torrent | null>(cached);
  const [files, setFiles] = useState<TorrentFile[]>(cached ? c.files(cached) : []);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // subscribe to progress changes
  progressVersion.value;
  serverViewed.value;

  useEffect(() => {
    c.get(hash)
      .then((r) => {
        setT(r);
        const f = c.files(r);
        if (f.length) {
          setFiles(f);
          return;
        }
        setLoadingInfo(true);
        return c.loadInfo(hash).then((info) => {
          setT(info);
          setFiles(c.files(info));
          setLoadingInfo(false);
        });
      })
      .catch((e) => {
        setLoadingInfo(false);
        setError(errorMessage(e));
      });
    refreshViewed(c);
    const timer = setInterval(() => {
      c.get(hash).then((r) => setT(r), () => undefined);
    }, 3000);
    return () => clearInterval(timer);
  }, [hash]);

  const queue = useMemo(() => (t ? buildTorrentQueue(c, t, files) : []), [t ? t.hash : '', files]);
  const groups = useMemo(() => groupBySeason(playableFiles(files)), [files]);

  useEffect(() => {
    restoreFocus('TORRENT-ACTIONS');
  }, [files.length > 0]);

  const play = (index: number, startAt?: number) => {
    if (index >= 0) navigate({ name: 'player', queue, index, startAt });
  };

  const remove = () => {
    confirmDialog('Удалить торрент с сервера?', 'Удалить').then((ok) => {
      if (!ok) return;
      c.remove(hash).then(
        () => {
          torrents.value = torrents.value.filter((x) => x.hash !== hash);
          toast('Торрент удалён');
          goBack();
        },
        (e) => toast(errorMessage(e), 'error'),
      );
    });
  };

  const resetViewed = () => {
    confirmDialog('Сбросить отметки просмотра?', 'Сбросить').then((ok) => {
      if (!ok) return;
      clearProgress(hash);
      c.removeViewed(hash).then(() => refreshViewed(c), () => undefined);
    });
  };

  useKeys((a) => {
    if (a === 'red') {
      remove();
      return true;
    }
    return false;
  });

  // first in-progress file, else first unwatched, else first
  let target = queue.findIndex((q) => resumePosition(hash, q.fileIndex!) > 0);
  const targetPos = target >= 0 ? resumePosition(hash, queue[target].fileIndex!) : 0;
  if (target < 0) target = queue.findIndex((q) => !isWatched(hash, q.fileIndex!));
  if (target < 0) target = 0;
  const targetLabel = queue[target] ? episodeLabel(queue[target].title) : '';
  const playLabel = targetPos > 0
    ? 'Продолжить ' + (targetLabel ? targetLabel + ' ' : '') + 'с ' + formatDuration(targetPos)
    : 'Смотреть' + (targetLabel ? ' ' + targetLabel : '');

  return (
    <FocusGroup focusKey="TORRENT" className="screen torrent">
      <div class="torrent-head">
        {t && t.poster ? <img src={t.poster} alt="" /> : null}
        <div class="info">
          <h1>{t ? t.title || t.name : hash}</h1>
          <div class="muted">
            {t && t.torrent_size ? formatBytes(t.torrent_size) + ' · ' : ''}
            {t && t.stat_string ? t.stat_string : ''}
            {t && t.stat === 3 ? ' · ' + formatSpeed(t.download_speed || 0) + ' · пиры ' + (t.active_peers || 0) + '/' + (t.total_peers || 0) : ''}
          </div>
          <FocusGroup focusKey="TORRENT-ACTIONS" className="row" preferredChildFocusKey="torrent-play">
            {queue.length > 0 && <Button focusKey="torrent-play" label={playLabel} onPress={() => play(target, targetPos || undefined)} />}
            {queue.length > 0 && <Button label="Плейлист" onPress={() => navigate({ name: 'playlist', url: c.playlistUrl(hash), title: t ? t.title : '' })} />}
            <Button label="Сбросить просмотр" onPress={resetViewed} />
            <Button label="Удалить" onPress={remove} />
          </FocusGroup>
        </div>
      </div>
      {loadingInfo && <Spinner text="Получение списка файлов…" />}
      {error && <div class="banner-error">{error}</div>}
      {!loadingInfo && !error && files.length > 0 && queue.length === 0 && <div class="empty">В торренте нет видео- или аудиофайлов</div>}
      <FocusGroup focusKey="TORRENT-FILES">
        {groups.map((g) => (
          <section key={String(g.season)}>
            {(groups.length > 1 || g.season !== null) && <h2>{g.season !== null ? 'Сезон ' + g.season : 'Другое'}</h2>}
            {g.files.map((f) => {
              const watched = isWatched(hash, f.id);
              const ratio = progressRatio(hash, f.id);
              return (
                <Focusable
                  key={f.id}
                  focusKey={'file-' + f.id}
                  className="list-item file-row"
                  onPress={() => play(queue.findIndex((q) => q.fileIndex === f.id))}
                >
                  <span class="ep">{episodeLabel(f.path)}</span>
                  <span class="name">{baseName(f.path)}</span>
                  {!watched && ratio > 0 && <span class="bar"><ProgressBar ratio={ratio} /></span>}
                  <span class="size">{formatBytes(f.length)}</span>
                  <span class="check">{watched ? '✓' : ''}</span>
                </Focusable>
              );
            })}
          </section>
        ))}
      </FocusGroup>
      <div class="hints">OK — смотреть · 🔴 удалить торрент · Назад — к библиотеке</div>
    </FocusGroup>
  );
}
```

- [ ] **Step 6: Подключить в src/app.tsx**

Импорт:
```tsx
import { TorrentScreen } from './screens/Torrent';
```
Case:
```tsx
    case 'torrent':
      return <TorrentScreen hash={r.hash} />;
```

- [ ] **Step 7: Build + тесты**

Run: `npx vitest run && npm run build`
Expected: PASS, сборка без ошибок.

- [ ] **Step 8: Commit**

```bash
git add src/player/queue.ts src/screens/Torrent.tsx src/app.tsx tests/player/queue.test.ts
git commit -m "feat: add torrent screen with seasons, progress and play queue"
```

---

### Task 13: Экран «Библиотека»

**Files:**
- Create: `src/screens/Library.tsx`
- Modify: `src/app.tsx` (импорт + case `library`)

**Interfaces:**
- Consumes: `client` (Task 9), `torrents`, `refreshTorrents` (Task 9), `continueWatching`, `refreshViewed`, `progressVersion` (Task 9), `CATEGORY_TABS`, `categoryOf`, `Category` (Task 2), `buildTorrentQueue` (Task 12), `episodeLabel`, `baseName` (Task 3), UI (Task 10)
- Produces: `LibraryScreen()`

- [ ] **Step 1: src/screens/Library.tsx**

```tsx
import { useEffect, useState } from 'preact/hooks';
import { client } from '../store/servers';
import { torrents, refreshTorrents } from '../store/library';
import { continueWatching, refreshViewed, progressVersion, Progress } from '../store/progress';
import type { Torrent } from '../api/types';
import { errorMessage } from '../api/http';
import { CATEGORY_TABS, Category, categoryOf } from '../lib/category';
import { formatBytes, formatDuration } from '../lib/format';
import { baseName, episodeLabel } from '../lib/episodes';
import { buildTorrentQueue } from '../player/queue';
import { navigate, resetTo } from '../ui/nav';
import { FocusGroup, Focusable, Button, ErrorView, ProgressBar, Spinner } from '../ui/components';
import { restoreFocus } from '../ui/focus';
import { confirmDialog } from '../ui/dialog';
import { toast } from '../ui/toast';
import { useKeys } from '../ui/keys';

function PosterCard(p: { t: Torrent; onPress: () => void; onFocused: () => void }) {
  const t = p.t;
  return (
    <Focusable focusKey={'torrent-' + t.hash} className="card" onPress={p.onPress} onFocused={p.onFocused}>
      <div class="poster">
        {t.poster
          ? <img src={t.poster} alt="" onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
          : <div class="poster-fallback">{(t.title || '?').charAt(0)}</div>}
      </div>
      <div class="card-title">{t.title || t.name || t.hash}</div>
      <div class="card-meta">{formatBytes(t.torrent_size || 0)}</div>
    </Focusable>
  );
}

export function LibraryScreen() {
  const c = client.value;
  const [tab, setTab] = useState<'all' | Category>('all');
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(torrents.value.length > 0);
  const [focusedHash, setFocusedHash] = useState<string | null>(null);
  progressVersion.value; // re-render when progress changes

  const load = () => {
    if (!c) return;
    refreshTorrents(c).then(
      () => { setError(null); setLoaded(true); },
      (e) => { setError(errorMessage(e)); setLoaded(true); },
    );
    refreshViewed(c);
  };

  useEffect(() => {
    if (!c) {
      resetTo({ name: 'connect' });
      return;
    }
    load();
    // picks up torrents added from a phone via the TorrServer web UI
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, [c]);

  useEffect(() => {
    if (loaded) restoreFocus(torrents.value.length ? 'LIB-GRID' : 'LIB-HEADER');
  }, [loaded]);

  const remove = (hash: string) => {
    const t = torrents.value.find((x) => x.hash === hash);
    confirmDialog('Удалить «' + (t ? t.title : hash) + '»?', 'Удалить').then((ok) => {
      if (!ok || !c) return;
      c.remove(hash).then(
        () => { torrents.value = torrents.value.filter((x) => x.hash !== hash); toast('Торрент удалён'); },
        (e) => toast(errorMessage(e), 'error'),
      );
    });
  };

  useKeys((a) => {
    if (a === 'red' && focusedHash) { remove(focusedHash); return true; }
    if (a === 'blue') { navigate({ name: 'settings' }); return true; }
    return false;
  });

  if (!c) return null;

  const resume = (e: { torrent: Torrent; fileIndex: number; progress: Progress }) => {
    const queue = buildTorrentQueue(c, e.torrent, c.files(e.torrent));
    const index = queue.findIndex((q) => q.fileIndex === e.fileIndex);
    if (index < 0) navigate({ name: 'torrent', hash: e.torrent.hash });
    else navigate({ name: 'player', queue, index, startAt: e.progress.time });
  };

  if (error && !torrents.value.length) {
    return (
      <div class="screen">
        <ErrorView
          message={'Не удалось загрузить список торрентов\n' + error}
          actions={[
            { label: 'Повторить', onPress: load },
            { label: 'Сменить сервер', onPress: () => navigate({ name: 'connect' }) },
          ]}
        />
      </div>
    );
  }

  const list = torrents.value.filter((t) => tab === 'all' || categoryOf(t.category) === tab);
  const cont = tab === 'all' ? continueWatching(torrents.value) : [];

  return (
    <FocusGroup focusKey="LIBRARY" className="screen library">
      <FocusGroup focusKey="LIB-HEADER" className="header">
        {CATEGORY_TABS.map((ct) => (
          <Focusable
            key={ct.id}
            focusKey={'tab-' + ct.id}
            className={'tab' + (tab === ct.id ? ' active' : '')}
            onPress={() => setTab(ct.id)}
            onFocused={() => setTab(ct.id)}
          >
            {ct.label}
          </Focusable>
        ))}
        <div class="spacer" />
        <Button label="＋ Добавить" onPress={() => navigate({ name: 'add' })} />
        <Button label="Плейлист" onPress={() => navigate({ name: 'playlist' })} />
        <Button label="Настройки" onPress={() => navigate({ name: 'settings' })} />
        <Button label="Сервер" onPress={() => navigate({ name: 'connect' })} />
      </FocusGroup>
      {error && <div class="banner-error">{error} — показан сохранённый список</div>}
      {!loaded && <Spinner text="Загрузка…" />}
      {cont.length > 0 && (
        <section>
          <h2>Продолжить просмотр</h2>
          <FocusGroup focusKey="LIB-CONTINUE" className="hscroll">
            {cont.map((e) => {
              const file = c.files(e.torrent).find((f) => f.id === e.fileIndex);
              const name = file ? episodeLabel(file.path) || baseName(file.path) : '';
              return (
                <Focusable key={e.torrent.hash} focusKey={'cont-' + e.torrent.hash} className="wide-card" onPress={() => resume(e)}>
                  <div class="title">{e.torrent.title}</div>
                  <div class="meta">{name} · {formatDuration(e.progress.time)} / {formatDuration(e.progress.duration)}</div>
                  <ProgressBar ratio={e.progress.time / e.progress.duration} />
                </Focusable>
              );
            })}
          </FocusGroup>
        </section>
      )}
      <FocusGroup focusKey="LIB-GRID" className="grid">
        {list.map((t) => (
          <PosterCard key={t.hash} t={t} onPress={() => navigate({ name: 'torrent', hash: t.hash })} onFocused={() => setFocusedHash(t.hash)} />
        ))}
      </FocusGroup>
      {loaded && !list.length && <div class="empty">Нет торрентов. Добавьте через «＋ Добавить» или веб-интерфейс TorrServer на телефоне.</div>}
      <div class="hints">OK — открыть · 🔴 удалить · 🔵 настройки · Назад — выход</div>
    </FocusGroup>
  );
}
```

- [ ] **Step 2: Подключить в src/app.tsx**

Импорт:
```tsx
import { LibraryScreen } from './screens/Library';
```
Case:
```tsx
    case 'library':
      return <LibraryScreen />;
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: без ошибок.

- [ ] **Step 4: Ручная проверка**

Run: `npm run dev` → `http://localhost:5173` (сервер `192.168.1.191:5665` уже выбран).
Expected: сетка постеров (13 торрентов), вкладки фильтруют по категории при наведении, стрелки двигают фокус, OK открывает экран торрента со списком серий по сезонам, Esc возвращает в библиотеку с фокусом на той же карточке. Добавить торрент через веб-интерфейс TorrServer → через ≤10 с появляется в сетке.

- [ ] **Step 5: Commit**

```bash
git add src/screens/Library.tsx src/app.tsx
git commit -m "feat: add library screen with categories, continue watching and auto refresh"
```


---

### Task 14: Логика плеера — перемотка, статистика, меню дорожек

**Files:**
- Create: `src/player/seek.ts`, `src/player/stats.ts`, `src/player/trackOptions.ts`
- Test: `tests/player/seek.test.ts`, `tests/player/stats.test.ts`, `tests/player/trackOptions.test.ts`

**Interfaces:**
- Consumes: `formatBytes`, `formatSpeed` (Task 2); `CacheState`, `FfprobeResult`, `FfprobeStream` (Task 6); `tracksFromProbe`, `describeTrack`, `normalizeLang`, `findLang`, `guessLangFromName` (Task 7); `audioTrackList`, `textTrackList` (Task 8); `ExternalSub` (Task 10)
- Produces:
  - `seekStep(base: number, repeat: number): number`; `class SeekAccumulator { constructor(apply: (t: number) => void, delayMs?: number, now?: () => number); press(dir: 1 | -1, current: number, duration: number, base: number): number; pending(): number | null; commit(): void; cancel(): void }`
  - `hdrLabel(s: FfprobeStream): string`, `statsLines(cache: CacheState | null, probe: FfprobeResult | null): string[]`
  - `interface TrackOption { label: string; language: string; isDefault: boolean }`, `audioOptions(probe, video): TrackOption[]`, `embeddedSubOptions(probe, video): TrackOption[]`, `subtitleMenu(embedded: TrackOption[], external: ExternalSub[]): { label: string; value: string }[]` (значения `'off'`, `'e<N>'`, `'x<N>'`), `defaultSubChoice(embedded, external, s: { subtitlesOn: boolean; subLang: string }): string`, `defaultAudioIndex(options: TrackOption[]): number`

- [ ] **Step 1: Тесты**

`tests/player/seek.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { seekStep, SeekAccumulator } from '../../src/player/seek';

afterEach(() => vi.useRealTimers());

describe('seekStep', () => {
  it('accelerates every 4 repeats up to x6', () => {
    expect(seekStep(10, 0)).toBe(10);
    expect(seekStep(10, 3)).toBe(10);
    expect(seekStep(10, 4)).toBe(20);
    expect(seekStep(10, 100)).toBe(60);
  });
});

describe('SeekAccumulator', () => {
  it('accumulates presses and applies once after delay', () => {
    vi.useFakeTimers();
    let now = 0;
    const apply = vi.fn();
    const s = new SeekAccumulator(apply, 700, () => now);
    expect(s.press(1, 100, 1000, 10)).toBe(110);
    now = 100;
    expect(s.press(1, 100, 1000, 10)).toBe(120);
    expect(s.pending()).toBe(120);
    vi.advanceTimersByTime(699);
    expect(apply).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(apply).toHaveBeenCalledWith(120);
    expect(s.pending()).toBeNull();
  });
  it('clamps to [0, duration-1]', () => {
    const s = new SeekAccumulator(() => undefined, 700, () => 0);
    expect(s.press(-1, 5, 1000, 10)).toBe(0);
    s.cancel();
    expect(s.press(1, 995, 1000, 10)).toBe(999);
    s.cancel();
  });
  it('commit applies immediately, cancel drops', () => {
    const apply = vi.fn();
    const s = new SeekAccumulator(apply, 700, () => 0);
    s.press(1, 0, 100, 10);
    s.commit();
    expect(apply).toHaveBeenCalledWith(10);
    s.press(1, 0, 100, 10);
    s.cancel();
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
```

`tests/player/stats.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { statsLines, hdrLabel } from '../../src/player/stats';

describe('hdrLabel', () => {
  it('detects HDR flavours', () => {
    expect(hdrLabel({ index: 0, codec_type: 'video', codec_name: 'hevc', color_transfer: 'smpte2084' })).toBe('HDR10');
    expect(hdrLabel({ index: 0, codec_type: 'video', codec_name: 'hevc', color_transfer: 'arib-std-b67' })).toBe('HLG');
    expect(hdrLabel({ index: 0, codec_type: 'video', codec_name: 'hevc', codec_tag_string: 'dvh1' })).toBe('Dolby Vision');
    expect(hdrLabel({ index: 0, codec_type: 'video', codec_name: 'h264', color_transfer: 'bt709' })).toBe('');
  });
});

describe('statsLines', () => {
  it('builds lines from cache and probe', () => {
    const lines = statsLines(
      {
        Capacity: 536870912, Filled: 134217728, PiecesLength: 2097152, PiecesCount: 10,
        Torrent: { hash: 'h', title: 't', stat: 3, download_speed: 1048576, active_peers: 3, total_peers: 7, connected_seeders: 2 },
      },
      {
        streams: [{ index: 0, codec_type: 'video', codec_name: 'hevc', profile: 'Main 10', width: 3840, height: 2160, color_transfer: 'smpte2084' }],
        format: { bit_rate: '25000000' },
      },
    );
    expect(lines).toEqual([
      'Скорость: 1.0 MB/s',
      'Пиры: 3 / 7 (сиды 2)',
      'Кэш: 128 MB / 512 MB (25%)',
      'Видео: HEVC Main 10 3840×2160 HDR10',
      'Битрейт: 25.0 Мбит/с',
    ]);
  });
  it('handles missing data', () => {
    expect(statsLines(null, null)).toEqual([]);
  });
});
```

`tests/player/trackOptions.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { audioOptions, embeddedSubOptions, subtitleMenu, defaultSubChoice, defaultAudioIndex } from '../../src/player/trackOptions';
import type { FfprobeResult } from '../../src/api/types';

const probe: FfprobeResult = {
  streams: [
    { index: 0, codec_type: 'video', codec_name: 'h264' },
    { index: 1, codec_type: 'audio', codec_name: 'ac3', channels: 6, tags: { language: 'eng' } },
    { index: 2, codec_type: 'audio', codec_name: 'aac', channels: 2, tags: { language: 'rus' }, disposition: { default: 1 } },
    { index: 3, codec_type: 'subtitle', codec_name: 'subrip', tags: { language: 'eng' } },
  ],
};

describe('trackOptions', () => {
  it('builds audio options from probe', () => {
    expect(audioOptions(probe, null)).toEqual([
      { label: 'EN · AC3 5.1', language: 'en', isDefault: false },
      { label: 'RU · AAC 2.0', language: 'ru', isDefault: true },
    ]);
    expect(defaultAudioIndex(audioOptions(probe, null))).toBe(1);
    expect(defaultAudioIndex([])).toBe(0);
  });
  it('falls back to video.audioTracks', () => {
    const video = { audioTracks: [{ language: 'ru', label: 'Dub' }] } as unknown as HTMLVideoElement;
    expect(audioOptions(null, video)).toEqual([{ label: 'Dub (ru)', language: 'ru', isDefault: false }]);
  });
  it('builds subtitle menu', () => {
    const emb = embeddedSubOptions(probe, null);
    const menu = subtitleMenu(emb, [{ url: 'u', label: 'rus', ext: 'srt' }]);
    expect(menu).toEqual([
      { label: 'Выкл', value: 'off' },
      { label: 'EN · SUBRIP', value: 'e0' },
      { label: 'rus (файл)', value: 'x0' },
    ]);
  });
  it('picks default subtitle', () => {
    const emb = embeddedSubOptions(probe, null);
    const ext = [{ url: 'u', label: 'rus', ext: 'srt' }];
    expect(defaultSubChoice(emb, ext, { subtitlesOn: false, subLang: 'ru' })).toBe('off');
    expect(defaultSubChoice(emb, ext, { subtitlesOn: true, subLang: 'ru' })).toBe('x0');
    expect(defaultSubChoice(emb, ext, { subtitlesOn: true, subLang: 'en' })).toBe('e0');
    expect(defaultSubChoice(emb, ext, { subtitlesOn: true, subLang: 'de' })).toBe('off');
  });
});
```

- [ ] **Step 2: Run — FAIL**

Run: `npx vitest run tests/player`
Expected: FAIL для новых файлов (queue.test.ts проходит)

- [ ] **Step 3: src/player/seek.ts**

```ts
export function seekStep(base: number, repeat: number): number {
  return base * Math.min(1 + Math.floor(repeat / 4), 6);
}

/** Collects repeated ←/→ presses into one target and seeks once the user stops pressing. */
export class SeekAccumulator {
  private target: number | null = null;
  private repeat = 0;
  private lastAt = -Infinity;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly apply: (t: number) => void;
  private readonly delayMs: number;
  private readonly now: () => number;

  constructor(apply: (t: number) => void, delayMs = 700, now: () => number = () => Date.now()) {
    this.apply = apply;
    this.delayMs = delayMs;
    this.now = now;
  }

  press(dir: 1 | -1, current: number, duration: number, base: number): number {
    const t = this.now();
    this.repeat = t - this.lastAt < 900 ? this.repeat + 1 : 0;
    this.lastAt = t;
    const from = this.target === null ? current : this.target;
    const max = duration > 0 ? Math.max(0, duration - 1) : Infinity;
    this.target = Math.max(0, Math.min(max, from + dir * seekStep(base, this.repeat)));
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.commit(), this.delayMs);
    return this.target;
  }

  pending(): number | null {
    return this.target;
  }

  commit(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.target !== null) {
      const v = this.target;
      this.target = null;
      this.apply(v);
    }
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.target = null;
  }
}
```

- [ ] **Step 4: src/player/stats.ts**

```ts
import type { CacheState, FfprobeResult, FfprobeStream } from '../api/types';
import { formatBytes, formatSpeed } from '../lib/format';

export function hdrLabel(s: FfprobeStream): string {
  if (/dvh1|dvhe/i.test(s.codec_tag_string || '')) return 'Dolby Vision';
  if (s.color_transfer === 'smpte2084') return 'HDR10';
  if (s.color_transfer === 'arib-std-b67') return 'HLG';
  return '';
}

export function statsLines(cache: CacheState | null, probe: FfprobeResult | null): string[] {
  const out: string[] = [];
  const t = cache && cache.Torrent;
  if (t) {
    out.push('Скорость: ' + formatSpeed(t.download_speed || 0));
    out.push('Пиры: ' + (t.active_peers || 0) + ' / ' + (t.total_peers || 0) + ' (сиды ' + (t.connected_seeders || 0) + ')');
  }
  if (cache && cache.Capacity > 0) {
    out.push('Кэш: ' + formatBytes(cache.Filled) + ' / ' + formatBytes(cache.Capacity) + ' (' + Math.round((cache.Filled * 100) / cache.Capacity) + '%)');
  }
  const v = probe ? probe.streams.find((s) => s.codec_type === 'video') : undefined;
  if (v) {
    const parts = ['Видео: ' + v.codec_name.toUpperCase()];
    if (v.profile) parts.push(v.profile);
    if (v.width && v.height) parts.push(v.width + '×' + v.height);
    const hdr = hdrLabel(v);
    if (hdr) parts.push(hdr);
    out.push(parts.join(' '));
  }
  const br = probe && probe.format && probe.format.bit_rate;
  if (br) out.push('Битрейт: ' + (+br / 1e6).toFixed(1) + ' Мбит/с');
  return out;
}
```

- [ ] **Step 5: src/player/trackOptions.ts**

```ts
import type { FfprobeResult } from '../api/types';
import { tracksFromProbe, describeTrack, normalizeLang, findLang, guessLangFromName } from '../lib/tracks';
import { audioTrackList, textTrackList } from '../platform/webosMedia';
import type { ExternalSub } from './types';

export interface TrackOption {
  label: string;
  language: string;
  isDefault: boolean;
}

function fromProbe(probe: FfprobeResult | null, kind: 'audio' | 'subtitle'): TrackOption[] {
  return tracksFromProbe(probe)
    .filter((t) => t.kind === kind)
    .map((t) => ({ label: describeTrack(t), language: t.language, isDefault: t.isDefault }));
}

function fromVideo(list: { language: string; label: string }[]): TrackOption[] {
  return list.map((t) => ({
    label: t.label + (t.language ? ' (' + t.language + ')' : ''),
    language: normalizeLang(t.language),
    isDefault: false,
  }));
}

export function audioOptions(probe: FfprobeResult | null, video: HTMLVideoElement | null): TrackOption[] {
  const p = fromProbe(probe, 'audio');
  if (p.length) return p;
  return video ? fromVideo(audioTrackList(video)) : [];
}

export function embeddedSubOptions(probe: FfprobeResult | null, video: HTMLVideoElement | null): TrackOption[] {
  const p = fromProbe(probe, 'subtitle');
  if (p.length) return p;
  return video ? fromVideo(textTrackList(video)) : [];
}

export function defaultAudioIndex(options: TrackOption[]): number {
  for (let i = 0; i < options.length; i++) if (options[i].isDefault) return i;
  return 0;
}

export function subtitleMenu(embedded: TrackOption[], external: ExternalSub[]): { label: string; value: string }[] {
  return [{ label: 'Выкл', value: 'off' }]
    .concat(embedded.map((t, i) => ({ label: t.label, value: 'e' + i })))
    .concat(external.map((s, i) => ({ label: s.label + ' (файл)', value: 'x' + i })));
}

export function defaultSubChoice(
  embedded: TrackOption[],
  external: ExternalSub[],
  s: { subtitlesOn: boolean; subLang: string },
): string {
  if (!s.subtitlesOn) return 'off';
  const e = findLang(embedded, s.subLang);
  if (e >= 0) return 'e' + e;
  for (let i = 0; i < external.length; i++) if (guessLangFromName(external[i].label) === s.subLang) return 'x' + i;
  return 'off';
}
```

- [ ] **Step 6: Run — PASS**

Run: `npx vitest run tests/player`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/player/seek.ts src/player/stats.ts src/player/trackOptions.ts tests/player
git commit -m "feat: add player seek accumulator, stream stats and track menu helpers"
```

---

### Task 15: Экран плеера

**Files:**
- Create: `src/player/useVideoState.ts`, `src/player/useProgressSync.ts`, `src/player/useNextEpisode.ts`, `src/player/useCacheStats.ts`, `src/player/Controls.tsx`, `src/player/Overlays.tsx`, `src/screens/Player.tsx`
- Modify: `src/app.tsx` (импорт + case `player`)

**Interfaces:**
- Consumes: всё из Task 14; `PlayItem` (Task 10); `client` (Task 9); `settings` (Task 9); `saveProgress`, `resumePosition` (Task 9); `selectAudioTrack`, `selectTextTrack` (Task 8); `pickTrack` (Task 7); `parseSubtitles`, `decodeText`, `cueAt`, `Cue` (Task 5); `formatDuration` (Task 2); UI `choose`, `toast`, `useKeys`, `goBack`, `ErrorView`, `Spinner` (Task 10)
- Produces: `PlayerScreen({ queue, index, startAt })`; хуки `useVideoState(ref, srcKey)`, `useProgressSync(c, item, posRef)`, `useNextEpisode(opts)`, `useCacheStats(c, hash, active)`; `mediaErrorText(e: MediaError | null): string`

- [ ] **Step 1: src/player/useVideoState.ts**

```ts
import { useEffect, useState } from 'preact/hooks';
import type { RefObject } from 'preact';

export interface VideoState {
  time: number;
  duration: number;
  paused: boolean;
  buffering: boolean;
  error: string | null;
  /** timestamp of the last 'ended' event, 0 if none */
  ended: number;
}

const INITIAL: VideoState = { time: 0, duration: 0, paused: true, buffering: true, error: null, ended: 0 };

export function mediaErrorText(e: MediaError | null): string {
  switch (e ? e.code : 0) {
    case 1: return 'Воспроизведение прервано';
    case 2: return 'Ошибка сети при загрузке видео';
    case 3: return 'Ошибка декодирования — формат не поддерживается телевизором';
    case 4: return 'Формат или кодек не поддерживается телевизором';
    default: return 'Неизвестная ошибка воспроизведения';
  }
}

export function useVideoState(ref: RefObject<HTMLVideoElement>, srcKey: string): VideoState {
  const [s, setS] = useState<VideoState>(INITIAL);
  useEffect(() => {
    setS(INITIAL);
    const v = ref.current;
    if (!v) return;
    const upd = (patch: Partial<VideoState>) => setS((prev) => ({ ...prev, ...patch }));
    const dur = () => (isFinite(v.duration) ? v.duration : 0);
    const handlers: { [k: string]: () => void } = {
      timeupdate: () => upd({ time: v.currentTime }),
      durationchange: () => upd({ duration: dur() }),
      loadedmetadata: () => upd({ duration: dur() }),
      play: () => upd({ paused: false }),
      pause: () => upd({ paused: true }),
      waiting: () => upd({ buffering: true }),
      seeking: () => upd({ buffering: true }),
      playing: () => upd({ buffering: false, paused: false }),
      canplay: () => upd({ buffering: false }),
      seeked: () => upd({ buffering: false }),
      error: () => upd({ error: mediaErrorText(v.error), buffering: false }),
      ended: () => upd({ ended: Date.now() }),
    };
    Object.keys(handlers).forEach((k) => v.addEventListener(k, handlers[k]));
    return () => Object.keys(handlers).forEach((k) => v.removeEventListener(k, handlers[k]));
  }, [srcKey]);
  return s;
}
```

- [ ] **Step 2: src/player/useProgressSync.ts**

```ts
import { useEffect } from 'preact/hooks';
import type { TorrServerClient } from '../api/torrserver';
import { saveProgress } from '../store/progress';
import type { PlayItem } from './types';

/** Saves position locally every 5 s and to TorrServer /viewed every 15 s and on exit. */
export function useProgressSync(
  c: TorrServerClient | null,
  item: PlayItem,
  pos: { current: { time: number; duration: number } },
): void {
  useEffect(() => {
    const hash = item.hash;
    const idx = item.fileIndex;
    if (!hash || idx === undefined) return;
    const save = (remote: boolean) => {
      const p = pos.current;
      if (p.duration <= 0 || p.time < 1) return;
      saveProgress(hash, idx, p.time, p.duration);
      if (remote && c) c.setViewed(hash, idx, Math.floor(p.time)).catch(() => undefined);
    };
    const local = setInterval(() => save(false), 5000);
    const remote = setInterval(() => save(true), 15000);
    return () => {
      clearInterval(local);
      clearInterval(remote);
      save(true);
    };
  }, [item]);
}
```

- [ ] **Step 3: src/player/useNextEpisode.ts**

```ts
import { useEffect, useRef, useState } from 'preact/hooks';

export interface NextEpisodeOptions {
  itemKey: unknown;
  enabled: boolean;
  hasNext: boolean;
  time: number;
  duration: number;
  ended: number;
  onNext: () => void;
  onEnd: () => void;
}

/** Shows a 10 s countdown in the last 30 s of an episode, then switches to the next one. */
export function useNextEpisode(o: NextEpisodeOptions): { countdown: number | null; dismiss: () => void } {
  const [dismissed, setDismissed] = useState(false);
  const [left, setLeft] = useState<number | null>(null);
  const onNext = useRef(o.onNext);
  const onEnd = useRef(o.onEnd);
  onNext.current = o.onNext;
  onEnd.current = o.onEnd;

  useEffect(() => {
    setDismissed(false);
    setLeft(null);
  }, [o.itemKey]);

  const remaining = o.duration - o.time;
  const show = o.enabled && o.hasNext && !dismissed && o.duration > 60 && remaining > 0 && remaining <= 30;

  useEffect(() => {
    if (!show) {
      setLeft(null);
      return;
    }
    let n = 10;
    setLeft(n);
    const t = setInterval(() => {
      n--;
      if (n <= 0) {
        clearInterval(t);
        onNext.current();
      } else {
        setLeft(n);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [show]);

  useEffect(() => {
    if (!o.ended) return;
    if (o.enabled && o.hasNext) onNext.current();
    else onEnd.current();
  }, [o.ended]);

  return { countdown: show ? left : null, dismiss: () => setDismissed(true) };
}
```

- [ ] **Step 4: src/player/useCacheStats.ts**

```ts
import { useEffect, useState } from 'preact/hooks';
import type { TorrServerClient } from '../api/torrserver';
import type { CacheState } from '../api/types';

export function useCacheStats(c: TorrServerClient | null, hash: string | undefined, active: boolean): CacheState | null {
  const [cache, setCache] = useState<CacheState | null>(null);
  useEffect(() => {
    if (!active || !c || !hash) return;
    let alive = true;
    const tick = () => c.cache(hash).then((r) => { if (alive) setCache(r); }, () => undefined);
    tick();
    const t = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [active, hash]);
  return cache;
}
```

- [ ] **Step 5: src/player/Controls.tsx**

```tsx
import { formatDuration } from '../lib/format';

interface ControlsProps {
  title: string;
  time: number;
  duration: number;
  paused: boolean;
  seekTarget: number | null;
  hasPrev: boolean;
  hasNext: boolean;
  onToggle: () => void;
  onSeekTo: (t: number) => void;
  onPrev: () => void;
  onNext: () => void;
  onTracks: () => void;
}

/** Bottom bar. Keys are handled by the player; mouse handlers serve Magic Remote / ThinQ pointer. */
export function Controls(p: ControlsProps) {
  const shown = p.seekTarget !== null ? p.seekTarget : p.time;
  const pct = p.duration > 0 ? (shown / p.duration) * 100 : 0;
  const barClick = (e: MouseEvent) => {
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    if (p.duration > 0 && rect.width > 0) p.onSeekTo(((e.clientX - rect.left) / rect.width) * p.duration);
  };
  return (
    <div class="player-controls">
      <div class="player-title">{p.title}</div>
      <div class="player-bar" onClick={barClick}>
        <div class="player-bar-fill" style={{ width: pct + '%' }} />
        {p.seekTarget !== null && <div class="player-bar-target" style={{ left: pct + '%' }} />}
      </div>
      <div class="player-row">
        {p.hasPrev && <span class="player-btn" onClick={p.onPrev}>⏮</span>}
        <span class="player-btn" onClick={p.onToggle}>{p.paused ? '▶' : '❚❚'}</span>
        {p.hasNext && <span class="player-btn" onClick={p.onNext}>⏭</span>}
        <span>{formatDuration(shown)} / {formatDuration(p.duration)}</span>
        <span class="player-btn" onClick={p.onTracks}>Дорожки</span>
        <div class="spacer" />
        <span class="player-hints">◀ ▶ перемотка · ▲ дорожки · 🟢 статистика · CH± серии</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: src/player/Overlays.tsx**

```tsx
import type { CacheState, FfprobeResult } from '../api/types';
import { cueAt, Cue } from '../lib/subtitles';
import { formatSpeed } from '../lib/format';
import { settings } from '../store/settings';
import { statsLines } from './stats';
import { Spinner, ErrorView } from '../ui/components';

export function StatsOverlay(p: { cache: CacheState | null; probe: FfprobeResult | null }) {
  const lines = statsLines(p.cache, p.probe);
  return (
    <div class="player-stats">
      {lines.length ? lines.map((l) => <div key={l}>{l}</div>) : <div>Нет данных</div>}
    </div>
  );
}

export function BufferingOverlay(p: { cache: CacheState | null }) {
  const t = p.cache && p.cache.Torrent;
  const text = 'Буферизация…' + (t ? ' ' + formatSpeed(t.download_speed || 0) + ' · пиры ' + (t.active_peers || 0) : '');
  return (
    <div class="player-buffer">
      <Spinner text={text} />
    </div>
  );
}

export function SubtitleOverlay(p: { cues: Cue[] | null; time: number; raised: boolean }) {
  const s = settings.value;
  if (!p.cues) return null;
  const text = cueAt(p.cues, p.time);
  if (!text) return null;
  const cls = 'subtitles sub-' + s.subSize + ' sub-' + s.subColor + (s.subBackground ? ' sub-bg' : ' sub-nobg') + (p.raised ? ' raised' : '');
  return (
    <div class={cls}>
      <span>{text}</span>
    </div>
  );
}

export function NextBanner(p: { seconds: number; title: string; onNext: () => void }) {
  return (
    <div class="next-banner" onClick={p.onNext}>
      <div>Следующая серия через {p.seconds} с</div>
      <div class="meta">{p.title}</div>
      <div class="meta">OK — сейчас · Назад — остаться</div>
    </div>
  );
}

export function PlayerError(p: { message: string; probe: FfprobeResult | null; onRetry: () => void; onBack: () => void }) {
  const details = statsLines(null, p.probe).join('\n');
  return (
    <div class="player-error">
      <ErrorView
        message={p.message + (details ? '\n\n' + details : '')}
        actions={[
          { label: 'Повторить', onPress: p.onRetry },
          { label: 'Назад', onPress: p.onBack },
        ]}
      />
    </div>
  );
}
```

- [ ] **Step 7: src/screens/Player.tsx**

```tsx
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { client } from '../store/servers';
import { settings } from '../store/settings';
import { resumePosition } from '../store/progress';
import type { FfprobeResult } from '../api/types';
import { errorMessage } from '../api/http';
import { formatDuration } from '../lib/format';
import { pickTrack } from '../lib/tracks';
import { parseSubtitles, decodeText, Cue } from '../lib/subtitles';
import { selectAudioTrack, selectTextTrack } from '../platform/webosMedia';
import type { PlayItem } from '../player/types';
import { SeekAccumulator } from '../player/seek';
import { audioOptions, embeddedSubOptions, subtitleMenu, defaultSubChoice, defaultAudioIndex } from '../player/trackOptions';
import { useVideoState } from '../player/useVideoState';
import { useProgressSync } from '../player/useProgressSync';
import { useNextEpisode } from '../player/useNextEpisode';
import { useCacheStats } from '../player/useCacheStats';
import { Controls } from '../player/Controls';
import { StatsOverlay, BufferingOverlay, SubtitleOverlay, NextBanner, PlayerError } from '../player/Overlays';
import { goBack } from '../ui/nav';
import { useKeys } from '../ui/keys';
import { choose } from '../ui/dialog';
import { toast } from '../ui/toast';

interface Props {
  queue: PlayItem[];
  index: number;
  startAt?: number;
}

export function PlayerScreen({ queue, index: startIndex, startAt }: Props) {
  const c = client.value;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [index, setIndex] = useState(startIndex);
  const item = queue[index];
  const [ready, setReady] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [probe, setProbe] = useState<FfprobeResult | null>(null);
  const [controls, setControls] = useState(true);
  const [statsOn, setStatsOn] = useState(settings.value.showStats);
  const [seekTarget, setSeekTarget] = useState<number | null>(null);
  const [audioIdx, setAudioIdx] = useState(-1);
  const [subChoice, setSubChoice] = useState('off');
  const [cues, setCues] = useState<Cue[] | null>(null);
  const startPos = useRef(0);
  const userTracks = useRef(false);
  const metaLoaded = useRef(false);
  const probeRef = useRef<FfprobeResult | null>(null);
  probeRef.current = probe;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const src = ready ? (c ? c.videoSrc(item.url) : item.url) : '';
  const vs = useVideoState(videoRef, index + ':' + reloadKey + ':' + src);
  const posRef = useRef({ time: 0, duration: 0 });
  posRef.current = { time: vs.time, duration: vs.duration };
  useProgressSync(c, item, posRef);

  const hasNext = index < queue.length - 1;
  const hasPrev = index > 0;
  const goNext = () => { if (hasNext) setIndex(index + 1); };
  const goPrev = () => { if (hasPrev) setIndex(index - 1); };

  const next = useNextEpisode({
    itemKey: index,
    enabled: settings.value.autoNext,
    hasNext,
    time: vs.time,
    duration: vs.duration,
    ended: vs.ended,
    onNext: goNext,
    onEnd: () => goBack(),
  });

  const cache = useCacheStats(c, item.hash, statsOn || (ready && vs.buffering));

  const showControls = () => {
    setControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      const v = videoRef.current;
      if (v && !v.paused) setControls(false);
    }, 4000);
  };

  // resume decision + ffprobe for every new item
  useEffect(() => {
    setReady(false);
    setProbe(null);
    setCues(null);
    setSubChoice('off');
    setAudioIdx(-1);
    userTracks.current = false;
    metaLoaded.current = false;
    showControls();
    let cancelled = false;
    const decide = (): Promise<number> => {
      if (index === startIndex && startAt !== undefined) return Promise.resolve(startAt);
      if (!item.hash || item.fileIndex === undefined) return Promise.resolve(0);
      const pos = resumePosition(item.hash, item.fileIndex);
      if (pos <= 0) return Promise.resolve(0);
      return choose('Продолжить просмотр?', [
        { label: 'Продолжить с ' + formatDuration(pos), value: pos },
        { label: 'Сначала', value: 0 },
      ]).then((v) => (v === null ? -1 : v));
    };
    decide().then((pos) => {
      if (cancelled) return;
      if (pos < 0) {
        goBack();
        return;
      }
      startPos.current = pos;
      setReady(true);
    });
    if (c && item.hash && item.fileIndex !== undefined) {
      c.probe(item.hash, item.fileIndex).then((p) => { if (!cancelled) setProbe(p); });
    }
    return () => { cancelled = true; };
  }, [index]);

  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);

  const seeker = useMemo(
    () => new SeekAccumulator((t) => {
      const v = videoRef.current;
      if (v) v.currentTime = t;
      setSeekTarget(null);
    }),
    [],
  );
  useEffect(() => () => seeker.cancel(), []);

  const seek = (dir: 1 | -1) => {
    const v = videoRef.current;
    if (!v) return;
    setSeekTarget(seeker.press(dir, v.currentTime, vs.duration, settings.value.seekStep));
    showControls();
  };

  const seekTo = (t: number) => {
    seeker.cancel();
    setSeekTarget(null);
    const v = videoRef.current;
    if (v) v.currentTime = t;
    showControls();
  };

  const togglePause = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      const p = v.play() as Promise<void> | undefined;
      if (p && p.catch) p.catch(() => undefined);
    } else {
      v.pause();
    }
    showControls();
  };

  const applySubChoice = (choice: string) => {
    const v = videoRef.current;
    if (!v) return;
    setSubChoice(choice);
    setCues(null);
    if (choice === 'off') {
      selectTextTrack(v, -1);
      return;
    }
    const n = +choice.slice(1);
    if (choice.charAt(0) === 'e') {
      selectTextTrack(v, n);
      return;
    }
    selectTextTrack(v, -1);
    const sub = (item.subtitles || [])[n];
    if (!sub || !c) return;
    c.fetchBytes(sub.url).then(
      (buf) => setCues(parseSubtitles(decodeText(buf), sub.ext)),
      (e) => toast('Не удалось загрузить субтитры: ' + errorMessage(e), 'error'),
    );
  };

  const applyDefaultTracks = () => {
    const v = videoRef.current;
    if (!v || userTracks.current) return;
    const s = settings.value;
    const audio = audioOptions(probeRef.current, v);
    const ai = pickTrack(audio, s.audioLang);
    if (ai >= 0) {
      setAudioIdx(ai);
      if (ai !== defaultAudioIndex(audio)) selectAudioTrack(v, ai);
    }
    applySubChoice(defaultSubChoice(embeddedSubOptions(probeRef.current, v), item.subtitles || [], s));
  };

  // ffprobe often arrives after metadata: re-apply language defaults
  useEffect(() => {
    if (probe && metaLoaded.current) applyDefaultTracks();
  }, [probe]);

  const onMeta = () => {
    const v = videoRef.current;
    if (!v) return;
    metaLoaded.current = true;
    if (startPos.current > 0) {
      try { v.currentTime = startPos.current; } catch (e) { /* not seekable yet */ }
    }
    applyDefaultTracks();
  };

  const openTrackMenu = () => {
    const v = videoRef.current;
    if (!v) return;
    const audio = audioOptions(probe, v);
    const menu = subtitleMenu(embeddedSubOptions(probe, v), item.subtitles || []);
    const current = menu.find((o) => o.value === subChoice) || menu[0];
    const audioLabel = audio[audioIdx] ? audio[audioIdx].label : 'по умолчанию';
    choose('Дорожки', [
      { label: 'Аудио: ' + audioLabel, value: 'audio' },
      { label: 'Субтитры: ' + current.label, value: 'subs' },
    ]).then((kind) => {
      if (kind === 'audio') {
        if (audio.length < 2) {
          toast('Других аудиодорожек нет');
          return;
        }
        choose('Аудио', audio.map((a, i) => ({ label: a.label, value: i })), audioIdx).then((i) => {
          if (i === null) return;
          userTracks.current = true;
          setAudioIdx(i);
          selectAudioTrack(v, i);
        });
      } else if (kind === 'subs') {
        choose('Субтитры', menu, subChoice).then((ch) => {
          if (ch === null) return;
          userTracks.current = true;
          applySubChoice(ch);
        });
      }
    });
  };

  const retry = () => {
    startPos.current = posRef.current.time;
    setReloadKey(reloadKey + 1);
  };

  useKeys((a) => {
    if (vs.error) return false; // error view buttons use spatial navigation
    if (next.countdown !== null) {
      if (a === 'enter') { goNext(); return true; }
      if (a === 'back') { next.dismiss(); return true; }
    }
    switch (a) {
      case 'enter':
      case 'playpause':
        togglePause();
        return true;
      case 'play': {
        const v = videoRef.current;
        if (v && v.paused) togglePause();
        return true;
      }
      case 'pause': {
        const v = videoRef.current;
        if (v && !v.paused) togglePause();
        return true;
      }
      case 'stop':
        goBack();
        return true;
      case 'left':
      case 'rw':
        seek(-1);
        return true;
      case 'right':
      case 'ff':
        seek(1);
        return true;
      case 'up':
      case 'yellow':
        openTrackMenu();
        return true;
      case 'down':
        showControls();
        return true;
      case 'green':
      case 'info':
        setStatsOn(!statsOn);
        return true;
      case 'next':
        goNext();
        return true;
      case 'prev':
        goPrev();
        return true;
      case 'back':
        if (controls && !vs.paused) {
          setControls(false);
          return true;
        }
        goBack();
        return true;
    }
    return false;
  });

  if (!item) return null;

  return (
    <div class="player" onMouseMove={showControls}>
      <video key={index + ':' + reloadKey} ref={videoRef} src={src || undefined} autoplay onLoadedMetadata={onMeta} />
      <SubtitleOverlay cues={cues} time={vs.time} raised={controls} />
      {ready && vs.buffering && !vs.error && <BufferingOverlay cache={cache} />}
      {statsOn && <StatsOverlay cache={cache} probe={probe} />}
      {next.countdown !== null && hasNext && (
        <NextBanner seconds={next.countdown} title={queue[index + 1].title} onNext={goNext} />
      )}
      {(controls || vs.paused) && !vs.error && (
        <Controls
          title={item.title}
          time={vs.time}
          duration={vs.duration}
          paused={vs.paused}
          seekTarget={seekTarget}
          hasPrev={hasPrev}
          hasNext={hasNext}
          onToggle={togglePause}
          onSeekTo={seekTo}
          onPrev={goPrev}
          onNext={goNext}
          onTracks={openTrackMenu}
        />
      )}
      {vs.error && <PlayerError message={vs.error} probe={probe} onRetry={retry} onBack={() => goBack()} />}
    </div>
  );
}
```

- [ ] **Step 8: Подключить в src/app.tsx**

Импорт:
```tsx
import { PlayerScreen } from './screens/Player';
```
Case:
```tsx
    case 'player':
      return <PlayerScreen queue={r.queue} index={r.index} startAt={r.startAt} />;
```

- [ ] **Step 9: Тесты и сборка**

Run: `npx vitest run && npm run build`
Expected: PASS, сборка без ошибок типов.

- [ ] **Step 10: Ручная проверка в браузере (Chrome на ПК)**

Run: `npm run dev` → открыть торрент «Star.Trek.Strange.New.Worlds.S04…» → серия S04E01.
Expected:
- видео (H.264/AAC) играет; Пробел — пауза; ←/→ — накопительная перемотка (маркер на полосе, применяется через 0.7 с); удержание → ускорение;
- `i` — оверлей статистики со скоростью/пирами/кэшем/кодеком;
- ↑ — меню «Дорожки» (аудио: `UND · AAC 2.0`; субтитры: «Выкл»);
- Esc при видимой панели скрывает её, повторный Esc — выход к торренту; у серии появилась полоска прогресса;
- повторный запуск серии → диалог «Продолжить с …»;
- `n` — следующая серия.
(Chrome на ПК не воспроизводит часть MKV-кодеков — это ожидаемо; при ошибке должен показаться экран ошибки с данными ffprobe и кнопками «Повторить»/«Назад».)

- [ ] **Step 11: Commit**

```bash
git add src/player src/screens/Player.tsx src/app.tsx
git commit -m "feat: add player screen with resume, seeking, tracks, subtitles, stats and next episode"
```

---

### Task 16: Экран «Добавить» (magnet + поиск)

**Files:**
- Create: `src/screens/Add.tsx`
- Modify: `src/app.tsx` (импорт + case `add`)

**Interfaces:**
- Consumes: `client` (Task 9); `SearchSource` (Task 6); `SearchResult` (Task 6); `errorMessage` (Task 6); `mapSearchCategory` (Task 2); `replaceRoute` (Task 10); UI (Task 10)
- Produces: `AddScreen()`

- [ ] **Step 1: src/screens/Add.tsx**

```tsx
import { useEffect, useState } from 'preact/hooks';
import { client } from '../store/servers';
import type { SearchSource } from '../api/torrserver';
import type { SearchResult } from '../api/types';
import { errorMessage } from '../api/http';
import { mapSearchCategory } from '../lib/category';
import { replaceRoute } from '../ui/nav';
import { FocusGroup, Focusable, Button, TextInput, ChoiceRow, Spinner } from '../ui/components';
import { restoreFocus } from '../ui/focus';
import { toast } from '../ui/toast';

const SOURCES: { value: SearchSource; label: string }[] = [
  { value: 'rutor', label: 'Rutor' },
  { value: 'torznab', label: 'Torznab (Jackett)' },
];

export function AddScreen() {
  const c = client.value!;
  const [link, setLink] = useState('');
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<SearchSource>('rutor');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => restoreFocus('ADD'), []);

  const add = (p: { link: string; title?: string; category?: string }) => {
    const l = p.link.trim();
    if (!l) {
      toast('Введите magnet-ссылку, хеш или URL .torrent', 'error');
      return;
    }
    setBusy(true);
    c.add({ link: l, title: p.title, category: p.category }).then(
      (t) => {
        toast('Добавлено: ' + (t.title || p.title || t.hash));
        replaceRoute({ name: 'torrent', hash: t.hash });
      },
      (e) => {
        setBusy(false);
        toast(errorMessage(e), 'error');
      },
    );
  };

  const search = () => {
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    setResults(null);
    c.search(q, source).then(
      (r) => {
        setBusy(false);
        setResults(r);
        if (!r.length) toast('Ничего не найдено');
      },
      (e) => {
        setBusy(false);
        toast(errorMessage(e), 'error');
      },
    );
  };

  return (
    <FocusGroup focusKey="ADD" className="screen add">
      <h1>Добавить торрент</h1>
      <h2>Magnet-ссылка, хеш или URL .torrent</h2>
      <div class="row">
        <TextInput focusKey="add-link" value={link} onChange={setLink} placeholder="magnet:?xt=urn:btih:…" onSubmit={() => add({ link })} />
        <Button label="Добавить" onPress={() => add({ link })} disabled={busy} />
      </div>
      <h2>Поиск</h2>
      <div class="row">
        <TextInput value={query} onChange={setQuery} placeholder="Название фильма или сериала" onSubmit={search} />
        <ChoiceRow label="Источник" value={source} options={SOURCES} onChange={setSource} />
        <Button label="Искать" onPress={search} disabled={busy} />
      </div>
      {busy && <Spinner text="Подождите…" />}
      {results && (
        <FocusGroup focusKey="ADD-RESULTS">
          {results.map((r, i) => (
            <Focusable
              key={i}
              focusKey={'res-' + i}
              className="list-item"
              onPress={() => add({ link: r.Magnet || r.Link, title: r.Title, category: mapSearchCategory(r.Categories) })}
            >
              <div class="title">{r.Title}</div>
              <div class="meta">
                {r.Size} · ⬆ {r.Seed} ⬇ {r.Peer} · {r.Tracker}{r.CreateDate ? ' · ' + r.CreateDate.slice(0, 10) : ''}
              </div>
            </Focusable>
          ))}
        </FocusGroup>
      )}
      <div class="hints">Текст удобно вводить с клавиатуры телефона в приложении LG ThinQ</div>
    </FocusGroup>
  );
}
```

- [ ] **Step 2: Подключить в src/app.tsx**

Импорт:
```tsx
import { AddScreen } from './screens/Add';
```
Case:
```tsx
    case 'add':
      return <AddScreen />;
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: без ошибок.

- [ ] **Step 4: Ручная проверка**

`npm run dev` → «＋ Добавить» → поиск «matrix» (Rutor) → список результатов с размером и сидами; переключатель «Источник» ←/→ → Torznab → результаты RuTracker/NoNaMe. Выбор результата добавляет торрент и открывает его экран (после проверки удалить тестовый торрент красной кнопкой/F1).

- [ ] **Step 5: Commit**

```bash
git add src/screens/Add.tsx src/app.tsx
git commit -m "feat: add screen for adding torrents by link or search"
```

---

### Task 17: Экран «Плейлист» (M3U/M3U8/HLS)

**Files:**
- Create: `src/screens/Playlist.tsx`
- Modify: `src/app.tsx` (импорт + case `playlist`)

**Interfaces:**
- Consumes: `client` (Task 9); `request`, `errorMessage` (Task 6); `parseM3U`, `isHlsPlaylist`, `parseStreamUrl`, `PlaylistEntry` (Task 4); `formatDuration` (Task 2); `PlayItem` (Task 10); `navigate`, `replaceRoute` (Task 10); UI (Task 10)
- Produces: `PlaylistScreen({ url?, title? })`

- [ ] **Step 1: src/screens/Playlist.tsx**

```tsx
import { useEffect, useState } from 'preact/hooks';
import { client } from '../store/servers';
import { request, errorMessage } from '../api/http';
import { parseM3U, isHlsPlaylist, parseStreamUrl, PlaylistEntry } from '../lib/m3u';
import { formatDuration } from '../lib/format';
import type { PlayItem } from '../player/types';
import { navigate, replaceRoute } from '../ui/nav';
import { FocusGroup, Focusable, Button, TextInput, Spinner } from '../ui/components';
import { restoreFocus } from '../ui/focus';

export function PlaylistScreen(p: { url?: string; title?: string }) {
  const c = client.value;
  const [url, setUrl] = useState(p.url || '');
  const [entries, setEntries] = useState<PlaylistEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = (u: string) => {
    const target = u.trim();
    if (!target) return;
    setBusy(true);
    setError(null);
    setEntries(null);
    const text = c ? c.fetchText(target) : request<string>(target, { responseType: 'text', timeoutMs: 15000 });
    text.then(
      (body) => {
        setBusy(false);
        if (isHlsPlaylist(body)) {
          replaceRoute({ name: 'player', queue: [{ url: target, title: p.title || target }], index: 0 });
          return;
        }
        const list = parseM3U(body, target);
        if (!list.length) setError('Плейлист пуст или имеет неизвестный формат');
        setEntries(list);
      },
      (e) => {
        setBusy(false);
        setError(errorMessage(e));
      },
    );
  };

  useEffect(() => {
    if (p.url) load(p.url);
    else restoreFocus('PLAYLIST');
  }, []);

  useEffect(() => {
    if (entries && entries.length) restoreFocus('PLAYLIST-ENTRIES');
  }, [entries]);

  const queue: PlayItem[] = (entries || []).map((e) => {
    const ref = parseStreamUrl(e.url);
    return {
      url: e.url,
      title: e.title,
      poster: e.logo,
      hash: ref ? ref.hash : undefined,
      fileIndex: ref ? ref.fileIndex : undefined,
    };
  });

  return (
    <FocusGroup focusKey="PLAYLIST" className="screen playlist">
      <h1>{p.title || 'Плейлист'}</h1>
      {!p.url && (
        <div class="row">
          <TextInput focusKey="pl-url" value={url} onChange={setUrl} placeholder="URL плейлиста M3U / M3U8" type="url" onSubmit={() => load(url)} />
          <Button label="Открыть" onPress={() => load(url)} />
          {c && (
            <Button
              label="Все торренты сервера"
              onPress={() => {
                const u = c.allPlaylistUrl();
                setUrl(u);
                load(u);
              }}
            />
          )}
        </div>
      )}
      {busy && <Spinner text="Загрузка плейлиста…" />}
      {error && <div class="banner-error">{error}</div>}
      {entries && entries.length > 0 && (
        <FocusGroup focusKey="PLAYLIST-ENTRIES">
          <Button label={'▶ Воспроизвести всё (' + entries.length + ')'} onPress={() => navigate({ name: 'player', queue, index: 0 })} />
          {entries.map((e, i) => (
            <div key={i}>
              {e.group && (i === 0 || entries[i - 1].group !== e.group) && <h2>{e.group}</h2>}
              <Focusable focusKey={'pl-' + i} className="list-item" onPress={() => navigate({ name: 'player', queue, index: i })}>
                <div class="title">{e.title}</div>
                {e.duration > 0 && <div class="meta">{formatDuration(e.duration)}</div>}
              </Focusable>
            </div>
          ))}
        </FocusGroup>
      )}
    </FocusGroup>
  );
}
```

- [ ] **Step 2: Подключить в src/app.tsx**

Импорт:
```tsx
import { PlaylistScreen } from './screens/Playlist';
```
Case:
```tsx
    case 'playlist':
      return <PlaylistScreen url={r.url} title={r.title} />;
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: без ошибок.

- [ ] **Step 4: Ручная проверка**

`npm run dev`:
- Библиотека → «Плейлист» → «Все торренты сервера» → список всех файлов всех торрентов; OK на элементе запускает плеер, CH+/`n` переходит к следующему.
- Экран торрента → «Плейлист» → список серий этого торрента.
- Ввести URL публичного HLS-потока (например `https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8`) → сразу открывается плеер (в Chrome на ПК HLS без MSE не играет — показ экрана ошибки допустим; на ТВ играет нативно).

- [ ] **Step 5: Commit**

```bash
git add src/screens/Playlist.tsx src/app.tsx
git commit -m "feat: add playlist screen for M3U/M3U8 and HLS streams"
```

---

### Task 18: Экран «Настройки» (приложение + сервер)

**Files:**
- Create: `src/version.ts`, `src/screens/Settings.tsx`
- Modify: `src/app.tsx` (импорт + case `settings`)

**Interfaces:**
- Consumes: `settings`, `updateSettings`, `resetSettings` (Task 9); `client`, `activeServer` (Task 9); `ServerSettings` (Task 6); `LANG_OPTIONS` (Task 7); `ChoiceRow`, `ON_OFF`, `Button`, `FocusGroup` (Task 10); `confirmDialog`, `toast`, `navigate`, `restoreFocus` (Task 10)
- Produces: `APP_VERSION`, `SettingsScreen()`

- [ ] **Step 1: src/version.ts**

```ts
export const APP_VERSION = '0.1.0';
```

- [ ] **Step 2: src/screens/Settings.tsx**

```tsx
import { useEffect, useState } from 'preact/hooks';
import { settings, updateSettings, resetSettings } from '../store/settings';
import { client, activeServer } from '../store/servers';
import type { ServerSettings } from '../api/types';
import { errorMessage } from '../api/http';
import { LANG_OPTIONS } from '../lib/tracks';
import { APP_VERSION } from '../version';
import { navigate } from '../ui/nav';
import { FocusGroup, ChoiceRow, ON_OFF, Button } from '../ui/components';
import { restoreFocus } from '../ui/focus';
import { confirmDialog } from '../ui/dialog';
import { toast } from '../ui/toast';

const MB = 1024 * 1024;
const SEEK = [5, 10, 15, 30, 60].map((v) => ({ value: v, label: v + ' с' }));
const SUB_SIZE: { value: 'small' | 'medium' | 'large'; label: string }[] = [
  { value: 'small', label: 'Маленький' },
  { value: 'medium', label: 'Средний' },
  { value: 'large', label: 'Крупный' },
];
const SUB_COLOR: { value: 'white' | 'yellow'; label: string }[] = [
  { value: 'white', label: 'Белый' },
  { value: 'yellow', label: 'Жёлтый' },
];
const CACHE = [64, 128, 256, 512, 1024, 2048].map((m) => ({ value: m * MB, label: m >= 1024 ? m / 1024 + ' ГБ' : m + ' МБ' }));
const PRELOAD = [0, 5, 10, 25, 50, 75, 95].map((v) => ({ value: v, label: v + '%' }));
const READAHEAD = [5, 25, 50, 75, 95].map((v) => ({ value: v, label: v + '%' }));
const CONNS = [10, 25, 50, 100, 200].map((v) => ({ value: v, label: String(v) }));
// TorrServer rate limits are in KB/s, 0 = unlimited
const RATE = [{ value: 0, label: 'Без ограничений' }].concat([1, 5, 10, 25, 50].map((m) => ({ value: m * 1024, label: m + ' МБ/с' })));
const DISCONNECT = [30, 60, 120, 300].map((v) => ({ value: v, label: v + ' с' }));

/** Keeps a server value visible even when it is not one of our presets. */
function withCurrent(options: { value: number; label: string }[], value: number) {
  return options.some((o) => o.value === value) ? options : [{ value, label: String(value) }].concat(options);
}

export function SettingsScreen() {
  const c = client.value;
  const s = settings.value;
  const [srv, setSrv] = useState<ServerSettings | null>(null);
  const [srvError, setSrvError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const loadServer = () => {
    if (!c) return;
    c.getSettings().then(
      (r) => { setSrv(r); setSrvError(null); setDirty(false); },
      (e) => setSrvError(errorMessage(e)),
    );
  };

  useEffect(() => {
    restoreFocus('SETTINGS');
    loadServer();
  }, []);

  const patch = (p: Partial<ServerSettings>) => {
    if (!srv) return;
    setSrv({ ...srv, ...p } as ServerSettings);
    setDirty(true);
  };

  const saveServer = () => {
    if (!c || !srv) return;
    c.setSettings(srv).then(
      () => { setDirty(false); toast('Настройки сервера сохранены'); },
      (e) => toast(errorMessage(e), 'error'),
    );
  };

  const resetServer = () => {
    confirmDialog('Сбросить настройки сервера по умолчанию?', 'Сбросить').then((ok) => {
      if (ok && c) c.resetSettings().then(loadServer, (e) => toast(errorMessage(e), 'error'));
    });
  };

  return (
    <FocusGroup focusKey="SETTINGS" className="screen settings">
      <h1>Настройки</h1>

      <h2>Воспроизведение</h2>
      <ChoiceRow focusKey="set-audio" label="Язык аудио" value={s.audioLang} options={LANG_OPTIONS} onChange={(v) => updateSettings({ audioLang: v })} />
      <ChoiceRow label="Субтитры при запуске" value={s.subtitlesOn} options={ON_OFF} onChange={(v) => updateSettings({ subtitlesOn: v })} />
      <ChoiceRow label="Язык субтитров" value={s.subLang} options={LANG_OPTIONS} onChange={(v) => updateSettings({ subLang: v })} />
      <ChoiceRow label="Шаг перемотки" value={s.seekStep} options={SEEK} onChange={(v) => updateSettings({ seekStep: v })} />
      <ChoiceRow label="Автопереход к следующей серии" value={s.autoNext} options={ON_OFF} onChange={(v) => updateSettings({ autoNext: v })} />
      <ChoiceRow label="Статистика потока при запуске" value={s.showStats} options={ON_OFF} onChange={(v) => updateSettings({ showStats: v })} />

      <h2>Субтитры</h2>
      <ChoiceRow label="Размер" value={s.subSize} options={SUB_SIZE} onChange={(v) => updateSettings({ subSize: v })} />
      <ChoiceRow label="Цвет" value={s.subColor} options={SUB_COLOR} onChange={(v) => updateSettings({ subColor: v })} />
      <ChoiceRow label="Подложка" value={s.subBackground} options={ON_OFF} onChange={(v) => updateSettings({ subBackground: v })} />

      <h2>Сервер{activeServer.value ? ' — ' + activeServer.value.name : ''}</h2>
      {srvError && <div class="banner-error">{srvError}</div>}
      {srv && (
        <div>
          <ChoiceRow label="Размер кэша" value={srv.CacheSize} options={withCurrent(CACHE, srv.CacheSize)} onChange={(v) => patch({ CacheSize: v })} />
          <ChoiceRow label="Предзагрузка" value={srv.PreloadCache} options={withCurrent(PRELOAD, srv.PreloadCache)} onChange={(v) => patch({ PreloadCache: v })} />
          <ChoiceRow label="Опережающее чтение" value={srv.ReaderReadAHead} options={withCurrent(READAHEAD, srv.ReaderReadAHead)} onChange={(v) => patch({ ReaderReadAHead: v })} />
          <ChoiceRow label="Лимит соединений" value={srv.ConnectionsLimit} options={withCurrent(CONNS, srv.ConnectionsLimit)} onChange={(v) => patch({ ConnectionsLimit: v })} />
          <ChoiceRow label="Ограничение загрузки" value={srv.DownloadRateLimit} options={withCurrent(RATE, srv.DownloadRateLimit)} onChange={(v) => patch({ DownloadRateLimit: v })} />
          <ChoiceRow label="Ограничение отдачи" value={srv.UploadRateLimit} options={withCurrent(RATE, srv.UploadRateLimit)} onChange={(v) => patch({ UploadRateLimit: v })} />
          <ChoiceRow label="Отключать неактивный торрент через" value={srv.TorrentDisconnectTimeout} options={withCurrent(DISCONNECT, srv.TorrentDisconnectTimeout)} onChange={(v) => patch({ TorrentDisconnectTimeout: v })} />
          <ChoiceRow label="Сохранять тайм-коды на сервере" value={!!srv.TrackTimecode} options={ON_OFF} onChange={(v) => patch({ TrackTimecode: v })} />
          <div class="row">
            <Button label={dirty ? 'Сохранить на сервере •' : 'Сохранить на сервере'} onPress={saveServer} />
            <Button label="По умолчанию" onPress={resetServer} />
            <Button label="Сменить сервер" onPress={() => navigate({ name: 'connect' })} />
          </div>
        </div>
      )}

      <h2>О приложении</h2>
      <div class="muted">TorrServer Player {APP_VERSION}{c ? ' · ' + c.baseUrl : ''}</div>
      <div class="row" style={{ marginTop: '16px' }}>
        <Button
          label="Сбросить настройки приложения"
          onPress={() => confirmDialog('Сбросить настройки приложения?', 'Сбросить').then((ok) => { if (ok) resetSettings(); })}
        />
      </div>
    </FocusGroup>
  );
}
```

- [ ] **Step 3: Подключить в src/app.tsx**

Импорт:
```tsx
import { SettingsScreen } from './screens/Settings';
```
Case:
```tsx
    case 'settings':
      return <SettingsScreen />;
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: без ошибок.

- [ ] **Step 5: Ручная проверка**

`npm run dev` → «Настройки»: ←/→ меняют значения, после перезагрузки страницы настройки приложения сохранены. Секция «Сервер» показывает текущие значения (кэш 512 МБ, предзагрузка 50%, соединения 25). Изменить «Сохранять тайм-коды» → «Сохранить на сервере» → тост; проверить `curl -s -X POST http://192.168.1.191:5665/settings -d '{"action":"get"}'` → `"TrackTimecode":true`. Вернуть значение обратно, если пользователь не просил его менять.

- [ ] **Step 6: Commit**

```bash
git add src/version.ts src/screens/Settings.tsx src/app.tsx
git commit -m "feat: add settings screen for playback, subtitles and TorrServer options"
```

---

### Task 19: README, финальная проверка, сборка .ipk, push

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: всё приложение
- Produces: документация по установке; `build/com.spacesarmat.torrplayer_0.1.0_all.ipk`; запушенная ветка `main`

- [ ] **Step 1: README.md**

````markdown
# webOS TorrServer Player

Медиапроигрыватель для телевизоров LG (webOS 4.0+), работающий с [TorrServer](https://github.com/YouROK/TorrServer) в локальной сети.

## Возможности

- Подключение к одному или нескольким TorrServer, автопоиск серверов в сети (порты 8090 и 5665)
- Библиотека торрентов с постерами и категориями, «Продолжить просмотр», автообновление (торренты, добавленные с телефона через веб-интерфейс TorrServer, появляются сами)
- Сериалы: группировка по сезонам, отметки просмотренного, продолжение с места остановки (локально + `/viewed` на сервере), автопереход к следующей серии
- Плеер на аппаратном декодере ТВ: MKV/MP4/TS/AVI, H.264/HEVC/VP9/AV1, HDR10/HLG/Dolby Vision, AAC/AC3/EAC3/DTS (в пределах возможностей модели)
- Выбор аудиодорожек и субтитров (встроенных и внешних SRT/VTT/ASS, кодировки UTF-8 и CP1251)
- Статистика потока: скорость, пиры, кэш, кодек, HDR
- Плейлисты M3U/M3U8 и HLS-потоки
- Добавление торрентов: magnet / хеш / URL .torrent, поиск через Rutor и Torznab (Jackett)
- Настройки приложения и сервера TorrServer
- Управление: пульт LG, Magic Remote (указатель), приложение LG ThinQ на телефоне (пульт, тачпад, ввод текста)

## Управление

| Кнопка | Действие |
|---|---|
| Стрелки / OK | Навигация / выбор |
| Назад | Предыдущий экран |
| В плеере: OK, ▶/❚❚ | Пауза / продолжить |
| В плеере: ◀ ▶, ⏪ ⏩ | Перемотка (удержание — быстрее) |
| В плеере: ▲ или 🟡 | Аудиодорожки и субтитры |
| В плеере: 🟢 или Info | Статистика потока |
| В плеере: CH+ / CH− | Следующий / предыдущий файл |
| 🔴 | Удалить торрент |
| 🔵 | Настройки |

## Установка на телевизор

1. На ТВ установите приложение **Developer Mode** из LG Content Store, войдите под аккаунтом разработчика LG, включите Dev Mode и Key Server, перезагрузите ТВ.
2. На ПК:
   ```bash
   npm install
   npx ares-setup-device   # добавить устройство с именем "tv", IP телевизора, порт 9922, пользователь prisoner
   npx ares-novacom --device tv --getkey   # ввести passphrase с экрана Developer Mode
   npm run package
   npm run tv:install
   npm run tv:launch
   ```
   Имя устройства можно переопределить переменной `WEBOS_DEVICE`.

Альтернатива: установить `.ipk` через Homebrew Channel (на рутованных ТВ).

## Разработка

```bash
npm install
npm run dev      # http://localhost:5173 — стрелки, Enter, Esc (Назад), Пробел, F1–F4 (цветные), i (статистика), n/p (серии)
npm test
npm run build    # legacy-бандл для Chromium 53+ в dist/
```

## Ограничения

- Набор поддерживаемых кодеков зависит от модели телевизора; браузер на ПК воспроизводит не всё.
- Если на TorrServer включена авторизация, на новых webOS (Chromium 59+) видео может не воспроизводиться: браузер блокирует логин/пароль в URL медиафайлов.
- Графические субтитры (PGS/VobSub) — только встроенные, через декодер ТВ.
````

- [ ] **Step 2: Полная проверка**

Run: `npx vitest run`
Expected: все тесты PASS (вывести количество).

Run: `npm run build`
Expected: без ошибок.

Run: `node -e "const h=require('fs').readFileSync('dist/index.html','utf8'); if(/type=\"module\"/.test(h)) {console.error('FAIL'); process.exit(1)} console.log('OK legacy-only')"`
Expected: `OK legacy-only`

Run: `npm run package`
Expected: `built build/com.spacesarmat.torrplayer_0.1.0_all.ipk`

- [ ] **Step 3: Проверка открытия из file:// (как на ТВ)**

Run: открыть `dist/index.html` напрямую в Chrome (`file:///C:/Users/ANDYBUM/webostorrserver/dist/index.html`).
Expected: приложение загружается (экран подключения), без ошибок загрузки модулей в консоли. Подключение к `192.168.1.191:5665` работает.

- [ ] **Step 4: Commit и push**

```bash
git add README.md
git commit -m "docs: add README with features, controls and TV installation"
git push origin main
```

- [ ] **Step 5: Чек-лист проверки на ТВ (выполняет пользователь)**

Передать пользователю список для проверки на телевизоре:
1. Установка `npm run tv:install` и запуск.
2. Автопоиск находит сервер; библиотека загружается.
3. MKV HEVC 4K HDR — воспроизводится, HDR включается.
4. Переключение аудиодорожек (AC3/EAC3/DTS) и встроенных субтитров через ▲.
5. Внешние SRT в CP1251 отображаются корректно.
6. Magic Remote: наведение фокусирует, клик открывает; клик по полосе плеера перематывает.
7. LG ThinQ: стрелки, OK, ввод magnet-ссылки с клавиатуры телефона.
8. Продолжение просмотра после выхода и повторного входа; автопереход к следующей серии.
