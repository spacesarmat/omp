# Подписки OMP и Jackett

Панель (React + shadcn/ui + Tailwind), бот Telegram и API, через которое телефон ищет в Jackett. Ключ Jackett на телефон не уходит. Состояние — SQLite (`billing.db`; старый `state.json` мигрирует сам).

## Локально на ПК

```
cd ops/billing
npm run build:admin   # один раз после правок admin/
node src/server.mjs
```

При первом запуске пароль панели печатается в консоль. Панель: `http://127.0.0.1:8787/admin`.

## Docker на NAS (ZimaOS) — тест в домашней сети

1. Скопируй каталог `ops/billing` на NAS (SMB / Git).
2. В ZimaOS → Docker → Compose (или SSH на NAS): из этого каталога  
   `docker compose up -d`
3. В логах контейнера `billing` найди строку `admin password: …`.
4. С телефона или ПК в той же Wi‑Fi открой `http://IP-NAS:8787/admin`.
5. В панели:
   - адрес Jackett: `http://jackett:9117` (имя сервиса в Docker);
   - API-ключ — из веб-интерфейса Jackett (его можно открыть временно, пробросив порт, или через `docker exec`);
   - цены можно поставить тестовые; бота и ЮMoney для домашнего теста не обязательны.
6. Выпусти код подписки в панели.
7. В приложении в `src/billing/config.ts` поставь `BILLING_ORIGIN = 'http://IP-NAS:8787'`, собери тестовый APK, введи код в «Источники поиска».

Jackett с хоста не торчит наружу — к нему ходит только контейнер billing.

## Публичный HTTPS — Caddy на VPS

Домен: **omp-player.online**. Панель и API: **`https://billing.omp-player.online`**.

Cloudflare Tunnel снят. Снаружи Cloudflare (оранжевое облако, SSL/TLS **Full (strict)**) ходит на Caddy на VPS. Caddy держит сертификат origin и проксирует контейнер `billing` на порту 8787. Лендинг, Jackett и JacRed — на том же Caddy. Стек и команды выкладки: `ops/vps/README.md`.

Проверка: `https://billing.omp-player.online/health` → `{"ok":true}`.

HSTS (`max-age=15552000; includeSubDomains`, без preload), `X-Content-Type-Options`, `X-Frame-Options` и `Referrer-Policy` ставит Caddy. Заголовка `Server` у origin нет.

### Локально и из мира

- Админка в LAN всегда: `http://192.168.1.191:8787/admin`
- Приложение пробует `https://billing.omp-player.online`, при недоступности — `http://192.168.1.191:8787`
- ЮMoney: `https://billing.omp-player.online/v1/yoomoney`

## Настройки панели

Токен бота, кошелёк и секрет ЮMoney, цены — вкладка **Настройки**. JacRed / Jackett / TorrServer (ops) — вкладка **Сервисы**: URL, ключи (маскируются), вкл/выкл для подписчиков, health-probe. Телефон ходит только в `POST /v1/search` и `POST /v1/torrent` (ключи на устройстве не хранятся).
