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

Стек на NAS остаётся как есть: `cloudflared` шарит сеть с `omp-billing` и проксирует наружу. Порты роутера не открываем.

1. Домен в [Cloudflare](https://dash.cloudflare.com/) (бесплатный план ок).
2. **Zero Trust** → **Networks** → **Tunnels** → **Create a tunnel** → Cloudflared → имя `omp-billing`.
3. Скопируй **token** (установка Docker). В Public Hostname:
   - Subdomain: например `billing`
   - Domain: твой домен
   - Type: HTTP
   - URL: `http://127.0.0.1:8787`  
     (туннель в том же network namespace, что и billing — см. `network_mode: service:omp-billing`)
4. На NAS создай файл `/DATA/AppData/omp-billing/.env`:

```
CLOUDFLARE_TUNNEL_TOKEN=eyJh...длинный_токен...
```

5. Обнови compose на NAS и подними туннель (profile `tunnel`, иначе только локальный `:8787`):

```
# скопируй ops/billing → /DATA/AppData/omp-billing/app
docker compose -f /DATA/AppData/omp-billing/app/docker-compose.yml \
  --env-file /DATA/AppData/omp-billing/.env \
  --profile tunnel up -d
```

6. Проверь: `https://billing.<домен>/health` → `{"ok":true}`, админка `/admin`.
7. В панели **publicOrigin** = `https://billing.<домен>`.
8. В приложении `src/billing/config.ts`: `BILLING_ORIGIN = 'https://billing.<домен>'`.
9. ЮMoney HTTP-уведомления: `https://billing.<домен>/v1/yoomoney`.

Без profile `tunnel` / без токена наружу ничего не торчит — LAN `:8787` как раньше. Токен в git не коммить.

Пример файла: `env.tunnel.example`.

### Временно без своего домена — trycloudflare.com

```
docker compose -f /DATA/AppData/omp-billing/app/docker-compose.yml \
  --profile quick up -d
docker logs omp-billing-quick 2>&1 | grep trycloudflare
```

В логах будет `https://….trycloudflare.com`. URL **меняется** при recreate. На части сетей (в т.ч. этот NAS) quick tunnel отвечает **CF 530/1033** — тогда нужен **свой домен** + profile `tunnel` (уже поднят на NAS).

## Настройки панели

Токен бота, кошелёк и секрет уведомлений [ЮMoney](https://yoomoney.ru/), адрес Jackett, API-ключ и цены. Уведомления ЮMoney: `https://<твой-tunnel-хост>/v1/yoomoney`.
