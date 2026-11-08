# Security hardening 0.20.10 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Закрыть три подтверждённые уязвимости и смежные усиления в независимых PR, не меняя `main`.

**Architecture:** Точечные изменения существующих модулей, без новых зависимостей. Общий capped body reader используется и torrent, и indexer fetch. Все секреты остаются в тестовых заглушках или существующих секретах.

**Tech Stack:** Node 24, JS MJS, TypeScript tests, Postgres 17, Bash, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-08-security-hardening-design.md`

## Global Constraints

- Только отдельные feature-ветки и PR в `main`, сам `main` не менять.
- Без production, Telegram и NUC действий, без вывода секретов.
- Только дефис `-`, новых зависимостей нет, TDD RED-GREEN для каждого изменения.
- Каждый PR проходит build, android, billing и Greptile до доклада.

## Review Focus

- DNS hostname с публичным literal и private resolved адресами: Task 1.
- Повторный callback, отмена и истёкший token не должны привязать устройство: Task 2.
- MITM или отсутствие known_hosts не должны получить GH token: Task 3.
- Новая CSP не ломает SPA и fallback login, старый cookie не принимается: Task 4.
- Большие XML и JSON тела отклоняются до полной буферизации: Task 4.

---

### Task 1: SSRF защита `/v1/torrent`

**Files:**
- Modify: `ops/billing/src/server.mjs`, `ops/billing/test/jackettSearch.test.ts`

**Interfaces:**
- Consumes: `createApp(file, fetchImpl, opts)`.
- Produces: `opts.downloadLookup(hostname)` для тестов, production `dns.lookup(..., { all: true })`.

- [ ] **Step 1:** Тесты literal loopback/private, DNS private, DNS failure и public HTTPS.
- [ ] **Step 2:** Проверить FAIL на запросах к внутренним адресам.
- [ ] **Step 3:** Добавить IP classifier и async redirect policy, same-origin не менять.
- [ ] **Step 4:** Проверить PASS, полный Linux suite, commit и push в PR #296.

### Task 2: Подтверждение Telegram-привязки

**Files:**
- Modify: `ops/billing/src/bot.mjs`, `ops/billing/src/logic.mjs`, `ops/billing/src/server.mjs`, `ops/billing/test/botUx.test.ts`, `ops/billing/test/claim.test.ts`

**Interfaces:**
- Produces: `pendingDeviceLink(state, { token, now })`; callback `ly:<32 hex>` и существующий `ux`.
- `/v1/link/start` и `/v1/link/claim` используют `claimLimit.check(ip, deviceId)`.

- [ ] **Step 1:** Тесты: Start не меняет state и не выдаёт код, cancel, confirm, repeat и expired.
- [ ] **Step 2:** Проверить FAIL на немедленной привязке.
- [ ] **Step 3:** Реализовать prompt и callback с повторной проверкой, rate limit start.
- [ ] **Step 4:** Проверить PASS, полный Linux suite, новый PR и Greptile.

### Task 3: Проверенный SSH host key

**Files:**
- Modify: `ops/vps/ssh-deploy.sh`, `ops/vps/test/deploy.test.ts`, `.github/workflows/vps-deploy.yml`, `ops/vps/README.md`

**Interfaces:**
- Produces: обязательный `VPS_KNOWN_HOSTS`, `UserKnownHostsFile` в WORKDIR, `StrictHostKeyChecking=yes`.

- [ ] **Step 1:** Тесты отсутствия known_hosts, strict option и отсутствие GH token в scp до первой успешной проверки.
- [ ] **Step 2:** Проверить FAIL на accept-new.
- [ ] **Step 3:** Записать known_hosts, проверить сервер первым SSH, затем продолжить deploy.
- [ ] **Step 4:** Проверить PASS и shellcheck, новый PR и Greptile.

### Task 4: Заголовки и ограничения тел

**Files:**
- Create: `ops/billing/src/httpBody.mjs`
- Modify: `ops/billing/src/server.mjs`, `ops/billing/src/services.mjs`, `ops/billing/src/jackett.mjs`, admin tests и `ops/billing/test/*`

**Interfaces:**
- Produces: `readCappedBody(res, maxBytes, code)`; `__Host-omp_admin`; JSON cap 256 KiB; indexer cap 2 MiB.

- [ ] **Step 1:** Тесты no-store, CSP, cookie, old cookie rejection, small JSON, active keys и oversized XML.
- [ ] **Step 2:** Проверить FAIL на старом cookie, отсутствии CSP и полном чтении.
- [ ] **Step 3:** Реализовать общий streaming reader и остальные минимальные изменения.
- [ ] **Step 4:** Проверить PASS и полный Linux suite, новый PR и Greptile.

### Task 5: Финальная проверка

- [ ] Все четыре PR зелёные, `main` на исходном SHA, секреты не выведены.
- [ ] Доложить ссылки, результаты и оставить merge решение за Andy.
