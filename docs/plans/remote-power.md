# Включение ТВ с пульта телефона

> Для агента: план короткий, по просьбе Andy. Путь `docs/plans/remote-power.md` важнее стандартного каталога Superpowers. Реализация: сначала падающий тест, потом код. Тире только дефис "-".

**Цель:** с пульта OMP на телефоне включать телевизор и приставку: Wake-on-LAN, сетевые команды LG / Samsung / Android TV, HDMI-CEC на приставке, ИК-порт и обучение кнопок.

**Архитектура:** чистые функции в `mobile/src/tv/power/` (пакет, сообщения протоколов, разбор ИК) покрыты тестами до остального кода. Телефон хранит MAC и broadcast у сопряженного OMP-устройства и у ручной записи по MAC. Пакет шлет нативный модуль Android (UDP 9 и 7, широковещательный адрес подсети и общий). В браузере тот же пакет уходит только если есть UDP API (`chrome.sockets.udp`), иначе понятная ошибка. Токены Samsung и обучалки лежат в keystore (`secretSet`), не в JSON устройства. CEC на Android TV вызывается при запуске с пульта и по `POST /omp/cec` после пробуждения, через `HdmiControlManager` с тихим отказом. ИК скрыт, если нет передатчика. Приемник на телефоне показывается только если у класса есть метод приема. Внешний приемник - скетч `hardware/ir-learner`.

**Стек:** Preact, существующие SSAP и Android TV Remote v2, Kotlin (DatagramSocket, ConsumerIrManager, NSD/SSDP), vitest, JUnit.

**Ограничения:**

- UI по-русски, новые элементы с кодами тестового режима (P08, P10, S05).
- Не вливать PR. Не делать rebase и force-push.
- Каждое замечание Greptile любой важности править, пока то же замечание не вернется после правки или пока не нужно решение по продукту.
- Секреты не писать в чат, логи и бэкап.

## Файлы

- `mobile/src/tv/power/wol.ts` - magic packet, цели, broadcast из маски.
- `mobile/src/tv/power/protocols.ts` - SSAP LG, JSON Samsung, байты Android TV Remote v2.
- `mobile/src/tv/power/irParse.ts` - raw, Pronto, Flipper, NEC/SIRC.
- `mobile/src/tv/power/irCodes.ts` - короткий набор команд, собранный нашим кодером (GPL-3, не копия IRDB).
- `mobile/src/tv/power/irProfile.ts` - выученные кнопки на устройство.
- `mobile/src/tv/power/manual.ts` - ручное устройство по MAC.
- `mobile/src/ui/PowerExtras.tsx`, `IrPanel.tsx` - «Включить», подсказка, ИК.
- Android: `WakeOnLan.kt`, `NetIdentity.kt`, `CecPower.kt`, `IrBlaster.kt`, `SamsungRemote.kt`, поиск SSDP/mDNS.
- `hardware/ir-learner/` - ESP32/ESP8266, HTTP и WebSocket, mDNS `_omp-ir._tcp`.
- `src/store/settings.ts` - `hdmiCec`, экран настроек ТВ.

## Порядок

1. Падающие тесты: пакет, протоколы, разбор ИК, MAC у Android TV.
2. Минимальный код, пока тесты зеленые.
3. UI, нативные модули, CEC, прошивка, CHANGELOG, коды экранов.
4. Прогон тестов, tsc, сборок. Самопроверка diff. PR. CI и Greptile.

## Проверка

- `npx vitest run mobile/tests/wol.test.ts mobile/tests/powerProtocols.test.ts mobile/tests/irParse.test.ts mobile/tests/powerUi.test.tsx mobile/tests/tvStore.test.ts mobile/tests/remote.test.tsx`
- `npx tsc --noEmit`
- `npm run build:mobile` если tsc чистый
- `cd android && ./gradlew :app:testDebugUnitTest --tests com.spacesarmat.omp.WakeOnLanTest --tests com.spacesarmat.omp.CecPowerTest --tests com.spacesarmat.omp.IrBlasterTest`
