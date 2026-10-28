# Screen codes

Stable codes for test mode.

- `S` / `D` - TV web UI on LG webOS and on Android TV (the shared WebView).
- `P` / `PD` - the phone app: screens, and sheets or confirms.
- `A` / `AD` - native Android TV surfaces outside the WebView: the player (`PlayerActivity`) and the Cloudflare / site-login dialog. The box WebView stays on `S` / `D`.

A beta build (`x.y.z-beta.N`, `isBetaVersion` in `src/lib/version.ts`) shows the setting «Режим тестирования» / "Test mode" (`settings.testMode`) on the TV and on the phone. Labels appear only when that switch is on. A stable build hides the switch and every label, even if `testMode` was left on. The native player and the native Cloudflare dialog read the same switch and check the app version again. Sign-in in the browser uses that same dialog (`AD06` on the box, `PD53` on the phone).

Codes are assigned in `src/testmode/registry.ts` (phone and native lists in `src/testmode/extra.ts`). Do not renumber an existing code. Append a new one.

Posters, files, episodes, search hits, subscriptions, user servers and track lists have no fixed code: they change with the library. They get element codes instead (see «Element codes» below), counted on the page.

Label size is a slider «Размер меток» / "Label size" next to the switch (beta only). TV web UI and the native Android TV player: 16-36 px, step 2, default 20 (`settings.testLabelPx`; on the TV left / right change it and the row shows the px). Phone: 8-24 px, step 1, default 12 (`settings.testLabelPhonePx`). Test-mode labels are the only TV text allowed under 24 px. A beta.2 choice small / large moves to the nearest px; medium takes the new default.

| Code | Where (ru) | Where (en) | Item (ru) | Item (en) |
| --- | --- | --- | --- | --- |
| S01 | Главная | Home |  |  |
| S01.1 | Главная | Home | История | History |
| S01.2 | Главная | Home | Все | All |
| S01.3 | Главная | Home | Фильмы | Movies |
| S01.4 | Главная | Home | Сериалы | Series |
| S01.5 | Главная | Home | Музыка | Music |
| S01.6 | Главная | Home | Аудиокниги | Audiobooks |
| S01.7 | Главная | Home | Прочее | Other |
| S01.8 | Главная | Home | Поиск | Search |
| S01.9 | Главная | Home | Строка поиска | Search field |
| S01.10 | Главная | Home | Вид | View |
| S01.10.1 | Главная | Home | Вид - Крупные постеры | View - Large posters |
| S01.10.2 | Главная | Home | Вид - Мелкие постеры | View - Small posters |
| S01.10.3 | Главная | Home | Вид - Список | View - List |
| S01.10.4 | Главная | Home | Вид - Компактный | View - Compact |
| S01.11 | Главная | Home | Сортировка | Sort |
| S01.11.1 | Главная | Home | Сортировка - Новые | Sort - New |
| S01.11.2 | Главная | Home | Сортировка - По названию | Sort - By title |
| S01.11.3 | Главная | Home | Сортировка - По размеру | Sort - By size |
| S01.12 | Главная | Home | Найти раздачу | Find a release |
| S01.13 | Главная | Home | Плейлисты | Playlists |
| S01.14 | Главная | Home | Настройки | Settings |
| S01.15 | Главная | Home | История - все | History - all |
| S01.16 | Главная | Home | История - с телевизора | History - from the TV |
| S01.17 | Главная | Home | История - с телефона | History - from the phone |
| S01.18 | Главная | Home | Повторить | Retry |
| S01.19 | Главная | Home | Сменить сервер | Change server |
| S01.20 | Главная | Home | Повторить загрузку | Retry loading |
| S02 | Каталог | Catalog |  |  |
| S02.1 | Каталог | Catalog | Обзор | Browse |
| S02.2 | Каталог | Catalog | Все | All |
| S02.3 | Каталог | Catalog | Фильмы | Movies |
| S02.4 | Каталог | Catalog | Сериалы | Series |
| S02.5 | Каталог | Catalog | Хочу | Want |
| S02.6 | Каталог | Catalog | Сортировка | Sort |
| S02.7 | Каталог | Catalog | Жанр | Genre |
| S02.8 | Каталог | Catalog | Год | Year |
| S02.9 | Каталог | Catalog | Страна | Country |
| S02.10 | Каталог | Catalog | Рейтинг | Rating |
| S02.11 | Каталог | Catalog | Найти фильм | Find a title |
| S02.12 | Каталог | Catalog | Сбросить поиск | Reset search |
| S02.13 | Каталог | Catalog | Повторить | Retry |
| S02.14 | Каталог | Catalog | Повторить загрузку | Retry loading more |
| S03 | Раздача | Release |  |  |
| S03.1 | Раздача | Release | Смотреть | Watch |
| S03.2 | Раздача | Release | Плейлист | Playlist |
| S03.3 | Раздача | Release | Найти в лучшем качестве | Find better quality |
| S03.4 | Раздача | Release | Сбросить просмотр | Reset watched |
| S03.5 | Раздача | Release | Переименовать | Rename |
| S03.6 | Раздача | Release | Сменить постер | Change poster |
| S03.7 | Раздача | Release | Удалить | Delete |
| S03.8 | Раздача | Release | Найти другую | Find another |
| S03.9 | Раздача | Release | Пропускать заставку | Skip the intro |
| S03.10 | Раздача | Release | Пропускать титры | Skip the credits |
| S03.11 | Раздача | Release | Заставка и титры | Intro and credits |
| S04 | Сериал | Series |  |  |
| S04.1 | Сериал | Series | Смотреть | Watch |
| S04.2 | Сериал | Series | Раздачи | Releases |
| S04.3 | Сериал | Series | В лучшем качестве | Better quality |
| S04.4 | Сериал | Series | Следить за сериями | Follow episodes |
| S04.5 | Сериал | Series | Озвучка | Dub |
| S04.6 | Сериал | Series | Найти раздачи | Find releases |
| S05 | Настройки | Settings |  |  |
| S05.1 | Настройки | Settings | Язык | Language |
| S05.1.1 | Настройки | Settings | Язык - Как в системе | Language - Follow the system |
| S05.1.2 | Настройки | Settings | Язык - Русский | Language - Russian |
| S05.1.3 | Настройки | Settings | Язык - English | Language - English |
| S05.2 | Настройки | Settings | Плеер - авто | Player - auto |
| S05.3 | Настройки | Settings | Плеер - встроенный | Player - built-in |
| S05.4 | Настройки | Settings | Плеер - VLC | Player - VLC |
| S05.5 | Настройки | Settings | Всегда FFmpeg | Always FFmpeg |
| S05.5.1 | Настройки | Settings | Всегда FFmpeg - Вкл | Always FFmpeg - On |
| S05.5.2 | Настройки | Settings | Всегда FFmpeg - Выкл | Always FFmpeg - Off |
| S05.6 | Настройки | Settings | Плеер для видео | Video player |
| S05.6.1 | Настройки | Settings | Плеер для видео - Встроенный | Video player - Built-in |
| S05.6.2 | Настройки | Settings | Плеер для видео - 2160 Player | Video player - 2160 Player |
| S05.7 | Настройки | Settings | Язык аудио | Audio language |
| S05.7.1 | Настройки | Settings | Язык аудио - Русский | Audio language - Russian |
| S05.7.2 | Настройки | Settings | Язык аудио - English | Audio language - English |
| S05.7.3 | Настройки | Settings | Язык аудио - Українська | Audio language - Ukrainian |
| S05.7.4 | Настройки | Settings | Язык аудио - Deutsch | Audio language - German |
| S05.7.5 | Настройки | Settings | Язык аудио - Français | Audio language - French |
| S05.7.6 | Настройки | Settings | Язык аудио - Español | Audio language - Spanish |
| S05.7.7 | Настройки | Settings | Язык аудио - 日本語 | Audio language - Japanese |
| S05.8 | Настройки | Settings | Субтитры при запуске | Subtitles at start |
| S05.8.1 | Настройки | Settings | Субтитры при запуске - Вкл | Subtitles at start - On |
| S05.8.2 | Настройки | Settings | Субтитры при запуске - Выкл | Subtitles at start - Off |
| S05.9 | Настройки | Settings | Язык субтитров | Subtitle language |
| S05.9.1 | Настройки | Settings | Язык субтитров - Русский | Subtitle language - Russian |
| S05.9.2 | Настройки | Settings | Язык субтитров - English | Subtitle language - English |
| S05.9.3 | Настройки | Settings | Язык субтитров - Українська | Subtitle language - Ukrainian |
| S05.9.4 | Настройки | Settings | Язык субтитров - Deutsch | Subtitle language - German |
| S05.9.5 | Настройки | Settings | Язык субтитров - Français | Subtitle language - French |
| S05.9.6 | Настройки | Settings | Язык субтитров - Español | Subtitle language - Spanish |
| S05.9.7 | Настройки | Settings | Язык субтитров - 日本語 | Subtitle language - Japanese |
| S05.10 | Настройки | Settings | Шаг перемотки | Seek step |
| S05.10.1 | Настройки | Settings | Шаг перемотки - 5 с | Seek step - 5 s |
| S05.10.2 | Настройки | Settings | Шаг перемотки - 10 с | Seek step - 10 s |
| S05.10.3 | Настройки | Settings | Шаг перемотки - 15 с | Seek step - 15 s |
| S05.10.4 | Настройки | Settings | Шаг перемотки - 30 с | Seek step - 30 s |
| S05.10.5 | Настройки | Settings | Шаг перемотки - 60 с | Seek step - 60 s |
| S05.11 | Настройки | Settings | Шаг двойного клика | Double-click step |
| S05.11.1 | Настройки | Settings | Шаг двойного клика - 5 с | Double-click step - 5 s |
| S05.11.2 | Настройки | Settings | Шаг двойного клика - 10 с | Double-click step - 10 s |
| S05.11.3 | Настройки | Settings | Шаг двойного клика - 15 с | Double-click step - 15 s |
| S05.12 | Настройки | Settings | Автопереход к следующей серии | Auto next episode |
| S05.12.1 | Настройки | Settings | Автопереход к следующей серии - Вкл | Auto next episode - On |
| S05.12.2 | Настройки | Settings | Автопереход к следующей серии - Выкл | Auto next episode - Off |
| S05.13 | Настройки | Settings | Статистика потока при запуске | Stream stats at start |
| S05.13.1 | Настройки | Settings | Статистика потока при запуске - Вкл | Stream stats at start - On |
| S05.13.2 | Настройки | Settings | Статистика потока при запуске - Выкл | Stream stats at start - Off |
| S05.14 | Настройки | Settings | Размер субтитров | Subtitle size |
| S05.14.1 | Настройки | Settings | Размер субтитров - Маленький | Subtitle size - Small |
| S05.14.2 | Настройки | Settings | Размер субтитров - Средний | Subtitle size - Medium |
| S05.14.3 | Настройки | Settings | Размер субтитров - Крупный | Subtitle size - Large |
| S05.15 | Настройки | Settings | Цвет субтитров | Subtitle color |
| S05.15.1 | Настройки | Settings | Цвет субтитров - Белый | Subtitle color - White |
| S05.15.2 | Настройки | Settings | Цвет субтитров - Жёлтый | Subtitle color - Yellow |
| S05.16 | Настройки | Settings | Подложка субтитров | Subtitle background |
| S05.16.1 | Настройки | Settings | Подложка субтитров - Вкл | Subtitle background - On |
| S05.16.2 | Настройки | Settings | Подложка субтитров - Выкл | Subtitle background - Off |
| S05.17 | Настройки | Settings | Сменить сервер | Change server |
| S05.18 | Настройки | Settings | Подключить телефон | Pair a phone |
| S05.19 | Настройки | Settings | Где искать фильмы | Where to search |
| S05.20 | Настройки | Settings | Актуальные сиды | Live seeds |
| S05.20.1 | Настройки | Settings | Актуальные сиды - Вкл | Live seeds - On |
| S05.20.2 | Настройки | Settings | Актуальные сиды - Выкл | Live seeds - Off |
| S05.21 | Настройки | Settings | Открывать при включении | Open on startup |
| S05.21.1 | Настройки | Settings | Открывать при включении - Вкл | Open on startup - On |
| S05.21.2 | Настройки | Settings | Открывать при включении - Выкл | Open on startup - Off |
| S05.22 | Настройки | Settings | Разрешить показ поверх окон | Allow draw over other apps |
| S05.23 | Настройки | Settings | Проверить обновление | Check for an update |
| S05.24 | Настройки | Settings | Обновление | Update |
| S05.25 | Настройки | Settings | Добавить репозиторий Homebrew | Add the Homebrew repository |
| S05.26 | Настройки | Settings | Помощь | Help |
| S05.27 | Настройки | Settings | Расширенные | Advanced |
| S05.28 | Настройки | Settings | Показать знакомство | Show the tour |
| S05.29 | Настройки | Settings | Режим тестирования | Test mode |
| S05.29.1 | Настройки | Settings | Режим тестирования - Вкл | Test mode - On |
| S05.29.2 | Настройки | Settings | Режим тестирования - Выкл | Test mode - Off |
| S05.30 | Настройки | Settings | Размер меток (ползунок, px) | Label size (slider, px) |
| S06 | Плеер | Player |  |  |
| S06.1 | Плеер | Player | Предыдущий | Previous |
| S06.2 | Плеер | Player | Воспроизведение | Play or pause |
| S06.3 | Плеер | Player | Следующий | Next |
| S06.4 | Плеер | Player | Меню | Menu |
| S06.5 | Плеер | Player | Главы | Chapters |
| S06.6 | Плеер | Player | Другая раздача | Another release |
| S06.7 | Плеер | Player | Повторить | Retry |
| S06.8 | Плеер | Player | Назад | Back |
| S07 | Поиск | Search |  |  |
| S07.1 | Поиск | Search | Запрос | Query |
| S07.2 | Поиск | Search | Найти | Search |
| S07.3 | Поиск | Search | Magnet или ссылка | Magnet or link |
| S07.4 | Поиск | Search | Источники | Sources |
| S07.5 | Поиск | Search | Все типы | All kinds |
| S07.6 | Поиск | Search | Фильмы | Movies |
| S07.7 | Поиск | Search | Сериалы | Series |
| S07.8 | Поиск | Search | Аудиокниги | Audiobooks |
| S07.9 | Поиск | Search | Сортировка | Sort |
| S08 | Плейлисты | Playlists |  |  |
| S08.1 | Плейлисты | Playlists | Адрес плейлиста | Playlist URL |
| S08.2 | Плейлисты | Playlists | Открыть | Open |
| S08.3 | Плейлисты | Playlists | Все торренты сервера | All server torrents |
| S08.4 | Плейлисты | Playlists | Воспроизвести всё | Play all |
| S08.5 | Плейлисты | Playlists | В избранное | Favorite |
| S09 | Подключение | Connect |  |  |
| S09.1 | Подключение | Connect | История серверов | Server history |
| S09.2 | Подключение | Connect | Адрес | Address |
| S09.3 | Подключение | Connect | Цифровая клавиатура | Keypad |
| S09.4 | Подключение | Connect | Логин и пароль | Login and password |
| S09.5 | Подключение | Connect | Логин | Login |
| S09.6 | Подключение | Connect | Пароль | Password |
| S09.7 | Подключение | Connect | Подключиться | Connect |
| S09.8 | Подключение | Connect | Найти в сети | Scan the network |
| S09.9 | Подключение | Connect | 1 | 1 |
| S09.10 | Подключение | Connect | 2 | 2 |
| S09.11 | Подключение | Connect | 3 | 3 |
| S09.12 | Подключение | Connect | Стереть | Backspace |
| S09.13 | Подключение | Connect | 4 | 4 |
| S09.14 | Подключение | Connect | 5 | 5 |
| S09.15 | Подключение | Connect | 6 | 6 |
| S09.16 | Подключение | Connect | . | . |
| S09.17 | Подключение | Connect | 7 | 7 |
| S09.18 | Подключение | Connect | 8 | 8 |
| S09.19 | Подключение | Connect | 9 | 9 |
| S09.20 | Подключение | Connect | : | : |
| S09.21 | Подключение | Connect | http:// | http:// |
| S09.22 | Подключение | Connect | 0 | 0 |
| S09.23 | Подключение | Connect | https:// | https:// |
| S09.24 | Подключение | Connect | Клавиатура | Keyboard |
| S09.25 | Подключение | Connect | Готово | Done |
| S10 | Расширенные | Advanced |  |  |
| S10.1 | Расширенные | Advanced | Назад | Back |
| S10.2 | Расширенные | Advanced | Ключ TMDB | TMDB key |
| S10.3 | Расширенные | Advanced | Размер кэша | Cache size |
| S10.3.1 | Расширенные | Advanced | Размер кэша - 64 МБ | Cache size - 64 MB |
| S10.3.2 | Расширенные | Advanced | Размер кэша - 128 МБ | Cache size - 128 MB |
| S10.3.3 | Расширенные | Advanced | Размер кэша - 256 МБ | Cache size - 256 MB |
| S10.3.4 | Расширенные | Advanced | Размер кэша - 512 МБ | Cache size - 512 MB |
| S10.3.5 | Расширенные | Advanced | Размер кэша - 1 ГБ | Cache size - 1 GB |
| S10.3.6 | Расширенные | Advanced | Размер кэша - 2 ГБ | Cache size - 2 GB |
| S10.4 | Расширенные | Advanced | Сохранить на сервере | Save on the server |
| S10.5 | Расширенные | Advanced | Для опытных | Expert |
| S10.6 | Расширенные | Advanced | Предзагрузка | Preload |
| S10.6.1 | Расширенные | Advanced | Предзагрузка - 0% | Preload - 0% |
| S10.6.2 | Расширенные | Advanced | Предзагрузка - 5% | Preload - 5% |
| S10.6.3 | Расширенные | Advanced | Предзагрузка - 10% | Preload - 10% |
| S10.6.4 | Расширенные | Advanced | Предзагрузка - 25% | Preload - 25% |
| S10.6.5 | Расширенные | Advanced | Предзагрузка - 50% | Preload - 50% |
| S10.6.6 | Расширенные | Advanced | Предзагрузка - 75% | Preload - 75% |
| S10.6.7 | Расширенные | Advanced | Предзагрузка - 95% | Preload - 95% |
| S10.7 | Расширенные | Advanced | Опережающее чтение | Read ahead |
| S10.7.1 | Расширенные | Advanced | Опережающее чтение - 5% | Read ahead - 5% |
| S10.7.2 | Расширенные | Advanced | Опережающее чтение - 25% | Read ahead - 25% |
| S10.7.3 | Расширенные | Advanced | Опережающее чтение - 50% | Read ahead - 50% |
| S10.7.4 | Расширенные | Advanced | Опережающее чтение - 75% | Read ahead - 75% |
| S10.7.5 | Расширенные | Advanced | Опережающее чтение - 95% | Read ahead - 95% |
| S10.8 | Расширенные | Advanced | Лимит соединений | Connection limit |
| S10.8.1 | Расширенные | Advanced | Лимит соединений - 10 | Connection limit - 10 |
| S10.8.2 | Расширенные | Advanced | Лимит соединений - 25 | Connection limit - 25 |
| S10.8.3 | Расширенные | Advanced | Лимит соединений - 50 | Connection limit - 50 |
| S10.8.4 | Расширенные | Advanced | Лимит соединений - 100 | Connection limit - 100 |
| S10.8.5 | Расширенные | Advanced | Лимит соединений - 200 | Connection limit - 200 |
| S10.9 | Расширенные | Advanced | Ограничение загрузки | Download limit |
| S10.9.1 | Расширенные | Advanced | Ограничение загрузки - Без ограничения | Download limit - Unlimited |
| S10.9.2 | Расширенные | Advanced | Ограничение загрузки - 1 Мбит/с | Download limit - 1 Mbps |
| S10.9.3 | Расширенные | Advanced | Ограничение загрузки - 5 Мбит/с | Download limit - 5 Mbps |
| S10.9.4 | Расширенные | Advanced | Ограничение загрузки - 10 Мбит/с | Download limit - 10 Mbps |
| S10.9.5 | Расширенные | Advanced | Ограничение загрузки - 25 Мбит/с | Download limit - 25 Mbps |
| S10.9.6 | Расширенные | Advanced | Ограничение загрузки - 50 Мбит/с | Download limit - 50 Mbps |
| S10.10 | Расширенные | Advanced | Ограничение отдачи | Upload limit |
| S10.10.1 | Расширенные | Advanced | Ограничение отдачи - Без ограничения | Upload limit - Unlimited |
| S10.10.2 | Расширенные | Advanced | Ограничение отдачи - 1 Мбит/с | Upload limit - 1 Mbps |
| S10.10.3 | Расширенные | Advanced | Ограничение отдачи - 5 Мбит/с | Upload limit - 5 Mbps |
| S10.10.4 | Расширенные | Advanced | Ограничение отдачи - 10 Мбит/с | Upload limit - 10 Mbps |
| S10.10.5 | Расширенные | Advanced | Ограничение отдачи - 25 Мбит/с | Upload limit - 25 Mbps |
| S10.10.6 | Расширенные | Advanced | Ограничение отдачи - 50 Мбит/с | Upload limit - 50 Mbps |
| S10.11 | Расширенные | Advanced | Отключать неактивный торрент | Disconnect idle torrent |
| S10.11.1 | Расширенные | Advanced | Отключать неактивный торрент - 30 с | Disconnect idle torrent - 30 s |
| S10.11.2 | Расширенные | Advanced | Отключать неактивный торрент - 60 с | Disconnect idle torrent - 60 s |
| S10.11.3 | Расширенные | Advanced | Отключать неактивный торрент - 120 с | Disconnect idle torrent - 120 s |
| S10.11.4 | Расширенные | Advanced | Отключать неактивный торрент - 300 с | Disconnect idle torrent - 300 s |
| S10.12 | Расширенные | Advanced | Сохранять тайм-коды на сервере | Save timecodes on the server |
| S10.12.1 | Расширенные | Advanced | Сохранять тайм-коды на сервере - Вкл | Save timecodes on the server - On |
| S10.12.2 | Расширенные | Advanced | Сохранять тайм-коды на сервере - Выкл | Save timecodes on the server - Off |
| S10.13 | Расширенные | Advanced | По умолчанию | Defaults |
| S10.14 | Расширенные | Advanced | Проверять обновления при запуске | Check for updates on start |
| S10.14.1 | Расширенные | Advanced | Проверять обновления при запуске - Вкл | Check for updates on start - On |
| S10.14.2 | Расширенные | Advanced | Проверять обновления при запуске - Выкл | Check for updates on start - Off |
| S10.15 | Расширенные | Advanced | Пробовать новые функции раньше всех | Try new features first |
| S10.15.1 | Расширенные | Advanced | Пробовать новые функции раньше всех - Вкл | Try new features first - On |
| S10.15.2 | Расширенные | Advanced | Пробовать новые функции раньше всех - Выкл | Try new features first - Off |
| S10.16 | Расширенные | Advanced | Очистить журнал | Clear the log |
| S10.17 | Расширенные | Advanced | Сбросить настройки приложения | Reset app settings |
| S11 | Помощь | Help |  |  |
| S11.1 | Помощь | Help | Ответ | Answer |
| S11.2 | Помощь | Help | Установка | Installation |
| S11.3 | Помощь | Help | Подключение | Connecting |
| S11.4 | Помощь | Help | Плеер | Player |
| S11.5 | Помощь | Help | Если что-то не работает | If something does not work |
| S11.6 | Помощь | Help | Поиск и настройка | Search and setup |
| S11.7 | Помощь | Help | О проекте | About the project |
| S11.8 | Помощь | Help | Журнал и резервная копия | Log and backup |
| S11.9 | Помощь | Help | Новое и подписки | New and subscriptions |
| S11.10 | Помощь | Help | Подойдёт ли мой телевизор? | Will my TV work? |
| S11.11 | Помощь | Help | Нужен ли root? | Do I need root? |
| S11.12 | Помощь | Help | Установить без root (режим разработчика) | Install without root (Developer Mode) |
| S11.13 | Помощь | Help | Установить через Homebrew Channel (с root) | Install through Homebrew Channel (with root) |
| S11.14 | Помощь | Help | Режим разработчика и 1000 часов | Developer Mode and 1000 hours |
| S11.15 | Помощь | Help | Как обновить OMP | How to update OMP |
| S11.16 | Помощь | Help | Установить на Android TV | Install on Android TV |
| S11.17 | Помощь | Help | Установка на Android через ADB | Install on Android with ADB |
| S11.18 | Помощь | Help | На каких приставках работает OMP | Which boxes OMP works on |
| S11.19 | Помощь | Help | Какой APK скачать | Which APK to download |
| S11.20 | Помощь | Help | Установить на Xiaomi (Mi Box, Mi TV) | Install on Xiaomi (Mi Box, Mi TV) |
| S11.21 | Помощь | Help | Установить на Сбер (SberBox, Салют ТВ) | Install on Sber (SberBox, Salute TV) |
| S11.22 | Помощь | Help | Установить на Яндекс (ТВ Станция, YaOS, Модуль) | Install on Yandex (TV Station, YaOS, Module) |
| S11.23 | Помощь | Help | Как обновить OMP | How to update OMP |
| S11.24 | Помощь | Help | Бета-версии | Beta versions |
| S11.25 | Помощь | Help | Установить OMP на телефон | Install OMP on the phone |
| S11.26 | Помощь | Help | Что делать после установки | What to do after installing |
| S11.27 | Помощь | Help | Есть ли OMP для Samsung? | Is there OMP for Samsung? |
| S11.28 | Помощь | Help | Android пишет «Приложение не установлено» | Android says “App not installed” |
| S11.29 | Помощь | Help | OMP пропал с телевизора | OMP disappeared from the TV |
| S11.30 | Помощь | Help | Dev Manager не подключается к телевизору | Dev Manager does not connect to the TV |
| S11.31 | Помощь | Help | Поставить с телефона (помощник) | Install from the phone (assistant) |
| S11.32 | Помощь | Help | Безопасность: Key Server и отладка по сети | Security: Key Server and network debugging |
| S11.33 | Помощь | Help | Подключить телефон к LG | Connect the phone to LG |
| S11.34 | Помощь | Help | Подключить телефон к Android TV | Connect the phone to Android TV |
| S11.35 | Помощь | Help | Подключить телефон к Xiaomi | Connect the phone to a Xiaomi TV |
| S11.36 | Помощь | Help | ТВ не видит TorrServer, а телефон видит | The TV cannot reach TorrServer but the phone can |
| S11.37 | Помощь | Help | Включить телевизор с телефона | Turn on the TV from the phone |
| S11.38 | Помощь | Help | Пропуск заставки и титров | Skipping the intro and credits |
| S11.39 | Помощь | Help | Звук, субтитры и перемотка | Sound, subtitles and seeking |
| S11.40 | Помощь | Help | Управлять просмотром с телефона | Control playback from the phone |
| S11.41 | Помощь | Help | Как найти и слушать аудиокнигу | How to find and listen to an audiobook |
| S11.42 | Помощь | Help | Плеер аудиокниги: кнопки, фон и таймер сна | Audiobook player: controls, background and the sleep timer |
| S11.43 | Помощь | Help | Мало сидов или в раздаче нет звука | Few seeds, or the torrent has no audio |
| S11.44 | Помощь | Help | Плеер: встроенный или VLC | Player: built-in or VLC |
| S11.45 | Помощь | Help | Что такое «Авто» и когда включается VLC | What “Auto” is and when VLC turns on |
| S11.46 | Помощь | Help | Звук DTS и TrueHD, вывод на ресивер (passthrough) | DTS and TrueHD sound, output to a receiver (passthrough) |
| S11.47 | Помощь | Help | ТВ или телефон не видит сервер | The TV or the phone does not see the server |
| S11.48 | Помощь | Help | Нет звука (AC3, DTS) | No sound (AC3, DTS) |
| S11.49 | Помощь | Help | Уведомления опаздывают или не приходят | Notifications are late or do not arrive |
| S11.50 | Помощь | Help | torrent.by просит ввести код | torrent.by asks for a code |
| S11.51 | Помощь | Help | Телефон не управляет плеером на ТВ | The phone does not control the player on the TV |
| S11.52 | Помощь | Help | Откуда ищет OMP и как включить rutracker | Where OMP searches and how to turn on rutracker |
| S11.53 | Помощь | Help | Передать источники и вход на Android TV | Send the sources and sign-ins to Android TV |
| S11.54 | Помощь | Help | Jackett и Prowlarr: другие трекеры | Jackett and Prowlarr: other trackers |
| S11.55 | Помощь | Help | Как установить FlareSolverr | How to install FlareSolverr |
| S11.56 | Помощь | Help | Сайты за Cloudflare: обход и «Пройти на телефоне» | Sites behind Cloudflare: the bypass and “Pass on the phone” |
| S11.57 | Помощь | Help | Kinozal, rustorka и NNM-Club: вход, зеркала и «Войти через браузер» | Kinozal, rustorka and NNM-Club: sign-in, mirrors and “Sign in with browser” |
| S11.58 | Помощь | Help | Где взять аккаунт для rutracker, Kinozal, rustorka и NNM-Club | Where to get an account for rutracker, Kinozal, rustorka and NNM-Club |
| S11.59 | Помощь | Help | Что такое «Обзор» | What is “Discover” |
| S11.60 | Помощь | Help | Добавить раздачу по magnet-ссылке | Add a torrent by magnet link |
| S11.61 | Помощь | Help | Фильтры поиска раздач | Search filters for torrents |
| S11.62 | Помощь | Help | Ключ TMDB для «Обзора» | TMDB key for “Discover” |
| S11.63 | Помощь | Help | Понятные названия и «Переименовать» | Clear names and “Rename” |
| S11.64 | Помощь | Help | Что такое TorrServer и где его взять | What TorrServer is and where to get it |
| S11.65 | Помощь | Help | Запустить TorrServer на телефоне | Run TorrServer on the phone |
| S11.66 | Помощь | Help | Где настройки сервера | Where the server settings are |
| S11.67 | Помощь | Help | Нет обложек у новых раздач | No posters for new torrents |
| S11.68 | Помощь | Help | Как работают подписки и «Новое» | How subscriptions and “New” work |
| S11.69 | Помощь | Help | Новые серии и кнопка «Заменить» | New episodes and the “Replace” button |
| S11.70 | Помощь | Help | Лучшее качество: раздача получше | Better quality: a better torrent |
| S11.71 | Помощь | Help | Найти в лучшем качестве: поиск по кнопке | Find in better quality: search on demand |
| S11.72 | Помощь | Help | Сериал одной карточкой и экран сериала | A series as one card, and the series screen |
| S11.73 | Помощь | Help | Журнал ошибок: что в нём записано | The error log: what is recorded in it |
| S11.74 | Помощь | Help | Сообщить об ошибке и поделиться журналом | Report an error and share the log |
| S11.75 | Помощь | Help | Резервная копия: сохранить и восстановить | Backup: save and restore |
| S11.76 | Помощь | Help | Как поддержать OMP | How to support OMP |
| S11.77 | Помощь | Help | Где брать новые версии (Telegram) | Where to get new versions (Telegram) |
| S11.78 | Помощь | Help | Подписка OMP: Jackett и JacRed | OMP subscription: Jackett and JacRed |
| S11.79 | Помощь | Help | TorrServer по https и на другом порту | TorrServer over https and on another port |
| S12 | Телефон | Phone |  |  |
| S12.1 | Телефон | Phone | Готово | Done |
| S12.2 | Телефон | Phone | Новый код | New code |
| S13 | Обновление | Update |  |  |
| S13.1 | Обновление | Update | Проверить | Check |
| S13.2 | Обновление | Update | Что нового | What's new |
| S13.3 | Обновление | Update | Бета-версии | Beta versions |
| S13.4 | Обновление | Update | Установить | Install |
| S13.5 | Обновление | Update | Открыть Homebrew Channel | Open Homebrew Channel |
| S13.6 | Обновление | Update | Добавить репозиторий OMP | Add the OMP repository |
| S14 | Карточка | Title |  |  |
| S14.1 | Карточка | Title | Найти раздачи | Find releases |
| S14.2 | Карточка | Title | Хочу посмотреть | Want to watch |
| S14.3 | Карточка | Title | Открыть в медиатеке | Open in the library |
| S14.4 | Карточка | Title | Повторить | Retry |
| S15 | Персона | Person |  |  |
| S15.1 | Персона | Person | Подробнее | More |
| S15.2 | Персона | Person | Актёр | Actor |
| S15.3 | Персона | Person | Режиссёр | Director |
| S15.4 | Персона | Person | Все | All |
| S15.5 | Персона | Person | В медиатеке | In the library |
| S15.6 | Персона | Person | Сортировка | Sort |
| S15.6.1 | Персона | Person | Сортировка - Популярные | Sort - Popular |
| S15.6.2 | Персона | Person | Сортировка - По году | Sort - By year |
| S15.7 | Персона | Person | Повторить | Retry |
| S16 | Источники телефона | Phone sources |  |  |
| S16.1 | Источники телефона | Phone sources | Повторить | Retry |
| S16.2 | Источники телефона | Phone sources | Забыть телефон | Forget the phone |
| S16.3 | Источники телефона | Phone sources | Источники TorrServer | TorrServer sources |
| S16.4 | Источники телефона | Phone sources | Rutor | Rutor |
| S16.5 | Источники телефона | Phone sources | NNM-Club | NNM-Club |
| S16.6 | Источники телефона | Phone sources | Anidub | Anidub |
| S16.7 | Источники телефона | Phone sources | BigFANGroup | BigFANGroup |
| S16.8 | Источники телефона | Phone sources | torrent.by | torrent.by |
| S16.9 | Источники телефона | Phone sources | RuTracker | RuTracker |
| S16.10 | Источники телефона | Phone sources | Kinozal | Kinozal |
| S16.11 | Источники телефона | Phone sources | Rustorka | Rustorka |
| S17 | Источники поиска | Search sources |  |  |
| S17.1 | Источники поиска | Search sources | rutor (TorrServer) | rutor (TorrServer) |
| S17.2 | Источники поиска | Search sources | Torznab | Torznab |
| S17.3 | Источники поиска | Search sources | Rutor | Rutor |
| S17.4 | Источники поиска | Search sources | Rutor - вход | Rutor - sign in |
| S17.5 | Источники поиска | Search sources | Rutor - обход Cloudflare | Rutor - Cloudflare bypass |
| S17.6 | Источники поиска | Search sources | NNM-Club | NNM-Club |
| S17.7 | Источники поиска | Search sources | NNM-Club - вход | NNM-Club - sign in |
| S17.8 | Источники поиска | Search sources | NNM-Club - обход Cloudflare | NNM-Club - Cloudflare bypass |
| S17.9 | Источники поиска | Search sources | Anidub | Anidub |
| S17.10 | Источники поиска | Search sources | Anidub - вход | Anidub - sign in |
| S17.11 | Источники поиска | Search sources | Anidub - обход Cloudflare | Anidub - Cloudflare bypass |
| S17.12 | Источники поиска | Search sources | BigFANGroup | BigFANGroup |
| S17.13 | Источники поиска | Search sources | BigFANGroup - вход | BigFANGroup - sign in |
| S17.14 | Источники поиска | Search sources | BigFANGroup - обход Cloudflare | BigFANGroup - Cloudflare bypass |
| S17.15 | Источники поиска | Search sources | torrent.by | torrent.by |
| S17.16 | Источники поиска | Search sources | torrent.by - вход | torrent.by - sign in |
| S17.17 | Источники поиска | Search sources | torrent.by - обход Cloudflare | torrent.by - Cloudflare bypass |
| S17.18 | Источники поиска | Search sources | RuTracker | RuTracker |
| S17.19 | Источники поиска | Search sources | RuTracker - вход | RuTracker - sign in |
| S17.20 | Источники поиска | Search sources | RuTracker - обход Cloudflare | RuTracker - Cloudflare bypass |
| S17.21 | Источники поиска | Search sources | Kinozal | Kinozal |
| S17.22 | Источники поиска | Search sources | Kinozal - вход | Kinozal - sign in |
| S17.23 | Источники поиска | Search sources | Kinozal - обход Cloudflare | Kinozal - Cloudflare bypass |
| S17.24 | Источники поиска | Search sources | Rustorka | Rustorka |
| S17.25 | Источники поиска | Search sources | Rustorka - вход | Rustorka - sign in |
| S17.26 | Источники поиска | Search sources | Rustorka - обход Cloudflare | Rustorka - Cloudflare bypass |
| S18 | Новое | News |  |  |
| S18.1 | Новое | News | Новое | News |
| S18.2 | Новое | News | Находки | Findings |
| S18.3 | Новое | News | Подписки | Subscriptions |
| S18.4 | Новое | News | Повторить | Retry |
| S18.5 | Новое | News | Повторить подписки | Retry subscriptions |
| S18.6 | Новое | News | Найти подписку | Find a subscription |
| D01 | Выход | Exit |  |  |
| D01.1 | Выход | Exit | Выйти | Exit |
| D01.2 | Выход | Exit | Отмена | Cancel |
| D02 | Удалить раздачу | Delete a release |  |  |
| D02.1 | Удалить раздачу | Delete a release | Удалить | Delete |
| D02.2 | Удалить раздачу | Delete a release | Отмена | Cancel |
| D03 | Удалить сериал | Delete a series |  |  |
| D03.1 | Удалить сериал | Delete a series | Удалить | Delete |
| D03.2 | Удалить сериал | Delete a series | Отмена | Cancel |
| D04 | Убрать из истории | Remove from history |  |  |
| D04.1 | Убрать из истории | Remove from history | Убрать | Remove |
| D04.2 | Убрать из истории | Remove from history | Отмена | Cancel |
| D05 | Подробнее о раздаче | Release details |  |  |
| D05.1 | Подробнее о раздаче | Release details | Добавить | Add |
| D06 | Magnet или ссылка | Magnet or link |  |  |
| D06.1 | Magnet или ссылка | Magnet or link | Поле | Field |
| D06.2 | Magnet или ссылка | Magnet or link | Добавить | Add |
| D06.3 | Magnet или ссылка | Magnet or link | Отмена | Cancel |
| D07 | Сортировка поиска | Search sort |  |  |
| D07.1 | Сортировка поиска | Search sort | По качеству | By quality |
| D07.2 | Сортировка поиска | Search sort | По сидам | By seeds |
| D07.3 | Сортировка поиска | Search sort | По размеру | By size |
| D07.4 | Сортировка поиска | Search sort | По дате | By date |
| D08 | Биография | Biography |  |  |
| D08.1 | Биография | Biography | Закрыть | Close |
| D09 | Забыть телефон | Forget the phone |  |  |
| D09.1 | Забыть телефон | Forget the phone | Забыть | Forget |
| D09.2 | Забыть телефон | Forget the phone | Отмена | Cancel |
| D10 | Продолжить просмотр | Resume |  |  |
| D10.1 | Продолжить просмотр | Resume | Продолжить | Resume |
| D10.2 | Продолжить просмотр | Resume | Сначала | From the start |
| D11 | Главы | Chapters |  |  |
| D12 | Аудио | Audio |  |  |
| D13 | Субтитры | Subtitles |  |  |
| D14 | Меню плеера | Player menu |  |  |
| D14.1 | Меню плеера | Player menu | Аудио | Audio |
| D14.2 | Меню плеера | Player menu | Субтитры | Subtitles |
| D14.3 | Меню плеера | Player menu | Размер субтитров | Subtitle size |
| D14.4 | Меню плеера | Player menu | Смещение субтитров | Subtitle offset |
| D14.5 | Меню плеера | Player menu | Главы | Chapters |
| D14.6 | Меню плеера | Player menu | Начало заставки | Intro start |
| D14.7 | Меню плеера | Player menu | Конец заставки | Intro end |
| D14.8 | Меню плеера | Player menu | Титры | Credits |
| D15 | Размер субтитров | Subtitle size |  |  |
| D15.1 | Размер субтитров | Subtitle size | Маленький | Small |
| D15.2 | Размер субтитров | Subtitle size | Средний | Medium |
| D15.3 | Размер субтитров | Subtitle size | Крупный | Large |
| D16 | Смещение субтитров | Subtitle offset |  |  |
| D16.1 | Смещение субтитров | Subtitle offset | Смещение | Offset |
| D16.1.1 | Смещение субтитров | Subtitle offset | Смещение - -5 с | Offset - -5 s |
| D16.1.2 | Смещение субтитров | Subtitle offset | Смещение - -4.5 с | Offset - -4.5 s |
| D16.1.3 | Смещение субтитров | Subtitle offset | Смещение - -4 с | Offset - -4 s |
| D16.1.4 | Смещение субтитров | Subtitle offset | Смещение - -3.5 с | Offset - -3.5 s |
| D16.1.5 | Смещение субтитров | Subtitle offset | Смещение - -3 с | Offset - -3 s |
| D16.1.6 | Смещение субтитров | Subtitle offset | Смещение - -2.5 с | Offset - -2.5 s |
| D16.1.7 | Смещение субтитров | Subtitle offset | Смещение - -2 с | Offset - -2 s |
| D16.1.8 | Смещение субтитров | Subtitle offset | Смещение - -1.5 с | Offset - -1.5 s |
| D16.1.9 | Смещение субтитров | Subtitle offset | Смещение - -1 с | Offset - -1 s |
| D16.1.10 | Смещение субтитров | Subtitle offset | Смещение - -0.5 с | Offset - -0.5 s |
| D16.1.11 | Смещение субтитров | Subtitle offset | Смещение - 0 с | Offset - 0 s |
| D16.1.12 | Смещение субтитров | Subtitle offset | Смещение - +0.5 с | Offset - +0.5 s |
| D16.1.13 | Смещение субтитров | Subtitle offset | Смещение - +1 с | Offset - +1 s |
| D16.1.14 | Смещение субтитров | Subtitle offset | Смещение - +1.5 с | Offset - +1.5 s |
| D16.1.15 | Смещение субтитров | Subtitle offset | Смещение - +2 с | Offset - +2 s |
| D16.1.16 | Смещение субтитров | Subtitle offset | Смещение - +2.5 с | Offset - +2.5 s |
| D16.1.17 | Смещение субтитров | Subtitle offset | Смещение - +3 с | Offset - +3 s |
| D16.1.18 | Смещение субтитров | Subtitle offset | Смещение - +3.5 с | Offset - +3.5 s |
| D16.1.19 | Смещение субтитров | Subtitle offset | Смещение - +4 с | Offset - +4 s |
| D16.1.20 | Смещение субтитров | Subtitle offset | Смещение - +4.5 с | Offset - +4.5 s |
| D16.1.21 | Смещение субтитров | Subtitle offset | Смещение - +5 с | Offset - +5 s |
| D17 | Озвучка сериала | Series dub |  |  |
| D18 | В лучшем качестве | Better quality |  |  |
| D19 | Раздачи сериала | Series releases |  |  |
| D20 | Очистить журнал | Clear the log |  |  |
| D20.1 | Очистить журнал | Clear the log | Очистить | Clear |
| D20.2 | Очистить журнал | Clear the log | Отмена | Cancel |
| D21 | Показ поверх окон | Draw over other apps |  |  |
| D21.1 | Показ поверх окон | Draw over other apps | Разрешить | Allow |
| D21.2 | Показ поверх окон | Draw over other apps | Отмена | Cancel |
| D22 | Сбросить настройки сервера | Reset server settings |  |  |
| D22.1 | Сбросить настройки сервера | Reset server settings | Сбросить | Reset |
| D22.2 | Сбросить настройки сервера | Reset server settings | Отмена | Cancel |
| D23 | Ключ TMDB | TMDB key |  |  |
| D23.1 | Ключ TMDB | TMDB key | Поле | Field |
| D23.2 | Ключ TMDB | TMDB key | Сохранить | Save |
| D23.3 | Ключ TMDB | TMDB key | Отмена | Cancel |
| D24 | Сбросить настройки приложения | Reset app settings |  |  |
| D24.1 | Сбросить настройки приложения | Reset app settings | Сбросить | Reset |
| D24.2 | Сбросить настройки приложения | Reset app settings | Отмена | Cancel |
| D25 | Обход Cloudflare | Cloudflare bypass |  |  |
| D25.1 | Обход Cloudflare | Cloudflare bypass | Включить | Enable |
| D25.2 | Обход Cloudflare | Cloudflare bypass | Отмена | Cancel |
| D26 | Выйти с сайта | Sign out |  |  |
| D26.1 | Выйти с сайта | Sign out | Выйти | Sign out |
| D26.2 | Выйти с сайта | Sign out | Отмена | Cancel |
| D27 | Разрешить установку | Allow installation |  |  |
| D27.1 | Разрешить установку | Allow installation | Разрешить | Allow |
| D27.2 | Разрешить установку | Allow installation | Отмена | Cancel |
| D28 | Удалить сервер | Delete the server |  |  |
| D28.1 | Удалить сервер | Delete the server | Удалить | Delete |
| D28.2 | Удалить сервер | Delete the server | Отмена | Cancel |
| D29 | Удалить торрент | Delete the torrent |  |  |
| D29.1 | Удалить торрент | Delete the torrent | Удалить | Delete |
| D29.2 | Удалить торрент | Delete the torrent | Отмена | Cancel |
| D30 | Переименовать | Rename |  |  |
| D30.1 | Переименовать | Rename | Поле | Field |
| D30.2 | Переименовать | Rename | Сохранить | Save |
| D30.3 | Переименовать | Rename | Отмена | Cancel |
| D31 | Сменить постер | Change poster |  |  |
| D31.1 | Сменить постер | Change poster | Поиск | Search |
| D31.2 | Сменить постер | Change poster | Вставить ссылку | Paste a link |
| D31.3 | Сменить постер | Change poster | Сбросить (найти автоматически) | Reset (find automatically) |
| D31.4 | Сменить постер | Change poster | К результатам | Back to results |
| D32 | Сбросить просмотр | Reset watched |  |  |
| D32.1 | Сбросить просмотр | Reset watched | Сбросить | Reset |
| D32.2 | Сбросить просмотр | Reset watched | Отмена | Cancel |
| D33 | Поиск в каталоге | Catalog search |  |  |
| D33.1 | Поиск в каталоге | Catalog search | Поле | Field |
| D33.2 | Поиск в каталоге | Catalog search | Найти | Search |
| D33.3 | Поиск в каталоге | Catalog search | Отмена | Cancel |
| D34 | Сортировка каталога | Catalog sort |  |  |
| D34.1 | Сортировка каталога | Catalog sort | Популярные | Popular |
| D34.2 | Сортировка каталога | Catalog sort | По рейтингу | By rating |
| D34.3 | Сортировка каталога | Catalog sort | По дате выхода | By release date |
| D34.4 | Сортировка каталога | Catalog sort | Самые ожидаемые | Most anticipated |
| D34.5 | Сортировка каталога | Catalog sort | Скоро в цифре | Digital soon |
| D35 | Жанр | Genre |  |  |
| D35.1 | Жанр | Genre | Любой | Any |
| D35.2 | Жанр | Genre | Боевик | Action |
| D35.3 | Жанр | Genre | Приключения | Adventure |
| D35.4 | Жанр | Genre | Мультфильм | Animation |
| D35.5 | Жанр | Genre | Комедия | Comedy |
| D35.6 | Жанр | Genre | Криминал | Crime |
| D35.7 | Жанр | Genre | Документальный | Documentary |
| D35.8 | Жанр | Genre | Драма | Drama |
| D35.9 | Жанр | Genre | Семейный | Family |
| D35.10 | Жанр | Genre | Фэнтези | Fantasy |
| D35.11 | Жанр | Genre | Фантастика | Sci-Fi |
| D35.12 | Жанр | Genre | История | History |
| D35.13 | Жанр | Genre | Ужасы | Horror |
| D35.14 | Жанр | Genre | Музыка | Music |
| D35.15 | Жанр | Genre | Детектив | Mystery |
| D35.16 | Жанр | Genre | Мелодрама | Romance |
| D35.17 | Жанр | Genre | Триллер | Thriller |
| D35.18 | Жанр | Genre | Военный | War |
| D35.19 | Жанр | Genre | Вестерн | Western |
| D35.20 | Жанр | Genre | Детский | Kids |
| D35.21 | Жанр | Genre | Реалити-шоу | Reality |
| D35.22 | Жанр | Genre | Ток-шоу | Talk show |
| D35.23 | Жанр | Genre | Новости | News |
| D36 | Год | Year |  |  |
| D36.1 | Год | Year | Любой | Any |
| D36.2 | Год | Year | Этот год | This year |
| D36.3 | Год | Year | Прошлый | Last year |
| D37 | Страна | Country |  |  |
| D37.1 | Страна | Country | Любая | Any |
| D37.2 | Страна | Country | Россия | Russia |
| D37.3 | Страна | Country | США | USA |
| D37.4 | Страна | Country | Великобритания | UK |
| D37.5 | Страна | Country | Корея | Korea |
| D37.6 | Страна | Country | Япония | Japan |
| D37.7 | Страна | Country | Франция | France |
| D37.8 | Страна | Country | Германия | Germany |
| D37.9 | Страна | Country | Испания | Spain |
| D37.10 | Страна | Country | Италия | Italy |
| D37.11 | Страна | Country | Индия | India |
| D37.12 | Страна | Country | Турция | Turkey |
| D37.13 | Страна | Country | Китай | China |
| D38 | Минимальный рейтинг | Minimum rating |  |  |
| D38.1 | Минимальный рейтинг | Minimum rating | Любой | Any |
| D38.2 | Минимальный рейтинг | Minimum rating | от 6 | from 6 |
| D38.3 | Минимальный рейтинг | Minimum rating | от 7 | from 7 |
| D38.4 | Минимальный рейтинг | Minimum rating | от 8 | from 8 |
| D39 | Найти подписку | Find a subscription |  |  |
| D39.1 | Найти подписку | Find a subscription | Поле | Field |
| D39.2 | Найти подписку | Find a subscription | Найти | Search |
| D39.3 | Найти подписку | Find a subscription | Отмена | Cancel |
| D40 | Доступно обновление | Update available |  |  |
| D40.1 | Доступно обновление | Update available | Обновить | Update |
| D40.2 | Доступно обновление | Update available | Позже | Later |
| D40.3 | Доступно обновление | Update available | Пропустить | Skip |
| D41 | Что нового | What's new |  |  |
| D41.1 | Что нового | What's new | OK | OK |
| D42 | Знакомство | Tour |  |  |
| D42.1 | Знакомство | Tour | Пропустить | Skip |
| D42.2 | Знакомство | Tour | Далее | Next |
| D42.3 | Знакомство | Tour | Приветствие | Welcome |
| D42.4 | Знакомство | Tour | Сервер | Server |
| D42.5 | Знакомство | Tour | Просмотр | Watching |
| D42.6 | Знакомство | Tour | Помощь | Help |
| D42.7 | Знакомство | Tour | Готово | Ready |
| D43 | В лучшем качестве | Better quality |  |  |
| D43.1 | В лучшем качестве | Better quality | Отмена | Cancel |
| D43.2 | В лучшем качестве | Better quality | Искать везде | Search everywhere |
| D43.3 | В лучшем качестве | Better quality | Следить за лучшим качеством | Follow better quality |
| D44 | Заставка и титры | Intro and credits |  |  |
| D44.1 | Заставка и титры | Intro and credits | Заставка с | Intro from |
| D44.2 | Заставка и титры | Intro and credits | Заставка до | Intro to |
| D44.3 | Заставка и титры | Intro and credits | Титры: последние | Credits: last |
| D44.4 | Заставка и титры | Intro and credits | Сбросить | Reset |
| D44.5 | Заставка и титры | Intro and credits | Сохранить | Save |
| D45 | Вход на сайт | Site sign-in |  |  |
| D45.1 | Вход на сайт | Site sign-in | Логин | Login |
| D45.2 | Вход на сайт | Site sign-in | Пароль | Password |
| D45.3 | Вход на сайт | Site sign-in | Войти через браузер | Sign in with the browser |
| D45.4 | Вход на сайт | Site sign-in | Войти на телефоне | Sign in on the phone |
| D45.5 | Вход на сайт | Site sign-in | Отмена | Cancel |
| D45.6 | Вход на сайт | Site sign-in | Войти | Sign in |
| D46 | Сервер | Server |  |  |
| D46.1 | Сервер | Server | Имя | Name |
| D46.2 | Сервер | Server | Адрес | Address |
| D46.3 | Сервер | Server | Цифровая клавиатура | Keypad |
| D46.4 | Сервер | Server | Логин | Login |
| D46.5 | Сервер | Server | Пароль | Password |
| D46.6 | Сервер | Server | Сохранить | Save |
| D46.7 | Сервер | Server | Отмена | Cancel |
| D46.8 | Сервер | Server | Удалить | Delete |
| D46.9 | Сервер | Server | 1 | 1 |
| D46.10 | Сервер | Server | 2 | 2 |
| D46.11 | Сервер | Server | 3 | 3 |
| D46.12 | Сервер | Server | Стереть | Backspace |
| D46.13 | Сервер | Server | 4 | 4 |
| D46.14 | Сервер | Server | 5 | 5 |
| D46.15 | Сервер | Server | 6 | 6 |
| D46.16 | Сервер | Server | . | . |
| D46.17 | Сервер | Server | 7 | 7 |
| D46.18 | Сервер | Server | 8 | 8 |
| D46.19 | Сервер | Server | 9 | 9 |
| D46.20 | Сервер | Server | : | : |
| D46.21 | Сервер | Server | http:// | http:// |
| D46.22 | Сервер | Server | 0 | 0 |
| D46.23 | Сервер | Server | https:// | https:// |
| D46.24 | Сервер | Server | Клавиатура | Keyboard |
| D46.25 | Сервер | Server | Готово | Done |
| D47 | История серверов | Server history |  |  |
| D48 | Поиск постера | Poster search |  |  |
| D48.1 | Поиск постера | Poster search | Поле | Field |
| D48.2 | Поиск постера | Poster search | Найти | Search |
| D48.3 | Поиск постера | Poster search | Отмена | Cancel |
| D49 | Ссылка на постер | Poster link |  |  |
| D49.1 | Ссылка на постер | Poster link | Поле | Field |
| D49.2 | Ссылка на постер | Poster link | Сохранить | Save |
| D49.3 | Ссылка на постер | Poster link | Отмена | Cancel |
| P01 | Подключение | Connect |  |  |
| P01.1 | Подключение | Connect | TorrServer на телефоне | TorrServer on the phone |
| P01.2 | Подключение | Connect | Логин и пароль | Login and password |
| P01.3 | Подключение | Connect | Подключиться | Connect |
| P01.4 | Подключение | Connect | Найти в сети | Scan the network |
| P02 | Каталог | Library |  |  |
| P02.1 | Каталог | Library | Мои | Mine |
| P02.2 | Каталог | Library | Обзор | Browse |
| P02.3 | Каталог | Library | Вид и сортировка | View and sort |
| P02.4 | Каталог | Library | Вид | View |
| P02.5 | Каталог | Library | Поиск | Search |
| P02.6 | Каталог | Library | Отменить выбор | Cancel selection |
| P02.7 | Каталог | Library | Выбрать все | Select all |
| P02.8 | Каталог | Library | История | History |
| P02.9 | Каталог | Library | Все | All |
| P02.10 | Каталог | Library | Фильмы | Movies |
| P02.11 | Каталог | Library | Сериалы | Series |
| P02.12 | Каталог | Library | Музыка | Music |
| P02.13 | Каталог | Library | Аудиокниги | Audiobooks |
| P02.14 | Каталог | Library | Прочее | Other |
| P02.15 | Каталог | Library | Удалить выбранное | Delete selected |
| P02.16 | Каталог | Library | Повторить | Retry |
| P02.17 | Каталог | Library | Поддержать | Support |
| P02.18 | Каталог | Library | Не напоминать | Do not remind |
| P02.19 | Каталог | Library | Продолжить просмотр | Continue watching |
| P02.20 | Каталог | Library | История | History |
| P02.21 | Каталог | Library | Вся история | All history |
| P03 | Новое | News |  |  |
| P03.1 | Новое | News | Находки | Findings |
| P03.2 | Новое | News | Подписки | Subscriptions |
| P03.3 | Новое | News | Календарь | Calendar |
| P04 | Находки подписки | Subscription findings |  |  |
| P04.1 | Находки подписки | Subscription findings | Назад | Back |
| P05 | Следить за новыми | Follow new episodes |  |  |
| P05.1 | Следить за новыми | Follow new episodes | Назад | Back |
| P05.2 | Следить за новыми | Follow new episodes | Как часто | How often |
| P06 | Раздача | Release |  |  |
| P06.1 | Раздача | Release | Назад | Back |
| P06.2 | Раздача | Release | Раздачи фильма | Releases of the film |
| P06.3 | Раздача | Release | Смотреть на телефоне | Watch on the phone |
| P06.4 | Раздача | Release | На ТВ | On the TV |
| P07 | Поиск | Search |  |  |
| P07.1 | Поиск | Search | Найти | Search |
| P07.2 | Поиск | Search | Magnet или ссылка | Magnet or link |
| P07.3 | Поиск | Search | Мои | Mine |
| P07.4 | Поиск | Search | Каталог | Catalog |
| P07.5 | Поиск | Search | Источники | Sources |
| P08 | Пульт | Remote |  |  |
| P08.1 | Пульт | Remote | Сменить телевизор | Switch TV |
| P09 | Сейчас играет | Now playing |  |  |
| P09.1 | Сейчас играет | Now playing | Свернуть | Collapse |
| P10 | Телевизор | TV |  |  |
| P10.1 | Телевизор | TV | Назад | Back |
| P11 | Настройки | Settings |  |  |
| P11.1 | Настройки | Settings | Аккаунт | Account |
| P11.2 | Настройки | Settings | Сменить телевизор | Change TV |
| P11.3 | Настройки | Settings | Установить OMP на телевизор | Install OMP on the TV |
| P11.4 | Настройки | Settings | Поиск с телевизора | Search from the TV |
| P11.5 | Настройки | Settings | Откуда смотреть | Watch from |
| P11.6 | Настройки | Settings | Плеер для видео | Video player |
| P11.7 | Настройки | Settings | Язык | Language |
| P11.8 | Настройки | Settings | Аудиокниги | Audiobooks |
| P11.9 | Настройки | Settings | Где искать | Where to search |
| P11.10 | Настройки | Settings | Актуальные сиды | Live seeds |
| P11.11 | Настройки | Settings | Следить за новыми | Follow new episodes |
| P11.12 | Настройки | Settings | Версия | Version |
| P11.13 | Настройки | Settings | Проверить обновление | Check for an update |
| P11.14 | Настройки | Settings | Помощь | Help |
| P11.15 | Настройки | Settings | Показать знакомство | Show the tour |
| P11.16 | Настройки | Settings | Подсказки снова | Hints again |
| P11.17 | Настройки | Settings | Поддержать | Support |
| P11.18 | Настройки | Settings | Расширенные | Advanced |
| P11.19 | Настройки | Settings | Режим тестирования | Test mode |
| P11.19.1 | Настройки | Settings | Режим тестирования - Вкл | Test mode - On |
| P11.19.2 | Настройки | Settings | Режим тестирования - Выкл | Test mode - Off |
| P11.20 | Настройки | Settings | Размер меток (ползунок, px) | Label size (slider, px) |
| P11.21 | Настройки | Settings | Сервер на телефоне | Server on the phone |
| P12 | Аккаунт | Account |  |  |
| P12.1 | Аккаунт | Account | Назад | Back |
| P13 | Расширенные | Advanced |  |  |
| P13.1 | Расширенные | Advanced | Назад | Back |
| P13.2 | Расширенные | Advanced | TorrServer на телефоне | TorrServer on the phone |
| P13.3 | Расширенные | Advanced | Запускать вместе с OMP | Start with OMP |
| P13.4 | Расширенные | Advanced | Очистить кэш | Clear cache |
| P13.5 | Расширенные | Advanced | Настройки сервера | Server settings |
| P13.6 | Расширенные | Advanced | Проверять обновления при запуске | Check for updates on start |
| P13.7 | Расширенные | Advanced | Бета-версии | Beta versions |
| P13.8 | Расширенные | Advanced | Резервная копия | Backup |
| P13.9 | Расширенные | Advanced | Журнал | Log |
| P13.10 | Расширенные | Advanced | Страница проекта | Project page |
| P14 | Плеер для видео | Video player |  |  |
| P14.1 | Плеер для видео | Video player | Назад | Back |
| P14.2 | Плеер для видео | Video player | Встроенный | Built-in |
| P14.3 | Плеер для видео | Video player | 2160 Player | 2160 Player |
| P14.4 | Плеер для видео | Video player | Выбор приложения | App chooser |
| P14.5 | Плеер для видео | Video player | Звук в фоне | Background audio |
| P14.6 | Плеер для видео | Video player | 2160 Player не установлен | 2160 Player is not installed |
| P15 | Настройки сервера | Server settings |  |  |
| P15.1 | Настройки сервера | Server settings | Назад | Back |
| P16 | TorrServer на телефоне | TorrServer on the phone |  |  |
| P16.1 | TorrServer на телефоне | TorrServer on the phone | Назад | Back |
| P17 | Помощь | Help |  |  |
| P17.1 | Помощь | Help | Назад | Back |
| P18 | Установка на телевизор | Install on the TV |  |  |
| P18.1 | Установка на телевизор | Install on the TV | Назад | Back |
| P19 | Журнал | Log |  |  |
| P19.1 | Журнал | Log | Назад | Back |
| P20 | Резервная копия | Backup |  |  |
| P20.1 | Резервная копия | Backup | Назад | Back |
| P21 | Источники поиска | Search sources |  |  |
| P21.1 | Источники поиска | Search sources | Назад | Back |
| P21.2 | Источники поиска | Search sources | FlareSolverr | FlareSolverr |
| P21.3 | Источники поиска | Search sources | Аккаунт | Account |
| P22 | FlareSolverr | FlareSolverr |  |  |
| P22.1 | FlareSolverr | FlareSolverr | Назад | Back |
| P23 | Сайт | Site |  |  |
| P23.1 | Сайт | Site | Назад | Back |
| P24 | Карточка | Title |  |  |
| P24.1 | Карточка | Title | Назад | Back |
| P25 | Сезон | Season |  |  |
| P25.1 | Сезон | Season | Назад | Back |
| P26 | Сериал | Series |  |  |
| P26.1 | Сериал | Series | Назад | Back |
| P26.2 | Сериал | Series | Озвучка | Dub |
| P26.3 | Сериал | Series | Сменить озвучку | Change the dub |
| P26.4 | Сериал | Series | Раздача - Сменить | Release - Change |
| P26.5 | Сериал | Series | Смотреть | Watch |
| P26.6 | Сериал | Series | На ТВ | On the TV |
| P27 | Персона | Person |  |  |
| P27.1 | Персона | Person | Назад | Back |
| P28 | Аудиокниги | Audiobooks |  |  |
| P28.1 | Аудиокниги | Audiobooks | Назад | Back |
| P28.2 | Аудиокниги | Audiobooks | Поиск | Search |
| P28.3 | Аудиокниги | Audiobooks | Мои книги | My books |
| P29 | Поиск аудиокниг | Audiobook search |  |  |
| P29.1 | Поиск аудиокниг | Audiobook search | Назад | Back |
| P30 | Мои книги | My books |  |  |
| P30.1 | Мои книги | My books | Назад | Back |
| P31 | Книга | Book |  |  |
| P31.1 | Книга | Book | Назад | Back |
| P32 | Плеер аудиокниги | Audiobook player |  |  |
| P32.1 | Плеер аудиокниги | Audiobook player | Назад | Back |
| P33 | Нижняя панель | Tab bar |  |  |
| P33.1 | Нижняя панель | Tab bar | Каталог | Library |
| P33.2 | Нижняя панель | Tab bar | Новое | News |
| P33.3 | Нижняя панель | Tab bar | Поиск | Search |
| P33.4 | Нижняя панель | Tab bar | Пульт | Remote |
| P33.5 | Нижняя панель | Tab bar | Настройки | Settings |
| P34 | Обзор | Browse |  |  |
| P34.1 | Обзор | Browse | Мои | Mine |
| P34.2 | Обзор | Browse | Обзор | Browse |
| P34.3 | Обзор | Browse | Сортировка | Sort |
| P34.4 | Обзор | Browse | Поиск | Search |
| P34.5 | Обзор | Browse | Все | All |
| P34.6 | Обзор | Browse | Фильмы | Movies |
| P34.7 | Обзор | Browse | Сериалы | Series |
| P34.8 | Обзор | Browse | Фильтры | Filters |
| PD01 | Язык | Language |  |  |
| PD01.1 | Язык | Language | Как в системе | Follow the system |
| PD01.2 | Язык | Language | Русский | Russian |
| PD01.3 | Язык | Language | English | English |
| PD02 | Меню сериала | Series menu |  |  |
| PD03 | Источники подписки | Subscription sources |  |  |
| PD04 | Подписка | Subscription |  |  |
| PD05 | Лимит подписок | Subscription limit |  |  |
| PD06 | Меню раздачи | Release menu |  |  |
| PD07 | Переименовать | Rename |  |  |
| PD08 | Тачпад | Touchpad |  |  |
| PD09 | Вход на сайт | Site sign-in |  |  |
| PD10 | Дорожки | Tracks |  |  |
| PD11 | Обновление | Update |  |  |
| PD12 | Что нового | What's new |  |  |
| PD13 | Индексатор | Indexer |  |  |
| PD14 | Где смотреть | Where to watch |  |  |
| PD15 | Заставка и титры | Intro and credits |  |  |
| PD16 | Сортировка обзора | Browse sort |  |  |
| PD17 | Фильтры обзора | Browse filters |  |  |
| PD18 | Постер | Poster |  |  |
| PD19 | Хочу посмотреть | Want to watch |  |  |
| PD20 | Заменить на лучшее | Replace with better |  |  |
| PD21 | В лучшем качестве | Better quality |  |  |
| PD22 | Код приставки | Box code |  |  |
| PD23 | Сертификат изменился | Certificate changed |  |  |
| PD24 | Код | Code |  |  |
| PD25 | Поддержать | Support |  |  |
| PD26 | Фильтры | Filters |  |  |
| PD27 | Обновление TorrServer | TorrServer update |  |  |
| PD28 | Переименовать | Rename |  |  |
| PD29 | Другая замена | Another replacement |  |  |
| PD30 | Замена | Replacement |  |  |
| PD31 | Подробнее | Details |  |  |
| PD32 | Продолжить | Resume |  |  |
| PD33 | Источники поиска | Search sources |  |  |
| PD34 | Сортировка поиска | Search sort |  |  |
| PD35 | Установка | Installation |  |  |
| PD36 | Как часто | How often |  |  |
| PD37 | Сменить телевизор | Switch TV |  |  |
| PD38 | Параметр сервера | Server option |  |  |
| PD39 | Ключ TMDB | TMDB key |  |  |
| PD40 | Очистить ключ | Clear the key |  |  |
| PD41 | Сбросить сервер | Reset the server |  |  |
| PD42 | Старая версия на телевизоре | Old version on the TV |  |  |
| PD43 | Знакомство | Tour |  |  |
| PD44 | Первый запуск | First run |  |  |
| PD45 | Удалить выбранное | Delete selected |  |  |
| PD45.1 | Удалить выбранное | Delete selected | Удалить | Delete |
| PD45.2 | Удалить выбранное | Delete selected | Отмена | Cancel |
| PD46 | Удалить сериал | Delete the series |  |  |
| PD46.1 | Удалить сериал | Delete the series | Удалить | Delete |
| PD46.2 | Удалить сериал | Delete the series | Отмена | Cancel |
| PD47 | Удалить подписку | Delete the subscription |  |  |
| PD47.1 | Удалить подписку | Delete the subscription | Удалить | Delete |
| PD47.2 | Удалить подписку | Delete the subscription | Отмена | Cancel |
| PD48 | Удалить раздачу | Delete the release |  |  |
| PD48.1 | Удалить раздачу | Delete the release | Удалить | Delete |
| PD48.2 | Удалить раздачу | Delete the release | Отмена | Cancel |
| PD49 | Удалить раздачу | Delete the release |  |  |
| PD49.1 | Удалить раздачу | Delete the release | Удалить | Delete |
| PD49.2 | Удалить раздачу | Delete the release | Отмена | Cancel |
| PD50 | Очистить журнал | Clear the log |  |  |
| PD50.1 | Очистить журнал | Clear the log | Очистить | Clear |
| PD50.2 | Очистить журнал | Clear the log | Отмена | Cancel |
| PD51 | Выключить телевизор | Turn the TV off |  |  |
| PD51.1 | Выключить телевизор | Turn the TV off | Выключить | Turn off |
| PD51.2 | Выключить телевизор | Turn the TV off | Отмена | Cancel |
| PD52 | Оставить одну раздачу | Keep one release |  |  |
| PD52.1 | Оставить одну раздачу | Keep one release | Оставить | Keep |
| PD52.2 | Оставить одну раздачу | Keep one release | Отмена | Cancel |
| PD53 | Проверка Cloudflare | Cloudflare check |  |  |
| PD53.1 | Проверка Cloudflare | Cloudflare check | Проверить ещё раз | Check again |
| PD53.2 | Проверка Cloudflare | Cloudflare check | Отмена | Cancel |
| PD54 | Вид и сортировка | View and sort |  |  |
| PD55 | Другая раздача | Another release |  |  |
| PD55.1 | Другая раздача | Another release | Найти другую раздачу | Find another release |
| PD56 | Сменить постер | Change poster |  |  |
| A01 | Нативный плеер | Native player |  |  |
| A01.1 | Нативный плеер | Native player | Пауза | Pause |
| A01.2 | Нативный плеер | Native player | Аудио | Audio |
| A01.3 | Нативный плеер | Native player | Субтитры | Subtitles |
| A01.4 | Нативный плеер | Native player | Следующий | Next |
| A01.5 | Нативный плеер | Native player | Пропустить заставку | Skip the intro |
| A01.6 | Нативный плеер | Native player | Следующая серия | Next episode |
| A01.7 | Нативный плеер | Native player | Основное действие ошибки | Error primary action |
| A01.8 | Нативный плеер | Native player | Повторить | Retry |
| A01.9 | Нативный плеер | Native player | Назад | Back |
| A01.10 | Нативный плеер | Native player | Вернуть пропуск | Undo skip |
| A01.11 | Нативный плеер | Native player | Поддержать | Support |
| A01.12 | Нативный плеер | Native player | Инфо | Info |
| AD01 | Меню плеера | Player menu |  |  |
| AD01.1 | Меню плеера | Player menu | Плеер | Player |
| AD01.2 | Меню плеера | Player menu | Аудио | Audio |
| AD01.3 | Меню плеера | Player menu | Субтитры | Subtitles |
| AD01.4 | Меню плеера | Player menu | Ночной звук | Night sound |
| AD01.5 | Меню плеера | Player menu | Инфо | Info |
| AD01.6 | Меню плеера | Player menu | Главы | Chapters |
| AD01.7 | Меню плеера | Player menu | Начало заставки | Intro start |
| AD01.8 | Меню плеера | Player menu | Конец заставки | Intro end |
| AD01.9 | Меню плеера | Player menu | Титры | Credits |
| AD02 | Аудио | Audio |  |  |
| AD03 | Субтитры | Subtitles |  |  |
| AD04 | Главы | Chapters |  |  |
| AD05 | VLC не справляется | VLC is stuck |  |  |
| AD05.1 | VLC не справляется | VLC is stuck | Вернуться к встроенному | Back to the built-in player |
| AD05.2 | VLC не справляется | VLC is stuck | Ждать | Wait |
| AD06 | Проверка Cloudflare | Cloudflare check |  |  |
| AD06.1 | Проверка Cloudflare | Cloudflare check | Пройти на телефоне | Pass it on the phone |
| AD06.2 | Проверка Cloudflare | Cloudflare check | Отметить пультом | Mark it with the remote |
| AD06.3 | Проверка Cloudflare | Cloudflare check | Проверить ещё раз | Check again |
| AD06.4 | Проверка Cloudflare | Cloudflare check | Отмена | Cancel |

## Element codes

Besides the fixed codes above, test mode labels the elements of a screen: posters, cards, list rows, tabs, buttons without their own code, fields and rows. They are counted on the page in screen order, so they follow the library and are meant for a report about what is on screen now.

- `S03.P#4` - the fourth poster on screen S03 (outside any row).
- `S03.R#2` - the second row (shelf, grid or list) on S03. Its label sits just above it.
- `S03.R2.P#4` - the fourth poster in that row. `S03.R2.C#4` is the fourth card in it.
- Inside an open dialog or sheet the dialog code replaces the screen: `D12.L#3`, `PD07.B#1`. While it is open, only its elements are labelled.
- The element labels are blue, fixed codes stay dark. A control with a fixed code (`S05.3`, `P11.19`) gets no element label.
- The size follows the «Размер меток» / "Label size" slider (`S05.30`, `P11.20`). The native Android TV player (`A01`, `AD01`-`AD06`) has fixed codes only and gets the same px value.

| Type | Element (ru) | Element (en) |
| --- | --- | --- |
| `R` | Ряд, полка, сетка или список | Row, shelf, grid or list |
| `P` | Постер или обложка | Poster or cover |
| `C` | Карточка (плитка) | Card (tile) |
| `L` | Строка списка (раздача, файл, серия, результат поиска) | List row (torrent, file, episode, search hit) |
| `T` | Вкладка или чип | Tab or chip |
| `B` | Кнопка без своего кода | Button without its own code |
| `I` | Поле ввода | Input field |
| `G` | Полоса прогресса или перемотки | Progress or seek bar |
