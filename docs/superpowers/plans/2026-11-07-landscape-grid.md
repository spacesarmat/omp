# Landscape Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show two complete card rows in landscape catalog views while preserving portrait layouts and navigation.

**Architecture:** Measure available space from the actual grid top to the tab bar, divide it by two rows and compute columns from compact landscape captions. Grid references are supplied by `Library`, `Discover` and `Person`; portrait CSS and existing gestures stay unchanged.

**Tech Stack:** Preact, TypeScript, CSS, Vitest, Android adb.

**Spec:** `docs/superpowers/specs/2026-11-07-landscape-grid-design.md`

## Global Constraints

- Exactly two card rows in landscape, with readable captions and no clipping.
- Portrait layout, routes, gestures, server state and NUC are unchanged.
- No new dependencies and no long or medium dashes in new text.
- S21 uses only `adb install -r` and never clears application data.

## Review Focus

- Header, filters and resume content consume height: available space starts at the grid top, not the screen top; covered by Task 1 tests.
- Both rows fit when captions are compact: covered by Task 1 property tests.
- Portrait must not change: covered by existing tests plus Task 2 assertions.
- Keyboard opening and rotation must not shrink cards incorrectly: covered by Task 2 tests.
- Very short screens fall back to scrolling rather than zero-sized posters: covered by Task 1 boundary tests.

---

### Task 1: Available height and two-row column calculation

**Files:**
- Modify: `mobile/src/ui/landscapeCols.ts`
- Modify: `mobile/tests/landscapeGrid.test.tsx`

**Interfaces:**
- Produces: `LANDSCAPE_ROWS = 2`, `visibleHeight(ref: RefObject<HTMLElement | null>): number`, `colsToFit(width, height, fit)` where `height` is available for one row.

- [ ] **Step 1: Write failing tests**

Add a measurement fixture with a grid at `y=120` and tab bar at `y=360`. Assert `visibleHeight` returns `240`, not the full window height. Add property tests showing that both computed rows, including compact captions, fit within `240`, and that fewer columns would exceed it when the minimum is greater than `LANDSCAPE_MIN_COLS`. Add short-screen and zero/negative-top boundary cases.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run mobile/tests/landscapeGrid.test.tsx`
Expected: FAIL because `visibleHeight` does not accept a grid ref and two-row calculation is absent.

- [ ] **Step 3: Implement measurement and row calculation**

Export `LANDSCAPE_ROWS = 2`. Compute available height from `nav.top - grid.top`, clamped to zero, then pass half of it to the existing column formula. Preserve keyboard height memory and `LANDSCAPE_MIN_COLS`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run mobile/tests/landscapeGrid.test.tsx`
Expected: new measurement, two-row and boundary tests PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/ui/landscapeCols.ts mobile/tests/landscapeGrid.test.tsx
git commit -m "[tech] Две строки карточек в ландшафте"
```

### Task 2: Compact captions and actual grid references

**Files:**
- Modify: `mobile/src/screens/Library.tsx`
- Modify: `mobile/src/screens/catalog/Discover.tsx`
- Modify: `mobile/src/screens/catalog/Person.tsx`
- Modify: `mobile/src/mobile.css`
- Modify: `mobile/tests/landscapeGrid.test.tsx`

**Interfaces:**
- Consumes: `LANDSCAPE_ROWS` and `visibleHeight(ref)` from Task 1.
- Produces: each view passes its actual `.m-grid` or `.m-disc-grid` ref to `useLandscapeBox`; landscape captions use at most two title lines.

- [ ] **Step 1: Add failing integration assertions**

Mount `Library`, `Discover` and `Person` in landscape. Assert the ref used by `useLandscapeBox` is the grid itself, two rows fit after compact captions are applied, and portrait `gridTemplateColumns` remains empty. Include `Discover` choices 2, 3 and 4.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run mobile/tests/landscapeGrid.test.tsx`
Expected: FAIL because whole-screen refs are still used.

- [ ] **Step 3: Wire grid refs and compact landscape CSS**

Attach dedicated grid refs in all three views. In the existing landscape media query, limit titles to two lines and use compact font and line spacing without changing portrait rules. Keep existing size choices, ads and gestures intact.

- [ ] **Step 4: Run all mobile tests**

Run: `npx vitest run mobile/tests`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/screens/Library.tsx mobile/src/screens/catalog/Discover.tsx mobile/src/screens/catalog/Person.tsx mobile/src/mobile.css mobile/tests/landscapeGrid.test.tsx
git commit -m "[tech] Компактные подписи и точная высота сетки"
```

### Task 3: Device verification and PR

**Files:**
- No planned source changes.

- [ ] **Step 1: Verify builds and unit tests**

Run `npm run build`, `npm run build:mobile`, Android `assembleDebug testDebugUnitTest`, and the standard CI suite. Confirm the change is limited to the landscape catalog.

- [ ] **Step 2: Verify on S21**

Install the debug APK using `adb install -r`. In landscape inspect two complete rows in «Мои» and «Обзор», including small and large views, title readability and tab bar clearance. Rotate back to portrait and verify no regression. Restore the original screen timeout and rotation settings.

- [ ] **Step 3: Request review and create PR**

Review the complete diff, request Greptile and create a PR with test evidence and landscape screenshots. Do not merge without explicit user approval.
