# OMP Theme and Interaction Editor Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Собрать работающий локальный редактор, который показывает настоящие OMP-компоненты в новом desktop shell, меняет темы Windows/macOS/Linux независимо, редактирует и симулирует правила, сохраняет черновики и экспортирует проверяемый diff.

**Architecture:** Preact/Vite-редактор работает с отдельным preview-entry и не меняет production `desktop/src/main.tsx`. JSON описывает только темы и разрешённые правила. CSS генерируется детерминированно, а ограниченный rule interpreter используется и в preview, и в последующем production-подключении. Loopback Node-сервис хранит черновики и защищённо экспортирует файлы без shell-команд, push и release.

**Tech Stack:** Node 24, TypeScript, Preact 11, Preact Signals, Vite 8, Vitest 5, jsdom, существующие desktop bridge и OMP stores, Node `http`, `crypto`, `fs` и `child_process.execFile`.

**Spec:** `docs/superpowers/specs/2026-11-10-theme-interaction-editor-design.md`

## Global Constraints

- Работа ведётся в `.tmp-theme-editor` на `feat/theme-editor-design`. `main` меняется только через PR после зелёного CI и явного разрешения Andy.
- Этот план не переключает production `desktop/src/main.tsx` на новый shell. Текущие Windows, Android и webOS продолжают работать как раньше.
- Текст проекта и отчёты используют только обычный дефис `-`, без длинного или среднего тире.
- ТВ-текст не менее 24px, кроме существующих тестовых подписей. Для ТВ запрещены flex `gap`, `aspect-ratio`, `inset` и `:has()`.
- Первый срез поддерживает preview только для `desktop-windows`, `desktop-macos` и `desktop-linux`. Схема сразу допускает `android-phone`, `android-tv` и `lg-webos`, но не объявляет их готовыми.
- Windows, macOS и Linux используют одни экраны и функции. Их темы независимы. Общий каркас - левое меню, на узком окне оно сворачивается до значков.
- Не добавлять `eval`, произвольный JavaScript в документах, сетевую загрузку правил или произвольный CSS.
- Не читать `.env`, SSH-ключи, реальные токены, пользовательскую историю и production localStorage. Preview использует отдельный origin и fixtures.
- Preview не обращается к реальным TorrServer, billing, Telegram, NUC или устройствам. Все native и HTTP-ответы являются fixtures.
- Новые зависимости не добавлять. Использовать существующие Preact, Vite, Vitest, jsdom и Node 24 type stripping только для чистых TypeScript-модулей без JSX и неerasable-синтаксиса.
- Существующие screen codes не перенумеровывать. Новые desktop идентификаторы находятся в собственном namespace.
- `releaseIntent` только описывает будущий релиз. Он не создаёт ветку, tag, push, PR, GitHub Release, Telegram-пост или deploy.
- Полный `npm test` запускать в Linux или WSL. В Git Bash запускать точечные тесты. Не считать регрессией известные Windows-only ограничения `shellcheck`, `rsync`, `flock` и Postgres.
- После изменений `AGENTS.md` и документации проверить, что команды и карта проекта соответствуют фактическому результату.

## Review Focus

1. Вредоносный или повреждённый JSON с неизвестными полями, `__proto__`, CSS `url()` или действием `eval` должен быть отклонён до записи и не должен выполняться. Проверка: Task 1, Step 2 и Task 3, Step 2.
2. Переопределение Windows или более поздний scope не должно попасть в macOS/Linux или потерять приоритет из-за CSS specificity. Проверка: Task 2, Steps 2-3.
3. Неверный Origin, токен, большой body, `..` в имени черновика и обращение к `.env` не должны дать доступ к файлам. Проверка: Task 6, Step 2.
4. Одно нажатие не должно вызвать старый handler и rule dispatcher одновременно, а безусловное правило не должно скрыть последующие правила без предупреждения. Проверка: Task 3, Step 2 и Task 4, Step 2.
5. Устаревший `baseCommit`, чужие изменения в `design/` и повторный экспорт не должны привести к потере работы. Проверка: Task 10, Steps 2-3.

## Последующие самостоятельные планы

Этот документ реализует только первый работающий срез, не уменьшая конечную цель спецификации. Следующие планы готовятся после его приёмки:

1. Production desktop shell: route registry, legacy-адаптеры и переключение Windows после регрессионных проверок.
2. Phone/TV preview: ориентация, ТВ-разрешения, токены и совместимый CSS.
3. Расширение реестра действий, состояний и экранов до полной матрицы `theme` и `logic`.
4. Git branch/PR automation и фактическая публикация тем через существующие release workflows.
5. macOS/Linux package integration после появления соответствующих пакетов. Их темы уже проверяются первым срезом.

---

### Task 1: Версионированная схема документов

**Files:**
- Create: `design/schema.ts`
- Create: `design/validation.ts`
- Create: `design/defaults.ts`
- Create: `tests/design/schema.test.ts`
- Modify: `tsconfig.json:19`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: нет.
- Produces: `DesignTarget`, `DesktopDesignTarget`, `DesignFormat`, `DesignState`, `ThemeDocument`, `ThemeOverride`, `FlowDocument`, `InteractionRule`, `parseThemeDocument(value)`, `parseFlowDocument(value)`, `createDefaultTheme(baseCommit)`, `createDefaultFlow(baseCommit)`, `DesignValidationError`.

- [ ] **Step 1: Установить зависимости и проверить исходное состояние**

```bash
npm ci
npm ci --prefix desktop
git diff --exit-code -- package-lock.json desktop/package-lock.json
git status --short
```

Expected: lockfiles не меняются. В status присутствуют только изменения текущего plan/spec, если они ещё не закоммичены.

- [ ] **Step 2: Написать failing-тесты схемы и вредоносных входов**

В `tests/design/schema.test.ts` использовать `BASE = '0000000000000000000000000000000000000000'`.

```ts
it('accepts defaults and rejects unknown or executable content', () => {
  expect(parseThemeDocument(createDefaultTheme(BASE)).schemaVersion).toBe(1);
  expect(() => parseThemeDocument({ ...createDefaultTheme(BASE), extra: true })).toThrow(DesignValidationError);
  expect(() => parseThemeDocument({ ...createDefaultTheme(BASE), ['__proto__']: { polluted: true } })).toThrow(DesignValidationError);
  expect(() => parseThemeDocument({ ...createDefaultTheme(BASE), tokens: { '--omp-color-accent': 'url(javascript:alert(1))' } })).toThrow(DesignValidationError);
  expect(() => parseFlowDocument({ ...createDefaultFlow(BASE), rules: [{ id: 'x', screenId: 'settings', elementId: 'x', event: 'click', action: { type: 'eval', code: 'alert(1)' } }] })).toThrow(DesignValidationError);
});
```

Добавить проверки: неверный `baseCommit`, повторный override `id`, повторный `releaseIntent.target`, неизвестный token и `--omp-size-space: -1px` отклоняются.

- [ ] **Step 3: Запустить тесты и убедиться в ожидаемом FAIL**

Run: `npx vitest run tests/design/schema.test.ts`
Expected: FAIL, поскольку `design/validation.ts` и `design/defaults.ts` отсутствуют.

- [ ] **Step 4: Реализовать типы, строгую проверку и defaults**

Основные типы:

```ts
export type DesignTarget = 'android-phone' | 'android-tv' | 'lg-webos' | 'desktop-windows' | 'desktop-macos' | 'desktop-linux';
export type DesktopDesignTarget = 'desktop-windows' | 'desktop-macos' | 'desktop-linux';
export type DesignFormat = 'portrait' | 'landscape';
export type DesignState = 'default' | 'hover' | 'focus' | 'active' | 'disabled' | 'error';
export type TokenMap = Record<string, string>;

export interface ThemeOverride {
  id: string;
  scope: 'target' | 'component' | 'screen' | 'element' | 'format' | 'state';
  target?: DesignTarget;
  componentId?: string;
  screenId?: string;
  elementId?: string;
  format?: DesignFormat;
  state?: DesignState;
  tokens: TokenMap;
}

export interface ReleaseIntent {
  target: DesignTarget;
  version: string;
  channel: 'beta' | 'stable';
}

export interface ThemeDocument {
  schemaVersion: 1;
  id: string;
  name: string;
  baseCommit: string;
  tokens: TokenMap;
  overrides: ThemeOverride[];
  releaseIntents: ReleaseIntent[];
}
```

`FlowDocument` имеет `schemaVersion: 1`, `id`, `baseCommit` и `rules: InteractionRule[]`. Rule использует `event: 'click'`, а action - только `navigate`, `back` или `toast`. Condition поддерживает `all`, `any`, `not` и `eq` для `server.connected`, `target`, `screen.current`.

Разрешённые tokens:

- `--omp-color-background`, `--omp-color-panel`, `--omp-color-text`, `--omp-color-accent`, `--omp-color-muted`, `--omp-color-danger`: шестизначный hex, например `#F5B700`.
- `--omp-size-space`, `--omp-size-font`, `--omp-size-sidebar`, `--omp-size-radius`: от `0px` до `512px`, максимум два десятичных знака.

`createDefaultTheme` использует текущие цвета `#0F1115`, `#181B22`, `#E8EAF0`, `#F5B700`, `#9AA1B2`, `#E5484D` и нейтральные desktop sizes. Все три desktop темы по умолчанию одинаковы. `createDefaultFlow` создаёт переходы левого меню и `settings-continue`: при `server.connected = true` в `library`, иначе в `connect`.

Валидатор принимает только plain objects с прототипом `Object.prototype` или `null`, отклоняет изменённый прототип и собственный ключ `__proto__`. Он не использует `Object.assign` с непроверенными объектами, копирует только известные ключи и возвращает новый объект. В `tsconfig.json` добавить `design` и `editor`. В `.gitignore` добавить `.omp-editor/` и `dist-editor/`.

- [ ] **Step 5: Запустить тесты и typecheck**

Run: `npx vitest run tests/design/schema.test.ts && npx tsc --noEmit`
Expected: PASS без ошибок TypeScript.

- [ ] **Step 6: Commit**

```bash
git add design tests/design/schema.test.ts tsconfig.json .gitignore
git commit -m "feat: add versioned design document schema"
```

---

### Task 2: Детерминированный resolver и CSS generator

**Files:**
- Create: `design/theme.ts`
- Create: `design/theme-checks.ts`
- Create: `design/generate.ts`
- Create: `scripts/design-generate.mjs`
- Create: `tests/design/theme.test.ts`
- Modify: `package.json:7-27`

**Interfaces:**
- Consumes: Task 1 `ThemeDocument`, `ThemeOverride`, `DesktopDesignTarget`, `DesignFormat`, `DesignState`.
- Produces: `ThemeContext`, `activeOverrideIds(theme, context)`, `resolveThemeTokens(theme, context)`, `checkTheme(theme, contexts)`, `generateThemeCss(theme, target)`, `writeGeneratedThemes(root)`, `GeneratedFile`, `DesignIssue`.

- [ ] **Step 1: Написать failing-тесты независимости целей и приоритета**

```ts
it('keeps platform overrides isolated and orders scopes explicitly', () => {
  const theme = createDefaultTheme(BASE);
  theme.overrides.push(
    { id: 'win-accent', scope: 'target', target: 'desktop-windows', tokens: { '--omp-color-accent': '#111111' } },
    { id: 'mac-accent', scope: 'target', target: 'desktop-macos', tokens: { '--omp-color-accent': '#222222' } },
    { id: 'button', scope: 'element', elementId: 'settings-continue', tokens: { '--omp-size-space': '12px' } },
    { id: 'landscape', scope: 'format', format: 'landscape', elementId: 'settings-continue', tokens: { '--omp-size-space': '20px' } },
  );
  const context = { target: 'desktop-windows' as const, screenId: 'settings', elementId: 'settings-continue', format: 'landscape' as const, state: 'default' as const };
  expect(activeOverrideIds(theme, context)).toEqual(['win-accent', 'button', 'landscape']);
  expect(generateThemeCss(theme, 'desktop-windows')).not.toContain('#222222');
});
```

Добавить тест: два вызова `generateThemeCss` дают одинаковую строку, все override selectors имеют вид `[data-design-overrides~="id"]`, поэтому приоритет определяется порядком, а не случайной specificity.

Добавить проверки читаемости:

```ts
it('reports contrast and font size errors with their context', () => {
  const theme = createDefaultTheme(BASE);
  theme.tokens['--omp-color-accent'] = '#000000';
  theme.tokens['--omp-size-font'] = '8px';
  expect(checkTheme(theme, [context])).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'CONTRAST', target: 'desktop-windows' }),
    expect.objectContaining({ code: 'FONT_SIZE', token: '--omp-size-font' }),
  ]));
});
```

- [ ] **Step 2: Добавить failing-тест генерации файлов**

Создать временный root с `design/themes/test.json`. Проверить, что `writeGeneratedThemes(root)` создаёт три CSS в `design/generated/`, а повторный вызов возвращает те же пути и не меняет содержимое. Для `--check` изменить один generated-файл и ожидать ошибку `GENERATED_OUTDATED` без перезаписи.

- [ ] **Step 3: Запустить тесты и убедиться в FAIL**

Run: `npx vitest run tests/design/theme.test.ts`
Expected: FAIL, отсутствуют resolver и generator.

- [ ] **Step 4: Реализовать resolver, checks и generator**

```ts
export interface ThemeContext {
  target: DesktopDesignTarget;
  screenId: string;
  elementId?: string;
  format: DesignFormat;
  state: DesignState;
}

export function activeOverrideIds(theme: ThemeDocument, context: ThemeContext): string[];
export function resolveThemeTokens(theme: ThemeDocument, context: ThemeContext): TokenMap;
export function checkTheme(theme: ThemeDocument, contexts: ThemeContext[]): DesignIssue[];
export function generateThemeCss(theme: ThemeDocument, target: DesktopDesignTarget): string;
export function writeGeneratedThemes(root: string): Promise<Array<{ path: string; sha256: string }>>;
```

Scope rank: `target = 1`, `component = 2`, `screen = 3`, `element = 4`, `format = 5`, `state = 6`. Сначала отфильтровать overrides по полному context, затем сортировать по rank и исходному индексу. Base tokens идут в `:root` первыми. `resolveThemeTokens` применяет активные overrides в том же порядке.

`checkTheme` использует WCAG relative luminance. Пары text/background, text/panel, muted/panel и background/accent требуют ratio не менее 4.5:1, panel/accent для фокуса - не менее 3:1. Desktop `--omp-size-font` менее 14px даёт `FONT_SIZE`. ТВ-проверка 24px будет подключена в phone/TV плане. `DesignIssue` содержит стабильный `code`, `target`, `screenId`, `elementId`, `format`, `state`, `token` и понятное сообщение.

Каждый override выводится одним single-attribute selector `[data-design-overrides~="id"]`. Это поддерживается старыми браузерами и даёт одинаковую specificity всем overrides. Runtime-helper из Task 4 устанавливает список активных id.

CLI `node scripts/design-generate.mjs` читает только `design/themes/*.json` и пишет `design/generated/desktop-{windows,macos,linux}.css`. Флаг `--check` сравнивает содержимое без записи. Добавить script `editor:generate` в `package.json`.

- [ ] **Step 5: Запустить проверки**

Run: `npx vitest run tests/design/schema.test.ts tests/design/theme.test.ts && npm run editor:generate -- --check && npx tsc --noEmit`
Expected: PASS. Пустой каталог themes не считается ошибкой до первого export.

- [ ] **Step 6: Commit**

```bash
git add design scripts/design-generate.mjs tests/design/theme.test.ts package.json
git commit -m "feat: generate deterministic platform themes"
```

---

### Task 3: Ограниченный rule interpreter

**Files:**
- Create: `design/interaction.ts`
- Create: `design/flow-validation.ts`
- Modify: `design/validation.ts`
- Create: `tests/design/interaction.test.ts`

**Interfaces:**
- Consumes: Task 1 `FlowDocument`, conditions и actions.
- Produces: `InteractionContext`, `InteractionEvent`, `InteractionDispatcher`, `InteractionTrace`, `dispatchInteraction(flow, event, context, dispatcher)`, `validateFlow(flow, routeIds)`.

- [ ] **Step 1: Написать failing-тесты условного перехода и одного dispatch**

```ts
it('routes by server state and emits one action', () => {
  const calls: string[] = [];
  const dispatcher = { navigate: (id: string) => calls.push(id), back: () => calls.push('back'), toast: (message: string) => calls.push(message) };
  const flow = createDefaultFlow(BASE);
  const event = { screenId: 'settings', elementId: 'settings-continue', type: 'click' as const };
  const base = { target: 'desktop-windows' as const, screenId: 'settings' };
  const trace = dispatchInteraction(flow, event, { ...base, serverConnected: false }, dispatcher);
  expect(calls).toEqual(['connect']);
  expect(trace.at(-1)).toMatchObject({ action: 'navigate', target: 'connect' });
});
```

- [ ] **Step 2: Добавить failing-тесты конфликтов и запрещённых действий**

Проверить:

- `serverConnected: true` ведёт в `library` и не вызывает `connect`.
- Безусловное правило перед условным даёт ошибку `SHADOWED_RULE` в `validateFlow`.
- Неизвестный destination даёт `UNKNOWN_ROUTE`.
- Два события создают два dispatch, одно событие - строго один.
- `eval`, произвольный condition path и вложенность conditions больше 8 отклоняются `parseFlowDocument`.
- `back` вызывает только `dispatcher.back()`, `toast` передаёт только текст до 200 символов.

- [ ] **Step 3: Запустить тесты и убедиться в FAIL**

Run: `npx vitest run tests/design/interaction.test.ts`
Expected: FAIL, отсутствует interpreter.

- [ ] **Step 4: Реализовать interpreter и validation**

```ts
export interface InteractionContext {
  target: DesktopDesignTarget;
  screenId: string;
  serverConnected: boolean;
}

export interface InteractionDispatcher {
  navigate(screenId: string): void;
  back(): void;
  toast(message: string): void;
}

export function dispatchInteraction(
  flow: FlowDocument,
  event: { screenId: string; elementId: string; type: 'click' },
  context: InteractionContext,
  dispatcher: InteractionDispatcher,
): InteractionTrace[];
```

Первое полностью подходящее правило побеждает. Navigate не запускает события экрана назначения автоматически, поэтому interpreter не создаёт немедленный цикл. `validateFlow` возвращает стабильный список ошибок, включая `SHADOWED_RULE`, `UNKNOWN_ROUTE`, дубликаты id и отсутствие обязательных параметров.

- [ ] **Step 5: Запустить проверки**

Run: `npx vitest run tests/design && npx tsc --noEmit`
Expected: все существующие на этом этапе design-тесты PASS. Команда не заменяет полный набор в Task 11.

- [ ] **Step 6: Commit**

```bash
git add design/interaction.ts design/flow-validation.ts design/validation.ts tests/design/interaction.test.ts
git commit -m "feat: interpret declarative interaction rules"
```

---

### Task 4: Реальный desktop preview и левый shell

**Files:**
- Create: `desktop/src/shell/routes.ts`
- Create: `desktop/src/shell/DesktopShell.tsx`
- Create: `desktop/src/shell/DesktopSettingsScreen.tsx`
- Create: `desktop/src/shell/designScope.ts`
- Create: `desktop/src/shell/shell.css`
- Create: `desktop/src/preview/DesktopPreview.tsx`
- Create: `desktop/src/preview/previewRoutes.tsx`
- Create: `desktop/src/preview/fixtures.ts`
- Create: `desktop/src/preview/native.ts`
- Create: `desktop/src/platform/createDesktopNative.ts`
- Create: `desktop/tests/shell.test.tsx`

**Interfaces:**
- Consumes: Tasks 1-3 schema, theme resolver, defaults и interpreter.
- Produces: `DesktopRouteId`, `DESKTOP_ROUTES`, `DesktopPreviewProps`, `DesktopPreview`, `designOverrideAttrs`, `installPreviewFixture`, `createPreviewTransport`.

- [ ] **Step 1: Написать failing-тесты shell и режима выбора**

```tsx
it('selects in design mode without executing an action', () => {
  const selected: string[] = [];
  const navigated: string[] = [];
  render(h(DesktopPreview, { ...previewProps({ serverConnected: false, mode: 'design', onSelect: (id) => selected.push(id), onNavigate: (id) => navigated.push(id) }), host);
  host.querySelector('[data-design-id="settings-continue"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(selected).toEqual(['settings-continue']);
  expect(navigated).toEqual([]);
});
```

- [ ] **Step 2: Добавить failing-тесты поведения и изоляции**

Проверить:

- В `simulate` один click на `settings-continue` без сервера вызывает ровно один переход в `connect`, без двойного dispatch.
- При подключённом fixture сервере результат - `library`.
- Меню содержит `Каталог`, `Новое`, `Поиск`, `Пульт`, `Настройки`; `connect` не является пунктом меню.
- `format = portrait` устанавливает `data-design-format="portrait"` и кнопку сворачивания меню.
- `designOverrideAttrs` возвращает активные ids в порядке Task 2.
- После `installPreviewFixture` spy на `fetch` и native transport не показывает внешних вызовов. После cleanup восстанавливаются stores и `setTorrServerTransport(null)`.

- [ ] **Step 3: Запустить тест и убедиться в FAIL**

Run: `npx vitest run desktop/tests/shell.test.tsx`
Expected: FAIL, отсутствует `DesktopPreview`.

- [ ] **Step 4: Реализовать shell, preview и fixtures**

```ts
export type DesktopRouteId = 'library' | 'news' | 'search' | 'remote' | 'settings' | 'connect';
export const DESKTOP_ROUTES: ReadonlyArray<{ id: DesktopRouteId; label: string; menu: boolean }>;
export const DESKTOP_SCREEN_SUPPORT: Record<DesktopRouteId, 'preview' | 'theme' | 'logic'> = {
  library: 'preview', news: 'preview', search: 'preview', remote: 'preview', settings: 'logic', connect: 'preview',
};

export interface DesktopPreviewProps {
  target: DesktopDesignTarget;
  route: DesktopRouteId;
  format: DesignFormat;
  language: 'ru' | 'en';
  mode: 'design' | 'logic' | 'simulate';
  serverConnected: boolean;
  theme: ThemeDocument;
  flow: FlowDocument;
  onSelect(elementId: string): void;
  onNavigate(route: DesktopRouteId): void;
  onTrace(trace: InteractionTrace[]): void;
}
```

`previewRoutes.tsx` использует настоящие `Library`, `News`, `Add`, `Remote` и `Connect` из `mobile/src/screens`. `settings` рендерит новый `DesktopSettingsScreen` с реальным `activeServer` и кнопкой `settings-continue`. Телефонный `App`, `NavBar`, background watchers и `mobile/src/main.tsx` не импортировать. Preview root монтируется с `key={language}`, чтобы переводы обновились.

`fixtures.ts` напрямую сохраняет и восстанавливает прежние `servers.value`, `activeServerId.value` и `lang.value`, использует только сервер `http://fixture.invalid:8090`, не вызывает `addServer` и не пишет в localStorage. Устанавливает fixture `TorrServerTransport`. `native.ts` создаёт `createDesktopNative(createBridge(createPreviewTransport(...)))`; `native_http` возвращает fixture 503 без сети.

`desktop/src/platform/createDesktopNative.ts` только реэкспортирует фабрику из `./native`. Preview импортирует именно этот re-export, чтобы alias `*/platform/native` не заменил импорт фабрики на сам preview mock. Preview native экспортирует тот же surface, что production adapter: `native`, `sourceHttp`, `nativeBilling`, `secrets`, `rawPlugin`, `onlyAndroid`.

`designScope.ts` формирует `data-design-overrides` из `activeOverrideIds`. `shell.css` использует только `var(--omp-...)` для редактируемых значений. Левое меню сворачивается до значков через format и явную кнопку. В design/logic режиме capture-handler только выбирает зарегистрированный элемент и блокирует его действие. В simulate включается только dispatcher, без старого handler на мигрированной кнопке.

- [ ] **Step 5: Запустить проверки**

Run: `npx vitest run desktop/tests/shell.test.tsx tests/design && npx tsc --noEmit`
Expected: PASS, включая RU и EN preview, production `desktop/src/main.tsx` не изменён.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/shell desktop/src/preview desktop/src/platform/createDesktopNative.ts desktop/tests/shell.test.tsx
git commit -m "feat: preview real screens in desktop shell"
```

---

### Task 5: Editor shell и доверенный preview protocol

**Files:**
- Create: `editor/index.html`
- Create: `editor/preview.html`
- Create: `editor/vite.config.ts`
- Create: `editor/src/main.tsx`
- Create: `editor/src/App.tsx`
- Create: `editor/src/editor.css`
- Create: `editor/src/components/TargetBar.tsx`
- Create: `editor/src/components/PreviewPane.tsx`
- Create: `editor/src/preview/main.tsx`
- Create: `editor/src/preview/protocol.ts`
- Create: `tests/editor/protocol.test.ts`
- Create: `tests/editor/app.test.tsx`
- Modify: `package.json:7-27`

**Interfaces:**
- Consumes: Tasks 1-4 defaults, routes, preview.
- Produces: `PreviewMessage`, `PreviewCommand`, `parsePreviewMessage`, `isTrustedPreviewEvent`, `sendPreviewCommand`, editor entry `/index.html`, preview entry `/preview.html`.

- [ ] **Step 1: Написать failing-тесты protocol**

```ts
it('rejects spoofed and malformed preview messages', () => {
  expect(() => parsePreviewMessage({ type: 'element-selected', elementId: 'x', extra: 'bad' })).toThrow();
  const event = { origin: 'https://attacker.invalid', source: null, data: { type: 'ready' } } as MessageEvent;
  expect(isTrustedPreviewEvent(event, 'http://127.0.0.1:4173', iframe.contentWindow)).toBe(false);
});
```

Проверить отсутствие token в `/preview.html` URL, обязательный `messageId`, `sessionId` и ограниченный union сообщений `ready`, `element-selected`, `navigated`, `trace`, `error`.

- [ ] **Step 2: Написать failing-тест editor toolbar**

Проверить:

- Начальная цель `desktop-windows`, экран `settings`, формат `landscape`, язык `ru`.
- Переключение на macOS и Linux меняет только `target` и generated CSS.
- Portrait отправляет viewport `720x960`, landscape - `1280x720`.
- Переключение RU/EN перемонтирует preview root и меняет переводы настоящих экранов без изменения темы или flow.
- Выбор экрана отправляет `navigate` через protocol, а не через реальный router приложения.
- Iframe имеет описательный `title` и не получает API token в URL.

- [ ] **Step 3: Запустить тесты и убедиться в FAIL**

Run: `npx vitest run tests/editor/protocol.test.ts tests/editor/app.test.tsx`
Expected: FAIL, отсутствует editor app.

- [ ] **Step 4: Реализовать editor entries и protocol**

`parsePreviewMessage` строго копирует известные поля. `isTrustedPreviewEvent` требует точный `origin`, ожидаемый `source` и совпадающий `sessionId`. `sendPreviewCommand` использует только loopback origin текущего editor, не `*` и не token в сообщении.

`editor/vite.config.ts` использует `root: editor`, `build.outDir: ../dist-editor`, два HTML input и alias телефонного native на `desktop/src/preview/native.ts`. Preview entry монтирует только `DesktopPreview`. Main entry монтирует editor `App` с default theme/flow.

`PreviewPane` содержит iframe, переключатели цели, экрана, формата и языка RU/EN. В первом срезе portrait и landscape обозначают форму viewport. Масштаб обзора не входит в документ темы. Язык входит только в состояние preview и черновик, не в правила или generated CSS.

Добавить `build:editor = vite build --config editor/vite.config.ts` и `editor = node editor/server.mjs` в `package.json`; server появится в Task 6, поэтому здесь проверяется только build script.

- [ ] **Step 5: Запустить проверки**

Run: `npx vitest run tests/editor desktop/tests/shell.test.tsx tests/design && npm run build:editor && npx tsc --noEmit`
Expected: PASS, оба HTML собраны в `dist-editor`.

- [ ] **Step 6: Commit**

```bash
git add editor tests/editor package.json
git commit -m "feat: add editor shell and trusted preview protocol"
```

---

### Task 6: Loopback server и безопасные черновики

**Files:**
- Create: `editor/server.mjs`
- Create: `editor/server.d.mts`
- Create: `editor/shared/draft.ts`
- Create: `editor/src/client.ts`
- Create: `tests/editor/server.test.ts`

**Interfaces:**
- Consumes: Task 1 validators, Task 5 editor build.
- Produces: `EditorDraft`, `DraftSnapshot`, `parseEditorDraft`, `createDefaultDraft`, `startEditorServer`, `RunningEditorServer`, `createEditorClient`.

- [ ] **Step 1: Подготовить failing-тест реального HTTP-сервиса**

В `tests/editor/server.test.ts` указать `// @vitest-environment node`. Helper создаёт временный Git repo без глобальных настроек пользователя и запускает:

```ts
const running = await startEditorServer({ root: repo, token: 'test-token', port: 0, withVite: false });
const response = await fetch(running.origin + '/api/state', { headers: { Authorization: 'Bearer test-token' } });
expect(response.status).toBe(200);
await running.close();
```

- [ ] **Step 2: Добавить failing security-тесты**

Проверить реальными HTTP-запросами:

- Нет token или неверный token: `401`.
- `Origin: https://attacker.invalid`: `403`.
- `GET /api/drafts/..%2F..%2F.env`: `400` или `404`, файл не прочитан.
- `PUT /api/drafts/bad-id` отклоняется, за пределами `.omp-editor` файл не создан.
- Body больше 1 MiB: `413`.
- Не-JSON content type: `415`.
- Неизвестное поле или невалидная тема: `400`, прежний черновик не меняется.
- `GET /.env`, `POST /api/exec`, `POST /api/push`: `404`.
- Повторный PUT того же валидного draft успешен, запись атомарна и не оставляет temp-файлы.

- [ ] **Step 3: Запустить тесты и убедиться в FAIL**

Run: `npx vitest run tests/editor/server.test.ts`
Expected: FAIL, отсутствует server.

- [ ] **Step 4: Реализовать server, draft schema и client**

```ts
export interface EditorDraft {
  schemaVersion: 1;
  id: string;
  baseCommit: string;
  target: DesktopDesignTarget;
  screenId: DesktopRouteId;
  format: DesignFormat;
  language: 'ru' | 'en';
  theme: ThemeDocument;
  flow: FlowDocument;
  snapshots: DraftSnapshot[];
}

export function startEditorServer(options: {
  root: string;
  token?: string;
  port?: number;
  withVite?: boolean;
}): Promise<RunningEditorServer>;
```

`startEditorServer` слушает только `127.0.0.1`, по умолчанию использует случайный token 32 bytes и порт 0. CLI печатает URL с token во fragment. `createEditorClient` читает fragment, сохраняет token только в памяти/sessionStorage вкладки и удаляет его из address bar через `history.replaceState`.

API:

- `GET /api/health` без секретных данных.
- `GET /api/state` возвращает `{ baseCommit, dirtyDesign }` через `execFile('git', ...)` без shell.
- `GET /api/drafts/:id` и `PUT /api/drafts/:id` с Bearer auth и same-origin проверкой.
- ID соответствует `[a-z0-9][a-z0-9-]{0,63}`. Путь формируется только внутри `.omp-editor/drafts/`.
- Запись выполняется в temp-файл того же каталога и `rename`. Максимум 1 MiB, snapshots максимум 10.
- Vite middleware подключается только при `withVite: true`. В тестах сервер не запускает Vite.

- [ ] **Step 5: Запустить проверки**

Run: `npx vitest run tests/editor && npm run build:editor && npx tsc --noEmit`
Expected: PASS, security-тесты подтверждают отсутствие записи вне `.omp-editor`.

- [ ] **Step 6: Commit**

```bash
git add editor tests/editor/server.test.ts
git commit -m "feat: store editor drafts on loopback server"
```

---

### Task 7: DraftController, undo/redo и snapshots

**Files:**
- Create: `editor/src/drafts.ts`
- Create: `editor/src/useDraftController.ts`
- Create: `tests/editor/drafts.test.ts`

**Interfaces:**
- Consumes: Task 6 `EditorDraft`, `EditorClient`.
- Produces: `DraftController`, `createDraftController`, `useDraftController`.

- [ ] **Step 1: Написать failing-тесты истории и autosave**

```ts
it('supports undo, redo and debounced persistence', async () => {
  const saved: EditorDraft[] = [];
  const controller = createDraftController({ draft: createDefaultDraft('draft-1', BASE), client: fakeClient(saved), autosaveMs: 20 });
  controller.upsertOverride({ id: 'win', scope: 'target', target: 'desktop-windows', tokens: { '--omp-color-accent': '#111111' } });
  expect(controller.undo()).toBe(true);
  expect(controller.draft.theme.overrides).toEqual([]);
  expect(controller.redo()).toBe(true);
  await controller.flush();
  expect(saved.at(-1)?.theme.overrides[0].id).toBe('win');
});
```

- [ ] **Step 2: Добавить failing-тесты snapshots и границ**

Проверить:

- Максимум 50 undo-шагов, новое изменение очищает redo.
- `snapshot('before release')` сохраняет theme/flow, `restore(snapshotId)` создаёт новый undo-шаг.
- Максимум 10 snapshots. Одиннадцатый отклоняется с `SNAPSHOT_LIMIT`, самый старый snapshot не удаляется автоматически.
- `baseCommit` нельзя изменить через `update`.
- После `dispose()` отложенный autosave не выполняется.
- Два быстрых изменения создают один debounced PUT, `flush` ждёт завершения записи.
- Ошибка записи сохраняется в `lastError` и не уничтожает локальный draft.
- `setView` сохраняет RU/EN и не создаёт новую тему или flow при переключении языка.

- [ ] **Step 3: Запустить тесты и убедиться в FAIL**

Run: `npx vitest run tests/editor/drafts.test.ts`
Expected: FAIL, отсутствует controller.

- [ ] **Step 4: Реализовать immutable controller и Preact-hook**

```ts
export interface DraftController {
  readonly draft: EditorDraft;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly lastError: string | null;
  subscribe(listener: () => void): () => void;
  upsertOverride(override: ThemeOverride): void;
  removeOverride(id: string): void;
  replaceFlow(flow: FlowDocument): void;
  setView(view: Pick<EditorDraft, 'target' | 'screenId' | 'format' | 'language'>): void;
  snapshot(name: string): DraftSnapshot;
  restore(snapshotId: string): boolean;
  undo(): boolean;
  redo(): boolean;
  flush(options?: { keepalive?: boolean }): Promise<void>;
  dispose(): void;
}
```

Все изменения immutable и используют `structuredClone`. Autosave debounce 300ms по умолчанию. При закрытии страницы `flush` вызывается с `{ keepalive: true }`. `useDraftController` подписывает Preact-компоненты и очищает subscription при unmount.

- [ ] **Step 5: Запустить проверки**

Run: `npx vitest run tests/editor && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add editor/src/drafts.ts editor/src/useDraftController.ts tests/editor/drafts.test.ts
git commit -m "feat: version editor drafts locally"
```

---

### Task 8: Визуальный inspector темы

**Files:**
- Create: `design/catalog.ts`
- Create: `editor/src/components/ThemeInspector.tsx`
- Create: `editor/src/components/PropertyField.tsx`
- Create: `tests/editor/theme-inspector.test.tsx`
- Modify: `editor/src/App.tsx`
- Modify: `editor/src/editor.css`

**Interfaces:**
- Consumes: Tasks 1-7 resolver, controller, protocol и preview.
- Produces: `DESIGN_ELEMENTS`, `DesignElementDef`, `ThemeInspector`, `PropertyField`.

- [ ] **Step 1: Написать failing-тест выбора элемента и независимого override**

```tsx
it('edits only the selected platform and element scope', () => {
  render(h(ThemeInspector, { target: 'desktop-windows', screenId: 'settings', elementId: 'sidebar', controller, format: 'landscape' }), host);
  chooseScope(host, 'element');
  setColor(host, '--omp-color-panel', '#112233');
  expect(controller.draft.theme.overrides).toEqual([
    expect.objectContaining({ scope: 'element', target: 'desktop-windows', elementId: 'sidebar', tokens: { '--omp-color-panel': '#112233' } }),
  ]);
  expect(generateThemeCss(controller.draft.theme, 'desktop-macos')).not.toContain('#112233');
});
```

- [ ] **Step 2: Добавить failing-тесты ограничений и сравнения**

Проверить:

- Незарегистрированный `elementId` показывает ограничение и не создаёт selector.
- `DESKTOP_SCREEN_SUPPORT.library = preview` отключает редактирование theme/logic и показывает `preview only`, а не выдаёт legacy-экран за мигрированный.
- Цвет не по схеме и размер больше 512px не сохраняются.
- `checkTheme` сообщает о CONTRAST и FONT_SIZE в панели, но позволяет сохранить временный черновик для последующего исправления.
- Reset удаляет только выбранный override, base theme остаётся.
- `До / После` переключает preview между `createDefaultTheme(baseCommit)` и текущей темой без изменения draft.
- Панель показывает цепочку `theme > platform > element` и источник активного значения.
- Изменение создаёт один undo-шаг и один debounced autosave.

- [ ] **Step 3: Запустить тесты и убедиться в FAIL**

Run: `npx vitest run tests/editor/theme-inspector.test.tsx`
Expected: FAIL, отсутствует inspector.

- [ ] **Step 4: Реализовать catalog и inspector**

`DESIGN_ELEMENTS` содержит только:

- `sidebar`: panel color и sidebar width;
- `sidebar-item`: accent, text, radius;
- `content`: background, space, font size;
- `settings-continue`: accent, text, radius, space.

Каждый `DesignElementDef` перечисляет разрешённые tokens и тип редактора `color` или `px`. Пользователь не вводит CSS-селектор или имя свойства вручную. Scope ограничен `platform`, `screen`, `element`, `format`, `state`.

`App` загружает или создаёт draft, соединяет выбор preview с `ThemeInspector`, генерирует CSS текущей цели после каждого изменения и отправляет его в iframe. До/После использует отдельную вычисленную строку CSS и не меняет документ. `DESKTOP_SCREEN_SUPPORT` явно управляет доступностью вкладок Дизайн и Логика. Панель issues получает контексты всех зарегистрированных элементов из `DESIGN_ELEMENTS`.

- [ ] **Step 5: Запустить проверки**

Run: `npx vitest run tests/editor desktop/tests/shell.test.tsx tests/design && npm run build:editor && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add design/catalog.ts editor tests/editor/theme-inspector.test.tsx
git commit -m "feat: edit platform themes visually"
```

---

### Task 9: Редактор логики, карта переходов и симуляция

**Files:**
- Create: `editor/src/components/LogicEditor.tsx`
- Create: `editor/src/components/FlowMap.tsx`
- Create: `editor/src/components/SimulationPanel.tsx`
- Create: `editor/src/simulation.ts`
- Create: `tests/editor/logic-editor.test.tsx`
- Modify: `editor/src/App.tsx`

**Interfaces:**
- Consumes: Tasks 3-7 interpreter, routes, controller и protocol.
- Produces: `LogicEditor`, `FlowMap`, `SimulationPanel`, `simulatePreviewClick`.

- [ ] **Step 1: Написать failing-тест редактирования правила**

Проверить, что для `settings-continue` можно:

- Выбрать событие `click`.
- Установить условие `server.connected = false`.
- Выбрать действие `navigate` и destination `connect`.
- Сохранить правило с тем же id, создав один undo-шаг.
- Добавить второе правило для `true -> library`.
- Поменять порядок кнопками вверх/вниз и увидеть `SHADOWED_RULE`, если безусловное правило оказалось первым.
- Запретить сохранение неизвестного route и пустого toast.

- [ ] **Step 2: Написать failing-тесты карты и симулятора**

```ts
it('simulates both server states with a trace and no real calls', async () => {
  const disconnected = await simulatePreviewClick(previewHarness(false));
  expect(disconnected.route).toBe('connect');
  expect(disconnected.trace.map((entry) => entry.action)).toEqual(['navigate']);
  expect(disconnected.realNetworkCalls).toBe(0);
  const connected = await simulatePreviewClick(previewHarness(true));
  expect(connected.route).toBe('library');
});
```

Проверить: карта показывает `settings`, `library`, `connect` и условия на стрелках. Повторный click в design mode не выполняет действие, в simulate выполняет одно. Ошибка preview отображается в `SimulationPanel`, а не скрывается.

- [ ] **Step 3: Запустить тесты и убедиться в FAIL**

Run: `npx vitest run tests/editor/logic-editor.test.tsx`
Expected: FAIL, отсутствуют компоненты логики.

- [ ] **Step 4: Реализовать редактор и симулятор**

`LogicEditor` использует только зарегистрированные события, conditions, actions и `DESKTOP_ROUTES`. Произвольный action type и condition path не предлагать. Изменения применяются через `replaceFlow`.

`FlowMap` строится данными из rules, без новой graph-библиотеки и без drag-drop. `SimulationPanel` выбирает `serverConnected`, отправляет `simulate` и выводит последовательность событие -> условия -> действие -> новый route.

`simulatePreviewClick` использует тот же `dispatchInteraction`, что и Task 3. Preview сохраняет собственный route stack для `back`. Реальные handlers мигрированной кнопки не вызываются.

- [ ] **Step 5: Запустить проверки**

Run: `npx vitest run tests/editor desktop/tests/shell.test.tsx tests/design && npm run build:editor && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add editor tests/editor/logic-editor.test.tsx
git commit -m "feat: edit and simulate interaction flows"
```

---

### Task 10: Release intent и защищённый экспорт

**Files:**
- Create: `editor/export.mjs`
- Create: `editor/export.d.mts`
- Create: `editor/src/components/ExportPanel.tsx`
- Create: `tests/editor/export.test.ts`
- Modify: `editor/server.mjs`
- Modify: `editor/server.d.mts`
- Modify: `editor/src/client.ts`
- Modify: `editor/src/App.tsx`

**Interfaces:**
- Consumes: Tasks 1-9 validators, generator, controller и server.
- Produces: `exportDraft({ root, draft })`, `ExportResult`, `POST /api/export`, `ExportPanel`.

- [ ] **Step 1: Написать failing-тест успешного экспорта**

Временный repo содержит `design/`, initial commit и валидный draft с текущим `baseCommit`. Проверить:

```ts
const result = await exportDraft({ root: repo, draft });
expect(result.files).toEqual([
  'design/flows/desktop-default.json',
  'design/generated/desktop-linux.css',
  'design/generated/desktop-macos.css',
  'design/generated/desktop-windows.css',
  'design/themes/default.json',
]);
expect(result.releaseIntents).toEqual([{ target: 'desktop-windows', version: '0.20.12-beta.3', channel: 'beta' }]);
```

Проверить, что `POST /api/export` требует те же auth и Origin, что и PUT draft. Release intent beta требует суффикс `-beta.N`, stable его запрещает. Дублирующий target отклоняется.

- [ ] **Step 2: Написать failing-тесты stale base и чужих изменений**

Проверить:

- `baseCommit` отличается от HEAD: `STALE_BASE`, ни один файл не изменился.
- В `design/themes/other.json` есть пользовательское изменение без export manifest: `DIRTY_DESIGN`, draft не перезаписывает его.
- Manifest содержит file hash предыдущего export. Повторный export разрешён только если все ранее изменённые файлы совпадают с manifest.
- Повторный export без изменений даёт тот же `sha256` и пустой Git diff после возврата к исходному состоянию.
- Удалённый из нового export файл удаляется только при наличии в предыдущем manifest.
- Любой path вне `design/` и `.omp-editor/exports/` отклоняется.
- Любой `CONTRAST` или `FONT_SIZE` issue из `checkTheme` блокирует export с `DESIGN_ISSUES`, ни один файл не меняется. Черновик при этом сохраняется.

- [ ] **Step 3: Запустить тесты и убедиться в FAIL**

Run: `npx vitest run tests/editor/export.test.ts`
Expected: FAIL, отсутствует export.

- [ ] **Step 4: Реализовать export и manifest**

```ts
export interface ExportResult {
  baseCommit: string;
  files: string[];
  releaseIntents: ReleaseIntent[];
}

export async function exportDraft(options: { root: string; draft: EditorDraft }): Promise<ExportResult>;
```

Перед записью:

1. Проверить draft, theme, flow и routes.
2. Запустить `checkTheme` для всех трёх desktop целей, зарегистрированных элементов, форматов и состояний. Любой issue уровня error останавливает export до записи.
3. Получить HEAD через `execFile('git', ['rev-parse', 'HEAD'])`.
4. Сравнить `draft.baseCommit` с HEAD.
5. Проверить tracked и untracked изменения `design/` отдельными `git diff --name-only` и `git ls-files --others --exclude-standard`.
6. Без manifest требовать чистый `design/`. С manifest требовать точное совпадение списка и SHA-256 прошлого export.
7. Сформировать все файлы в памяти, затем записать только разрешённые пути и обновить `.omp-editor/exports/<draft-id>.json` с SHA-256.

`releaseIntents` сохраняются в theme JSON. Для macOS/Linux UI показывает `package unavailable`, но не блокирует подготовку документа. Экспорт не вызывает `git add`, `commit`, `branch`, `push`, `gh` или release scripts.

`ExportPanel` редактирует intents по одному на target, вызывает `flush` перед export, показывает ошибки и список файлов. После успеха показывает команду `git diff -- design`.

- [ ] **Step 5: Запустить проверки**

Run: `npx vitest run tests/editor && npm run editor:generate -- --check && npm run build:editor && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add editor tests/editor/export.test.ts
git commit -m "feat: export reviewed design changes safely"
```

---

### Task 11: End-to-end проверка, CI и документация

**Files:**
- Create: `tests/editor/boot.test.ts`
- Modify: `package.json:7-27`
- Modify: `.github/workflows/ci.yml:58-67`
- Modify: `docs/desktop-cross-platform.md:21-43`
- Modify: `AGENTS.md:11-22`
- Modify: `CHANGELOG.md:1-12`
- Modify: `CHANGELOG.en.md:1-15`

**Interfaces:**
- Consumes: все предыдущие tasks.
- Produces: команды `npm run editor`, `npm run build:editor`, `npm run editor:generate -- --check`, задокументированный безопасный запуск и CI gate.

- [ ] **Step 1: Добавить integration boot-тест полного server+preview запуска**

В `tests/editor/boot.test.ts` с `// @vitest-environment node` запустить `startEditorServer({ withVite: true, port: 0 })` во временной копии необходимых config-файлов. Реальными HTTP GET проверить:

- `/` возвращает editor HTML;
- `/preview.html` возвращает preview HTML;
- `/api/state` с token возвращает 40-hex `baseCommit`;
- `/api/state` без token возвращает 401;
- Vite не возвращает `.env` при запросе `/.env` и `/@fs/.../.env`;
- После `close()` порт освобождён.

Это интеграционная проверка уже реализованных задач, поэтому искусственный FAIL не требуется. Если тест падает, сначала зафиксировать фактическую причину.

- [ ] **Step 2: Запустить boot-тест и устранить интеграционные ошибки**

Run: `npx vitest run tests/editor/boot.test.ts`
Expected: PASS. Если Vite требует явный `fs.allow`, разрешить только workspace source, editor и design, но не секретные файлы. Не ослаблять auth API ради теста.

- [ ] **Step 3: Добавить CI, scripts и документацию**

В `package.json` зафиксировать:

- `editor: node editor/server.mjs`;
- `build:editor: vite build --config editor/vite.config.ts`;
- `editor:generate: node scripts/design-generate.mjs`;
- `test:editor: vitest run tests/design tests/editor desktop/tests/shell.test.tsx`.

В CI build job добавить `npm run build:editor` и `npm run editor:generate -- --check`. В `docs/desktop-cross-platform.md` описать запуск `npm run editor`, открытие только выданного loopback URL, отсутствие production-переключения и ограничения первого среза. В `AGENTS.md` добавить `editor/`, `design/` и новые команды.

В CHANGELOG добавить раздел `## Не выпущено` / `## Unreleased` с одной `[tech]` записью о локальном редакторе тем и правил. Не менять текущую версию пакета.

- [ ] **Step 4: Запустить точечные тесты и все сборки в Git Bash**

```bash
npm run test:editor
npm run editor:generate -- --check
npm run build
npm run build:mobile
npm run build:desktop
npm run build:editor
git diff --check
```

Expected: все команды exit 0. `dist-editor/` и `.omp-editor/` не появляются в `git status`.

- [ ] **Step 5: Запустить полный набор в Linux или WSL**

```bash
npm ci
npm ci --prefix desktop
npm test
```

Expected: exit 0, включая root и billing, lockfiles не меняются. Если WSL недоступен, не выдавать задачу за полностью проверенную: положиться на обязательный зелёный CI и явно сообщить это до PR.

- [ ] **Step 6: Проверить реальный пользовательский сценарий в браузере**

Запустить `npm run editor` и открыть выданный URL в браузере. Проверить не только загрузку:

1. Выбрать Windows -> Настройки -> landscape. Видны левое меню и настоящий desktop preview.
2. Выбрать `sidebar`, изменить panel color на `#112233`. Windows меняется, macOS и Linux остаются прежними.
3. Переключить portrait `720x960` и landscape `1280x720`. Меню сворачивается, overflow отсутствует.
4. Переключить RU и EN. Настоящие переводы меняются без потери draft и выбранной темы.
5. Создать snapshot, изменить цвет, выполнить undo/redo и До/После.
6. В `Логика` для `settings-continue` оставить `false -> connect` и `true -> library`.
7. В симуляторе без сервера оказаться в `connect`, с сервером - в `library`. Журнал содержит один dispatch, сетевых запросов к реальным адресам нет.
8. Перезагрузить страницу и восстановить draft. Указать Windows `0.20.12-beta.3`, beta.
9. Экспортировать, проверить `git diff -- design`. Повторный export не создаёт новых изменений. Push и release не происходят.
10. Через editor удалить smoke-override и smoke release intent, затем снова экспортировать. В PR остаются default colors, пустой `releaseIntents` и отсутствие `#112233`. Не использовать `git reset` или `git clean`.

Снять скриншоты Windows/macOS/Linux в landscape и одного portrait для PR. Проверить клавиатурную навигацию, focus и читаемость панелей.

- [ ] **Step 7: Проверить итоговый diff и commit**

```bash
git status --short
git diff --check
git diff --stat
```

Expected: только перечисленные файлы и очищенные default-документы, экспортированные через editor. Никаких логов, token-файлов, screenshots временных каталогов, `node_modules`, `dist-editor` или `.omp-editor`.

```bash
git add package.json .github/workflows/ci.yml docs/desktop-cross-platform.md AGENTS.md CHANGELOG.md CHANGELOG.en.md tests/editor/boot.test.ts editor design
git commit -m "feat: verify the theme editor vertical slice"
```

## Самопроверка покрытия

- Реальные экраны и левый shell: Task 4.
- Windows/macOS/Linux и независимые темы: Tasks 2, 4, 8.
- Portrait/landscape и RU/EN: Tasks 4-5, 7 и ручной сценарий Task 11.
- Правила, условия, navigate/back/toast: Tasks 3, 4, 9.
- Карта переходов и trace: Task 9.
- Mock native и отсутствие реальных вызовов: Tasks 4, 6, 9.
- Draft, autosave, undo/redo, snapshots: Tasks 6-7.
- Release intent, безопасный export и repeatable diff: Task 10.
- Схема, security, CI, builds, browser verification и docs: Tasks 1, 6, 10-11.
- Production-миграция, полный phone/TV, все actions и фактический выпуск не относятся к этому срезу и перечислены в последующих планах.
