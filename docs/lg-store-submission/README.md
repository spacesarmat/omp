# OMP - LG Content Store: материалы подачи

Материалы для подачи store-сборки OMP (плеер своего TorrServer без публичного поиска) в LG Content Store. Сборка влита (#439), план/оценка - docs/lg-content-store.md (#437). Seller-аккаунт у Andy уже есть.

## Состав
- `description.md` - название, короткое и полное описание (ru/en). Честное позиционирование: плеер своего TorrServer, без публичного поиска.
- `privacy-policy.md` - политика конфиденциальности (ru/en) по фактическому поведению кода. Публичные URL: https://omp-player.online/privacy и https://omp-player.online/privacy/en.
- `qa-instructions.md` - инструкция тестировщику LG: стенд TorrServer + тестовый контент + что проверить.
- `screenshots/` - скриншоты ТВ-интерфейса store-сборки (каталог, плеер; без поиска).

## Готово
- Описания ru/en.
- Политика конфиденциальности (ru/en) и постоянный URL https://omp-player.online/privacy (English: https://omp-player.online/privacy/en). Контакт поддержки: ompplayerandroid@gmail.com и те же Telegram, что уже в подвале сайта.
- QA-инструкция.

## Нужно от Andy / доделать перед подачей
- Создать приложение в LG Seller Lounge -> уточнит точные требования: размеры иконок/скриншотов, число скриншотов, app id, категория, обязательные поля, возрастной рейтинг. Под них подогнать ассеты.
- Политика конфиденциальности: URL для листинга Seller Lounge - https://omp-player.online/privacy (English: https://omp-player.online/privacy/en). Контакт на странице: ompplayerandroid@gmail.com, плюс адреса из подвала сайта (группа https://t.me/ompgplayerroup, канал https://t.me/ompplyaer, бот https://t.me/OMPBILLINGBOT). Текст вычитать перед подачей. Страница в репозитории; на домене она появится после деплоя site/ и обоих Caddyfile (деплой отдельно, по согласованию).
- Решить: оставить ли диагностику в store-сборке (сейчас как в обычной, отключаемая). Если хотим «без сбора данных» - отключить диагностику в store-сборке отдельным фиксом и упростить политику.
- Иконки требуемых размеров (исходники webos/icon.png, largeIcon.png, assets/logo.svg).
- Финальный пакет: `npm run package:store` (ipk, id com.spacesarmat.torrplayer) - собрать под требования Seller Lounge.
- Подать на ревью LG; ответы на замечания - вместе.

## Примечание по коду
Store-сборка гейтит рендер поиска/discovery, но сам код поиска остаётся в бандле (не tree-shake). Если ревью LG придерётся к presence мёртвого кода - вынести экраны поиска в условный lazy-import (отдельный фикс).