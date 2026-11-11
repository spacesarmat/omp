# Component Design Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Редактировать реальные кнопки, поля, карточки и choice rows на phone/TV через стабильные design ID.

**Architecture:** DOM-адаптер размечает существующие классы и semantic elements, назначает override IDs и наблюдает за динамическими детьми. Preact и бизнес-логика не меняются.

**Tech Stack:** TypeScript, Preact, MutationObserver, Vitest, jsdom.

**Spec:** `docs/superpowers/specs/2026-11-11-component-design-adapter-design.md`

## Global Constraints

- Только preview, никаких production DOM-мутаций.
- Не перезаписывать существующие design ID.
- Использовать только пять зарегистрированных типов.
- Не делать коммиты или push без Andy.

## Review Focus

- Существующие ID не перезаписываются. Проверяется в Task 1.
- Динамический button получает ID и override. Проверяется в Task 1.
- Phone/TV показывают пять шаблонов. Проверяется в Task 1.
- Экспорт проверяет новые элементы. Проверяется в Task 2.

---

### Task 1: Adapter и шаблоны

**Files:**
- Create: `desktop/src/preview/designElements.ts`
- Modify: `design/catalog.ts`
- Modify: `desktop/src/preview/PhonePreview.tsx`
- Modify: `desktop/src/preview/TvPreview.tsx`
- Modify: `tests/editor/app.test.tsx`
- Test: `tests/editor/design-elements.test.ts`
- Test: `tests/editor/platform-preview.test.tsx`

**Interfaces:**
- `decorateDesignElements(root: HTMLElement, theme: ThemeDocument, context: ThemeContext): void` размечает root и потомков.
- `observeDesignElements(root, theme, context): () => void` вызывает decorate и подключает MutationObserver, возвращает disconnect.

- [ ] **Step 1: Написать failing tests**

Проверить четыре типа, сохранение существующего ID, dynamic child, пять слоёв в App и attrs на реальных phone/TV компонентах.

- [ ] **Step 2: Запустить RED**

Run: `npx vitest run tests/editor/design-elements.test.ts tests/editor/app.test.tsx tests/editor/platform-preview.test.tsx`
Expected: FAIL из-за отсутствия adapter и шаблонов.

- [ ] **Step 3: Реализовать adapter и потребителей**

Добавить `button`, `input`, `card`, `choice-row` в каталог. Разрешить их phone/TV. Подключить observer в адаптерах и CSS для accent/panel/text/font/space/radius.

- [ ] **Step 4: Запустить проверки**

Run: `npx vitest run tests/editor/design-elements.test.ts tests/editor/app.test.tsx tests/editor/platform-preview.test.tsx`
Expected: PASS.

### Task 2: Экспорт и сквозная проверка

**Files:**
- Modify: `editor/export.mjs`
- Modify: `CHANGELOG.md`
- Modify: `CHANGELOG.en.md`

- [ ] **Step 1: Расширить экспортные контексты**

Использовать все зарегистрированные `DESIGN_ELEMENTS` на phone/TV маршрутах. Сохранить `checks phone legacy page contrast before export` зелёным.

- [ ] **Step 2: Добавить changelog и проверки**

Один `[tech]` пункт на русском и английском. Запустить `npm run test:editor`, `npx tsc --noEmit`, `npm run build:editor`, `npm run editor:generate -- --check`.

- [ ] **Step 3: Проверить браузер и diff**

Выбрать button/input/card/choice-row на реальных phone/TV, изменить токен, проверить результат и undo. Затем `git diff --check`.
