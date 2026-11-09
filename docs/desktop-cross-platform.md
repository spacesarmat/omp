# OMP Desktop для Windows и перенос на другие ОС

## Текущий статус

Первый desktop-пакет предназначен для Windows 10/11 x64. Он включает каталог, поиск, библиотеку, источники, billing, встроенный или внешний TorrServer и внешний mpv. Установщик - NSIS, сертификат подписи пока не требуется.

macOS и Linux проходят базовую CI-матрицу, но готовых пакетов для них пока нет. Microsoft Store и обязательный пульт не входят в первую версию. Для mpv используется сборка x86_64-v3, поэтому нужен процессор с соответствующими инструкциями. Старые процессоры x86_64 без x86_64-v3 не поддерживаются.

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
