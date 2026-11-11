# OMP Desktop для Windows и перенос на другие ОС

## Текущий статус

Desktop-пакет есть для Windows 10/11 x64, macOS (Intel и Apple Silicon) и Linux x64. Он включает каталог, поиск, библиотеку, источники, billing, встроенный или внешний TorrServer и внешний mpv. Windows: установщик NSIS и portable exe, сертификат подписи пока не требуется. macOS: два DMG без аккаунта Apple Developer, подпись ad-hoc. Linux: AppImage и deb.

Открыть неподписанный macOS: правый клик по приложению и «Открыть», либо «Системные настройки» - «Конфиденциальность и безопасность» - «Все равно открыть».

Microsoft Store и обязательный пульт не входят в первую версию. Для mpv на Windows используется сборка x86_64-v3, поэтому нужен процессор с соответствующими инструкциями. Старые процессоры x86_64 без x86_64-v3 не поддерживаются.

## Версионирование и теги desktop

Desktop живёт своим циклом версий, независимо от Android, webOS и ТВ. Источник версии desktop - `desktop/package.json`, та же версия дублируется в `desktop/src-tauri/tauri.conf.json` и в `Cargo.toml`/`Cargo.lock`. Их согласованность между собой проверяет `tests/version.test.ts`; совпадение с корневой версией `package.json` не требуется. Desktop UI получает версию из `desktop/package.json` на этапе сборки (`desktop/vite.config.ts`).

Desktop-релиз публикуется тегом `desktop-<version>`, например `desktop-0.20.12-beta.2`. Такой тег не запускает Release workflow (он срабатывает только на `v*`), поэтому Android и webOS в релиз не попадают. Тег создаётся вручную вместе с GitHub Release, затем Desktop workflow (`workflow_dispatch`, `publish=true`, поле tag = существующий `desktop-<version>`) собирает NSIS, portable exe, два DMG, AppImage и deb, загружает их в этот release и обновляет фиды `update-windows.json`, `update-macos.json` и `update-linux.json` на gh-pages. Версия установщика берётся из `tauri.conf.json`, заметки для feed - из раздела `## <version>` в `CHANGELOG.md`. В каждом фиде есть `version`, HTTPS `url`, `sha256`, `size`, `notes` и `releaseUrl`. Дополнительные файлы лежат в `assets`.

## Установка и WebView2

Для интерфейса нужен Microsoft Edge WebView2 Runtime. Если его нет, приложение показывает инструкцию и ссылку на установку: https://developer.microsoft.com/microsoft-edge/webview2/

Tauri создаёт установщик `OMP_<version>_x64-setup.exe` в `desktop/src-tauri/target/release/bundle/nsis/`. GitHub Actions копирует его в артефакт `omp-nsis-preview` под именем `OMP-<version>-setup.exe`. Установка и обновление не удаляют настройки или историю.

## Сборка и проверка

Требуется Node 24 и Rust через rustup. Из корня репозитория:

```bash
npm ci
npm ci --prefix desktop
npm run build
npm run build:mobile
npm run build:desktop
cargo test --manifest-path desktop/src-tauri/Cargo.toml
npm --prefix desktop run tauri -- build --debug
```

Для настоящего NSIS-установщика:

```bash
npm --prefix desktop run tauri -- build --bundles nsis
```

Полный `npm test` запускается в Linux или WSL: ему нужны `shellcheck`, `rsync`, `flock` и Postgres 17. В Git Bash на Windows запускаются точечные JS-тесты и `cargo test`. Для `server_peer_download` нужен Python из `desktop/tests/requirements.txt`.

CI содержит `build`, `android`, `billing`, smoke-матрицу Windows/macOS/Ubuntu и `package-windows`. Cargo и `node_modules` кешируются по ОС и lockfiles. При точном cache hit зависимости устанавливаются через `npm install --prefer-offline`, при промахе - через `npm ci`. `git diff --exit-code` не позволяет кешу изменить lockfiles.

## Локальный редактор тем и правил

Первый preview-срез редактора работает отдельно от production Windows-приложения и не меняет его экраны. Он показывает настоящие компоненты в новом desktop shell с левым меню. Windows, macOS и Linux имеют общие функции, но независимые темы. Поддерживаются landscape, portrait и RU/EN preview.

Запуск из корня репозитория:

```bash
npm run editor
```

Открывать нужно только выданный командой URL `http://127.0.0.1:<port>/#token=<session>`. Токен находится во fragment и удаляется из address bar после чтения. Он хранится только в sessionStorage вкладки. Сервер слушает только loopback и не читает `.env`, пользовательские секреты или реальные хранилища OMP.

В первом срезе:

- Дизайн и логика доступны для desktop `settings`; остальные legacy-экраны имеют уровень `preview` и не выдаются за мигрированные.
- Preview native и HTTP отвечают только fixtures. Реальные TorrServer, billing, Telegram, NUC и устройства не вызываются.
- Черновики сохраняются в `.omp-editor/`. Экспорт пишет только разрешённые файлы `design/` и защищает чужие изменения через `baseCommit` и manifest. Параллельные экспорты одного репозитория выполняются последовательно.
- Новый черновик загружает committed theme и flow из `design/`. После смены `HEAD` панель `Версия из Git` показывает результат трёхстороннего слияния до применения. Конфликт оставляет черновик без изменений.
- Снимки черновика можно восстанавливать из списка, лимит - 10 снимков. Ошибки сохранения и экспорта показываются вместе с кодом и деталями API.
- Инспектор предлагает только реальные состояния выбранного элемента. `disabled` не предлагается, пока элемент не имеет такого состояния.
- Release intent не создаёт branch, tag, push, PR, GitHub Release или deploy.
- Произвольный JavaScript и произвольный CSS запрещены. Разрешены только зарегистрированные tokens, события, условия и действия.

Проверки редактора:

```bash
npm run test:editor
npm run build:editor
npm run editor:generate -- --check
```

Production-переключение desktop shell, phone/TV-редактор и полный реестр действий относятся к следующим этапам.

## TorrServer и источники

Встроенный TorrServer скачивается по HTTPS с точным SHA-256 и лимитом размера, затем запускается только на `127.0.0.1:8090`. HTTP и peer listener ограничены loopback. Можно выбрать внешний TorrServer, тогда встроенный процесс не запускается и адрес не меняется.

Каталог и источники используют существующие экраны `mobile/src` и API. Desktop HTTP-adapter выполняет запросы через Rust: поддерживает cookies, формы, бинарные ответы и кодировки. Секреты не пишутся в логи и не передаются в полные query-параметры ошибок.

## Внешний mpv

mpv скачивается по pinned asset с SHA-256 и лимитом размера, затем распаковывается в локальный каталог данных. Запуск выполняется отдельным процессом, а не через HTML video. Проверены H.265 10-bit, AV1, VC-1, H.264 и внешние ASS-субтитры.

IPC использует короткое имя named pipe в Windows или Unix socket на других ОС, `request_id`, отдельный worker и deadline. Медиа открывается через `loadfile` только после подключения IPC, поэтому ошибки загрузки не теряются. Медленная загрузка не имеет произвольного лимита: её можно отменить через stop или новый open. Состояние pause сверяется с самим mpv, а порядок open/stop сохраняется через submission generation. Процессы завершаются при выходе приложения.

## Обновления через NSIS

Feed `update-windows.json` содержит `version`, HTTPS `url`, `sha256`, `notes` и `releaseUrl`. Клиент принимает только более новую версию, downgrade блокируется. Пакет скачивается с лимитом размера и проверкой SHA-256 до запуска.

После проверки хеша helper ждёт завершения OMP и запускает NSIS с `/S`. Результат сохраняется в `update-result.json` в каталоге данных. При следующем запуске приложение читает и удаляет файл один раз и показывает ошибку через существующий toast. Настройки и история сохраняются.

Публикация выполняется только вручную через `Desktop` workflow: `Run workflow`, `publish=true` и существующий release tag. Workflow загружает NSIS в существующий GitHub Release и обновляет feed в `gh-pages`. Сертификат и секреты подписи сейчас не нужны.

## Границы переносимости

- `desktop/src-tauri/src/platform.rs`: `TargetPlatform` и pinned assets. Новый target сначала получает явную ошибку, а не запуск чужого binary.
- `desktop/src-tauri/src/process.rs`: запуск и завершение процессов, Windows named pipe и Unix socket. При добавлении Unix-пакета процесс должен запускаться в отдельной process group, а stop должен завершать группу с дочерними процессами, а не только parent PID.
- `desktop/src-tauri/src/update.rs`: общий `PackageInstaller`, `UpdateInfo`, проверка версий, hash и результата установки. `UpdateManager::from_environment` сейчас выбирает `NsisInstaller`; новая ОС получает здесь свой installer вместо Windows default.
- `desktop/src/platform/*`: TypeScript bridge и адаптеры платформы. Экраны `mobile/src` не копируются.
- `desktop/tests`: Vitest, а `desktop/src-tauri/src/*/tests.rs`: тесты Rust и реальные Windows integration.

### Добавление macOS

1. Добавить macOS assets с точными URL, SHA-256 и размерами для `MacOsX64` и `MacOsArm64`.
2. Реализовать и проверить завершение Unix process group с дочерними процессами и Unix socket.
3. Реализовать `DmgInstaller` через тот же `PackageInstaller` и выбирать его для macOS в `UpdateManager::from_environment`, не меняя `updateCheck`, UI или `ServerHandle`.
4. Добавить подпись и нотаризацию DMG, feed `update-macos.json` и публикацию артефакта.
5. Запустить те же unit и integration тесты на `macos-latest`.

### Добавление Linux

1. Добавить Linux assets для `LinuxX64` и `LinuxArm64`.
2. Реализовать и проверить завершение Unix process group с дочерними процессами и Unix socket.
3. Реализовать `AppImageInstaller` через тот же `PackageInstaller` и выбирать его для Linux в `UpdateManager::from_environment`; при необходимости добавить deb/rpm упаковку.
4. Добавить feed `update-linux.json` и публикацию AppImage.
5. Запустить те же unit и integration тесты на `ubuntu-latest`.

## Проверка результата

Список ручных проверок находится в `docs/manual-checks.md` в разделе `Desktop (Windows)`. Скриншоты реального окна сохраняются в `docs/screenshots/desktop/` в размерах 1280x720 и 1920x1080. Production, NUC, реальный Telegram и устройства для этих проверок не используются.
