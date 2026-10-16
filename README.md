English: [README.en.md](README.en.md)

<p align="center"><img src="assets/logo.svg" width="128" alt="OMP"></p>

<h1 align="center">OMP — Open Movie Player</h1>

<p align="center">Медиаплеер для телевизоров LG (webOS 4.0+), Android TV и телефонов Android. Смотрит фильмы и сериалы из <a href="https://github.com/YouROK/TorrServer">TorrServer</a> в домашней сети.</p>

<p align="center"><a href="https://omp-player.online">Сайт</a> · <a href="https://github.com/spacesarmat/omp/releases/latest">Скачать</a> · <a href="#установка">Установка</a> · <a href="https://t.me/ompplyaer">Telegram</a> · <a href="https://github.com/spacesarmat/omp/issues">Задачи</a> · <a href="https://boosty.to/djmaker/donate">Поддержать</a></p>

## Платформы

- **LG webOS 4.0+** — примерно телевизоры 2018 года и новее. Для работы OMP root не требуется.
- **Android TV и Google TV** — Android 8 и новее. Тот же APK, что и на телефоне.
- **Телефон Android** — Android 8 и новее.

Samsung (Tizen) пока не поддерживается. Приставки Xiaomi, Сбер и Яндекс ставятся тем же APK: шаги показывает помощник установки на телефоне.

## Возможности

- Каталог TorrServer: категории, несколько видов, сериалы по сезонам, общая история и продолжение с места остановки.
- Плеер. На LG — аппаратный декодер телевизора. На Android TV — встроенный 2160 Player (4K, HDR, Dolby Vision как HDR10 без аппаратного декодера; AC3, E-AC3, DTS и TrueHD на ресивер или с программным декодированием) или VLC; режим «Авто» переключает сам. На телефоне — тот же встроенный плеер.
- Дорожки, субтитры, главы, пропуск заставки и титров.
- Телефон как пульт: запуск на ТВ, пауза, перемотка, серии, дорожки и громкость. На экране «Сейчас на ТВ» свайп вниз открывает пульт, вверх — серии раздачи. На Android TV с телефона можно управлять и самой приставкой. Если сертификат телевизора сменился, OMP спрашивает, доверять ли новому.
- Поиск раздач на телефоне и Android TV: rutor, nnmclub, rutracker, Kinozal, rustorka, Anidub, BigFANGroup, torrent.by, свой Jackett или Prowlarr, а по подписке — Jackett и JacRed OMP (бот [@OMPBILLINGBOT](https://t.me/OMPBILLINGBOT); ключи остаются на сервере OMP). На LG поиск идёт через телефон или через TorrServer. «Обзор» показывает новинки из TMDB.
- «Новое» на телефоне: лента, подписки и новые серии, проверка в фоне.
- Плейлисты M3U/M3U8. Если плейлист — поток HLS, он открывается в плеере.
- Проверка обновлений при запуске.

## Требования

Нужен [TorrServer](https://github.com/YouROK/TorrServer) в домашней сети. Если своего нет, OMP на телефоне arm64 скачает сборку с GitHub и запустит её (в APK её нет; файл сверяется по sha256). Для телевизора запустите TorrServer на телефоне или на другом устройстве. На телефоне без arm64 сервер нужен на другом устройстве. Сервер на телефоне открыт без пароля и виден в этой сети Wi‑Fi. Телефон, телевизор и сервер должны быть в одной сети.

## Установка

Сборки лежат на странице [последнего выпуска](https://github.com/spacesarmat/omp/releases/latest): `OMP-<версия>-webOS.ipk` для LG и три APK для Android.

Проще всего с телефона: «Настройки» → «Установить OMP на телевизор». Телефон находит LG и Android TV в сети и ставит OMP сам. На LG это режим разработчика (код Passphrase из приложения Developer Mode), на Android TV — отладка по сети (порт 5555). Сопряжение «Беспроводной отладки» Android 11+ помощник пока не делает.

### LG webOS

- **Homebrew Channel**, если на телевизоре есть root. Settings → Add repository → `https://raw.githubusercontent.com/spacesarmat/omp/gh-pages/apps.json`. То же действие есть в OMP: Настройки → «Добавить репозиторий OMP в Homebrew Channel».
- **Без root.** Аккаунт разработчика на [webostv.developer.lge.com](https://webostv.developer.lge.com). На телевизоре установите Developer Mode из LG Content Store, включите Dev Mode Status и Key Server. На компьютере в той же сети откройте [webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop/releases/latest), добавьте телевизор (IP и passphrase), поставьте Homebrew Channel, затем OMP из репозитория или файл `OMP-<версия>-webOS.ipk`. Сессия Developer Mode длится 1000 часов: продлевайте её в том же приложении, иначе поставленные через неё приложения удалятся.

Когда телевизор уже в режиме разработчика, пакет можно поставить из командной строки: в клоне репозитория выполните `npm install`, один раз настройте устройство (`npx ares-setup-device`, ключ — `npx ares-novacom --device tv --getkey`) и выполните `npx ares-install --device tv OMP-<версия>-webOS.ipk`. Собрать пакет самим: `npm run package`, затем `npm run tv:install`.

### OMP для Android

Android 8 и новее. Скачайте APK со [страницы выпуска](https://github.com/spacesarmat/omp/releases/latest) и откройте его в браузере, в «Downloader», в файловом менеджере или командой `adb install`. Разрешите установку из неизвестных источников.

| Файл | Для чего |
|---|---|
| `OMP-<версия>-arm64.apk` | 64-битная система: почти все современные телефоны и часть приставок |
| `OMP-<версия>-armv7.apk` | 32-битная система: многие приставки Android TV, в том числе с 64-битным процессором |
| `OMP-<версия>.apk` | обе архитектуры, если система неизвестна |

Версия и подпись у трёх файлов одни. Обновление внутри приложения и помощник установки выбирают файл сами.

Телефон подключается к телевизору так: на LG — QR в Настройки → «Подключить телефон», на Android TV — код из 6 цифр на том же экране. Пока телевизор не выбран, «Каталог», «Пульт» и настройки показывают найденные в сети телевизоры: LG подключается нажатием, Android TV просит этот код.

### После установки

Откройте OMP, введите адрес TorrServer или нажмите «Найти в сети».

## Разработка

```bash
npm install
npm test
npm run dev
npm run build
```

`npm run dev` поднимает интерфейс телевизора. Сборка Android (`npm run android:sync`) требует подмодуль `android/vendor/2160player`: `git submodule update --init --recursive`. CI на pull request и на push в `main` запускает тесты, сборку и упаковку. Выпуск собирается по тегу `vX.Y.Z` после того, как версия в `package.json` обновлена.

## Ссылки

- Сайт: https://omp-player.online
- Telegram: https://t.me/ompplyaer
- Задачи: https://github.com/spacesarmat/omp/issues
- Поддержать: https://boosty.to/djmaker/donate

## Лицензия

[GNU GPL v3](LICENSE).

В сборку Android входят [2160 Player](https://github.com/spacesarmat/2160player) (GPL-3.0), [AndroidX Media3](https://github.com/androidx/media) (Apache-2.0), [libVLC](https://code.videolan.org/videolan/libvlcjni) (LGPL-2.1) и [NextLib](https://github.com/anilbeesetti/nextlib) (GPL-3.0). Помощник установки использует [JSch](https://github.com/mwiede/jsch) (BSD-3-Clause) и [dadb](https://github.com/mobile-dev-inc/dadb) (Apache-2.0).
