# Клиентский Sync V2

Дата: 2026-11-21
Статус: реализация по одобренной realtime-схеме

## 1. Цель

Перевести поддерживаемые устройства на revision, durable outbox и realtime delivery, не теряя локальные изменения при offline, перезапуске, двух вкладках или потере ответа. Старые устройства и любой сбой capability остаются на работающем `/v1/sync`.

## 2. Подходы

### 2.1. V2 рядом с текущим deviceDb

Выбрано. Новый IndexedDB `omp-sync-v2` содержит отдельные `records`, `outbox` и `meta`. Текущий localStorage Bag остается синхронной проекцией для экранов и fallback `/v1`. V2 включается только после реальной транзакционной проверки. Это ограничивает изменения и сохраняет откат без потери данных.

### 2.2. Полная замена deviceDb сразу

Отклонено. Все экраны сейчас синхронно читают localStorage. Одновременная замена хранилища, протокола и проекций создала бы слишком большой риск перед бетой.

### 2.3. Только WebSocket

Отклонено. HTTP V2 обязателен при недоступном сокете, а `/v1` нужен для capability failure и старого сервера.

## 3. Хранилище

IndexedDB `omp-sync-v2`, version 1:

- `records`: одна запись на SyncRecord id;
- `outbox`: `{ mutationId, accountId, row, createdAt }`, ключ mutationId;
- `meta`: account, revision, device counter, migrated flag и leader-independent status.

Одна IDB транзакция `readwrite` на `records` и `outbox` объединяет локальную запись и mutation. `mutationId` = `<deviceId>:<monotonic counter>`, counter сохраняется в meta. Ack удаляет именно mutationId, а не весь id записи: более новая локальная редакция того же id остается в outbox.

Первое включение копирует текущий Bag в records и создает outbox только для `unsentRecords(syncEpoch)`. Уже acked записи не выгружаются повторно. После hydrate records снова строят localStorage projection и вызывают `reapplyDeviceRecords`, поэтому in-memory parked не является единственным мостом к экрану.

При смене аккаунта revision и outbox нового аккаунта изолированы. Старые локальные records остаются на устройстве, но не отправляются в другой аккаунт до нового локального изменения по правилам syncEpoch.

## 4. Capability и feature flag

Флаг `omp.syncV2`: `auto` по умолчанию, `on` для явной проверки и `off` для отката.

- `off`: всегда `/v1`.
- `auto`: V2 только после успешной IDB транзакции records+outbox, наличия WebSocket и рабочего leader lease.
- Отсутствие IndexedDB, ошибка записи или неподдерживаемый WebSocket оставляет `/v1`.
- HTTP 404/405/503 от старого сервера временно возвращает `/v1`; сетевой сбой V2 не переключает протокол и не дублирует outbox в `/v1`.
- Ack V2 также обновляет старый `ackSent`, чтобы ручной откат не отправил уже принятое изменение повторно.

## 5. Sync leader

Один leader на deviceId:

- lease в localStorage с owner и timestamp, TTL 15 секунд, refresh 5 секунд;
- `BroadcastChannel('omp-sync-v2')` при наличии, иначе `storage` events;
- follower не открывает сокет и не выполняет HTTP pump, а просит leader синхронизироваться;
- leader сообщает status другим вкладкам;
- lease освобождается на pagehide, истекший owner может быть заменен;
- API отсутствия BroadcastChannel не повышает минимальную платформу: fallback использует storage events.

Запись в IDB выполняется в любой вкладке, поэтому follower не теряет локальную операцию даже если leader недоступен.

## 6. Транспорт

### 6.1. HTTP V2

`POST /v2/sync` принимает `{ since, records }`, где каждая запись содержит stable mutationId. Ответ обрабатывается атомарно:

- ack удаляет только подтвержденные mutations;
- records сливаются текущим whole-record LWW;
- revision сохраняется только вместе с обработанной страницей;
- winning records вызывают `applyPulled`;
- 500 записей запускают следующую страницу.

`mutation_expired` не применяет старый body. Мутация удаляется из outbox, выполняется rebase из текущего snapshot/records, а пользовательское новое изменение остается возможным как новая mutation.

### 6.2. WebSocket

После начального HTTP resume leader открывает `/v2/sync/ws`:

- auth с device token в сообщении, deviceId и никакого token в URL;
- resume с последним revision и обработка всех страниц changes;
- mutations с ack для новых outbox rows;
- reconnect с экспоненциальной задержкой 1-30 секунд и jitter;
- пока сокет не ready или ack недоступен используется HTTP V2, без одновременной отправки одной mutation в два транспорта;
- close/error не меняет локальные записи и не блокирует playback.

Presence продолжает работать через текущий fallback и может использовать WS presence события без отключения HTTP recovery.

## 7. UX

Существующий блок синхронизации показывает:

- «Синхронизировано» после ack и пустого outbox;
- «Offline, N изменений в очереди» при сетевом сбое;
- ошибку доступа без автоматического перехода на другой аккаунт;
- transport/revision для тестового режима, без технических подробностей обычному пользователю.

Ручная кнопка запускает leader sync. Локальный прогресс, история и пропуски доступны независимо от сети.

## 8. Совместимость

- Whole-record LWW по updatedAt/deviceId остается каноничным. HLC, per-field merge и playback conflict UX не входят в этот этап.
- `/v1/progress` и его last-arrival-wins сохраняются для старых устройств.
- Новые записи V2 видны старым устройствам через server projection `/v1`.
- Отключение флага не удаляет IDB и не меняет экраны.

## 9. Проверки и бета

Автоматически: atomic write, restart recovery, lost response, expired mutation, account switch, two-tab leader, stale lease, WS disconnect during batch, HTTP fallback, cursor monotonicity и old webOS capability fallback.

Ручной стенд перед бетой: S21, LG, Android TV и desktop; offline изменения, блокировка телефона, перезапуск ТВ, две вкладки, обрыв сети во время batch и откат флага.

После зеленого CI и стенда выпускается только бета-тег, без Telegram-поста. Стабильный релиз является отдельным решением после beta feedback.

## 10. Решения после проверки дизайна

- Локальный `omp.syncV2` хранится в localStorage. Дополнительно `/v1/me` возвращает `sync.v2`: server kill-switch через billing env, по умолчанию включен. `auto` требует и capability, и разрешения сервера. Аварийное выключение не требует обновления APK.
- IDB records зеркалируются и при `off`, включая записи `/v1`. При повторном включении IDB и текущий Bag сливаются тем же LWW; более новый Bag никогда не перезаписывается устаревшей IDB копией.
- `mutation_expired`: старая мутация удаляется из outbox и не создается заново автоматически. Остаток rolled-back batch отправляется повторно с прежними ids. Пользователь видит ошибку recovery и может создать новое изменение после rebase.
- Поврежденная или непринятая сервером запись помечается `blocked` с причиной и пропускается, не блокируя FIFO остальных. Она остается локально; новое локальное изменение того же id создает новую mutation и снимает карантин. Статус показывает ошибку, а не ложное «Синхронизировано».
- WS presence и leader-aware presence reporting не входят в этот этап. Текущий HTTP presence продолжает работать независимо, дубли heartbeat двух вкладок не влияют на records/outbox.
