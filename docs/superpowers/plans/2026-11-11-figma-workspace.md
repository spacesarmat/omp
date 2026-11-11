# Figma Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Превратить существующий редактор OMP в Figma-подобную рабочую область с панелью слоёв, управляемым холстом и компактным инспектором.

**Architecture:** Сохранить `DraftController`, iframe и протокол предпросмотра. Добавить независимые компоненты панелей и значков, а состояние масштаба, инструмента и перемещения держать в `App` и `PreviewPane`, не записывая его в документ темы.

**Tech Stack:** Preact 11, TypeScript, CSS Grid, Pointer Events, ResizeObserver, Vitest, jsdom.

**Spec:** `docs/superpowers/specs/2026-11-11-figma-workspace-design.md`

## Global Constraints

- Не добавлять зависимости и не менять модель темы или протокол iframe.
- Не изменять существующие несохранённые исправления автосохранения.
- Не использовать длинное или среднее тире в тексте и коде.
- Не делать коммиты, merge, push или PR без отдельной просьбы Andy.
- Все иконки SVG декоративны, кнопки имеют доступные имена и видимый фокус.

## Review Focus

- Координаты при масштабе: размер артборда должен учитывать `zoom`, чтобы не обрезать iframe и не оставлять неверную область прокрутки. Проверяется в Task 2.
- Ввод в полях: глобальные клавиши не должны срабатывать из `input`, `select`, `textarea` и редактируемого содержимого. Проверяется в Task 2.
- Недоступный `ResizeObserver`: тестовая и старая среда должны сохранить масштаб 100% и рабочие кнопки. Проверяется в Task 2.
- Выбор динамических `nav-*`: панель должна подсвечивать общий слой `sidebar-item`, не теряя фактический выбранный элемент для инспектора. Проверяется в Task 1.
- Недоступные действия: кнопки истории и режимов с `aria-disabled` не должны выполняться по клику или клавиатуре. Проверяется в Task 1 и Task 2.

---

### Task 1: Панели и Figma-компоновка

**Files:**
- Create: `editor/src/components/EditorIcon.tsx`
- Create: `editor/src/components/EditorToolbar.tsx`
- Create: `editor/src/components/LayersPanel.tsx`
- Modify: `editor/src/App.tsx`
- Modify: `editor/src/components/TargetBar.tsx`
- Test: `tests/editor/app.test.tsx`

**Interfaces:**
- Produces: `EditorIcon({ name, size? })`, `EditorToolbar({ label, orientation?, children })`, `LayersPanel({ selected, route, onSelect })`.
- Сохраняет существующие `data-testid` режимов, целевой платформы, экрана, формата, языка и before-after.

- [ ] **Step 1: Написать падающие тесты**

Добавить проверки: отображаются четыре слоя; клик по `data-testid="layer-content"` вызывает `ThemeInspector` с заголовком `Контент`; выбор `nav-library` подсвечивает `sidebar-item`; панель имеет `aria-label="Слои"`, а верхние группы кнопок используют `role="toolbar"`.

- [ ] **Step 2: Запустить тесты и увидеть ожидаемый FAIL**

Run: `npx vitest run tests/editor/app.test.tsx`
Expected: FAIL из-за отсутствия панели слоёв и новых toolbar.

- [ ] **Step 3: Реализовать компоненты и перестроить разметку**

`EditorIcon` рисует небольшой набор inline SVG через `currentColor` и `aria-hidden="true"`. `EditorToolbar` задаёт `role="toolbar"`, `focusgroup`, roving tabindex fallback для стрелок, Home и End. `LayersPanel` строит список из `DESIGN_ELEMENTS`, отображает текущий route и сопоставляет `nav-*` с `sidebar-item`. `App` получает header, контекстную строку и grid из левой панели, холста и правого инспектора. Действия с `aria-disabled="true"` проверяют состояние перед вызовом.

- [ ] **Step 4: Запустить тесты**

Run: `npx vitest run tests/editor/app.test.tsx tests/editor/theme-inspector.test.tsx`
Expected: PASS.

### Task 2: Масштаб, вписывание, перемещение и клавиши

**Files:**
- Create: `editor/src/components/CanvasControls.tsx`
- Modify: `editor/src/App.tsx`
- Modify: `editor/src/components/PreviewPane.tsx`
- Test: `tests/editor/app.test.tsx`

**Interfaces:**
- Produces: `CanvasControls({ zoom, tool, onZoomIn, onZoomOut, onFit, onTool })` с типами `CanvasTool = 'select' | 'hand'`.
- `PreviewPane` дополнительно принимает `zoom: number`, `tool: CanvasTool`, `onZoomChange(zoom: number): void`, `onFitRequested?(): void`.
- Ограничения масштаба: минимум `0.1`, максимум `2.5`, шаг кнопок `1.25`, вписывание с полем `48px` с каждой стороны.

- [ ] **Step 1: Написать падающие тесты**

Проверить кнопки `zoom-in`, `zoom-out`, `zoom-fit`, начальное вписывание по размерам контейнера, `Ctrl/Cmd + Z`, `Ctrl/Cmd + Shift + Z`, `Ctrl/Cmd + 0`, `V` и `H`. Отдельно проверить, что клавиши внутри поля версии не меняют инструмент или историю. Проверить scaled wrapper: при zoom `0.5` для landscape его CSS-размер равен `640px x 360px`, iframe сохраняет `1280 x 720`.

- [ ] **Step 2: Запустить тесты и увидеть ожидаемый FAIL**

Run: `npx vitest run tests/editor/app.test.tsx`
Expected: FAIL из-за отсутствия canvas controls и атрибутов масштаба.

- [ ] **Step 3: Реализовать холст**

`CanvasControls` содержит переключатели select/hand с `aria-pressed`, кнопки масштаба и отображение округлённых процентов. `PreviewPane` использует `ResizeObserver`, если он доступен, для первоначального fit и повторного fit по запросу. Внутренний iframe масштабируется через `transform: scale()`, внешний wrapper получает реальные scaled dimensions. Hand tool перемещает `scrollLeft/scrollTop` через pointer capture, а select не перехватывает события iframe. Глобальные shortcuts пропускают поля ввода и disabled-действия.

- [ ] **Step 4: Запустить тесты**

Run: `npx vitest run tests/editor/app.test.tsx tests/editor/preview-protocol.test.ts`
Expected: PASS. Если отдельного файла протокола нет, запустить только app test, не создавая новый ненужный набор.

### Task 3: Визуальная система и сквозная проверка

**Files:**
- Modify: `editor/src/editor.css`
- Modify: `editor/index.html`
- Modify: `editor/src/components/ThemeInspector.tsx`
- Modify: `editor/src/components/ExportPanel.tsx`
- Modify: `CHANGELOG.md`
- Modify: `CHANGELOG.en.md`

**Interfaces:**
- Consumes: разметка и data-атрибуты Task 1 и Task 2.
- Не меняет публичные интерфейсы компонентов.

- [ ] **Step 1: Применить стили**

Использовать нейтральную палитру Figma, header `48px`, левую панель `240px`, правую `280px`, центральный dotted canvas и артборд с тенью. Добавить `100dvh`, узкие компактные варианты панелей, scrollbar styling, `prefers-reduced-motion`, `forced-colors` и цели не меньше `24px`. Оформить инспектор секциями и сделать export визуально вторичным. Обновить theme-color.

- [ ] **Step 2: Добавить запись в Unreleased**

Добавить один пользовательский пункт о Figma-подобной рабочей области, слоях и масштабе в русский и английский разделы «Не выпущено» / «Unreleased», не перенося чужие записи.

- [ ] **Step 3: Запустить полный набор проверок редактора**

Run: `npm run test:editor && npm run build:editor`
Expected: PASS и успешная Vite-сборка.

- [ ] **Step 4: Проверить реальный сценарий в браузере**

Запустить `npm run editor`, открыть локальный редактор встроенным браузером. Проверить выбор слоя, изменение токена, undo/redo, zoom/fit, hand panning, переключение landscape/portrait и окна 1440px и 900px. Сохранить скриншоты только во временный каталог, не добавлять build output или логи в Git.

- [ ] **Step 5: Проверить итоговый diff**

Run: `git status --short && git diff --check`
Expected: нет whitespace-ошибок, случайных файлов или изменений вне задачи; существующие правки автосохранения сохранены.
