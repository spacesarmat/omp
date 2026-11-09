# Cross-platform OMP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Выпустить полноценный OMP сначала для Windows 10/11 x64, а затем добавить macOS и Linux через те же интерфейсы платформы, бинарных активов, процессов и обновлений.

**Architecture:** Preact UI переиспользуется из `mobile/src`, адаптеры desktop находятся в `desktop/`. Rust в `desktop/src-tauri` изолирует процессы, загрузки и пакеты. Windows реализуется первой, но платформенные различия ограничены `TargetPlatform`, `process.rs` и `PackageInstaller`.

**Tech Stack:** Tauri, Preact, TypeScript, Vite, Rust, mpv, TorrServer, NSIS, будущие DMG и AppImage, GitHub Actions Windows/macOS/Linux, Vitest, cargo test.

**Spec:** `docs/superpowers/specs/2026-11-09-windows-desktop-design.md`

## Global Constraints

- Первая ОС - Windows 10/11 x64. Не изменять Android, webOS, billing, production, NUC или устройства.
- Каждая задача начинается с failing test и заканчивается зелёными проверками и отдельным PR.
- `main` не меняется напрямую. Merge каждого PR только с разрешения Andy и зелёным CI.
- Никаких `cfg!(windows)` или Windows-only путей в бизнес-логике. Платформенные различия только в `platform.rs`, `process.rs` и `PackageInstaller`.
- Бинарные файлы только по HTTPS, с точным SHA-256 и лимитом размера. Исполнение до проверки запрещено.
- Секреты только в CI secrets. Не печатать токены, пароли, секретные заголовки или полные query-параметры.
- TorrServer только на `127.0.0.1:8090`, mpv внешним процессом. Процессы завершаются при выходе приложения.
- Все пользовательские тексты только с дефисом `-`, без длинного и среднего тире. Не добавлять дубликаты экранов `mobile/src` в `desktop/src`.

## Review Focus

- Отсутствие WebView2: понятная ошибка установки вместо молчаливого падения - Task 1.
- Новый `TargetPlatform` без asset: явная ошибка поддержки, а не запуск чужого бинаря - Task 2.
- Неверный hash, oversized download, HTTP URL и path traversal: загрузка отклоняется без запуска - Task 2.
- Внешний сервер уже используется: не стартует встроенный и не меняет его адрес - Task 3.
- mpv не запускается, падает или остаётся после выхода: состояние ошибки и отсутствие осиротевших процессов - Task 5.
- Неверный hash, downgrade, ошибка deferred install, обновление с пользовательскими данными: отказ безопасно или обновление с сохранением данных - Task 6.
- Случайный Windows-only вызов в общем коде: тест совместимости и матрица ОС не пропускают его - Task 7.

---

### Task 1: Кроссплатформенная оболочка и platform bridge

**Files:**
- Create: `desktop/package.json`, `desktop/vite.config.ts`, `desktop/index.html`, `desktop/src/platform/bridge.ts`, `desktop/src-tauri/Cargo.toml`, `desktop/src-tauri/tauri.conf.json`, `desktop/src-tauri/src/main.rs`, `desktop/src-tauri/src/commands.rs`, `desktop/src-tauri/src/platform.rs`, `desktop/tests/bridge.test.ts`, `desktop/tests/boot.test.ts`
- Modify: `package.json`, `.github/workflows/desktop.yml`

**Interfaces:**
- Produces: `DesktopBridge.invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>`, `TargetPlatform` и `npm run build:desktop`.

- [ ] **Step 1:** Написать failing test на загрузку desktop bridge, ошибку отсутствия WebView2 и выбор `TargetPlatform`.
Run: `npx vitest run desktop/tests/bridge.test.ts desktop/tests/boot.test.ts`.
Expected: файлы и реализация отсутствуют.

- [ ] **Step 2:** Создать минимальную Vite оболочку, typed `invoke`, Tauri config и `TargetPlatform` без Windows-specific вызовов в общих модулях.
Expected: статическая Preact страница стартует в Tauri, отсутствие WebView2 выдаёт инструкцию установки runtime.

- [ ] **Step 3:** Повторить unit tests и `npm run build:desktop`.
Expected: все тесты и сборка проходят.

- [ ] **Step 4:** Добавить матрицу `windows-latest`, `macos-latest`, `ubuntu-latest` smoke job в `desktop.yml`.
Expected: все ОС запускают базовые unit tests и Vite build.

- [ ] **Step 5:** Commit `feat: add cross-platform desktop shell`.

### Task 2: Каталог бинарных активов и безопасная загрузка

**Files:**
- Create: `desktop/src-tauri/src/download.rs`, `desktop/src-tauri/src/download/tests.rs`, `desktop/src-tauri/src/http_test.rs`
- Modify: `desktop/src-tauri/src/platform.rs`

**Interfaces:**
- Consumes: `DesktopBridge.invoke`, `TargetPlatform` из Task 1.
- Produces: `BinaryAsset { target, id, version, url, sha256, maxBytes }`, `download_verified(asset: BinaryAsset) -> Result<PathBuf, DownloadError>` и `asset_for(target) -> Result<BinaryAsset, DownloadError>`.

- [ ] **Step 1:** Написать failing Rust tests на hash mismatch, oversized body, HTTP URL, path traversal и отсутствие asset для `TargetPlatform`.
Run: `cargo test --manifest-path desktop/src-tauri/Cargo.toml download::tests`.
Expected: безопасной реализации нет, тесты падают.

- [ ] **Step 2:** Реализовать `asset_for` и `download_verified`: HTTPS only, потоковое чтение с cap, временный файл, SHA-256, атомарный rename, удаление ошибочного payload.
Expected: бинарь нельзя запустить до завершения проверки, неподдерживаемый target не получает чужой asset.

- [ ] **Step 3:** Повторить `cargo test download::tests`.
Expected: все отклонённые входы возвращают `DownloadError`, валидный архив проходит.

- [ ] **Step 4:** Commit `feat: verify desktop binary downloads by target`.

### Task 3: Встроенный и внешний TorrServer

**Files:**
- Create: `desktop/src-tauri/src/server.rs`, `desktop/src-tauri/src/server/tests.rs`, `desktop/src/platform/server.ts`, `desktop/tests/server.test.ts`

**Interfaces:**
- Consumes: `download_verified`, `asset_for` из Task 2.
- Produces: `ServerHandle { mode, origin, status, error? }`, `serverStart`, `serverStop`, `serverStatus`, `serverUpdate`.

- [ ] **Step 1:** Написать failing tests: embedded download/start/health/stop, external без скачивания и смены origin, ошибка запуска, повторный start.
Run: `cargo test server::tests` и `npx vitest run desktop/tests/server.test.ts`.
Expected: процессы и состояние сервера ещё не реализованы.

- [ ] **Step 2:** Реализовать `ServerHandle`, загрузку TorrServer по пину, loopback-only start, health `/echo`, stop, status и выбор embedded/external через общий процесс-менеджер.
Expected: внешний origin не меняется, embedded не запускается дважды, выход убивает процесс.

- [ ] **Step 3:** Повторить unit tests и Windows integration `server_start_health_stop`.
Expected: TorrServer отвечает `/echo`, внешний режим не запускает бинарь.

- [ ] **Step 4:** Commit `feat: manage Windows TorrServer modes`.

### Task 4: Каталог, источники и billing

**Files:**
- Create: `desktop/src/platform/native.ts`, `desktop/tests/catalog.test.ts`
- Modify: `desktop/src/platform/server.ts`, `desktop/src/platform/bridge.ts`

**Interfaces:**
- Consumes: `serverStart/serverStatus` из Task 3.
- Produces: desktop `native` adapter для экранов `mobile/src`, использующий существующие `src/api`, `src/billing/client.ts` и настройки серверов.

- [ ] **Step 1:** Добавить failing tests на открытие каталога, поиск, выбор embedded/external и ошибки HTTP без утечки секретов.
Run: `npx vitest run desktop/tests/catalog.test.ts tests/billing tests/api`.
Expected: desktop adapter отсутствует.

- [ ] **Step 2:** Реализовать adapter без изменения `src/billing/client.ts`: каталог, поиск, библиотека и настройки используют существующие экраны и API.
Expected: embedded использует `127.0.0.1:8090`, external сохраняет настройки, секреты не попадают в логи.

- [ ] **Step 3:** Повторить desktop и существующие billing/api tests.
Expected: все проходят без production.

- [ ] **Step 4:** Commit `feat: connect desktop catalog and sources`.

### Task 5: Плеер через внешний mpv и общий процесс-менеджер

**Files:**
- Create: `desktop/src-tauri/src/process.rs`, `desktop/src-tauri/src/player.rs`, `desktop/src-tauri/src/player/tests.rs`, `desktop/src/platform/player.ts`, `desktop/tests/player.test.ts`

**Interfaces:**
- Consumes: `download_verified` из Task 2, `ServerHandle` из Task 3.
- Produces: `PlayerOpenRequest`, `PlayerStatus`, `playerOpen`, `playerPause`, `playerStop`, `playerStatus` и общий `process.rs` для TorrServer и mpv.

- [ ] **Step 1:** Написать failing tests на аргументы mpv, start/pause/stop/status, crash, повторный open и отсутствие процесса после выхода. Проверить, что headers и query не попадают в логи.
Run: `cargo test player::tests` и `npx vitest run desktop/tests/player.test.ts`.
Expected: процесс mpv и состояние отсутствуют.

- [ ] **Step 2:** Реализовать общий процесс-менеджер и mpv: загрузку по пину через Task 2, запуск с URL, IPC состояния, остановку и очистку процессов.
Expected: один активный mpv, позиция и ошибки видны в UI, процессы не остаются после выхода. Платформенные команды находятся только в `process.rs`.

- [ ] **Step 3:** Повторить unit tests и ручной smoke mpv с H.265 10-bit, AV1, VC-1 и ASS-субтитрами.
Expected: файлы играют, pause/stop работают, процесс завершается корректно.

- [ ] **Step 4:** Commit `feat: play desktop media through mpv`.

### Task 6: NSIS и граница обновлений

**Files:**
- Create: `desktop/src-tauri/src/update.rs`, `desktop/src-tauri/src/update/tests.rs`, `desktop/src/platform/update.ts`, `desktop/tests/update.test.ts`, `desktop/packaging/macos/.gitkeep`, `desktop/packaging/linux/.gitkeep`
- Modify: `.github/workflows/desktop.yml`, `scripts/hb-lib.mjs`, `CHANGELOG.md`, `CHANGELOG.en.md`

**Interfaces:**
- Consumes: `PlayerOpenRequest` и `ServerHandle` не меняются.
- Produces: `UpdateInfo { version, url, sha256, notes }`, `PackageInstaller { downloadApply(info) }`, `NsisInstaller`, `updateCheck`, `updateDownload`, `updateApply`, `update-windows.json`.
- Future: `DmgInstaller` и `AppImageInstaller` через тот же `PackageInstaller`.

- [ ] **Step 1:** Написать failing tests на проверку версии, неверный hash, downgrade и сохранение настроек.
Run: `cargo test update::tests` и `npx vitest run desktop/tests/update.test.ts`.
Expected: небезопасный пакет отклоняется.

- [ ] **Step 2:** Реализовать `PackageInstaller` и `NsisInstaller`: скачивание NSIS по HTTPS, SHA-256 перед установкой, downgrade блокируется, данные сохраняются. Установка выполняется после выхода из приложения.
Expected: старая версия получает обновление, ошибка установки видна после следующего запуска.

- [ ] **Step 3:** Добавить Windows CI для сборки NSIS и публикации `update-windows.json`.
Expected: артефакт собран, feed указывает на него. Другие ОС используют свои файлы только через `PackageInstaller`.

- [ ] **Step 4:** Commit `feat: update Windows desktop through NSIS`.

### Task 7: Полная проверка и готовность к macOS и Linux

**Files:**
- Create: `docs/desktop-cross-platform.md`, `docs/screenshots/desktop/`
- Modify: `AGENTS.md`, `docs/manual-checks.md`, `CHANGELOG.md`, `CHANGELOG.en.md`, `.github/workflows/desktop.yml`

**Interfaces:**
- Consumes: все предыдущие интерфейсы без изменения.

- [ ] **Step 1:** Задокументировать установку, WebView2, embedded/external, mpv, обновление, ограничения и способ добавления `DmgInstaller` и `AppImageInstaller`. Обновить `AGENTS.md` и CHANGELOG.
Expected: команды build/test соответствуют коду, секретов нет, путь добавления ОС не требует переписывания UI.

- [ ] **Step 2:** Запустить `npm test`, `npm run build`, `npm run build:mobile`, `npm run build:desktop`, `cargo test --manifest-path desktop/src-tauri/Cargo.toml` и Windows integration на всей CI-матрице.
Expected: все проходят, Windows-only вызовы остаются только в разрешённых границах.

- [ ] **Step 3:** Выполнить ручной чек-лист: каталог, оба сервера, поиск, mpv, кодеки и субтитры, выход процессов, обновление, подпись и сохранение данных. Снять 1280x720 и 1920x1080.
Expected: UI читается, ошибки понятны, процессы не остаются, настройки сохраняются.

- [ ] **Step 4:** Открыть PR, запросить Greptile и дождаться `build`, `android`, `billing`, `desktop`. Не делать merge без разрешения Andy.
Expected: все проверки зелёные, замечания обработаны.

- [ ] **Step 5:** Commit `docs: prepare cross-platform desktop release`.

## Execution

- Выбран Native: реализация в текущей сессии с одним финальным reviewer всей ветки.
- Каждая задача идёт отдельной веткой и PR в порядке Task 1 -> Task 7. Следующая задача начинается только после merge предыдущей и зелёного `main`.
- macOS и Linux добавляются последующими задачами через `TargetPlatform`, asset catalog, `process.rs` и `PackageInstaller`, без изменения общих UI и API.
- Ручные устройства и production не используются. Все download-тесты идут на mock/fake servers и временные каталоги.
