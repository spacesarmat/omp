# OMP - LG Content Store: материалы подачи

Материалы для подачи store-сборки OMP (плеер своего TorrServer без публичного поиска) в LG Content Store. Сборка влита (#439), план/оценка - docs/lg-content-store.md (#437). Seller-аккаунт у Andy уже есть.

Поддержка во всех материалах: ompplayerandroid@gmail.com. Политика для листинга: https://omp-player.online/privacy (English: https://omp-player.online/privacy/en).

## Состав
- `description.md` - название, короткое и полное описание (ru/en). Честное позиционирование: плеер своего TorrServer, без публичного поиска.
- `privacy-policy.md` - политика конфиденциальности (ru/en), тот же текст, что на сайте.
- `qa-instructions.md` - инструкция тестировщику LG: стенд TorrServer + тестовый контент + что проверить.
- `self-checklist.md` - черновик Self Checklist по пунктам LG. Пункты, которые нельзя закрыть без телевизора, помечены «проверить на ТВ».
- `ux-scenario.md` - UX Scenario на английском, чтобы вставить в шаблон LG.
- `screenshots/` - скриншоты ТВ-интерфейса store-сборки. Лупа в каталоге - поиск по названиям медиатеки (`Поиск`), не поиск раздач. Кнопки «Найти раздачу» на этих кадрах нет.

## requiredACG
Поле пишется только в appinfo store-ipk (`scripts/store-appinfo.mjs`, `npm run package:store`). В `webos/appinfo.json` его нет: на webOS TV 26 заполненное поле включает проверку ACG, а обычная сборка по-прежнему открывает Homebrew Channel и Developer Mode.

Гайд: https://webostv.developer.lge.com/develop/guides/acg-guide. Вызовы телефона по SSAP в этот ipk не входят. webOSTV.js не используется. `PalmSystem.launchParams` и `PalmSystem.activate` - не вызовы Luna.

| Вызов | Модуль | Store-сборка | Группа ACG |
| --- | --- | --- | --- |
| `luna://com.webos.service.connectionmanager/getStatus` | `src/api/discovery.ts` | остаётся: IPv4 телевизора для поиска TorrServer в сети | `network.query`. В гайде тот же метод у `com.palm.connectionmanager/getStatus` |
| `luna://com.webos.media/selectTrack` | `src/platform/webosMedia.ts` | остаётся: дорожка звука или субтитров, если у `<video>` нет HTML-списка | в публичном списке группы нет, имя не выдумываем |
| `luna://com.webos.media/setSubtitleEnable` | `src/platform/webosMedia.ts` | остаётся: включить или выключить субтитры тем же запасным путём | в публичном списке группы нет |
| `luna://com.webos.settingsservice/getSystemSettings` | `src/platform/deviceName.ts` | убран: в шапке запасное имя «LG webOS TV» | `settings.query`, не запрашиваем |
| `luna://com.webos.applicationManager/launch` | `src/platform/devmode.ts`, `src/platform/hbchannel.ts` | убран из бандла (alias на пустые модули) | `application.launcher`, не запрашиваем |
| `luna://com.webos.applicationManager/getAppInfo` | `src/platform/hbchannel.ts` | убран | в списке нет (`getAppLoadStatus` - это `application.query`) |
| `luna://org.webosbrew.hbchannel.service/*` | `src/platform/hbchannel.ts` | убран | не сервис LG |

Итог в ipk: `"requiredACG": ["network.query"]`.

`splashBackground` и `bgImage` в appinfo не заданы, отдельных файлов заставки и фона лаунчера нет. Иконки ipk (`icon.png` 80x80, `largeIcon.png` 130x130) непрозрачные, фон `#181B22`.

Обычная сборка (не store) эти вызовы не теряет.

## Готово
- Описания ru/en, контакт поддержки, URL политики.
- Политика: в store-сборке диагностика и отчёты о сбоях выключены, пока их не включат. Статистика ранжирования из store-сборки не уходит. Текст страницы в `ops/vps/site/privacy/` совпадает. На домене страница сменится после деплоя site/ (отдельно, по согласованию).
- QA-инструкция, черновик Self Checklist, черновик UX Scenario.
- Иконки без прозрачных углов. `npm run package:store` падает, если в бандле остались строки Homebrew Channel / Developer Mode / settingsservice или если `ares-package` предупредил про пустой `requiredACG`.

## Нужно от Andy / доделать перед подачей
- Проверить на ТВ (webOS 26, где ACG уже можно включить, и на обычном webOS 4+): поиск TorrServer по сети не получает Denied; переключение дорожки через `com.webos.media` всё ещё работает, когда HTML-списка нет; имя в шапке - «LG webOS TV»; нет кнопок Homebrew Channel и «Продлить режим»; Back с каталога возвращает на Home; лупа фильтрует медиатеку.
- Создать приложение в LG Seller Lounge и подогнать число и размер скриншотов, категорию и возрастной рейтинг под форму.
- Вычитать политику. Деплой обновлённой страницы - отдельно.
- Подать на ревью LG; ответы на замечания - вместе.

## Примечание по коду
Store-сборка по-прежнему оставляет в бандле часть кода публичного поиска (экраны не открываются). Вызовы Homebrew Channel и Developer Mode из бандла убраны.