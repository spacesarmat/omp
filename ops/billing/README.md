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

## Публичный HTTPS — Cloudflare Tunnel

Домен: **omp-player.online** → хост **`https://billing.omp-player.online`**.  
Коннектор — приложение ZimaOS **Cloudflared** (`wisdomsky/cloudflared-web`, сеть host). Панель: `http://192.168.1.191:14333/`. Порты роутера не открываем. В биллинге своего cloudflared нет.

В веб-морде Cloudflared вставить токен туннеля `omp-billing`. В Zero Trust у публичного hostname URL: `http://127.0.0.1:8787` (на NAS это опубликованный порт панели).

Проверка: `https://billing.omp-player.online/health` → `{"ok":true}`.

### Локально и из мира

- Админка в LAN всегда: `http://192.168.1.191:8787/admin`
- Приложение пробует `https://billing.omp-player.online`, при недоступности — `http://192.168.1.191:8787`
- ЮMoney: `https://billing.omp-player.online/v1/yoomoney`

## Настройки панели

Токен бота, кошелёк и секрет уведомлений [ЮMoney](https://yoomoney.ru/), адрес Jackett, API-ключ и цены. Уведомления ЮMoney: `https://<твой-tunnel-хост>/v1/yoomoney`.
