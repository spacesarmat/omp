# Security hardening 0.20.10

## Цель

Закрыть три подтверждённые уязвимости и усилить смежные границы без изменений в `main`: SSRF `/v1/torrent`, подтверждение Telegram-привязки, проверенный SSH host key, заголовки админки и ограничения тел.

## Независимые изменения

1. PR #296: внешний redirect только по HTTPS без userinfo, Basic-auth удаляется, loopback/private/link-local адреса запрещены и для literal IP, и после DNS lookup. Ошибки DNS fail closed.
2. Новый PR Telegram: `/start link_...` только показывает device id и кнопки. Привязка выполняется через существующий `botCallback` после явного нажатия, с повторной проверкой token. `/v1/link/start` использует существующий claim limiter.
3. Новый PR SSH: `VPS_KNOWN_HOSTS` обязателен, `StrictHostKeyChecking=yes`, первый SSH выполняется до записи GH token во временный файл и до scp.
4. Новый PR усилений: `Cache-Control: no-store` для админки, cookie `__Host-omp_admin` по HTTPS и совместимый `omp_admin` для документированного HTTP LAN, строгая CSP, малый JSON limit 256 KiB, cap активных ключей rate limiter, streaming cap 2 MiB для indexer XML.

## Ограничения и выбор

- Нет новых зависимостей. Используются `node:dns/promises`, `node:net`, существующие callbacks и тестовые стили.
- Внешние HTTPS redirect сохраняются для совместимости с текущими magnet и torrent сценариями.
- Старые HTTPS admin-сессии после смены cookie name перестают работать, что допустимо для коротких 12-часовых сессий. HTTP LAN сохраняет прежнее имя и вход.
- Не выполняются действия на production, Telegram и NUC. Секретные значения не выводятся.

## Проверка

Каждое изменение начинается с падающего security-теста. Для DNS используется инъекция lookup. Для Telegram проверяются отсутствие привязки до кнопки, отмена, подтверждение и повторное нажатие. Для SSH проверяются strict mode, порядок передачи token и отказ при отсутствии known_hosts. Затем выполняются focused и полные Linux suites, build, Android, CI и Greptile для каждого PR.
