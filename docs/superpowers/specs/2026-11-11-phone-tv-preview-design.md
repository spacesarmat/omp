# Phone и TV preview для редактора OMP

## Назначение

Подключить реальные phone и TV экраны к редактору тем, не запуская production App с фоновыми процессами, сетевыми запросами и нативными побочными эффектами.

## Подходы

1. Выбрано: отдельные `PhonePreview` и `TvPreview` над существующими экранами, общий реестр маршрутов и `DesignTarget`. Это сохраняет изоляцию fixtures и позволяет использовать реальные компоненты.
2. Отклонено: рендер `mobile/src/app` и `src/app` целиком. Они запускают обновления, мониторинг, нативные мосты и фоновые таймеры, которые не нужны редактору.
3. Отклонено: статические HTML-макеты. Они не доказывают совместимость темы с реальными экранами.

## Маршруты и viewport

- Desktop: существующие шесть маршрутов и 1280x720 или 720x960.
- Android phone: `library`, `news`, `search`, `remote`, `settings`, `connect`. Portrait 720x960, landscape 960x720.
- Android TV и LG webOS: `library`, `search`, `settings`, `connect`. Всегда логический viewport 1920x1080. Portrait-режим для TV не предлагать.

## Типы и реестр

- `EditorDraft.target` расширяется до `DesignTarget`, `screenId` остаётся совместимым набором строк.
- Новый `editor/shared/routes.ts` возвращает страницы и viewport по платформе и проверяет допустимость маршрута.
- При смене платформы неподдерживаемый маршрут заменяется на `settings`; выбранный шаблон сбрасывается на `content`.
- `TargetBar` показывает все шесть целей и только маршруты активной платформы.

## Preview

`PreviewRoot` выбирает адаптер по `config.target`:

- desktop: существующий `DesktopPreview`.
- phone: реальные `Library`, `News`, `Add`, `Remote`, `Settings`, `Connect` из `mobile/src`.
- TV: реальные `LibraryScreen`, `AddScreen`, `SettingsScreen`, `ConnectScreen` из `src`.

Оба новых адаптера:

- используют `installPreviewFixture` и блокируют реальную сеть;
- применяют `generateThemeCss` и `designOverrideAttrs`;
- имеют стабильный `data-design-id="legacy-page"`;
- поддерживают выбор элемента и сообщения редактора;
- не запускают production App и его фоновые сервисы.

TV CSS использует логический 1920x1080. Пространственная навигация инициализируется только внутри TV preview.

## Темы и экспорт

- `ThemeContext`, `DesignIssue` и `InteractionContext` используют общий `DesignTarget`.
- `generateThemeCss` работает для всех шести целей.
- `design/generate.ts` создаёт CSS для `DESIGN_TARGETS`, не только desktop.
- Mobile aliases: `--bg`, `--panel`, `--panel-2`, `--accent`, `--text`, `--muted`.
- TV aliases: `--bg`, `--panel`, `--panel2`, `--accent`, `--text`, `--muted`, `--danger`.
- Вторичные поверхности вычисляются через `color-mix` с прежним fallback.

## Ограничения этапа

- Это preview и редактирование общего шаблона, а не разметка всех внутренних компонентов.
- Логика остаётся только для desktop-настроек.
- TV portrait не добавляется искусственно.
- Нативный плеер, обновления, биллинг и фоновые процессы не запускаются.

## Решения после проверки исполнителя

- `src/platform/env.ts` получает явный preview override с функцией восстановления. `TvPreview` устанавливает `androidtv` или `webos` на время монтирования, поэтому ветки экранов соответствуют выбранной цели без подделки `window.Capacitor`.
- `installPreviewFixture` дополнительно оборачивает fetch и XHR open. Same-origin запросы сохраняются, внешний fetch получает Response 503, внешний XHR отклоняется до сети. Прежние функции восстанавливаются при cleanup.
- `TvPreview` регистрирует существующий `tvCatalog`, а не оставляет экраны без catalog provider.
- Панель шаблонов использует `DesignTarget`: desktop показывает существующие shared/route-specific слои, phone и TV только `legacy-page`. Сброс выбора для phone/TV выполняется на `legacy-page`, не на несуществующий `content`.
- `PreviewPane` перемонтирует iframe при смене `target`. Это полностью очищает документ от mobile и TV global CSS и исключает конфликт `html`, `body`, `:root` между платформами.

## Проверка

- Тесты реестра целей, маршрутов и viewport.
- Тесты смены платформы и сброса неподдерживаемой страницы.
- Тесты реального рендера phone и TV адаптеров, override attrs и отсутствия production side effects.
- `npm run test:editor`, `npx tsc --noEmit`, `npm run build:editor`, `npm run editor:generate -- --check`.
- Браузер: phone portrait/landscape, Android TV и LG webOS 1920x1080, выбор и изменение шаблона, возврат значений.
