# Биллинг: Postgres на NUC - запуск, бэкапы, переключение, восстановление

**Статус:** переключено 19.10.2026 в 17:13 МСК (только чтение - 75 с). Биллинг работает на Postgres, `billing.db` больше не пишется; бэкапы до переключения - `/opt/omp-backups/billing-20261019-171052` и `…-171229`.

Путь SQLite из кода удалён (PR «Billing: Postgres only»): откат на `billing.db` больше невозможен ни правкой compose, ни старым `BILLING_STORE=sqlite` (биллинг с ним не стартует). Разделы 0, 1 и «Откат» ниже - история переключения; восстановление теперь только из дампа Postgres (раздел 2). `billing.db` лежит на диске как архив, `tools/migrateToPostgres.mjs` умеет прочитать его в пустую базу.

Ранбук к разделам 4-6 [плана](postgres-migration-plan.md). Все команды - на NUC в `/opt/omp-vps`, от root (`sudo -i`).
Сокращение: `dc` = `docker compose -f docker-compose.yml -f docker-compose.nuc.yml`.

**Секреты.** Пароль Postgres живёт только в `.env` (`BILLING_PG_PASSWORD`). Не печатать его и не запускать
`dc config` без `-q` (выводит подставленные значения), не делать `docker inspect omp-billing` / `omp-postgres` в чат или лог.
Дампы содержат настройки биллинга с токенами и персональные данные: каталог `/opt/omp-backups/pg` - root 700, файлы 600.

## 0. Первый запуск (PR с compose, BILLING_STORE остаётся sqlite)

1. **Строка в `.env`** (одобрение Andy), генерируется на сервере и не выводится:
   ```sh
   grep -q '^BILLING_PG_PASSWORD=' .env || sh -c 'umask 077; printf "BILLING_PG_PASSWORD=%s\n" "$(openssl rand -hex 32)" >> .env'
   grep -c '^BILLING_PG_PASSWORD=.\{64\}$' .env      # 1
   stat -c '%a %U' .env                             # 600 root
   ```
   Без неё compose отказывается запускать что-либо (`set BILLING_PG_PASSWORD in .env`) - поэтому строка добавляется **до** копирования нового `docker-compose.nuc.yml`.
2. `install -d -m 700 /opt/omp-backups/pg`
3. Обычная выкатка биллинга (бэкап `billing.db`, тег `rollback-<ts>`, `billing-src`, `Dockerfile.billing` - в образе появляется `pg_dump` 17) + копия `docker-compose.nuc.yml` (старую - в бэкап).
4. `dc up -d postgres` → `docker ps --filter name=omp-postgres` показывает `(healthy)`; `dc up -d --no-deps billing`.
5. Проверка:
   - `/health` 200, в логе `billing listening on 8787 (store: sqlite) pg backups on`;
   - через ~2 минуты в `/opt/omp-backups/pg` появляется `billing-YYYYMMDD-HHMMSS.dump` (дамп пока пустой базы), права `600`;
   - `/health` → `"pgBackupOk":true`; админка → Настройки → «Бэкапы Postgres»: время и размер последнего дампа;
   - порт наружу не открыт: `docker port omp-postgres` - пусто; сеть `omp-vps_pg` - `internal`.

**Дамп сейчас** (вне расписания; печатает только имя и размер или ошибку):
```sh
docker exec omp-billing node --input-type=module -e "import { backupConfig, runDump } from '/app/src/pgBackup.mjs'; console.log(JSON.stringify(await runDump(backupConfig(process.env), Date.now())))"
```

Частота и срок хранения - админка (`backupEveryHours` 1-168, по умолчанию 24; `backupKeepDays` 1-365, по умолчанию 30; самый свежий дамп не удаляется никогда).
Планировщик в биллинге смотрит раз в 10 минут. Свежесть: `/health` → `pgBackupOk` / `pgBackupAgoSec`; дамп старше `backupEveryHours + 3 ч` (или ошибка `pg_dump`) - красное предупреждение на главной админки и одно сообщение админам в Telegram (и одно, когда снова в порядке).

## 1. Переключение на Postgres (окно ~15 минут, ночью)

Перед окном: `pending` бота 0, нет неоплаченных платежей в ожидании, сухой прогон на копии прошёл (PR #151).

1. **Сухой прогон на живом Postgres** (ничего не пишет):
   ```sh
   dc run --rm --no-deps billing node src/migrateToPostgres.mjs --from /data/billing.db --report /data/pgmig-dry.json
   ```
   Выход 0 и «dry run passed». Иначе - стоп.
2. **Только чтение** (поиск и `/v1/me` работают; активация, refresh, оплата, админка на запись → 503; ЮMoney получает 503 и повторит уведомление; бот не опрашивает Telegram - апдейты ждут до 24 ч):
   ```sh
   BILLING_READONLY=1 dc up -d --no-deps billing
   docker exec omp-billing node -e "fetch('http://127.0.0.1:8787/health').then(r=>r.text()).then(console.log)"   # "readOnly":true
   ```
3. **Бэкап** `billing.db` (`sqlite3 … ".backup '/opt/omp-backups/billing-<ts>/billing.db'"`) и `docker tag …:local …:rollback-<ts>`.
4. **Перенос**:
   ```sh
   dc run --rm --no-deps billing node src/migrateToPostgres.mjs --from /data/billing.db --apply --report /data/pgmig-apply.json
   ```
   Выход 0 и «committed». Любое расхождение - транзакция откатывается сама; снять read-only (`dc up -d --no-deps billing`) и разбираться - SQLite не менялся.
5. **Проверка на Postgres, всё ещё только чтение**:
   ```sh
   BILLING_STORE=postgres BILLING_READONLY=1 dc up -d --no-deps billing
   ```
   - лог: `store: postgres … READ-ONLY`; `/health` 200;
   - админка (только просмотр): Хранилище = postgres, подписки, платежи, промо, аудит на месте;
   - телефон: поиск работает.
6. **Закрепить Postgres** в compose на сервере, чтобы любой следующий `dc up` не вернул SQLite (и тем же изменением - PR в `ops/vps/docker-compose.nuc.yml`):
   `BILLING_STORE: ${BILLING_STORE:-sqlite}` → `BILLING_STORE: ${BILLING_STORE:-postgres}`. Затем `dc up -d --no-deps billing` (без переменных - запись открыта, бот опрашивает).
7. **Проверка вживую**: `/health` (`botPollOkAgoSec` маленький, `readOnly` нет), бот `/start` и «Устройства», телефон - refresh токена проходит,
   `pending` 0 через минуту, уведомления ЮMoney (если были) дошли повторно - «Проблемы ЮMoney» в админке пусты, сверка с историей операций кошелька.
   Сразу снять «дамп сейчас» (команда выше) - это первый настоящий бэкап.
8. Логи `omp-billing` и `omp-postgres` без ошибок 30 минут.

### Откат
- **До шага 6**: `dc up -d --no-deps billing` (store из compose = sqlite, read-only снят) - `billing.db` не менялся, ничего не потеряно.
- **После шага 6**, если проверки шага 7 не прошли: вернуть `${BILLING_STORE:-sqlite}` в compose, `dc up -d --no-deps billing`. Всё, что записано в Postgres после шага 6, в `billing.db` нет - сверить вручную (платежи - по истории ЮMoney). Поэтому решение принимается в первые минуты.
- Позже - только восстановление из дампа Postgres (раздел 2). Отката на `billing.db` после реальной работы на Postgres нет (решение Andy).
- Образ: `docker tag …:rollback-<ts> …:local` + `dc up -d --no-deps billing`, если сломан сам образ.

## 2. Восстановление из дампа Postgres

Внутри `omp-postgres` локальный сокет без пароля, поэтому пароль в командах не нужен.

1. Выбрать дамп: `ls -la /opt/omp-backups/pg`.
2. Если база жива - «дамп сейчас» (раздел 0), чтобы было куда вернуться.
3. Восстановить **в отдельную базу** и проверить:
   ```sh
   docker exec omp-postgres dropdb -U omp_billing --if-exists omp_billing_restore
   docker exec omp-postgres createdb -U omp_billing omp_billing_restore
   cat /opt/omp-backups/pg/billing-YYYYMMDD-HHMMSS.dump | docker exec -i omp-postgres pg_restore -U omp_billing -d omp_billing_restore --no-owner --exit-on-error
   docker exec omp-postgres psql -U omp_billing -d omp_billing_restore -Atc \
     "select 'accounts', count(*) from accounts union all select 'subscriptions', count(*) from subscriptions union all select 'codes', count(*) from activation_codes union all select 'devices', count(*) from devices union all select 'payments', count(*) from payments"
   ```
4. Подмена (биллинг остановлен - у переименуемой базы не должно быть подключений):
   ```sh
   dc stop billing
   docker exec omp-postgres psql -U omp_billing -d postgres -c 'ALTER DATABASE omp_billing RENAME TO omp_billing_old' -c 'ALTER DATABASE omp_billing_restore RENAME TO omp_billing'
   dc up -d --no-deps billing
   ```
5. Проверка как в шаге 7 переключения. `omp_billing_old` удалить через неделю: `docker exec omp-postgres dropdb -U omp_billing omp_billing_old`.

**Пробное восстановление раз в месяц**: шаг 3 со свежим дампом, сверить количества с админкой, затем `dropdb … omp_billing_restore`.

## 3. Полная потеря каталога `data/postgres`

`dc stop billing postgres`, переместить `data/postgres` в сторону, `dc up -d postgres` (создаст пустую базу с паролем из `.env`),
затем раздел 2 с шагом 3 прямо в `omp_billing` (`createdb` не нужен - база уже создана, но пустая) и `dc up -d --no-deps billing`.
