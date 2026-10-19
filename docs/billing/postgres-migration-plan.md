# План переезда биллинга OMP с SQLite на PostgreSQL

Статус: **план одобрен Andy 19.10.2026**. PR 1 (стабильные id строк) — в работе.
Основа: `main` f9d025b (включая #147: `baseDevices`, `limitOverride`, `bonusSlots`, `meta.limitModel`).

## Решения Andy (19.10.2026)

| Вопрос | Решение |
|---|---|
| Окно переключения | будняя ночь, 03:00–04:00 МСК, пользователей не предупреждаем |
| Пароль базы | отдельная строка `BILLING_PG_PASSWORD` в `/opt/omp-vps/.env`, генерируется на сервере, нигде не печатается |
| Данные PG | `/opt/omp-vps/data/postgres` (bind) |
| Бэкапы | ежечасно с хранением 48 ч + ежедневно 30 дней, копия на NAS |
| Секреты в `settings` | выносятся в `.env` отдельной задачей позже (не в этом переезде) |
| ЮMoney в окне | отвечаем 503, ЮMoney повторяет уведомление |
| Хранение журналов | аудит 1 год, попытки активации 90 дней |
| Путь отката на SQLite | держим 4 недели после переключения |
| Версия | PostgreSQL 17 |

---

## 0. Что есть сейчас (коротко)

- `ops/billing/src/store.mjs`: SQLite-файл `billing.db` (через `node:sqlite`, Node 24), таблица `snapshot(id=1, data TEXT)` — **весь стейт одним JSON**:
  `settings, accounts, subscriptions, codes, sessions, attempts, payments, webhooks, promos, links, adminLogins, adminCliLogins, supportMessages, supportReplies, supportClosed, audit, outbox, purchases, meta` + любые неизвестные ключи сохраняются как есть.
- Рядом нормальные таблицы (`registry.mjs`): `devices`, `refresh_tokens`, `kv` (`token_secret`, если не задан `BILLING_TOKEN_SECRET`). `syncRegistry()` синхронизирует `devices` со снапшотом в той же транзакции.
- `updateState(file, fn)`: прочитать весь JSON → чистая функция из `logic.mjs`/`deviceAdmin.mjs` → записать весь JSON. Сериализация — промис-цепочка в одном процессе.
- `readState()` синхронный, вызывается ~74 раза в `server.mjs`, плюс `bot.mjs`, тесты (14 файлов, ~270 тестов).
- Миграции формы данных — функции в `normalizeState()` по флагам `meta` (`deviceBase`, `extraMonthly`, `limitModel`) + `migrateTruncatedIps`, `enrichActors`.
- Время везде — миллисекунды (`Date.now()`), «нет значения» часто = `0` или `''`, бонус «навсегда» = `until: null`.
- Логи с потолком: `attempts` 200, `webhooks` 200, `audit` 200, `supportMessages` 400, `supportReplies` 200, `purchases` 2000, `links` 80, `adminCliLogins` 20, `swaps` 20 на подписку, `bonusSlots` 50 на подписку.

Главное следствие: `logic.mjs` (~2300 строк) — чистые функции над целым стейтом. Переписывать их на SQL разом — дорого и рискованно. План ниже сохраняет их на первом этапе и переносит хранение под ними.

---

## 1. Нормализованная схема

Принципы:
- Время — `timestamptz` (в маппере ↔ ms). `0`/`''` в коде ↔ `NULL` в БД там, где это «нет значения»; маппер обязан делать обратное преобразование точно (проверяется чексуммами, раздел 3).
- Идентификаторы — `text` (существующие `randomId()`), чтобы не переписывать ссылки и метки оплат `buy:<id>`, `sub:<id>`.
- Деньги — `numeric(12,2)` + исходная строка суммы ЮMoney (`amount_raw`), потому что сейчас сумма хранится строкой и `money()` её парсит.
- Telegram id — `text` (как сейчас; в коде везде строки).
- У каждой «бизнес»-таблицы колонка `extra jsonb NOT NULL DEFAULT '{}'` — **для неизвестных полей**, чтобы миграция была без потерь и обратный экспорт давал тот же JSON. Это единственное «широкое» использование JSONB; по мере уборки кода поля переезжают в колонки, `extra` пустеет.

### 1.1 Таблицы

**Служебные**
| Таблица | Колонки | Ключи / индексы |
|---|---|---|
| `schema_migrations` | `version text`, `applied_at` | PK `version` |
| `kv` | `key text`, `value text` | PK `key`. `token_secret`, `store_version` (счётчик записей), `cutover_at`, флаги `meta.*` |
| `settings` | `key text`, `value jsonb`, `updated_at` | PK `key`. JSONB оправдан: ~35 разнородных настроек (числа, строки, bool), меняются из админки, схема гибкая. Валидация — в коде (`baseDevices()`, `graceDays()` и т.п.). Внимание: тут же лежат секреты (`botToken`, `yoomoneySecret`, `smtpPass`, `jackettApiKey`, `indexerPass`, `adminHash/Salt`) — см. вопросы |
| `migration_runs` | `id`, `source_sha256`, `started_at`, `finished_at`, `report jsonb` | Журнал прогонов переноса (отчёт сверки — JSONB оправдан, это документ) |
| `legacy_state` | `key text`, `value jsonb` | Неизвестные top-level ключи снапшота и `outbox` (сейчас не используется кодом). Если при dry-run пусто — таблица остаётся пустой |

**Аккаунты и подписки**
| Таблица | Колонки | Ключи / индексы |
|---|---|---|
| `accounts` | `id`, `email`, `telegram_id`, `telegram_username`, `telegram_name`, `created_at`, `extra` | PK `id`; `UNIQUE (telegram_id) WHERE telegram_id <> ''`; индекс `lower(email) WHERE email <> ''` (уникальность — только после проверки данных) |
| `account_devices` | `account_id`, `device_id`, `position` | PK `(account_id, device_id)`; индекс `device_id`. Это `accounts[].linkedDevices` (связь телефон↔Telegram) |
| `subscriptions` | `id`, `account_id` FK, `product`, `paid_until`, `device_limit` (зеркало для отката), `limit_override smallint NULL CHECK 1..20`, `extra_slots int ≥0`, `extra_until`, `credit_rub int ≥0`, `swaps_reset_at`, `created_at`, `extended_at`, `extra` | PK `id`; индекс `(account_id, product, paid_until DESC)` (`mainSubscription`/`anySub`); индекс `paid_until` (напоминания, отчёты) |
| `bonus_slots` | `id`, `subscription_id` FK, `count smallint CHECK 1..20`, `until NULL`=навсегда, `reason`, `source` (`admin`/`promo`), `promo_id NULL` FK, `granted_at` | PK `id`; индекс `(subscription_id)`. Отдельная таблица — потому что бонусы живут дольше смены базы и их надо отчётно считать |
| `device_swaps` | `id bigserial`, `subscription_id` FK, `at`, `device_prefix` | индекс `(subscription_id, at DESC)` |
| `reminders` | `subscription_id` FK, `paid_until`, `kind` (`d3/d1/d0/end`), `sent_at NULL`, `tries smallint` | PK `(subscription_id, paid_until, kind)` — «одно напоминание на вид и дату окончания» становится ограничением БД |

**Коды, сессии, реестр устройств**
| Таблица | Колонки | Ключи / индексы |
|---|---|---|
| `activation_codes` | `id`, `subscription_id` FK, `hash`, `plain NULL` (показ кода до привязки), `device_id NULL`, `bound_at NULL`, `last_seen_at`, `last_ip_net`, `revoked bool`, `created_at`, `extra` | PK `id`; `UNIQUE (hash)`; индекс `(subscription_id) WHERE NOT revoked`; индекс `(device_id) WHERE NOT revoked AND device_id IS NOT NULL` (`deviceAccess`) |
| `legacy_sessions` | `hash`, `code_id` FK, `created_at`, `upgraded_at NULL` | PK `hash`; индекс `code_id`. Уйдёт после `BILLING_LEGACY_TOKENS=0` |
| `devices` | как сейчас (`subscription_id`, `account_id`, `code_id`, `device_id`, `name`, `platform`, `created_at`, `bound_at`, `last_seen_at`, `last_ip_net`, `status`, `revoked_at`, `revoke_reason`, `clone_at`, `clone_count`) | PK `id`; FK `code_id`→`activation_codes`, `subscription_id`→`subscriptions`; индексы `(code_id, status)`, `(subscription_id, status)`; **`UNIQUE (code_id) WHERE status='active'`** — инвариант «одна активная строка на код», который сейчас чинит `syncRegistry` (`duplicate`) |
| `refresh_tokens` | как сейчас | PK `hash`; FK `device_row_id`→`devices ON DELETE CASCADE`; индекс `device_row_id`; индекс `expires_at` (чистка) |

**Деньги и промо**
| Таблица | Колонки | Ключи / индексы |
|---|---|---|
| `purchases` | `id`, `kind CHECK in ('new','sub','dev')`, `account_id`, `subscription_id`, `price numeric`, `extras`, `credit`, `add_extra`, `paid_until`, `currency`, `at` | PK `id`; индексы `(account_id, at)`, `(subscription_id, at)` |
| `payments` | `id` (новый стабильный id), `operation_id`, `label`, `purchase_id NULL` FK (из `buy:<id>`), `account_id NULL`, `amount numeric`, `amount_raw text`, `currency`, `at`, `error NULL`, `pending bool`, `credited int NULL`, `extra` | PK `id`; индексы `(at)`, `(account_id, at)`, `(operation_id)`; **частичный уникальный** `(operation_id) WHERE NOT pending AND coalesce(error,'') <> 'rejected'` — защита от двойного зачисления на уровне БД (повторяет `seenPayment`). Включать только если dry-run на копии прода не нашёл нарушений |
| `promos` | `id`, `code`, `days`, `max_uses`, `bonus_slots`, `bonus_days`, `created_at`, `revoked` | PK `id`; `UNIQUE (code) WHERE NOT revoked` |
| `promo_uses` | `promo_id` FK, `account_id` FK, `subscription_id`, `code` (сейчас там лежит выданный код активации), `at` | PK `(promo_id, account_id)` — «один аккаунт не активирует промо дважды» становится ограничением; `max_uses` проверяется под блокировкой строки промо |

**Журналы и поддержка** (append-only, без потолка в БД; потолок — только при загрузке в стейт, чистка — ретенцией)
| Таблица | Колонки | Индексы |
|---|---|---|
| `audit` | `id bigserial`, `at`, `action`, `detail`, `actor_kind`, `actor_id`, `actor_label`, `account_id` | `(at DESC)`, `(action, at DESC)`, `(account_id, at DESC)` |
| `activation_attempts` | `id bigserial`, `at`, `hash`, `device_id`, `ok`, `reason`, `account_id` | `(at DESC)`, `(account_id, at DESC)` |
| `webhook_problems` | `id bigserial`, `at`, `kind`, `operation_id`, `label`, `amount`, `extra` | `(at DESC)` |
| `support_messages` | `id`, `telegram_id`, `text`, `direction`, `via`, `at` | `(telegram_id, at)` |
| `support_replies` | `key` (`chatId:messageId`), `telegram_id`, `at` | PK `key` |
| `support_closed` | `telegram_id`, `closed_at` | PK `telegram_id` |

**Короткоживущие токены**
| Таблица | Колонки | Ключи |
|---|---|---|
| `device_links` | `token`, `device_id`, `account_id`, `created_at`, `expires_at`, `used_at` | PK `token`; индекс `expires_at` |
| `admin_logins` | `token`, `telegram_id`, `created_at`, `expires_at`, `confirmed_at`, `consumed_at`, `denied_at` | PK `token` |
| `admin_cli_logins` | `hash`, `created_at`, `expires_at`, `consumed_at` | PK `hash` |

Замечание: `links` и `adminLogins` сейчас хранят сырой токен. Перенос — как есть (иначе живые ссылки сломаются), а хэширование — отдельной задачей.

### 1.2 Эффективный лимит устройств в схеме
Лимит **не хранится** (как и сейчас), а вычисляется: `coalesce(limit_override, settings.baseDevices) + sum(bonus_slots.count where until is null or until > now) + (extra_slots if now < extra_until + graceDays)`. На первом этапе считает `logic.deviceLimitNow()`; позже можно добавить SQL-представление `v_device_limit` для отчётов, но источником правды остаётся одна функция в коде.

---

## 2. Слой доступа к данным

### 2.1 Интерфейс репозитория
Новый модуль `src/db/` со стором, выбираемым через `BILLING_STORE=sqlite|postgres` (по умолчанию `sqlite` до переключения):

```js
// src/db/index.mjs
export async function createStore(env) // → Store
interface Store {
  engine: 'sqlite' | 'postgres';
  read(): Promise<State>;                    // весь стейт (из кэша, если версия не менялась)
  update(fn): Promise<Result>;               // тот же контракт, что updateState: fn(state) → { state, result }
  registry: RegistryRepo;                    // devices / refresh_tokens / kv, все методы async
  info(): Promise<StorageInfo>;              // для админки и /health
  close(): Promise<void>;
}
interface RegistryRepo {
  deviceRow(id), activeRowForCode(codeId), listDevices(subId),
  revokeRow(id, reason, now), setRevokeReason(id, reason), touchRow(id, opts),
  tokenSecret(env), verifyAccess(...), refreshPair(...), upgradePair(...)
}
```

- `SqliteStore` — обёртка над текущим `store.mjs`/`registry.mjs` (поведение не меняется).
- `PgStore` — `pg` (node-postgres) с `Pool` (`max: 10`, `idleTimeoutMillis: 30000`, `statement_timeout` 5 с, `application_name: omp-billing`), строка подключения из `BILLING_DATABASE_URL`.
- Логика (`logic.mjs`, `deviceAdmin.mjs`) **не меняется** на первом этапе — она по-прежнему работает со стейтом.

### 2.2 Как `PgStore.update()` пишет
1. `BEGIN` → `SELECT pg_advisory_xact_lock(<константа billing>)` — глобальная сериализация записей, как сейчас промис-цепочка, но корректная и между процессами.
2. Загрузить стейт (из кэша, если `kv.store_version` совпадает, иначе из таблиц).
3. `fn(state)` → новый стейт.
4. **Diff по строкам**: для каждой коллекции сравнить строки по `id` и хэшу канонического JSON строки → `INSERT … ON CONFLICT DO UPDATE` / `DELETE` только изменённых. Для журналов (`audit`, `attempts`, `webhooks`, `support_messages`) — только `INSERT` новых; обрезка потолком в стейте **не удаляет** строки в БД.
5. Синхронизация `devices` (порт `syncRegistry` на SQL) в той же транзакции.
6. `UPDATE kv SET value = value+1 WHERE key='store_version'` → `COMMIT` → обновить кэш.
7. Ошибка → `ROLLBACK`, кэш сбрасывается.

Пререквизит: **у каждой строки стабильный `id`**. Его не было у `payments`, `attempts`, `webhooks`, `audit`, `swaps`, `promo.uses`. PR 1 добавляет `id` в момент создания строки и бэкфилл в `normalizeState` (`migrateRowIds`, флаг `meta.rowIds = 1`), ещё на SQLite:
- старые строки получают **детерминированный** id (`sha256(коллекция, позиция, содержимое)`, 16 hex, как `randomId()`), поэтому каждое чтение одного и того же снапшота даёт те же id, а первая запись их сохраняет;
- новые строки — `randomId()` при создании; принятый ЮMoney (или админом) зависший платёж сохраняет id зависшей строки;
- повторяющийся id в журнальных строках заменяется; у сущностей (аккаунты, подписки, коды, покупки, промо) только заполняется отсутствующий;
- бэкфилл идёт на каждом чтении и заполняет только пустое, поэтому строки, дописанные старым образом после отката, получат id при следующем чтении; старый образ поле `id` и `meta.rowIds` сохраняет (строки копируются через spread).

### 2.3 Чтение
- `read()` возвращает кэшированный неизменяемый объект; при каждом запросе проверка дешёвая — `SELECT value FROM kv WHERE key='store_version'` (или без проверки, пока процесс один; включим проверку сразу, она стоит <1 мс).
- Полная загрузка: ~20 `SELECT` в одном `REPEATABLE READ` read-only транзакции; на текущих объёмах — единицы миллисекунд.

### 2.4 Async-рефакторинг
- `readState(file)` (синхронный) → `await store.read()` во всех ~74 местах `server.mjs`, в `bot.mjs`, `botPoll.mjs`, `adminLoginLink.mjs`.
- Функции `registry.mjs` переходят на `await repo.*`. `inTx`/`BEGIN IMMEDIATE` → `client.query('BEGIN')` + `SELECT … FOR UPDATE` по строке `refresh_tokens`/`devices`.
- Правило ревью: между `await read()` и решением о записи состояние может устареть — решения о записи принимаются **только внутри `update(fn)`**.

### 2.5 Дальнейшая эволюция (после стабилизации)
Горячие пути переводятся на точечные запросы без загрузки всего стейта: проверка доступа в `/v1/search` (код + подписка + бонусы), страницы платежей/аудита (`LIMIT/OFFSET` в SQL), `adminFind`, финансовый отчёт (`SUM … GROUP BY`). Глобальная advisory-блокировка постепенно заменяется на `SELECT … FOR UPDATE` по подписке/промо.

---

## 3. Перенос данных из `billing.db`

Скрипт `ops/billing/scripts/migrate-sqlite-to-pg.mjs`, запускается в образе биллинга (там есть Node 24 и `node:sqlite`):

```
docker compose -f docker-compose.yml -f docker-compose.nuc.yml run --rm --no-deps \
  -e BILLING_STORE=postgres billing node scripts/migrate-sqlite-to-pg.mjs \
  --source /data/billing.migrate.db [--dry-run] [--force]
```

### 3.1 Алгоритм
1. **Источник — копия**: `billing.migrate.db`, сделанная из `billing.db` при остановленных записях (`VACUUM INTO` через node-скрипт или `cp` при остановленном контейнере). Посчитать `sha256` файла.
2. Прочитать снапшот **через тот же `normalizeState()`**, что и прод (применятся все `migrate*`, включая `migrateLimitModel` из #147), + таблицы `devices`, `refresh_tokens`, `kv`.
3. Применить миграции схемы PG (`schema_migrations`).
4. **Защита от затирания**: если `kv.cutover_at` уже стоит (PG стал основным) — отказ без `--force`.
5. Одна транзакция: `TRUNCATE` всех бизнес-таблиц → вставка в порядке FK (accounts → subscriptions → bonus/swaps/reminders → codes → sessions → devices → refresh_tokens → purchases → payments → promos → promo_uses → журналы → токены → settings → kv). Пакетная вставка через `INSERT … SELECT * FROM unnest(...)` / `COPY`.
6. Сверка (3.2) **внутри той же транзакции**; при любом расхождении — `ROLLBACK` и отчёт. При успехе — запись в `migration_runs` и `COMMIT`.

Идемпотентность: повторный прогон с тем же источником даёт то же содержимое (TRUNCATE + reload в одной транзакции); `--dry-run` всегда завершает `ROLLBACK`, оставляя только отчёт.

### 3.2 Сверка
- **Количества** по каждой коллекции и таблице: `snapshot.accounts.length == count(accounts)` и т.д., `devices` и `refresh_tokens` — 1:1.
- **Чексуммы по подписке**: канонический JSON (ключи отсортированы, ms, `null/0/''` нормализованы одинаково) из SQLite-стейта и из стейта, **заново загруженного из PG через `PgStore`**:
  `sub + её activation_codes + bonus_slots + swaps + reminders + devices(+ refresh_tokens hashes)` → `sha256`. Должны совпасть все.
- **Поведенческая сверка на фиксированном `now`** (момент запуска) для каждой подписки, сравнение старого и нового стейта:
  `deviceLimitNow`, `limitBreakdown(...).text` и `.total`, `subAccess` (paid/grace/accessUntil), `activeExtras`, `activeBonus`, `boundDevices`, `codeWithinLimit` для каждого привязанного кода, `renewalPrice` (с доп. устройствами и без), `creditOf`, `swapStatus`.
- **Глобальные**: `financeReport(now)` (суммы день/неделя/месяц), `dueReminders(now)`, `adminSummary(now)` — равны.
- **Платежи**: `sha256` отсортированного списка `(operation_id, label, amount_raw, at, error, pending)`; список нарушений будущего уникального индекса по `operation_id` (если есть — индекс не создаётся, вопрос Andy).
- **Настройки**: сравнение по ключам; в отчёт попадают только имена ключей и `совпало/нет`, **значения секретов не печатаются никогда**.
- Отчёт: JSON + короткий человекочитаемый вывод (числа и id подписок с расхождениями, без персональных данных и секретов).

### 3.3 Обратный экспорт (для отката)
`scripts/pg-to-sqlite.mjs`: PG → новый `billing.db` (снапшот JSON + `devices`/`refresh_tokens`/`kv`) с той же сверкой в обратную сторону. Тест в CI: SQLite → PG → SQLite даёт идентичные чексуммы.

---

## 4. Docker

В `ops/vps/docker-compose.yml` (и зеркально описано в README, правка — в репо, на сервер — только выкаткой):

```yaml
  postgres:
    image: postgres:17-alpine          # пин на минор: postgres:17.x-alpine
    container_name: omp-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: omp_billing
      POSTGRES_USER: omp_billing
      POSTGRES_PASSWORD: ${BILLING_PG_PASSWORD:?Set BILLING_PG_PASSWORD in .env}
      TZ: UTC
    command: ["postgres", "-c", "shared_buffers=128MB", "-c", "max_connections=30",
              "-c", "log_min_duration_statement=500"]
    volumes:
      - ./data/postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U omp_billing -d omp_billing"]
      interval: 10s
      timeout: 5s
      retries: 6
    networks: [omp]
    # порт не публикуется — доступ только из сети omp

  billing:
    environment:
      BILLING_STORE: ${BILLING_STORE:-sqlite}
      BILLING_DATABASE_URL: postgres://omp_billing:${BILLING_PG_PASSWORD:-}@postgres:5432/omp_billing
    depends_on:
      postgres:
        condition: service_healthy
```

- **Порт наружу не открывается**, `ports:` нет. Добавить `postgres` в `NO_PROXY` биллинга (там `HTTP_PROXY` на warp).
- **Данные**: `/opt/omp-vps/data/postgres` (bind, рядом с `data/billing`) — решение Andy. Владелец каталога — uid 70 (postgres в alpine), права 700.
- **Пароль** — `BILLING_PG_PASSWORD` в `/opt/omp-vps/.env` (одобрено Andy; добавляется при выкатке PR с Docker, не раньше). Генерация на сервере без вывода на экран, например:
  `umask 077; printf 'BILLING_PG_PASSWORD=%s\n' "$(openssl rand -hex 24)" >> /opt/omp-vps/.env`
  (hex — чтобы не экранировать символы в URL). Значение нигде не печатается: ни в чате, ни в логах, ни в отчётах (`docker compose config` не выводить целиком).
- `BILLING_STORE` задаётся в `docker-compose.nuc.yml` (не в `.env`), чтобы переключение было коммитом в репо, а не правкой секретов.
- Образ биллинга: добавить зависимость `pg` (пин версии, `package-lock`), проверить, что `start.sh`/Dockerfile ставят её в образ.
- Ресурсы NUC: Postgres 17 с такими настройками ~80–150 МБ RAM; база на текущих объёмах — десятки МБ.
- Контейнер `postgres` поднимается **заранее** (пустой) — за день-два до окна, чтобы проверить healthcheck, бэкап и восстановление.

---

## 5. Бэкапы

Скрипт `ops/vps/pg-backup.sh` (в репо) → на NUC `/usr/local/bin/omp-pg-backup`, cron `/etc/cron.d/omp-pg-backup`:

```sh
#!/bin/sh
set -eu
umask 077
DIR=/opt/omp-backups/pg
TS=$(date +%Y%m%d-%H%M)
mkdir -p "$DIR/hourly" "$DIR/daily"
TMP="$DIR/.billing-$TS.dump.tmp"
docker exec omp-postgres pg_dump -U omp_billing -d omp_billing -Fc -Z 6 > "$TMP"
docker exec -i omp-postgres pg_restore --list < "$TMP" > /dev/null   # дамп читается
mv "$TMP" "$DIR/hourly/billing-$TS.dump"
[ "$(date +%H)" = "03" ] && cp "$DIR/hourly/billing-$TS.dump" "$DIR/daily/"
find "$DIR/hourly" -name '*.dump' -mtime +2  -delete     # ~48 часовых
find "$DIR/daily"  -name '*.dump' -mtime +30 -delete     # 30 суточных
# копия на NAS (хост и путь — из конфигурации, не IP)
if [ -n "${NAS_BACKUP_TARGET:-}" ]; then rsync -a --delete "$DIR/" "$NAS_BACKUP_TARGET/"; fi
```

cron: `17 * * * * root /usr/local/bin/omp-pg-backup >> /var/log/omp-pg-backup.log 2>&1`

- Дампы содержат секреты из `settings` и персональные данные → каталог `root:root 700`, файлы `600`.
- Перед каждой выкаткой биллинга — внеочередной дамп (`/opt/omp-backups/pg/predeploy-<ts>.dump`) рядом с привычным `billing-<ts>`.
- Мониторинг: `/health` или jackett-monitor проверяет, что свежайший дамп младше 2 часов, иначе уведомление админу в Telegram.
- Копия на NAS (решение Andy): после успешного дампа `rsync` каталога на NAS по имени хоста (не по IP), на NAS хранятся те же 48 ч + 30 дней. Детали доступа — открытый вопрос ниже.
- Позже (не сейчас): WAL-архив для восстановления на момент времени.

**Восстановление** (вписать в `ops/vps/README.md`):
1. `docker compose … stop billing`
2. Дамп на всякий случай: `omp-pg-backup`
3. `docker exec omp-postgres dropdb -U omp_billing --if-exists omp_billing_restore && docker exec omp-postgres createdb -U omp_billing omp_billing_restore`
4. `docker exec -i omp-postgres pg_restore -U omp_billing -d omp_billing_restore --no-owner < /opt/omp-backups/pg/…/billing-XXXX.dump`
5. Проверка: `node scripts/verify-pg.mjs --db omp_billing_restore` (количества, чексуммы, лимиты).
6. Переключение: `ALTER DATABASE omp_billing RENAME TO omp_billing_old; ALTER DATABASE omp_billing_restore RENAME TO omp_billing;`
7. `docker compose … up -d billing`, проверка `/health`, админка, бот. `omp_billing_old` удалить через неделю.
- Раз в месяц — пробное восстановление в `omp_billing_restore` (можно тем же cron, с отчётом в лог).

---

## 6. Выкатка

### 6.1 Подготовка (до окна)
- PR 1–4 смёржены (после одобрения Andy и зелёного CI: build, android, billing), образ собран, на проде всё ещё `BILLING_STORE=sqlite`.
- Andy одобрил добавление `BILLING_PG_PASSWORD` в `.env`; контейнер `omp-postgres` поднят пустым, бэкап/восстановление проверены.
- **Генеральная репетиция** за 1–2 дня: копия прод-`billing.db` → `migrate --dry-run` в отдельную базу `omp_billing_dryrun` → отчёт сверки = 0 расхождений; замер длительности.
- Проверить поведение ЮMoney при ответе 503 на уведомление (по документации повторяет; подтвердить до окна).

### 6.2 Окно (оценка 20–30 мин, запись недоступна ~10 мин)
Время — будняя ночь, 03:00–04:00 МСК (решение Andy), без уведомления пользователей.
1. **Бэкап**: `cp -a data/billing` в `/opt/omp-backups/billing-<ts>` + git-тег `rollback-<ts>`, как обычно.
2. **Только чтение**: перезапуск биллинга с `BILLING_READONLY=1` и `BILLING_BOT_POLL=0`.
   - `/v1/search`, `/v1/me`, проверка access-токенов — работают (телефоны ищут).
   - Активация, refresh токенов, оплата, промо, админка на запись → `503 maintenance` (приложение повторит; access-токены живут 24 ч).
   - Вебхук ЮMoney → 503, ЮMoney повторяет уведомление (решение Andy). После окна — сверка с историей операций ЮMoney.
   - Бот не опрашивает Telegram — апдейты ждут на стороне Telegram (хранятся до 24 ч), ничего не теряется.
3. Снять копию `billing.migrate.db`, посчитать `sha256`.
4. `migrate-sqlite-to-pg.mjs` → отчёт сверки. Любое расхождение → стоп, снять read-only, разбор (откат не нужен: SQLite не менялся).
5. **Переключение**: `BILLING_STORE=postgres`, `BILLING_READONLY=0`, `BILLING_BOT_POLL=1` → `up -d billing`. В `kv` пишется `cutover_at`.
6. **Проверка** (10–15 мин):
   - `/health`: `storage.engine = postgres`, poll ok; админка → «Хранилище»: postgres.
   - Бот: `/start`, меню «Устройства» с разбивкой лимита.
   - S21: поиск работает, refresh токена проходит.
   - Админка: платежи, промо, аудит на месте (только просмотр, настройки не трогать).
   - Логи `omp-billing` и `omp-postgres` без ошибок 30 мин; через час — первый плановый дамп появился.
7. Старый `billing.db` остаётся на месте и **не используется** (заморожен) до конца периода отката.

### 6.3 Откат на SQLite
- **До шага 5**: просто снять read-only — данные не менялись.
- **После переключения** (в течение периода отката — 4 недели, решение Andy):
  1. read-only + poll off;
  2. `pg-to-sqlite.mjs` → новый `billing.db` со сверкой;
  3. `BILLING_STORE=sqlite` → `up -d billing`; при необходимости — образ по тегу `rollback-<ts>` (#147 совместим с откатом: `deviceLimit` зеркалится).
  Записи, сделанные в PG, сохраняются.
- **Аварийно** (PG недоступен и экспорт невозможен): вернуть замороженный `billing.db` + сверить платежи за период с историей ЮMoney вручную. Только как крайняя мера.
- Код SQLite-хранилища удаляется отдельным PR после 4 недель.

---

## 7. Тесты и CI

- В `.github/workflows/ci.yml`, job `billing` (обязательная проверка) — сервис-контейнер:
  ```yaml
  services:
    postgres:
      image: postgres:17-alpine
      env: { POSTGRES_USER: test, POSTGRES_PASSWORD: test, POSTGRES_DB: billing_test }  # тестовый, не секрет
      ports: ["5432:5432"]
      options: >-
        --health-cmd "pg_isready -U test" --health-interval 5s --health-timeout 5s --health-retries 10
  ```
  и шаги `npm test` дважды: `BILLING_TEST_STORE=sqlite` и `BILLING_TEST_STORE=postgres` с `BILLING_TEST_DATABASE_URL=postgres://test:test@localhost:5432/billing_test`. Пока SQLite жив — гоняем оба.
- Изоляция: каждый тестовый файл — своя схема (`CREATE SCHEMA t_<random>`, `search_path`), чтобы vitest шёл параллельно; в конце `DROP SCHEMA … CASCADE`.
- Существующие ~270 тестов переводятся на фабрику стора (`await createTestStore()`) вместо путей к `billing.db`.
- Новые тесты:
  - **контракт репозитория**: одинаковые сценарии на обоих сторах (чтение/запись, diff, журналы не удаляются при обрезке, кэш и версия);
  - **перенос**: фикстуры `billing.db` (синтетические, без реальных данных), включая старые формы (без `meta`, `deviceBase: 1`, без `limitModel`, полный IP) → migrate → сверка 0; повторный прогон даёт то же; SQLite → PG → SQLite идентично;
  - **конкурентность** (только PG): две активации на последний слот — ровно одна успешна; параллельные погашения промо с `maxUses=1`; дубль вебхука с тем же `operation_id` — одно зачисление; параллельный refresh одного токена;
  - **лимит устройств**: для набора подписок (база, override, бонусы навсегда/до даты/истёкшие, купленные в льготном периоде) `deviceLimitNow` и `limitBreakdown` одинаковы на обоих сторах;
  - **read-only режим**: записи → 503, поиск работает.
- Миграции схемы проверяются в CI «с нуля» и «поверх предыдущей версии».

---

## 8. Разбивка на PR, риски, сроки

| # | PR | Что внутри | Оценка |
|---|---|---|---|
| 1 | **Стабильные id строк** (на SQLite) | `id` у всех строк при создании, бэкфилл `migrateRowIds` / `meta.rowIds`, тесты. Поведение не меняется | 0,5 дня (в работе) |
| 1b | **Store interface + async** (на SQLite) | `createStore`, `SqliteStore`, все `readState` → `await store.read()`, `registry` async. Поведение не меняется | 2 дня |
| 2 | **PgStore + схема** | SQL-миграции, `pg` Pool, маппер стейт↔строки, diff-запись, advisory lock, кэш по `store_version`, реестр на PG; CI-матрица sqlite/postgres; по умолчанию `sqlite` | 4–5 дней |
| 3 | **Перенос и откат** | `migrate-sqlite-to-pg.mjs`, `verify-pg.mjs`, `pg-to-sqlite.mjs`, `BILLING_READONLY`, движок в `/health` и админке; фикстуры | 2–3 дня |
| 4 | **ops: Postgres и бэкапы** | сервис `postgres` в `ops/vps/docker-compose*.yml`, `NO_PROXY`, `pg-backup.sh` + cron, инструкция восстановления, README | 1 день |
| — | Подготовка прода | одобрение `.env`, запуск пустого PG, проверка бэкапа, репетиция на копии | 0,5 дня |
| — | **Окно переключения** | раздел 6 | ~1 час |
| 5 | Уборка (через 2–4 недели) | удаление SQLite-пути, точечные SQL-запросы для горячих путей, row-level блокировки, ретенция журналов, хэширование `links`/`adminLogins` | 1–2 недели, по частям |

Итого до переключения: **~2–2,5 недели** работы (PR 1–4) + репетиция + окно.

**Риски и меры**
| Риск | Мера |
|---|---|
| Регрессии при переводе ~74 мест на async (гонки между `await`) | Решения о записи только внутри `update(fn)`; PR 1 отдельно на SQLite, тесты без изменений поведения |
| Ошибки маппинга ms↔timestamptz, `0/''`↔`NULL`, `until:null` (бонус навсегда) | Поведенческая сверка лимитов/доступа/цен на фиксированном `now`, round-trip тест |
| Потеря неизвестных полей | Колонки `extra jsonb`, `legacy_state`, чексуммы по каноническому JSON |
| Дубли `operation_id` в старых платежах ломают уникальный индекс | Проверка на репетиции; индекс включается только при чистых данных |
| Потеря уведомления ЮMoney в окне | 503 + повтор ЮMoney или очередь в файл; после окна сверка с историей ЮMoney |
| Секреты в дампах и отчётах | Права 600/700, отчёты без значений, пароль генерируется на сервере без вывода |
| Дополнительный сервис на одном NUC (отказ диска/контейнера) | Ежечасные дампы, мониторинг свежести, копия вне NUC, пробное восстановление |
| Откат после записей в PG | Обратный экспорт со сверкой; SQLite-путь живёт 2–4 недели |
| Два процесса пишут в одну базу (например, случайно поднятый биллинг на VPS) | Advisory lock + проверка версии кэша; VPS-биллинг не имеет доступа к PG (порт не открыт) |
| Будущий апгрейд 17 → 18 | Через `pg_dump`/`pg_restore` по той же инструкции, отдельное окно |
| Права на `data/postgres` (uid 70) | Создание каталога в PR 4/инструкции, проверка заранее |

---

## 9. Открытые вопросы

Решённые вопросы — в таблице «Решения Andy» в начале. Осталось:

1. **Уникальность платежей**: если на копии прода найдутся дубли `operation_id`, разбираем их вручную перед окном или переносим как есть без уникального индекса? (Предложение: разбираем вручную, индекс нужен.)
2. **Промокоды**: в истории активаций хранится сам выданный код активации. Оставить или хранить только ссылку на код? (Предложение: при переносе оставить как есть, убрать отдельной задачей.)
3. **Копия на NAS**: по какому имени хоста и в какой каталог, каким пользователем (SSH-ключ только на запись в этот каталог)? Нужно имя хоста, а не IP.
4. **Хранение проблемных вебхуков**: не обсуждалось; предложение — 1 год, как аудит.
