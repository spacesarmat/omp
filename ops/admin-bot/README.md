# Админ-бот OMP (Telegram + Cloudflare Worker)

Маленький бот для администратора: в Telegram пишешь команду — бот смотрит GitHub и отвечает. Работает как
**Cloudflare Worker** (бесплатный тариф), Telegram присылает ему сообщения по **webhook**. Это **тот же бот OMP**,
что публикует релизы в канал (тот же токен, что секрет репозитория `TELEGRAM_BOT_TOKEN`) — нового бота заводить не нужно.

| Команда | Что делает |
|---|---|
| `/status` | последняя таблица монитора парсеров (`parser-monitor.json` в ветке `monitor-state`) и время проверки |
| `/check` или `/check rutor` | запускает workflow «Parser monitor» (все источники или указанные); таблицу пришлёт сам workflow, когда закончит (обычно 3–15 мин) |
| `/versions` | версии в `update.json`, `update-android.json`, `update-beta.json`, `update-android-beta.json` (ветка `gh-pages`) и даты релизов |
| `/stats` | скачивания по файлам последнего стабильного и последнего бета-релиза, всего скачиваний, звёзды, открытые issues, открытые issues монитора парсеров |
| `/ci` | последние запуски CI (main), Release, Parser monitor: ✅ / ❌ / ⏳, когда, ссылка |
| `/help` | список команд |

Бот отвечает **только** в чат `ADMIN_CHAT_ID` (по умолчанию `536445442` — личка администратора). Всем остальным —
тишина, без ответа. Каждый запрос от Telegram проверяется по секрету `WEBHOOK_SECRET` (заголовок
`X-Telegram-Bot-Api-Secret-Token`): чужой запрос на адрес Worker получает 403 и ничего не делает.

## Важно: webhook и публикация релизов

Пока у бота есть webhook, Telegram **не отдаёт обновления через `getUpdates`** (ошибка 409). Раньше `getUpdates`
использовался в одном месте: `scripts/telegram-post.mjs` после закрепления поста релиза искал в обновлениях служебное
сообщение «… закрепил(а) сообщение» и удалял его из канала. Как теперь:

- **Worker сам удаляет эти сообщения.** Telegram присылает ему служебный пост канала (`channel_post` с
  `pinned_message`) — бот удаляет его, если канал совпадает с `CHANNEL_ID` из `wrangler.toml` (по умолчанию
  `@ompplyaer`). Удаляется любое «закрепил сообщение» в этом канале (и при ручном закреплении тоже); остальные посты
  канала бот не трогает. Пустой `CHANNEL_ID` — бот канал не трогает вообще.
- **Скрипт релиза больше не зависит от `getUpdates`.** Перед поиском он спрашивает `getWebhookInfo`: если webhook
  есть — пишет в лог `a webhook is set (admin bot…)` и ничего не ищет. Если `getUpdates` всё же вернул 409 — то же
  самое. Без webhook (бот откатили) всё работает как раньше, через `getUpdates`.
- **Публикация в канал не изменилась**: `sendPhoto`/`sendMediaGroup`/`sendDocument`/`pinChatMessage` от workflow
  работают и с webhook.

Для этого webhook подписан на `message` и `channel_post` (это задаёт скрипт из шага 7), а бот должен оставаться
админом канала с правом удалять сообщения (он уже такой — релизы удаляли эти строки и раньше).

## Что понадобится

- Компьютер с Node.js 24 и этой папкой репозитория (`git clone https://github.com/spacesarmat/omp`, затем `npm ci`).
- Токен бота OMP: в Telegram откройте **@BotFather** → `/mybots` → бот OMP → **API Token**. Это тот же токен, что
  лежит в секрете репозитория `TELEGRAM_BOT_TOKEN` (GitHub не показывает значения секретов, поэтому берём у BotFather).
  **Не нажимайте «Revoke»** — иначе релизы перестанут публиковаться, пока не обновите секрет на GitHub.
- Минут 20.

Все команды ниже — в терминале (Windows: PowerShell; macOS/Linux: Terminal). Секреты нигде не набираются в самой
команде: wrangler и наш скрипт спрашивают их отдельно, со скрытым вводом, — в истории терминала их не остаётся.

## Шаг 1. Бесплатный аккаунт Cloudflare

1. Откройте https://dash.cloudflare.com/sign-up, зарегистрируйтесь (почта + пароль), подтвердите почту.
2. В панели слева: **Compute (Workers)** → **Workers & Pages**. При первом входе Cloudflare попросит выбрать
   поддомен вида `<имя>.workers.dev` — придумайте любое. Карту привязывать не нужно: бесплатного тарифа
   (100 000 запросов в день) хватает с огромным запасом.

## Шаг 2. Токен GitHub (`GH_TOKEN`)

1. GitHub → аватар справа вверху → **Settings** → внизу слева **Developer settings** → **Personal access tokens** →
   **Fine-grained tokens** → **Generate new token**.
2. Заполните:
   - **Token name**: `omp-admin-bot`.
   - **Expiration**: например, 1 год (за неделю до конца GitHub пришлёт письмо; потом повторите шаг 2 и шаг 5 только для `GH_TOKEN`).
   - **Resource owner**: `spacesarmat`.
   - **Repository access**: **Only select repositories** → `spacesarmat/omp`.
   - **Repository permissions** — ровно эти, всё остальное «No access»:

     | Разрешение | Уровень | Зачем |
     |---|---|---|
     | **Actions** | **Read and write** | `/ci` и `/status` читают запуски workflow; `/check` запускает «Parser monitor» (workflow_dispatch — это запись) |
     | **Contents** | **Read-only** | `/status` читает `parser-monitor.json` из ветки `monitor-state`, `/versions` — фиды из `gh-pages`; `/versions` и `/stats` — релизы и счётчики скачиваний |
     | **Issues** | **Read-only** | `/stats`: число открытых issues и открытые issues с меткой `parser-monitor` |
     | **Metadata** | **Read-only** | обязательное (GitHub ставит само): звёзды и сведения о репозитории |

3. **Generate token** → скопируйте токен (`github_pat_…`). GitHub покажет его один раз — не закрывайте страницу до шага 5
   (или сохраните в менеджер паролей).

## Шаг 3. Секрет webhook (`WEBHOOK_SECRET`)

Любая случайная строка — по ней Worker узнаёт, что запрос пришёл от Telegram. Сгенерируйте:

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Скопируйте результат (понадобится в шагах 5 и 7; можно сохранить в менеджер паролей).

## Шаг 4. Wrangler и вход в Cloudflare

Wrangler — консольная программа Cloudflare. Ставить её не обязательно: `npx wrangler …` скачает её сама
(или один раз `npm i -g wrangler`, тогда можно писать просто `wrangler …`).

```
cd ops/admin-bot
npx wrangler login
```

Откроется браузер → **Allow**. В терминале появится «Successfully logged in». Все следующие команды `wrangler` —
из папки `ops/admin-bot`.

Проверьте `wrangler.toml`: `ADMIN_CHAT_ID` — ваш чат (`536445442`), `CHANNEL_ID` — канал OMP, тот же, что переменная
репозитория `TELEGRAM_CHAT_ID` (GitHub → Settings → Secrets and variables → Actions → вкладка Variables). Если там
числовой id — впишите его вместо `@ompplyaer`.

## Шаг 5. Выложить Worker и положить секреты

```
npx wrangler deploy
```

В конце wrangler напишет адрес вида `https://omp-admin-bot.<имя>.workers.dev` — запомните его. Пока секретов нет,
Worker отвечает на всё «403» и ничего не делает — так и задумано.

Теперь три секрета. Каждая команда спросит значение (вставьте и Enter; ввод скрыт):

```
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put GH_TOKEN
npx wrangler secret put WEBHOOK_SECRET
```

- `TELEGRAM_BOT_TOKEN` — токен бота OMP от @BotFather;
- `GH_TOKEN` — токен из шага 2;
- `WEBHOOK_SECRET` — строка из шага 3.

Секреты хранятся в Cloudflare зашифрованными, в репозиторий они не попадают. Применяются сразу, повторный deploy не нужен.

## Шаг 6. (Проверка) Worker жив

Откройте в браузере `https://omp-admin-bot.<имя>.workers.dev` — должно быть «Not found». Это нормально: Worker
принимает только запросы Telegram.

## Шаг 7. Подключить бота к Worker (webhook + меню команд)

Из **корня репозитория** (`cd ../..`):

```
npm run admin-bot:webhook -- https://omp-admin-bot.<имя>.workers.dev
```

Скрипт спросит токен бота и `WEBHOOK_SECRET` (ввод скрыт), затем:
- `setWebhook` — адрес Worker, секрет, типы обновлений `message` и `channel_post`;
- `setMyCommands` — меню команд (кнопка «/» в Telegram), видно **только в вашем чате**;
- покажет `getWebhookInfo` — адрес и последнюю ошибку, если была.

(Если удобнее, токен и секрет можно задать переменными окружения `TELEGRAM_BOT_TOKEN` и `WEBHOOK_SECRET` — тогда
скрипт ничего не спрашивает. Но не набирайте их значения прямо в команде — они останутся в истории.)

## Шаг 8. Проверить

1. В Telegram откройте чат с ботом OMP и отправьте `/help` — придёт список команд.
2. `/status` — таблица парсеров, `/ci` — последние запуски. `/check rutor` — через несколько секунд в сообщении
   появится ссылка на запуск, а через 3–15 минут бот пришлёт таблицу.
3. С другого аккаунта бот не отвечает ничего — так и должно быть.

Если бот молчит:
- `npm run admin-bot:webhook -- --info` — строка «последняя ошибка» (например, `403` — `WEBHOOK_SECRET` в Worker и в
  webhook разные: повторите шаг 7 с тем же значением, что в шаге 5);
- `npx wrangler tail` (из `ops/admin-bot`) — живой лог Worker, отправьте команду ещё раз и смотрите;
- «⚠️ Не получилось: GitHub …: HTTP 403/404» в ответе — у `GH_TOKEN` не те разрешения или не тот репозиторий (шаг 2).

## Откат

Вернуть всё как было до бота (релизы снова удаляют «закрепил сообщение» через `getUpdates`):

```
npm run admin-bot:webhook -- --delete
```

Это `deleteWebhook` + удаление меню команд. Worker после этого просто не получает сообщений; удалить его совсем —
`npx wrangler delete` из `ops/admin-bot` (или в панели Cloudflare). Вернуть бота — снова шаг 7.

## Обновить бота

После изменений в `ops/admin-bot/` (или в `scripts/parser-monitor/telegramTable.mjs`, `src/sources/sourceNames.ts`,
которые он использует): `git pull`, затем из `ops/admin-bot` — `npx wrangler deploy`. Секреты и webhook остаются.
Поменять список команд в меню — `src/commandList.mjs`, затем снова шаг 7.

## Как это устроено

- `src/index.ts` — вход Worker: только POST с верным секретом, ответ Telegram всегда 200 (иначе он повторяет запрос).
- `src/bot.ts` — команды; `src/commands.ts` — разбор команд, фильтр админа, служебные посты канала;
  `src/format.ts` — тексты ответов; `src/github.ts`, `src/telegram.ts` — API.
- `/check`: Worker после ответа может работать ещё только ~30 секунд (`ctx.waitUntil`), а проверка идёт минуты.
  Поэтому бот запускает workflow с флажком `notify=true`, а таблицу по окончании отправляет сам workflow
  (шаг «Report to the admin» → `scripts/parser-monitor/notify.mjs`, в чат `MONITOR_TG_CHAT`, по умолчанию `536445442`).
  Бот за эти ~25 секунд только находит новый запуск и дописывает ссылку на него в своё сообщение.
- Тесты: `ops/admin-bot/test/` (в общем `npm test`, без сети).
