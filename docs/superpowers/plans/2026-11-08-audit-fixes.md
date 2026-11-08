# Исправления аудита 0.20.10 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Исправить пять подтверждённых проблем аудита в `feat/audit-0.20.10`, не меняя `main`.

**Architecture:** Точечные изменения существующих модулей, без новых зависимостей и рефакторинга. Каждая задача начинается с регрессионного теста и заканчивается независимой проверкой.

**Tech Stack:** Node 24, TypeScript, Preact, Vite, Vitest, Postgres 17, GitHub Actions, Kotlin/Gradle.

**Spec:** `docs/superpowers/specs/2026-11-08-audit-fixes-design.md`

## Global Constraints

- `main` остаётся на `61b173e808994ebc907681b91a405197545d8ff9`.
- Новых зависимостей нет. Стили и структура соответствуют соседнему коду.
- Только дефис `-`, без длинного или среднего тире.
- Пользовательские изменения помечаются в `CHANGELOG.md` и `CHANGELOG.en.md` в `Не выпущено` / `Unreleased`.
- Не выполнять push, merge и действия на устройствах или NUC.

## Review Focus

- Same-origin download сохраняет Basic-auth, внешний HTTPS не получает его: Task 1.
- Таймаут действует и при чтении тела, превышение 5 MiB не буферизуется: Task 1.
- Чипы остаются доступны горизонтальной прокруткой, текст вкладок не обрезан: Task 2.
- Release устанавливает `pg` перед запуском обязательных Postgres-тестов: Task 3.
- LF-правила не требуют массового изменения текущего дерева, полный POSIX-запуск остаётся обязательным: Task 4.

---

### Task 1: Безопасный `/v1/torrent`

**Files:**
- Modify: `ops/billing/src/server.mjs:518-535,2102-2134`
- Test: `ops/billing/test/jackettSearch.test.ts:1015-1179`
- Docs: `CHANGELOG.md`, `CHANGELOG.en.md`

**Interfaces:**
- Consumes: существующий `createApp(file, fetchImpl, opts)` и ответ `{ status, headers, arrayBuffer(), body? }` от upstream.
- Produces: опциональные тестовые `opts.torrentTimeoutMs` и `opts.torrentMaxBytes`; production defaults 20000 ms и 5 MiB. Ошибки клиента: 502 с `too_large` или `timeout`.

- [ ] **Step 1: Написать падающие тесты**
  - Внешний HTTPS redirect не получает `Authorization`, same-origin redirect сохраняет его.
  - Ответ больше `torrentMaxBytes` возвращает 502 `too_large` без сохранения тела.
  - Зависший upstream прерывается по `AbortSignal` и возвращает 502 `timeout`.
  - Внешний HTTP и redirect с userinfo отклоняются.
- [ ] **Step 2: Проверить красный тест**
  Run: `BILLING_TEST_DATABASE_URL=... npx vitest run --config ops/billing/vitest.config.ts ops/billing/test/jackettSearch.test.ts`
  Expected: новые проверки FAIL на передаче auth, чтении большого тела и отсутствии timeout.
- [ ] **Step 3: Реализовать минимальную защиту**
  Передать один `AbortSignal` в оба fetch, очищать timer после чтения. Сравнивать origin redirect, удалять auth при смене origin. Читать `body.getReader()` с отменой либо проверять fallback `arrayBuffer()` до его принятия клиенту.
- [ ] **Step 4: Проверить зелёный тест и changelog**
  Run: та же focused команда. Expected: все проверки файла PASS. Добавить `[tech]` запись о redirect, лимите и таймауте.
- [ ] **Step 5: Commit**
  `git add ops/billing/src/server.mjs ops/billing/test/jackettSearch.test.ts CHANGELOG.md CHANGELOG.en.md && git commit -m "fix: secure billing torrent downloads"`

### Task 2: Мобильные вкладки и overflow-check

**Files:**
- Modify: `mobile/src/mobile.css`, `mobile/dev/overflowHarness.tsx:305-309`, `package.json`, `.github/workflows/ci.yml`
- Test: `mobile/tests/overflowRules.test.ts`
- Docs: `CHANGELOG.md`, `CHANGELOG.en.md`

**Interfaces:**
- Consumes: `node scripts/overflow-check.mjs --widths 320 --scenes news-feed,news-subs,news-calendar,add`.
- Produces: `npm run check:overflow` и CI step с тем же обязательным результатом.

- [ ] **Step 1: Зафиксировать падающее состояние**
  Добавить статический тест наличия `.m-chips` в `ROW_SCROLLERS`, узких правил вкладок и npm script. Запустить focused test и overflow-check.
  Expected: FAIL, вкладки имеют 12-13 px и 7 px переполнение, чипы дают ложные offenders.
- [ ] **Step 2: Исправить CSS и harness**
  На 320-374 px уменьшить типографику вкладок Нового, календарь перевести в столбец. Добавить `.m-chips` в `ROW_SCROLLERS`, не меняя `overflow-x: auto`.
- [ ] **Step 3: Добавить package script и CI**
  `check:overflow` вызывает существующий скрипт, CI запускает его после mobile build.
- [ ] **Step 4: Проверить UI и changelog**
  Run: focused test, `npm run check:overflow`, скриншоты 320 px.
  Expected: 81/81, focused PASS, текст и чипы остаются доступны. Добавить `[phone]` и `[tech]` записи.
- [ ] **Step 5: Commit**
  `git add mobile/src/mobile.css mobile/dev/overflowHarness.tsx mobile/tests/overflowRules.test.ts package.json .github/workflows/ci.yml CHANGELOG.md CHANGELOG.en.md && git commit -m "fix: fit mobile tabs on narrow screens"`

### Task 3: Postgres в release gate

**Files:**
- Modify: `.github/workflows/release.yml:29-52`
- Test: `tests/scripts/releaseWorkflow.test.ts`

**Interfaces:**
- Consumes: тот же Postgres 17 и test credentials, что в `.github/workflows/ci.yml`.
- Produces: release `npm test` с `BILLING_TEST_DATABASE_URL` и `BILLING_TEST_REQUIRE_PG=1` после `npm --prefix ops/billing ci`.

- [ ] **Step 1: Написать падающий workflow-тест**
  Проверить `services.postgres`, установку billing dependencies и обе env variables в release.
- [ ] **Step 2: Проверить красный тест**
  Run: `npx vitest run tests/scripts/releaseWorkflow.test.ts`. Expected: FAIL на отсутствии Postgres.
- [ ] **Step 3: Исправить workflow**
  Скопировать service из CI, установить billing dependencies и задать env только шагу тестов.
- [ ] **Step 4: Проверить зелёный тест**
  Run: та же команда и `npx vitest run ops/vps/test/stores.test.ts` при наличии PG config. Expected: PASS.
- [ ] **Step 5: Commit**
  `git add .github/workflows/release.yml tests/scripts/releaseWorkflow.test.ts && git commit -m "ci: require Postgres tests for releases"`

### Task 4: LF checkout и документированный POSIX-запуск

**Files:**
- Modify: `.gitattributes`, `README.md`, `README.en.md`, `AGENTS.md`
- Test: `tests/scripts/testEnvironment.test.ts`

**Interfaces:**
- Consumes: свежий checkout и существующие команды Node 24.
- Produces: `* text=auto eol=lf`; инструкция полного прогона в Linux/WSL с `shellcheck`, `rsync`, `flock` и Postgres.

- [ ] **Step 1: Написать падающий тест**
  Проверить глобальное LF-правило и наличие WSL/Linux инструкции в обеих README.
- [ ] **Step 2: Проверить красный тест**
  Run: `npx vitest run tests/scripts/testEnvironment.test.ts`. Expected: FAIL.
- [ ] **Step 3: Исправить attributes и документацию**
  Добавить глобальное правило, описать обязательный полный запуск в Linux/WSL и зависимости, синхронизировать AGENTS.
- [ ] **Step 4: Проверить зелёный тест и свежий checkout**
  Run: focused test и `git -c core.autocrlf=false clone ...`. Expected: PASS и отсутствие CRLF в текстовых файлах.
- [ ] **Step 5: Commit**
  `git add .gitattributes README.md README.en.md AGENTS.md tests/scripts/testEnvironment.test.ts && git commit -m "test: document POSIX test environment"`

### Task 5: Полная проверка ветки

**Files:**
- Verify only, без изменений по умолчанию.

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: отчёт с командами, результатами и оставшимися ограничениями.

- [ ] **Step 1: Проверить focused и полные тесты**
  Run: `npm test` в Linux/WSL или GitHub CI; локально отдельно полный Postgres suite и регрессии, доступные в окружении.
- [ ] **Step 2: Проверить сборки и UI**
  Run: `npm run build`, `npm run build:mobile`, `npm run check:boot`, `npm run check:overflow`, Android `testDebugUnitTest assembleDebug`, admin typecheck.
- [ ] **Step 3: Проверить чистоту дерева и main**
  Run: `git status --short`, `git diff --check`, `git log --oneline main..HEAD`, `git rev-parse main`.
  Expected: только разрешённые пользовательские untracked файлы, `main` на исходном SHA.
- [ ] **Step 4: Доложить без push и merge**
  Указать ветку, коммиты, проверки, ссылки на изменённые файлы и что требуется для PR.
