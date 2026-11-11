# All Desktop Pages and Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сделать все шесть desktop-страниц и их реально существующие шаблоны доступными для редактирования темы.

**Architecture:** Использовать существующие `DESKTOP_ROUTES`, `DESIGN_ELEMENTS` и `designOverrideAttrs`. Legacy-страницы получают единый стабильный `legacy-page` wrapper, который связывает mobile custom properties с OMP-токенами в общем desktop CSS.

**Tech Stack:** Preact 11, TypeScript, CSS custom properties, Vitest, jsdom.

**Spec:** `docs/superpowers/specs/2026-11-11-all-pages-templates-design.md`

## Global Constraints

- Не добавлять зависимости, токены, поля схемы или произвольный CSS.
- Не менять чужие несохранённые исправления автосохранения.
- Не заявлять готовую поддержку Android phone, Android TV или LG webOS.
- Не делать коммиты, merge, push или PR без отдельной просьбы Andy.
- Использовать только дефис в новых текстах.

## Review Focus

- Переход из logic настройки на theme-страницу должен вернуть design. Проверяется в Task 1 тестом смены маршрута из режима logic.
- `connect` не находится в главном меню, но обязан быть доступен в редакторе. Проверяется в Task 1 отдельным выбором `page-connect`.
- После смены страницы старый route-specific элемент не должен остаться выбранным. Проверяется в Task 1 сбросом на `content`.
- Override `legacy-page` должен применяться только к своему экрану и появляться на всех пяти legacy-маршрутах. Проверяется в Task 2 через `data-design-overrides` и контекст маршрута.
- `server-card` должен принимать overrides, а не только иметь каталожную запись. Проверяется в Task 2 атрибутом на реальной карточке настроек.

---

### Task 1: Все страницы в реестре и редакторе

**Files:**
- Modify: `desktop/src/shell/routes.ts`
- Modify: `editor/src/components/TargetBar.tsx`
- Modify: `editor/src/components/LayersPanel.tsx`
- Modify: `editor/src/App.tsx`
- Test: `desktop/tests/shell.test.tsx`
- Test: `tests/editor/app.test.tsx`
- Test: `tests/editor/theme-inspector.test.tsx`

**Interfaces:**
- `LayersPanel` дополнительно принимает `onNavigate(route: DesktopRouteId): void` и создаёт кнопки `data-testid="page-${route.id}"`.
- `DESKTOP_SCREEN_SUPPORT`: `settings: logic`, остальные пять маршрутов: `theme`.
- Смена `screenId` сбрасывает выбранный элемент на `content`; маршрут ниже `logic` принудительно включает `design`.

- [ ] **Step 1: Написать падающие тесты**

Проверить поддержку `theme` для всех legacy-маршрутов, шесть кнопок страниц, присутствие `connect` в `TargetBar`, переход по `page-connect`, сброс выбора и возврат из logic в design. Обновить ожидание настроек с четырёх до пяти шаблонов после добавления `server-card` в Task 2 только в Task 2, не заранее.

- [ ] **Step 2: Запустить тесты и увидеть FAIL**

Run: `npx vitest run desktop/tests/shell.test.tsx tests/editor/app.test.tsx -t "pages|support|logic|connect"`
Expected: FAIL из-за старого уровня `preview` и отсутствия кнопок страниц.

- [ ] **Step 3: Реализовать реестр и навигацию**

`TargetBar` перестаёт фильтровать `menu`. `LayersPanel` показывает `DESKTOP_ROUTES` отдельной группой и вызывает `onNavigate`. `App` передаёт `setView`, сбрасывает selection и mode по правилам интерфейса. `ThemeInspector` сохраняет защиту для будущих preview-маршрутов, но текущие маршруты в неё не попадают.

- [ ] **Step 4: Запустить проверки Task 1**

Run: `npx vitest run desktop/tests/shell.test.tsx tests/editor/app.test.tsx tests/editor/theme-inspector.test.tsx -t "^(?!.*shows a failed save).*$"`
Expected: PASS с учётом заранее известного excluded baseline.

### Task 2: Шаблоны и реальное применение токенов

**Files:**
- Modify: `design/catalog.ts`
- Modify: `desktop/src/preview/previewRoutes.tsx`
- Modify: `desktop/src/shell/DesktopSettingsScreen.tsx`
- Modify: `desktop/src/shell/shell.css`
- Test: `desktop/tests/shell.test.tsx`
- Test: `tests/editor/app.test.tsx`
- Test: `tests/editor/theme-inspector.test.tsx`

**Interfaces:**
- Добавляются каталожные элементы `server-card` с `componentId: card` и `legacy-page` с `componentId: legacy-page`.
- Каждый legacy wrapper имеет `data-design-id="legacy-page"`, `data-design-component="legacy-page"` и `designOverrideAttrs` с текущими `target`, `route`, `format`.
- `server-card` получает `designOverrideAttrs` с `screenId: settings`.

- [ ] **Step 1: Написать падающие тесты**

Проверить, что настройки содержат пять шаблонов, library содержит `legacy-page`, инспектор редактирует оба новых элемента. Для каждого из пяти legacy-маршрутов проверить wrapper и активный override ID только своего экрана. Для настроек проверить override ID на `server-card`.

- [ ] **Step 2: Запустить тесты и увидеть FAIL**

Run: `npx vitest run desktop/tests/shell.test.tsx tests/editor/theme-inspector.test.tsx tests/editor/app.test.tsx -t "legacy|server-card|layers"`
Expected: FAIL из-за отсутствия каталожных записей и override attrs.

- [ ] **Step 3: Подключить шаблоны и CSS-адаптер**

Использовать существующие токены. В `.desktop-legacy` связать `--bg`, `--panel`, `--accent`, `--text`, `--muted` напрямую, `--panel-2` через `color-mix(... panel 92%, text)`. Применить зафиксированные в spec размеры к `.m-screen`, `.m-btn`, `.m-input` и общим radius-селекторам. Не менять `design/validation.ts` или generated JSON.

- [ ] **Step 4: Запустить проверки Task 2**

Run: `npx vitest run desktop/tests/shell.test.tsx tests/editor/theme-inspector.test.tsx tests/editor/app.test.tsx -t "^(?!.*shows a failed save).*$"`
Expected: PASS с учётом заранее известного excluded baseline.

### Task 3: Сквозная проверка и документирование

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `CHANGELOG.en.md`
- Modify: `editor/src/editor.css` только при необходимости для групп страниц.

- [ ] **Step 1: Добавить Unreleased-записи**

Один `[tech]` пункт на русском и английском: все desktop-страницы, включая `connect`, и shared/legacy templates редактируются. Не упоминать phone/TV как готовые.

- [ ] **Step 2: Запустить стандартные проверки**

Run: `npm run test:editor`, `npx tsc --noEmit`, `npm run build:editor`
Expected: сборка и TypeScript PASS; в тестах допускается только заранее задокументированный baseline failure автосохранения.

- [ ] **Step 3: Проверить все страницы в браузере**

Перебрать все шесть страниц, выбрать `legacy-page` на library и `server-card` на settings, изменить цвет и размер, убедиться в реальном изменении preview, затем вернуть значения через undo. Проверить 1440px и 900px, остановить сервер и закрыть вкладку.

- [ ] **Step 4: Проверить diff**

Run: `git diff --check && git status --short`
Expected: нет whitespace-ошибок или случайных build-файлов; чужие изменения сохранены.
