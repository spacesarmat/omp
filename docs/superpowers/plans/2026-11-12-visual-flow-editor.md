# Visual Flow Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать визуальный node editor логики с типизированными событиями, условиями, действиями, debugger и общим preview/production runtime.

**Architecture:** `FlowDocument.schemaVersion` остаётся 1. Legacy rules выполняются первыми через существующий `dispatchInteraction`, новые graph-правила запускаются только при отсутствии legacy match. Все вычисления выполняются синхронно через typed dispatcher, без eval и произвольного JavaScript.

**Tech Stack:** TypeScript, Preact 11, Vitest, jsdom, существующие editor/design/runtime APIs.

**Spec:** `docs/superpowers/specs/2026-11-12-visual-flow-editor-design.md`

## Global Constraints

- Нет произвольного JavaScript, eval, HTML, HTTP или секретов в variables.
- Сохранить `schemaVersion: 1`, legacy `dispatchInteraction`, snapshots, drafts, rebase и export manifest.
- Production активирует flow только после явного export. Autosave production не меняет.
- Максимум 32 steps на event и 16 активных timer flows. Графы без циклов и self-loops.
- Один event создаёт один execution context и один trace. Variables живут только в текущей сессии.
- Node editor работает только на desktop. Phone и TV используются как preview/production flows.
- Один drag/edit/paste равен одному undo-шагу. Новые тексты используют только дефис.
- Не запускать deploy, release, NUC или устройства.
- Полный `npm test` локально на Windows не запускать, полная проверка выполняется в CI на Linux.

## Review Focus

- Legacy и graph правила в одном документе: legacy имеет приоритет и не меняет поведение. Проверяется Task 1 тестом `legacy rules keep precedence over graph rules`.
- Конфликт двух edges в одну ветку: экспорт должен отклонить неоднозначное выполнение. Проверяется Task 2 тестом `rejects ambiguous branch destination`.
- Read-only before/snapshot и clipboard: нельзя изменить скрытый draft, реальные actions не выполняются. Проверяется Task 3 и Task 4.
- Debugger после смены route/orientation: состояние и breakpoints не остаются от предыдущего документа. Проверяется Task 5.
- Повторный export и timers: registry сбрасывается, production не активируется до export. Проверяется Task 7.

---

### Task 1: Graph Schema и совместимый interpreter

**Files:**
- Modify: `design/schema.ts`
- Modify: `design/validation.ts`
- Modify: `design/defaults.ts`
- Create: `design/flow-graph.ts`
- Modify: `design/interaction.ts`
- Test: `tests/design/flow-graph.test.ts`
- Test: `tests/design/schema.test.ts`

**Interfaces:**
- Produces: `FlowNodeView`, `FlowEdge`, `FlowVariable`, `InteractionStep`, `ExecutionContext`, `ExecutionResult`.
- Produces: `executeGraphRule(rule, event, dispatcher): ExecutionResult` и `executeFlow(flow, event, dispatcher): ExecutionResult`.

- [ ] **Step 1: Написать failing tests**

`legacy rules keep precedence over graph rules`, true/false/error ветки, variables по типам, max 32 steps, один trace, session reset, terminal action без обязательного result, отсутствие eval и network.

- [ ] **Step 2: Запустить RED**

Run: `npx vitest run tests/design/flow-graph.test.ts tests/design/schema.test.ts`
Expected: FAIL, graph types и executeFlow отсутствуют.

- [ ] **Step 3: Реализовать schema и interpreter**

Legacy вызывается первым существующим `dispatchInteraction`. Graph запускается только без legacy match. Dispatcher возвращает `{ok:boolean,error?:string}` и остаётся синхронным. Не добавлять async API в interpreter.

- [ ] **Step 4: Запустить GREEN**

Run: `npx vitest run tests/design`
Expected: все design tests PASS, старые документы без graph сохраняют форму.

- [ ] **Step 5: Commit**

```bash
git add design tests/design
git commit -m "feat: add typed flow graph interpreter"
```

### Task 2: Graph validation и rebase

**Files:**
- Create: `design/flow-validation-graph.ts`
- Modify: `design/flow-validation.ts`
- Modify: `editor/design.mjs`
- Test: `tests/design/flow-validation-graph.test.ts`
- Test: `tests/editor/design.test.ts`

**Interfaces:**
- Produces: `validateFlowGraph(flow, routeIds): FlowIssue[]`.
- Produces: `FlowIssue {code,nodeId?,edgeId?,message}` и `REBASE_CONFLICT` по node/edge/variable id.

- [ ] **Step 1: Написать failing tests**

`rejects ambiguous branch destination`, self-loop, cycle, missing node, wrong value type, unreachable result, independent additions by id и competing edits одного node/edge/variable.

- [ ] **Step 2: Запустить RED**

Run: `npx vitest run tests/design/flow-validation-graph.test.ts tests/editor/design.test.ts -t "ambiguous|cycle|rebase|flow"`
Expected: FAIL, graph validation отсутствует.

- [ ] **Step 3: Реализовать validation и merge**

Проверять edges, types, reachability, routes и messages. Rebase сливать независимые additions по id и отклонять competing changes одного узла, связи или переменной.

- [ ] **Step 4: Запустить GREEN**

Run: `npx vitest run tests/design/flow-validation-graph.test.ts tests/editor/design.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add design editor/design.mjs tests
git commit -m "feat: validate and rebase flow graphs"
```

### Task 3: Node Canvas и инспекторы

**Files:**
- Create: `editor/src/flow/nodeOperations.ts`
- Create: `editor/src/components/FlowCanvas.tsx`
- Create: `editor/src/components/FlowNodeInspector.tsx`
- Modify: `editor/src/App.tsx`
- Modify: `editor/src/editor.css`
- Test: `tests/editor/flow-canvas.test.tsx`

**Interfaces:**
- Produces: `addFlowNode`, `moveFlowNode`, `connectFlowNodes`, `removeFlowNodes`, `autoLayoutFlow`.
- `FlowCanvasProps {controller,screenId,readOnly,onSelectNode,onOpenSimulation}`.

- [ ] **Step 1: Написать failing tests**

Добавление узла, drag позиции, связь output-input, запрещённая связь, inspector полей, один undo и read-only non-draft режим.

- [ ] **Step 2: Запустить RED**

Run: `npx vitest run tests/editor/flow-canvas.test.tsx`
Expected: FAIL, canvas отсутствует.

- [ ] **Step 3: Реализовать node editor**

Canvas с zoom/pan/grid/minimap, toolbar и `Insert`, drag из output в input, typed inspector, связь с Design mode. Не добавлять новую модель данных помимо Task 1.

- [ ] **Step 4: Запустить GREEN**

Run: `npx vitest run tests/editor/flow-canvas.test.tsx tests/editor/app.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add editor tests/editor
git commit -m "feat: edit logic flows on node canvas"
```

### Task 4: Multi-select, clipboard и auto-layout

**Files:**
- Create: `editor/src/flow/selection.ts`
- Create: `editor/src/flow/clipboard.ts`
- Modify: `editor/src/components/FlowCanvas.tsx`
- Modify: `editor/src/components/FlowNodeInspector.tsx`
- Test: `tests/editor/flow-selection.test.ts`
- Test: `tests/editor/flow-clipboard.test.ts`

**Interfaces:**
- Produces: `reduceFlowSelection`, `copyFlowSelection`, `pasteFlowSelection`, `autoLayoutFlow`.
- `FlowClipboard {schemaVersion:1,nodes,edges,variables}` с новыми ids и ограничениями.

- [ ] **Step 1: Написать failing tests**

Shift add/remove, групповое перемещение, copy/paste с новыми ids, отсутствие dangling edges, invalid clipboard, один undo и read-only guard.

- [ ] **Step 2: Запустить RED**

Run: `npx vitest run tests/editor/flow-selection.test.ts tests/editor/flow-clipboard.test.ts`
Expected: FAIL, selection/clipboard отсутствуют.

- [ ] **Step 3: Реализовать selection и clipboard**

Групповые операции одной транзакцией, строгая валидация clipboard, новые ids, auto-layout без перекрытий.

- [ ] **Step 4: Запустить GREEN**

Run: `npx vitest run tests/editor/flow-selection.test.ts tests/editor/flow-clipboard.test.ts tests/editor/flow-canvas.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add editor tests/editor
git commit -m "feat: manage flow nodes and clipboard"
```

### Task 5: Debugger и trace comparison

**Files:**
- Create: `editor/src/flow/debugger.ts`
- Create: `editor/src/components/FlowDebugger.tsx`
- Modify: `editor/src/components/SimulationPanel.tsx`
- Test: `tests/editor/flow-debugger.test.ts`
- Test: `tests/editor/flow-debugger-panel.test.tsx`

**Interfaces:**
- Produces: `createDebugSession`, `startDebug`, `pauseDebug`, `stepOver`, `stepInto`, `stopDebug`, `resetDebug`, `compareTraces`.
- `DebugSession {status,event,context,breakpoints,currentNodeId,trace}`.

- [ ] **Step 1: Написать failing tests**

Start/pause/step/stop/reset, breakpoints, variables, error path, trace first difference, смена route/orientation и отсутствие реальных actions.

- [ ] **Step 2: Запустить RED**

Run: `npx vitest run tests/editor/flow-debugger.test.ts tests/editor/flow-debugger-panel.test.tsx`
Expected: FAIL, debugger отсутствует.

- [ ] **Step 3: Реализовать debugger**

Использовать typed interpreter Task 1, mocks server/network/account/playback/download, не менять реальные настройки. Сбрасывать session при смене route/orientation.

- [ ] **Step 4: Запустить GREEN**

Run: `npx vitest run tests/editor/flow-debugger.test.ts tests/editor/flow-debugger-panel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add editor tests/editor
git commit -m "feat: debug flow execution step by step"
```

### Task 6: Библиотека шаблонов

**Files:**
- Create: `design/flow-templates.ts`
- Create: `editor/src/components/FlowTemplateLibrary.tsx`
- Modify: `editor/src/components/FlowCanvas.tsx`
- Test: `tests/design/flow-templates.test.ts`
- Test: `tests/editor/flow-template-library.test.tsx`

**Interfaces:**
- Produces: `FLOW_TEMPLATES`, `instantiateFlowTemplate(id, context): FlowDocument`.
- Template ids: `connect-server`, `offline-retry`, `episode-queue`, `playback-fallback`, `restore-position`.

- [ ] **Step 1: Написать failing tests**

Все пять шаблонов создают валидные documents, новые ids, отсутствие изменения исходного шаблона, route/variables корректны.

- [ ] **Step 2: Запустить RED**

Run: `npx vitest run tests/design/flow-templates.test.ts tests/editor/flow-template-library.test.tsx`
Expected: FAIL, templates отсутствуют.

- [ ] **Step 3: Реализовать templates**

Использовать только существующие типы и actions, применять контекст без секретов, генерировать новые node/rule/edge ids.

- [ ] **Step 4: Запустить GREEN**

Run: `npx vitest run tests/design/flow-templates.test.ts tests/editor/flow-template-library.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add design editor tests
git commit -m "feat: add reusable logic flow templates"
```

### Task 7: Scoped export и production runtime

**Files:**
- Create: `design/production-flow.ts`
- Create: `design/generated/flow.ts`
- Modify: `src/main.tsx`
- Modify: `mobile/src/main.tsx`
- Modify: `desktop/src/main.tsx`
- Modify: `editor/export.mjs`
- Modify: `editor/export.d.mts`
- Modify: `editor/src/client.ts`
- Modify: `editor/server.mjs`
- Modify: `editor/src/components/ExportPanel.tsx`
- Test: `tests/design/production-flow.test.ts`
- Test: `tests/editor/export-flow.test.ts`

**Interfaces:**
- Produces: `installProductionFlow(root): () => void` и `createFlowExportPlan(draft,scope): ExportPlan`.
- Production использует generated `PRODUCTION_FLOW` и typed dispatcher.

- [ ] **Step 1: Написать failing tests**

Production не активируется до export, legacy/graph parity, publishers, timer reset при повторном export, scoped diff, manifest ownership и rollback.

- [ ] **Step 2: Запустить RED**

Run: `npx vitest run tests/design/production-flow.test.ts tests/editor/export-flow.test.ts`
Expected: FAIL, production flow/export отсутствуют.

- [ ] **Step 3: Реализовать export и production**

Подключить publishers через существующие API, timer registry только после export, scoped flow diff с node/edge/variable ids, сохранить manifest/process lock/safePath.

- [ ] **Step 4: Запустить GREEN и builds**

Run: `npx vitest run tests/design/production-flow.test.ts tests/editor/export-flow.test.ts && npm run build && npm run build:mobile && npm run build:desktop && npm run build:editor && npm run editor:generate -- --check`
Expected: все команды exit 0.

- [ ] **Step 5: Commit**

```bash
git add design editor src mobile desktop tests
git commit -m "feat: export reviewed flows into production"
```

### Task 8: Документация и acceptance

**Files:**
- Modify: `docs/editor-guide.md`
- Modify: `CHANGELOG.md`
- Modify: `CHANGELOG.en.md`
- Modify: `AGENTS.md` только если карта проекта изменилась

**Interfaces:**
- Consumes: все предыдущие public UI и export interfaces.

- [ ] **Step 1: Обновить инструкцию**

Описать node canvas, conditions, actions, variables, clipboard, debugger, templates, scoped export и production activation.

- [ ] **Step 2: Запустить полный regression**

Run: `npm run test:editor && npx tsc --noEmit && npm run build:editor && npm run editor:generate -- --check`
Expected: все команды exit 0 без unhandled errors.

- [ ] **Step 3: Запустить production builds и formatting**

Run: `npm run build && npm run build:mobile && npm run build:desktop && git diff --check`
Expected: все builds exit 0, diff check чистый.

- [ ] **Step 4: Выполнить browser acceptance**

Проверить desktop node editing, связи, clipboard, debugger, templates, read-only и export diff. Phone/TV проверять как preview/production flows. Не выполнять deploy и не менять реальные настройки.

- [ ] **Step 5: Финальное ревью и PR**

Проверить весь diff, исправить Critical/Important, создать один PR в `main` и дождаться `build`, `android`, `billing`, desktop smoke и Greptile. Не вливать без явного разрешения Andy.

- [ ] **Step 6: Commit**

```bash
git add docs CHANGELOG.md CHANGELOG.en.md AGENTS.md
git commit -m "docs: explain visual logic editing and export"
```
