# Snapshot History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Именованные снимки со сравнением, восстановлением и удалением в существующем редакторе.

**Architecture:** `DraftController` хранит снимки и историю undo. `SnapshotPanel` вызывает controller, а App переключает preview между текущей и snapshot темой.

**Tech Stack:** Preact, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-11-snapshot-history-design.md`

## Global Constraints

- Лимит 10 снимков, ошибки без исключения наружу.
- Не менять существующую модель snapshot restore.
- Не делать коммиты или push без Andy.

## Review Focus

- Удаление только выбранного снимка и один undo step. Проверяется в Task 1.
- Пустое имя и лимит показывают ошибку без потери данных. Проверяется в Task 2.
- Сравнение и возврат к текущей теме. Проверяется в Task 2.

---

### Task 1: Удаление в controller

**Files:**
- Modify: `editor/src/drafts.ts`
- Test: `tests/editor/drafts.test.ts`

**Interfaces:**
- `deleteSnapshot(snapshotId: string): boolean`.

- [ ] **Step 1: Написать failing test**

Создать два снимка, удалить первый, проверить второй и восстановить первый через undo.

- [ ] **Step 2: Запустить RED**

Run: `npx vitest run tests/editor/drafts.test.ts -t "delete"`
Expected: FAIL потому что метод отсутствует.

- [ ] **Step 3: Реализовать deleteSnapshot**

Фильтровать по ID через общий `update`, вернуть false если ID отсутствует.

- [ ] **Step 4: Запустить проверку**

Run: `npx vitest run tests/editor/drafts.test.ts`
Expected: PASS.

### Task 2: Панель и сравнение

**Files:**
- Create: `editor/src/components/SnapshotPanel.tsx`
- Modify: `editor/src/App.tsx`
- Modify: `editor/src/editor.css`
- Modify: `CHANGELOG.md`
- Modify: `CHANGELOG.en.md`
- Test: `tests/editor/snapshot-panel.test.tsx`
- Test: `tests/editor/app.test.tsx`

**Interfaces:**
- `SnapshotPanel({ controller, onCompare(snapshot: DraftSnapshot): void })`.
- `data-testid="snapshot-name"`, `data-action="create-snapshot"`, `data-action="compare-snapshot"`, `data-action="restore-snapshot"`, `data-action="delete-snapshot"`.

- [ ] **Step 1: Написать failing tests**

Проверить именованное создание, compare, restore, delete, пустое имя и лимит. В App проверить preview snapshot theme и возврат текущей.

- [ ] **Step 2: Запустить RED**

Run: `npx vitest run tests/editor/snapshot-panel.test.tsx tests/editor/app.test.tsx -t "snapshot"`
Expected: FAIL из-за отсутствия панели.

- [ ] **Step 3: Реализовать панель и App compare**

Header toggles панель. Создание ловит ошибки в inline alert. Кнопки вызывают соответствующие методы. App хранит `comparison: DraftSnapshot | null` и использует его theme до возврата текущей.

- [ ] **Step 4: Запустить проверки и changelog**

Запустить тесты, `npm run test:editor`, `npx tsc --noEmit`, `npm run build:editor`. Добавить `[tech]` пункт ru/en и проверить браузером создание, compare, restore, delete.
