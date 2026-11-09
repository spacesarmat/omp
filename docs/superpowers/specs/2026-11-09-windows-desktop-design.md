# Cross-platform OMP Design

## Цель и пользовательские решения

Полноценный desktop OMP: каталог, поиск, библиотека, торренты, плеер и настройки. Первая ОС - Windows 10/11 x64. Архитектура сразу допускает macOS и Linux без переписывания UI, каталога, серверной логики и процессов обновления.

Оболочка - Tauri с Preact и TypeScript. Поддерживаются внешние TorrServer, Jackett, JacRed и billing, а также встроенный TorrServer. Видео воспроизводит внешний mpv. Первая дистрибуция - подписанный MSIX с автообновлением через GitHub Releases.

## Не входит в первую версию

- Microsoft Store, macOS, Linux, Windows ARM и 32-битный Windows как целевые пакеты.
- Переписывание каталога, плеера, источников и биллинга на C# или Rust.
- Встроенные Jackett, JacRed, FlareSolverr и billing в клиентский пакет.
- Обязательный пульт в первом релизе. Существующий SSAP-протокол можно добавить позже без смены архитектуры.

Это ограничения первого пакета, а не архитектурные запреты. Для macOS и Linux предусмотрены отдельные реализации тех же интерфейсов.

## Кроссплатформенная архитектура

- `desktop/`: Vite и Preact-оболочка с мобильным UI, адаптированным для мыши, клавиатуры и оконного режима. Существующие экраны и логика из `mobile/src` переиспользуются через адаптеры, без копирования реализации.
- `desktop/src-tauri/`: Rust-слой для процессов TorrServer и mpv, файлов, обновлений и IPC. `Cargo.lock` фиксирует версии.
- Внешние HTTP API Jackett, JacRed и billing используются по существующим клиентам без изменений. Встроенный TorrServer скачивается по пину и запускается локально на `127.0.0.1:8090`.
- mpv запускается внешним процессом по URL TorrServer. Состояние плеера и позиция возвращаются через IPC; UI не открывает процессы напрямую.
- CI содержит матрицу `windows-latest`, `macos-latest` и `ubuntu-latest` для базовых проверок совместимости с первого этапа.

## Платформенные границы

- `TargetPlatform`: `WindowsX64`, `MacOsX64`, `MacOsArm64`, `LinuxX64`, `LinuxArm64`.
- `desktop/src-tauri/src/platform.rs`: определение целевой ОС и архитектуры, выбор asset и путей, никаких проверок `cfg!(windows)` в бизнес-логике.
- `desktop/src-tauri/src/download.rs`: безопасная загрузка `BinaryAsset`, независимая от ОС.
- `desktop/src-tauri/src/process.rs`: единый жизненный цикл дочерних процессов, остановка и очистка. Платформенные команды выделены в этот файл.
- `desktop/src-tauri/src/server.rs`: TorrServer и внешние адреса через общий процесс-менеджер.
- `desktop/src-tauri/src/player.rs`: mpv через общий процесс-менеджер и общее состояние.
- `desktop/src-tauri/src/update.rs`: `PackageInstaller` как граница пакетов и обновлений. Windows использует `MsixInstaller`; будущие `DmgInstaller` и `AppImageInstaller` подключаются без изменения `updateCheck`.
- `desktop/src/platform/*`: общие TypeScript адаптеры. Специфичные для ОС действия проходят только через bridge и `TargetPlatform`.

## Интерфейсы

- `DesktopBridge.invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>`.
- `TargetPlatform` перечисляет все поддерживаемые ОС и архитектуры.
- `BinaryAsset { target: TargetPlatform, id: string, version: string, url: string, sha256: string, maxBytes: number }`.
- `ServerHandle { mode: "embedded" | "external", origin: string, status: "stopped" | "starting" | "ready" | "error", error?: string }`.
- `PlayerOpenRequest { url: string, title?: string, headers?: Record<string, string>, startMs?: number }`.
- `PlayerStatus { state: "idle" | "starting" | "playing" | "paused" | "ended" | "error", positionMs: number, durationMs: number, error?: string }`.
- `PackageInstaller { downloadApply(info: UpdateInfo): Result<(), UpdateError> }`.

## Безопасность и данные

- Бинарные файлы принимаются только по HTTPS, с точным SHA-256 и ограничением размера. Несоответствие удаляется до запуска. Запрещены path traversal, запуск из временного каталога загрузки и выполнение до завершения проверки.
- TorrServer слушает только loopback. Внешние процессы завершаются при выходе приложения. Логи не содержат токены, пароли, полные query-параметры или секретные заголовки.
- Настройки и история остаются локальными. Секреты сертификата подписи существуют только в CI secrets, не в репозитории.
- Существующие правила проекта сохраняются: main защищён, merge только с разрешения Andy, production и устройства не используются для тестов.

## Обновления и пакеты

- Первая реализация: MSIX, SHA-256 и Authenticode. Клиент проверяет версию, скачивает MSIX, проверяет подпись и хеш, затем передаёт пакет Windows для установки.
- Следующие реализации интерфейса: подписанный и нотаризованный DMG для macOS, AppImage и при необходимости deb/rpm для Linux. Они используют тот же `PackageInstaller` и не меняют проверку версий или пользовательский интерфейс.
- Фиды разделены: `update-windows.json`, `update-macos.json`, `update-linux.json`, при необходимости отдельные ARM64-фиды. Клиент выбирает только свой `TargetPlatform`.
- Обновление не удаляет настройки или историю. При ошибке остаётся текущая версия с возможностью повторить обновление. Downgrade блокируется без отдельного подтверждения.

## Проверка и переносимость

- Unit: Vitest для UI и `cargo test` для Rust на Windows, macOS и Linux CI.
- Integration на `windows-latest`: загрузка по mock-серверу, запуск TorrServer, `/echo`, запуск и остановка mpv.
- Для новых ОС сначала добавляются те же тесты интерфейсов, затем платформенные пакеты и интеграционные проверки.
- Ручные проверки: каталог, внешний и встроенный сервер, кодеки, субтитры, ошибки сети, обновление, подпись и сохранение данных.
- Перед merge проверяется, что новые ОС-specific вызовы находятся только в `platform.rs`, `process.rs` и соответствующем `PackageInstaller`.
