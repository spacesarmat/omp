# Interactive States Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Показывать и редактировать default, hover, focus, active, disabled и error в реальном preview всех платформ.

**Architecture:** Единый `DesignState` из App проходит через TargetBar и PreviewConfiguration во все адаптеры. `activeOverrideIds` применяет state override к существующим design ID.

**Tech Stack:** TypeScript, Preact, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-11-interactive-states-design.md`

## Global Constraints

- Не менять список состояний и формат документа.
- Не имитировать отдельные CSS-движки для каждого состояния.
- Не делать коммиты или push без Andy.

## Review Focus

- TargetBar и inspector используют одно состояние. Проверяется в Task 1.
- State передаётся в protocol init. Проверяется в Task 1.
- Desktop/phone/TV получают атрибут и override ID состояния. Проверяется в Task 1.
- Смена страницы сбрасывает state. Проверяется в Task 1.

---

### Task 1: Единое состояние и protocol

**Files:**
- Modify: `editor/src/App.tsx`
- Modify: `editor/src/components/TargetBar.tsx`
- Modify: `editor/src/components/ThemeInspector.tsx`
- Modify: `editor/src/components/PreviewPane.tsx`
- Modify: `editor/src/preview/protocol.ts`
- Modify: `editor/src/preview/main.tsx`
- Test: `tests/editor/app.test.tsx`
- Test: `tests/editor/theme-inspector.test.tsx`

**Interfaces:**
- `TargetBarProps.state: DesignState`, `onStateChange(state)`.
- `ThemeInspectorProps.state: DesignState`, `onStateChange(state)`.
- `PreviewConfiguration.state: DesignState`.

- [ ] **Step 1: Написать failing tests**

Выбрать hover в TargetBar, проверить iframe data-state и init state. Выбрать state scope в инспекторе и проверить override с этим state. Сменить страницу и проверить default.

- [ ] **Step 2: Запустить RED**

Run: `npx vitest run tests/editor/app.test.tsx tests/editor/theme-inspector.test.tsx`
Expected: FAIL из-за отсутствия shared state.

- [ ] **Step 3: Реализовать общее состояние**

Хранить state в App, сбрасывать при смене target/screen, передавать в init. ThemeInspector использует внешний state вместо локального.

- [ ] **Step 4: Запустить проверки**

Run: `npx vitest run tests/editor/app.test.tsx tests/editor/theme-inspector.test.tsx`
Expected: PASS.

### Task 2: State во всех адаптерах

**Files:**
- Modify: `desktop/src/preview/DesktopPreview.tsx`
- Modify: `desktop/src/preview/previewRoutes.tsx`
- Modify: `desktop/src/shell/DesktopShell.tsx`
- Modify: `desktop/src/shell/DesktopSettingsScreen.tsx`
- Modify: `desktop/src/preview/PhonePreview.tsx`
- Modify: `desktop/src/preview/TvPreview.tsx`
- Modify: `CHANGELOG.md`
- Modify: `CHANGELOG.en.md`
- Test: `desktop/tests/shell.test.tsx`
- Test: `tests/editor/platform-preview.test.tsx`

**Interfaces:**
- Все preview props включают `state: DesignState` через `DesktopPreviewProps`.

- [ ] **Step 1: Написать failing tests**

Создать state override и проверить `data-design-state` и override ID на корне и внутренних компонентах desktop/phone/TV.

- [ ] **Step 2: Запустить RED**

Run: `npx vitest run desktop/tests/shell.test.tsx tests/editor/platform-preview.test.tsx`
Expected: FAIL из-за default state во всех адаптерах.

- [ ] **Step 3: Передать state во все context и data-атрибуты**

Использовать props.state вместо литерала default. Не менять бизнес-логику компонентов.

- [ ] **Step 4: Запустить проверки и changelog**

Запустить оба файла, затем `npm run test:editor`, `npx tsc --noEmit`, `npm run build:editor`, `npm run editor:generate -- --check`. Добавить один `[tech]` пункт ru/en и проверить браузером hover/focus/disabled с undo.
