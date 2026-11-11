# Phone and TV Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Подключить реальные Android phone, Android TV и LG webOS экраны к редактору с независимыми темами и изолированными fixtures.

**Architecture:** Общий `DesignTarget` и platform route registry выбирают отдельные preview-компоненты. Production App не запускается. Смена target перемонтирует iframe и очищает глобальные стили.

**Tech Stack:** Preact 11, TypeScript, CSS custom properties, Vitest, jsdom.

**Spec:** `docs/superpowers/specs/2026-11-11-phone-tv-preview-design.md`

## Global Constraints

- Не запускать production App, нативные сервисы или реальные сетевые запросы.
- Не добавлять зависимости и не менять существующие route IDs.
- TV использует только 1920x1080; phone portrait 720x960, landscape 960x720.
- Phone и TV показывают только `legacy-page` до следующего этапа внутренних компонентов.
- Не делать коммиты, merge, push или PR без отдельной просьбы Andy.

## Review Focus

- Смена `news` на Android TV должна выбрать допустимый `settings`, а не оставить неподдерживаемый маршрут. Проверяется в Task 1.
- Phone и TV не должны показывать desktop `sidebar` или `content`. Проверяется в Task 1 единственным `legacy-page`.
- Android TV и LG должны различаться через `platformKind` и восстанавливать прежнее значение после unmount. Проверяется в Task 2.
- Внешние fetch/XHR блокируются, same-origin сохраняется, cleanup восстанавливает API. Проверяется в Task 2.
- Смена target перемонтирует iframe, а TV viewport всегда 1920x1080. Проверяется в Task 1.

---

### Task 1: Общие цели, маршруты и слои

**Files:**
- Create: `editor/shared/routes.ts`
- Modify: `editor/shared/draft.ts`
- Modify: `editor/src/components/TargetBar.tsx`
- Modify: `editor/src/components/LayersPanel.tsx`
- Modify: `editor/src/App.tsx`
- Modify: `design/catalog.ts`
- Modify: `design/theme.ts`
- Modify: `design/theme-checks.ts`
- Modify: `design/interaction.ts`
- Modify: `desktop/src/shell/DesktopShell.tsx`
- Modify: `desktop/src/shell/DesktopSettingsScreen.tsx`
- Modify: `desktop/src/preview/DesktopPreview.tsx`
- Modify: `desktop/src/preview/previewRoutes.tsx`
- Modify: `editor/src/preview/protocol.ts`
- Test: `tests/editor/routes.test.ts`
- Test: `tests/editor/app.test.tsx`
- Test: `tests/editor/drafts.test.ts`

**Interfaces:**
- `EditorPage { id: DesktopRouteId, label: string, labelEn: string }`.
- `getEditorPages(target: DesignTarget): EditorPage[]`.
- `getEditorViewport(target: DesignTarget, format: DesignFormat): { width: number, height: number }`.
- `isEditorRoute(target: DesignTarget, route: string): route is DesktopRouteId`.
- `isDesignElementAvailable(id, screenId, target = 'desktop-windows')`.
- `getDefaultElementId(target: DesignTarget): 'content' | 'legacy-page'`.

- [ ] **Step 1: Написать failing tests**

Проверить шесть целей, шесть phone- и четыре TV-страницы, viewport, draft phone/TV, смену `news` на Android TV с переходом на `settings`, TV 1920x1080 и перемонтирование iframe. Проверить один `legacy-page` вместо desktop-слоёв.

- [ ] **Step 2: Запустить RED**

Run: `npx vitest run tests/editor/routes.test.ts tests/editor/app.test.tsx tests/editor/drafts.test.ts -t "target|platform|viewport|draft"`
Expected: FAIL из-за отсутствия registry и desktop-only типов.

- [ ] **Step 3: Реализовать общие типы и выбор страницы**

`EditorDraft.target` становится `DesignTarget`, парсинг проверяет маршрут через registry. `TargetBar` использует `DESIGN_TARGETS` и `getEditorPages`. `App` вычисляет допустимый screen при смене target, сбрасывает selection через `getDefaultElementId` и передаёт target в `LayersPanel`. `ThemeContext`, `DesignIssue` и `InteractionContext` переходят на `DesignTarget`.

- [ ] **Step 4: Запустить проверки Task 1**

Run: `npx vitest run tests/editor/routes.test.ts tests/editor/app.test.tsx tests/editor/drafts.test.ts`
Expected: PASS.

### Task 2: Изолированные PhonePreview и TvPreview

**Files:**
- Create: `desktop/src/preview/PhonePreview.tsx`
- Create: `desktop/src/preview/TvPreview.tsx`
- Modify: `desktop/src/preview/fixtures.ts`
- Modify: `src/platform/env.ts`
- Modify: `editor/src/preview/main.tsx`
- Modify: `editor/src/components/PreviewPane.tsx`
- Test: `tests/editor/platform-preview.test.tsx`
- Test: `desktop/tests/fixtures.test.ts`

**Interfaces:**
- `setPreviewPlatformKind(kind: PlatformKind | null): () => void` возвращает restore.
- `PhonePreview` и `TvPreview` принимают те же props, что `DesktopPreview`.
- Оба адаптера имеют `data-design-id="legacy-page"` и применяют overrides через `designOverrideAttrs`.

- [ ] **Step 1: Написать failing tests**

Для phone проверить каждый из шести маршрутов и активный override. Для TV проверить четыре маршрута, `platformKind` androidtv/webos и restore. Для fixtures проверить внешний fetch 503, внешний XHR rejected до сети, same-origin вызов прежнего API и cleanup.

- [ ] **Step 2: Запустить RED**

Run: `npx vitest run tests/editor/platform-preview.test.tsx desktop/tests/fixtures.test.ts`
Expected: FAIL из-за отсутствия адаптеров и platform override.

- [ ] **Step 3: Реализовать адаптеры и изоляцию**

`PhonePreview` рендерит реальные mobile экраны с aliases. `TvPreview` регистрирует `tvCatalog`, устанавливает platform override, инициализирует spatial navigation и рендерит реальные TV экраны с aliases. Fixture устанавливается до дочерних effects. `PreviewRoot` выбирает адаптер по target. `PreviewPane` получает key `${target}-${language}` и сбрасывает loaded при смене target.

- [ ] **Step 4: Запустить проверки Task 2**

Run: `npx vitest run tests/editor/platform-preview.test.tsx desktop/tests/fixtures.test.ts tests/editor/preview-main.test.tsx tests/editor/protocol.test.ts`
Expected: PASS.

### Task 3: Экспорт и сквозная проверка

**Files:**
- Modify: `design/generate.ts`
- Modify: `tests/design/theme.test.ts`
- Modify: `tests/editor/export.test.ts`
- Modify: `CHANGELOG.md`
- Modify: `CHANGELOG.en.md`

- [ ] **Step 1: Обновить экспортные ожидания и сгенерировать CSS**

Сначала изменить тесты на шесть generated-файлов и увидеть FAIL, затем использовать `DESIGN_TARGETS` в `design/generate.ts`. Запустить `npm run editor:generate` один раз для создания версионированных CSS.

- [ ] **Step 2: Добавить Unreleased-записи**

Один `[tech]` пункт на русском и английском о phone/TV preview и независимых темах.

- [ ] **Step 3: Запустить стандартные проверки**

Run: `npm run test:editor && npx tsc --noEmit && npm run build:editor && npm run editor:generate -- --check`
Expected: все 97 и новые тесты PASS, TypeScript, сборка и generated check PASS.

- [ ] **Step 4: Проверить браузер и diff**

Проверить phone portrait/landscape, Android TV и LG webOS, различие экранов, `legacy-page` edit и отсутствие сетевых ошибок. Затем `git diff --check && git status --short`, без случайных файлов.
