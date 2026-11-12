# Visual Layout Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать все десять функций визуального редактора с гибридным layout и общим preview/production runtime для phone, TV и desktop.

**Architecture:** `ThemeDocument` сохраняет совместимость через optional layout/preset поля. Чистые операции находятся в `design/layout.ts`, стабильная DOM-регистрация и runtime в `design/layoutDom.ts`, редакторские транзакции в `editor/src/layout`. Один runtime применяет экспортированный layout в preview и production, а export обновляет только документированные файлы через manifest.

**Tech Stack:** TypeScript, Preact 11, Vitest, jsdom, существующий Vite editor, DOM Pointer Events и CSS custom properties.

**Spec:** `docs/superpowers/specs/2026-11-11-visual-layout-editor-design.md`

## Global Constraints

- Не добавлять зависимости и не разрешать произвольный CSS, HTML или JavaScript.
- Сохранить `schemaVersion: 1`, старые drafts/snapshots, autosave revisions, rebase и export manifest.
- Production активирует layout только после явного export. Открытие редактора и autosave production не меняют.
- TV: 1080p и 4K выглядят одинаково, текст от 24px кроме тестовых подписей. Нельзя flex `gap`, `aspect-ratio`, `inset`, `:has`.
- Design mode не выполняет реальные actions и не меняет сохранённые настройки. Текстовые поля сохраняют focus и typing.
- Один drag, group edit или paste равен одному undo-шагу.
- Новые тексты используют только дефис. Не запускать deploy или release.
- Полный `npm test` локально на Windows не запускать. Обязательные локальные проверки: точечные тесты, `npm run test:editor`, `npx tsc --noEmit`, `npm run build:editor`, `npm run editor:generate -- --check`, `git diff --check`.

## Review Focus

- Динамический item исчезает и возвращается с тем же data key: placement обязан восстановиться. Проверяется Task 2 тестом `restores layout by data key after a dynamic item remount`.
- Drag при zoom/pan и click по текстовому полю: координаты должны быть точными, реальные настройки не меняются. Проверяется Task 3 тестами координат и capture.
- Locked или удалённый node входит в stale selection: групповое действие пропускает его и очищает selection. Проверяется Task 5 и Task 7.
- TV 4K и safe area: геометрия масштабируется, минимальный шрифт и overflow не теряются. Проверяется Task 10.
- Частичный export при dirty unrelated files: разрешённые файлы обновляются, чужие остаются byte-for-byte. Проверяется Task 11.

---

### Task 1: Layout Schema и чистые операции

**Files:**
- Modify: `design/schema.ts`
- Modify: `design/validation.ts`
- Modify: `design/defaults.ts`
- Create: `design/layout.ts`
- Test: `tests/design/layout.test.ts`
- Test: `tests/design/schema.test.ts`

**Interfaces:**
- Produces: `LayoutContext`, `LayoutContainer`, `LayoutPlacement`, `LayoutDocument`, `StylePreset`.
- Produces: `moveLayoutNode(theme, context, nodeId, parentId, index): ThemeDocument`.
- Produces: `upsertLayoutPlacement(theme, placement): ThemeDocument` и `getLayoutPlacement(theme, context, nodeId): LayoutPlacement | undefined`.

- [ ] **Step 1: Написать failing tests**

Проверить загрузку старой темы без layout, отказ отрицательных размеров/неизвестного mode, перемещение `card-b` на index 0 с результатом `['card-b','card-a']`, absolute placement `{x:40,y:24,anchor:'top-left'}` и изоляцию одинакового nodeId между `portrait` и `landscape`.

- [ ] **Step 2: Запустить RED**

Run: `npx vitest run tests/design/layout.test.ts tests/design/schema.test.ts`
Expected: FAIL, типы и функции layout отсутствуют.

- [ ] **Step 3: Реализовать schema, validation и operations**

`LayoutDocument = { containers: LayoutContainer[]; placements: LayoutPlacement[] }`. `LayoutPlacement` содержит identity, `mode`, координаты, anchor, размеры, zIndex, hidden, locked, label. Добавить optional `theme.layout` и `theme.stylePresets`, строгие лимиты и чистые immutable operations без DOM.

- [ ] **Step 4: Запустить GREEN и полный design suite**

Run: `npx vitest run tests/design`
Expected: все design tests PASS, старые документы не изменились.

- [ ] **Step 5: Commit**

```bash
git add design tests/design
git commit -m "feat: add hybrid layout schema and operations"
```

### Task 2: Стабильная идентичность и общий runtime

**Files:**
- Create: `design/layoutDom.ts`
- Create: `design/generated/layout.ts`
- Modify: `desktop/src/preview/designElements.ts`
- Modify: `src/main.tsx`
- Modify: `mobile/src/main.tsx`
- Modify: `desktop/src/main.tsx`
- Test: `tests/design/layout-dom.test.ts`
- Test: `desktop/tests/layout-runtime.test.ts`

**Interfaces:**
- Consumes: типы и operations из Task 1.
- Produces: `LayoutNodeDescriptor { nodeId, elementId, parentId, label, kind }`.
- Produces: `observeLayout(root, theme, context): () => void`.
- Produces: `observeProductionLayout(root): () => void`, использующий `PRODUCTION_LAYOUT` из `design/generated/layout.ts`.

- [ ] **Step 1: Написать failing tests**

`restores layout by data key after a dynamic item remount`: удалить и вернуть item `hash-1`, проверить сохранение `{mode:'absolute',x:40,y:24}`. Проверить duplicate data key ошибку, source key приоритет, отсутствие layout в default generated runtime и одинаковый order в preview/production fixture.

- [ ] **Step 2: Запустить RED**

Run: `npx vitest run tests/design/layout-dom.test.ts desktop/tests/layout-runtime.test.ts`
Expected: FAIL, `observeLayout` и production adapter отсутствуют.

- [ ] **Step 3: Реализовать registry и runtime**

Приоритет identity: source/data key, зарегистрированный adapter key, детерминированный путь до первого layout. Запретить silent index fallback для незарегистрированных dynamic items. Применять order/placement через DOM observer, сохранять отсутствующие nodes в документе и игнорировать editor-only locks в production.

- [ ] **Step 4: Подключить no-op production entry points**

Вызвать `observeProductionLayout` из трёх entry points с cleanup. Пустой `PRODUCTION_LAYOUT` не должен менять DOM. Preview использует тот же `observeLayout` с текущим draft.

- [ ] **Step 5: Запустить GREEN**

Run: `npx vitest run tests/design/layout-dom.test.ts desktop/tests/layout-runtime.test.ts tests/editor/platform-preview.test.tsx`
Expected: PASS, dynamic remount и inherited theme aliases не сломаны.

- [ ] **Step 6: Commit**

```bash
git add design desktop src mobile tests
git commit -m "feat: add stable layout runtime across platforms"
```

### Task 3: Flow reorder, absolute placement и drag transactions

**Files:**
- Create: `editor/src/layout/transactions.ts`
- Create: `editor/src/components/SelectionOverlay.tsx`
- Create: `editor/src/components/LayoutInspector.tsx`
- Modify: `editor/src/components/PreviewPane.tsx`
- Modify: `editor/src/App.tsx`
- Modify: `editor/src/editor.css`
- Test: `tests/editor/layout-transactions.test.ts`
- Test: `tests/editor/layout-workspace.test.tsx`

**Interfaces:**
- Consumes: `moveLayoutNode`, `upsertLayoutPlacement`, `LayoutNodeDescriptor`.
- Produces: `moveNodeTransaction(controller, args): void` и `placeNodeTransaction(controller, placement): void`.
- Produces: `screenToArtboard(point, iframeRect, viewport, zoom): {x:number;y:number}`.

- [ ] **Step 1: Написать failing tests**

Проверить `screenToArtboard` при zoom 0.5 и scroll offset, insertion `card-b` перед `card-a`, явный flow -> absolute с сохранением rect, absolute -> flow через insertion point, один undo на весь drag и capture без изменения `settings.value`.

- [ ] **Step 2: Запустить RED**

Run: `npx vitest run tests/editor/layout-transactions.test.ts tests/editor/layout-workspace.test.tsx`
Expected: FAIL, transactions и overlay отсутствуют.

- [ ] **Step 3: Реализовать координаты, drag и inspector**

Начинать drag после порога 4px, отличать click от drag, сохранить text editing. Переводить Pointer Events в native artboard coordinates, вызывать controller один раз на commit и показывать insertion/free mode вместо молчаливого переключения.

- [ ] **Step 4: Запустить GREEN**

Run: `npx vitest run tests/editor/layout-transactions.test.ts tests/editor/layout-workspace.test.tsx tests/editor/app.test.tsx`
Expected: PASS, zoom/pan, selection и существующие shortcuts работают.

- [ ] **Step 5: Commit**

```bash
git add editor tests/editor
git commit -m "feat: edit flow order and absolute placement"
```

### Task 4: Resize и визуальный layout inspector

**Files:**
- Modify: `editor/src/components/SelectionOverlay.tsx`
- Modify: `editor/src/components/LayoutInspector.tsx`
- Create: `design/geometry.ts`
- Test: `tests/design/geometry.test.ts`
- Test: `tests/editor/layout-workspace.test.tsx`

**Interfaces:**
- Produces: `resizePlacement(placement, handle, delta, constraints): LayoutPlacement`.
- Produces: `LayoutConstraints { minWidth,maxWidth,minHeight,maxHeight }` и editor `mixed` значения.

- [ ] **Step 1: Написать failing tests**

Для `{x:100,y:80,width:200,height:100}` handle `se` с delta `{x:30,y:-20}` дать `230x80`. Проверить min/max, отрицательные размеры, anchor `bottom-right`, padding/margin поля и один undo на resize.

- [ ] **Step 2: Запустить RED**

Run: `npx vitest run tests/design/geometry.test.ts tests/editor/layout-workspace.test.tsx -t "resize|padding|margin"`
Expected: FAIL, geometry resize отсутствует.

- [ ] **Step 3: Реализовать resize и поля**

Вычислять противоположный anchor от handle, ограничивать размеры документированными constraints и синхронизировать численный inspector с handles.

- [ ] **Step 4: Запустить GREEN**

Run: `npx vitest run tests/design/geometry.test.ts tests/editor/layout-workspace.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add design editor tests
git commit -m "feat: resize layout elements and edit spacing"
```

### Task 5: Multi-select, alignment и distribution

**Files:**
- Create: `editor/src/layout/selection.ts`
- Create: `editor/src/components/MultiSelectInspector.tsx`
- Modify: `editor/src/components/PreviewPane.tsx`
- Modify: `editor/src/components/SelectionOverlay.tsx`
- Test: `tests/editor/selection.test.ts`
- Test: `tests/editor/multi-select.test.tsx`

**Interfaces:**
- Produces: `reduceSelection(state, action): SelectionState`, `SelectionState { ids:string[]; anchorId:string|null }`.
- Produces: `alignPlacements(placements, alignment): LayoutPlacement[]` и `distributePlacements(placements, axis): LayoutPlacement[]`.

- [ ] **Step 1: Написать failing tests**

Проверить Shift add/remove, marquee, `mixed`, align left/center/right и distribute по X трёх элементов. Locked и удалённый node пропускаются, stale ids очищаются, групповое действие создаёт один undo.

- [ ] **Step 2: Запустить RED**

Run: `npx vitest run tests/editor/selection.test.ts tests/editor/multi-select.test.tsx`
Expected: FAIL, selection model отсутствует.

- [ ] **Step 3: Реализовать selection и групповые операции**

Разделить flow container alignment и absolute coordinates, применять одну draft transaction и не менять locked nodes.

- [ ] **Step 4: Запустить GREEN**

Run: `npx vitest run tests/editor/selection.test.ts tests/editor/multi-select.test.tsx tests/editor/layout-workspace.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add editor tests/editor
git commit -m "feat: align and distribute multiple layout elements"
```

### Task 6: Rulers, guides, snapping и safe area

**Files:**
- Create: `editor/src/layout/guides.ts`
- Create: `editor/src/components/Rulers.tsx`
- Modify: `editor/src/components/SelectionOverlay.tsx`
- Modify: `editor/src/editor.css`
- Test: `tests/editor/guides.test.ts`

**Interfaces:**
- Produces: `findSnap(position, movingRects, guides, threshold): SnapResult`.
- Produces: `getSafeArea(target, viewport): Rect` и editor settings для grid/snap.

- [ ] **Step 1: Написать failing tests**

Проверить края/центры, шаг сетки 8px, threshold 6px, `Alt` без snap, zoom-independent screen guides и TV safe area 1920x1080/4K с одинаковой относительной геометрией.

- [ ] **Step 2: Запустить RED**

Run: `npx vitest run tests/editor/guides.test.ts`
Expected: FAIL, guide engine отсутствует.

- [ ] **Step 3: Реализовать guides и rulers**

Считать guides в native artboard coordinates, рендерить их с учётом zoom, подсвечивать safe-area overflow и не использовать запрещённые TV CSS.

- [ ] **Step 4: Запустить GREEN**

Run: `npx vitest run tests/editor/guides.test.ts tests/editor/layout-workspace.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add editor tests/editor
git commit -m "feat: add layout rulers guides and snapping"
```

### Task 7: Операции слоёв и clipboard

**Files:**
- Create: `editor/src/layout/layerOperations.ts`
- Modify: `editor/src/components/LayersPanel.tsx`
- Modify: `editor/src/App.tsx`
- Test: `tests/editor/layer-operations.test.ts`
- Test: `tests/editor/layers-panel.test.tsx`

**Interfaces:**
- Produces: `duplicateNode`, `setNodeHidden`, `setNodeLocked`, `renameNode`, `copyNodes`, `pasteNodes`.
- Produces: `LayoutClipboard {schemaVersion:1;nodes:...}` с лимитами и новым UUID при paste.

- [ ] **Step 1: Написать failing tests**

Проверить duplicate с новым id, hidden выбор только через LayersPanel, locked запрет изменений, поиск/фильтры, copy/paste между страницами без action/nodeId, очистку stale selection и undo всех операций.

- [ ] **Step 2: Запустить RED**

Run: `npx vitest run tests/editor/layer-operations.test.ts tests/editor/layers-panel.test.tsx`
Expected: FAIL, operations отсутствуют.

- [ ] **Step 3: Реализовать operations и LayersPanel**

Показывать все layout-only nodes, добавить rename/hide/lock/duplicate, поиск и фильтры. Валидировать clipboard по схеме и показывать несовместимости до сохранения.

- [ ] **Step 4: Запустить GREEN**

Run: `npx vitest run tests/editor/layer-operations.test.ts tests/editor/layers-panel.test.tsx tests/editor/app.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add editor tests/editor
git commit -m "feat: manage layout layers and clipboard"
```

### Task 8: Copy/Paste Style и библиотека tokens

**Files:**
- Create: `editor/src/layout/styleOperations.ts`
- Create: `editor/src/components/TokenLibrary.tsx`
- Modify: `editor/src/components/ThemeInspector.tsx`
- Test: `tests/editor/style-operations.test.ts`
- Test: `tests/editor/token-library.test.tsx`

**Interfaces:**
- Produces: `copyStyle`, `pasteStyle`, `resetStyleProperty`, `applyStylePreset`, `findTokenUsages`.
- Consumes: `StylePreset` из Task 1 и существующий `buildOverride`.

- [ ] **Step 1: Написать failing tests**

Проверить перенос tokens без nodeId/action, сброс одного свойства, явный список несовместимых свойств между платформами, поиск token usage, preset apply и обновление использований только по явной команде.

- [ ] **Step 2: Запустить RED**

Run: `npx vitest run tests/editor/style-operations.test.ts tests/editor/token-library.test.tsx`
Expected: FAIL, style operations отсутствуют.

- [ ] **Step 3: Реализовать style operations и TokenLibrary**

Использовать только разрешённые tokens и один override/undo на операцию. Не создавать неявных обратных ссылок preset -> overrides.

- [ ] **Step 4: Запустить GREEN**

Run: `npx vitest run tests/editor/style-operations.test.ts tests/editor/token-library.test.tsx tests/editor/theme-inspector.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add editor tests/editor
git commit -m "feat: reuse styles and design token presets"
```

### Task 9: Compare Workspace

**Files:**
- Create: `editor/src/components/CompareWorkspace.tsx`
- Modify: `editor/src/App.tsx`
- Modify: `editor/src/components/PreviewPane.tsx`
- Modify: `editor/src/editor.css`
- Test: `tests/editor/compare-workspace.test.tsx`

**Interfaces:**
- Produces: `CompareView {id,target,format,language}` и `compareSelection` по `data-layout-node`.
- Consumes: существующие lazy previews и `PreviewConfiguration`.

- [ ] **Step 1: Написать failing tests**

Открыть desktop/phone/TV одновременно, проверить независимые target/format/language, синхронный node/state, отсутствие изменения compare views при редактировании основного view и корректный fixture cleanup.

- [ ] **Step 2: Запустить RED**

Run: `npx vitest run tests/editor/compare-workspace.test.tsx`
Expected: FAIL, compare component отсутствует.

- [ ] **Step 3: Реализовать compare**

Использовать один controller/draft, отдельные sessionId и view state. Не дублировать network fixtures между frames и не перезагружать общий черновик.

- [ ] **Step 4: Запустить GREEN**

Run: `npx vitest run tests/editor/compare-workspace.test.tsx tests/editor/platform-preview.test.tsx tests/editor/preview-main.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add editor tests/editor
git commit -m "feat: compare platform layouts side by side"
```

### Task 10: Доступность и геометрические проверки

**Files:**
- Create: `design/layout-checks.ts`
- Create: `editor/src/components/AccessibilityPanel.tsx`
- Modify: `editor/src/components/ExportPanel.tsx`
- Test: `tests/design/layout-checks.test.ts`
- Test: `tests/editor/accessibility-panel.test.tsx`

**Interfaces:**
- Produces: `checkLayoutAccessibility(snapshot, theme): LayoutIssue[]`.
- Produces: `LayoutIssue {code,nodeId,severity:'warning'|'error',message}` и `GeometrySnapshot` из реальных computed styles/rects.

- [ ] **Step 1: Написать failing tests**

Проверить контраст, focus indication, font 24px TV, target size, overflow, overlap интерактивных nodes, safe area 1080p/4K и явное подтверждение geometry warnings перед export.

- [ ] **Step 2: Запустить RED**

Run: `npx vitest run tests/design/layout-checks.test.ts tests/editor/accessibility-panel.test.tsx`
Expected: FAIL, checks отсутствуют.

- [ ] **Step 3: Реализовать checks и панель**

Проверки получают реальные стили/rects, не вычисляют геометрию из текста. Существующие blocking rules остаются, geometry warnings требуют явного подтверждения.

- [ ] **Step 4: Запустить GREEN**

Run: `npx vitest run tests/design/layout-checks.test.ts tests/editor/accessibility-panel.test.tsx tests/editor/export-panel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add design editor tests
git commit -m "feat: validate accessible layout geometry"
```

### Task 11: Scoped diff export и production activation

**Files:**
- Modify: `editor/export.mjs`
- Modify: `editor/export.d.mts`
- Modify: `editor/src/components/ExportPanel.tsx`
- Modify: `editor/src/client.ts`
- Modify: `editor/server.mjs`
- Modify: `design/generate.ts`
- Test: `tests/editor/export-layout.test.ts`
- Test: `tests/editor/export-panel.test.tsx`

**Interfaces:**
- Produces: `createExportPlan(draft, scope): ExportPlan` и `createExportDiff(root, plan): Promise<ExportDiff>`.
- `ExportScope = {kind:'all'} | {kind:'page';screenId:string} | {kind:'component';nodeId:string}`.
- `ExportPlan` содержит validated files, production layout generated module и затронутые targets.

- [ ] **Step 1: Написать failing tests**

Проверить all/page/component diff, список targets, dirty unrelated file без изменений, отсутствие удаления других scopes, manifest repeat export, stale base и production generated layout идентичный preview.

- [ ] **Step 2: Запустить RED**

Run: `npx vitest run tests/editor/export-layout.test.ts tests/editor/export-panel.test.tsx`
Expected: FAIL, scoped export отсутствует.

- [ ] **Step 3: Реализовать plan/diff/export**

Сохранить baseCommit, manifest ownership, process lock и safePath. Генерировать layout только из validated data, активировать production через документированный generated module и не менять runtime при autosave.

- [ ] **Step 4: Запустить GREEN**

Run: `npx vitest run tests/editor/export-layout.test.ts tests/editor/export-panel.test.tsx tests/editor/export.test.ts tests/editor/export-manifest.test.ts`
Expected: PASS.

- [ ] **Step 5: Запустить production и generated проверки**

Run: `npm run editor:generate -- --check && npm run build && npm run build:mobile && npm run build:desktop`
Expected: все команды exit 0. Полный `npm test` не запускать на Windows.

- [ ] **Step 6: Commit**

```bash
git add design editor tests src mobile desktop
git commit -m "feat: export reviewed layouts into production"
```

### Task 12: Документация и полное acceptance

**Files:**
- Modify: `docs/editor-guide.md`
- Modify: `docs/desktop-cross-platform.md`
- Modify: `CHANGELOG.md`
- Modify: `CHANGELOG.en.md`
- Modify: `AGENTS.md` только если карта проекта или команды изменились
- Test: `docs/manual-checks.md` только если проект требует обновления существующего сценария

**Interfaces:**
- Consumes: все предыдущие public UI и export interfaces.

- [ ] **Step 1: Обновить краткую и полную инструкцию**

Описать flow/absolute, resize, multi-select, guides, layers, style/token tools, compare, warnings, scoped diff export и активацию production. Сохранить быстрый запуск `npm run editor` и предупреждение о local token.

- [ ] **Step 2: Запустить полный editor regression**

Run: `npm run test:editor && npx tsc --noEmit && npm run build:editor && npm run editor:generate -- --check`
Expected: все команды exit 0 без unhandled errors.

- [ ] **Step 3: Проверить production builds и formatting**

Run: `npm run build && npm run build:mobile && npm run build:desktop && git diff --check`
Expected: все builds exit 0, diff check чистый.

- [ ] **Step 4: Выполнить браузерный acceptance**

Проверить phone portrait/landscape, desktop 1280x720, TV 1920x1080 и 4K: flow reorder, absolute drag, resize, multi-select, guides, layers, styles, tokens, compare, accessibility и export diff. Зафиксировать результат в PR, не создавать непрошенных screenshot/report файлов.

- [ ] **Step 5: Провести финальное ревью и создать PR**

Проверить весь diff, исправить Critical/Important findings, повторить зелёные проверки, создать один PR в `main` и дождаться `build`, `android`, `billing`, desktop smoke и Greptile. Не вливать без явного разрешения Andy.

- [ ] **Step 6: Commit**

```bash
git add docs CHANGELOG.md CHANGELOG.en.md AGENTS.md
git commit -m "docs: explain visual layout editing and export"
```
