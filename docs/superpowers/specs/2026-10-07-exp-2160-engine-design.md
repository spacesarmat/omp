# Экспериментальная ветка: OMP на AGP 9 и движок 2160 Player

Дата: 2026-10-07. Ветка `exp/2160-engine`. В каналы обновлений не выпускается без решения владельца; сборки — артефакты GitHub Actions.

## Решения владельца
- OMP переводится на инструменты 2160player (AGP 9.4.x, Kotlin 2.4.x, compileSdk 37) — без пониженной ветки 2160player.
- На Android TV движок 2160 (`PlayerController` из `player-core`) **заменяет** Media3-движок OMP; экран плеера OMP остаётся; VLC остаётся запасным.
- Сохраняются: управление с телефона, QR поддержки на паузе/титрах, пропуск и следующая серия OMP (журнал TorrServer), места остановки и «История», переход на VLC при ошибке.
- Телефон: «Смотреть на телефоне» открывает встроенный экран 2160 (`Player2160Activity` через `Player2160.PlayContract`), позиция возвращается; «Выбор Android» — запасной.

## Этапы
1. OMP на AGP 9.4 / Kotlin 2.4 / compileSdk 37 (+ требуемый Gradle). Все плагины Capacitor собираются, Android unit-тесты и vitest зелёные, приложение запускается на Dune и S21. Стоп-условие: плагин Capacitor не собирается — варианты владельцу.
2. 2160player как git-подмодуль (`android/vendor/2160player`, ветка `main`) + `includeBuild` с подстановкой `tv.p2160:player-core`; Media3 1.11.x; nextlib вместо `org.jellyfin.media3:media3-ffmpeg-decoder`; `packaging.jniLibs.pickFirsts` для libavcodec/libavutil/libswscale/libswresample; `org.gradle.jvmargs=-Xmx4g`; CI с `submodules: recursive`.
3. Android TV: `Engine2160` реализует интерфейс движка OMP (`player/PlayerEngine.kt`) поверх `PlayerController`; `EngineChooser` — 2160 вместо MEDIA3 (wire "builtin" сохраняется); проверки на Dune: passthrough, дорожки, субтитры, пропуск, следующая серия, пульт телефона, переход на VLC.
4. Телефон: встроенный экран 2160 для «Смотреть на телефоне».

## Цена
APK +~26 МБ на ABI (проба: arm64 40→65 МБ). Подробности пробы: `C:\Users\ANDYBUM\omp-spike\SPIKE-2160-EMBED.md`.
