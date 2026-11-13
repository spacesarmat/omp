# Visual Flow Editor Design

Дата: 2026-11-12
Статус: ожидает подтверждения Andy
Ветка: `feat/visual-flow-editor`

## 1. Назначение

Реализовать визуальный редактор логики OMP Design Editor: ноды и связи на canvas, типизированные условия и действия, пошаговый debugger, проверки и безопасный экспорт в production.

Подход: одна типизированная `FlowDocument` для редактора, симулятора и production. Произвольный JavaScript запрещён.

## 2. Текущее состояние

`InteractionRule` поддерживает только `click`, `server.connected`, `target`, `screen.current`, а действия ограничены `navigate`, `back`, `toast`. `dispatchInteraction` выбирает первое подходящее правило. `LogicEditor` редактирует правила списком, `SimulationPanel` запускает один click.

Старые документы и поведение обязаны остаться рабочими без миграции пользовательских данных.

## 3. Цели

- Визуальное создание и связывание событий, условий, действий и результатов.
- Расширенные события, условия, переменные и документированные действия.
- Пошаговая симуляция с breakpoints, состоянием и traces.
- Проверка циклов, связей, типов и покрытия результатов.
- Общий runtime для preview и production после явного export.
- Совместимость со старыми `FlowDocument`, snapshots, drafts и rebase.

## 4. Не входит

- Произвольный JavaScript, eval, HTML или загружаемый пользовательский код.
- Произвольные HTTP-запросы и секреты в variables.
- Асинхронные цепочки и параллельное выполнение в первой версии.
- Автоматический deploy, release или запуск flows на устройствах Andy.
- Замена реальных приложений независимым движком скриптов.

## 5. Модель данных

### 5.1 Совместимость

`FlowDocument.schemaVersion` остаётся 1. Добавляются optional поля `graph`, `variables` и `steps` в существующие правила. Старый `rules` остаётся источником поведения для старых flows.

Старый `InteractionRule` считается одной цепочкой `trigger -> action`. Новый rule может содержать упорядоченные `steps` и ссылаться на condition graph. Graph metadata хранит представление, а не произвольную логику.

### 5.2 GraphView

- `FlowNodeView`: `id`, `kind`, `ruleId?`, `stepId?`, `x`, `y`, `label?`.
- `FlowEdge`: `id`, `from`, `to`, `branch: 'default' | 'true' | 'false' | 'error'`.
- `kind`: `trigger`, `condition`, `action`, `result`.
- Каждый узел ссылается на типизированную часть правила, не на DOM id.
- Удаление узла удаляет связанные edges и предупреждает о потерянных ветвях.
- Позиции узлов не влияют на выполнение.

### 5.3 Variables

- `FlowVariable`: `id`, `name`, `type: 'boolean' | 'string' | 'number' | 'enum'`, `initial`, `values?` для enum.
- Значения проходят ту же строгую валидацию, что документ.
- Секреты, токены, пароли и произвольные URL запрещены.
- Контекст содержит переменные пользователя и документированные read-only значения среды.

### 5.4 Steps

`InteractionStep` содержит `id`, `condition?` и `action`. Правило имеет trigger, condition и steps. Runtime выполняет steps по порядку. `result` содержит итоговый route, variables, toast и trace.

## 6. События

- `click` по elementId.
- `screen.enter` и `screen.leave`.
- `server.connected` и `server.disconnected`.
- `network.online` и `network.offline`.
- `account.signed-in` и `account.signed-out`.
- `playback.started`, `playback.paused`, `playback.stopped`, `playback.finished`.
- `download.started`, `download.completed`, `download.failed`.
- `timer` с ограниченным интервалом и отключённым фоновым запуском по умолчанию.

События имеют payload только из разрешённых полей. Пользовательские события не создают сетевых вызовов.

## 7. Условия

- Группы `all`, `any`, `not`.
- Операторы `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `contains`, `exists`.
- Пути `server.connected`, `target`, `screen.current`, `network.online`, `account.signedIn`, `playback.state`, `download.state`, `variable.<id>`.
- Типы значений проверяются до сохранения: number только числа, boolean только true/false, enum только разрешённые значения.
- Cooldown и once per event ограничивают повторные запуски без изменения смысла условия.

## 8. Действия

- `navigate`, `back`, `openScreen`.
- `toast`, `dialog`.
- `playback.playPause`, `playback.stop`, `playback.nextEpisode`.
- `queue.add`, `queue.replace`.
- `server.connect`, `server.reconnect`, `server.retry`.
- `source.retry`, `source.next`.
- `variable.set` с типизированным значением.
- `link.open` только из allowlist текущего проекта и HTTPS.
- `telegram.open` только документированный канал/бот проекта.

Действия используют существующие приложенческие API. Никаких динамических имен функций или eval.

## 9. Runtime и execution policy

- Синхронный детерминированный interpreter без фоновых promises.
- Один event создаёт один execution context и один trace.
- Не более 32 steps на event и не более 16 одновременно зарегистрированных timer flows.
- Циклические edges запрещены. Повторный trigger подчиняется cooldown.
- Ошибка action останавливает текущую ветку и переходит в `error`, если она существует, иначе завершает сценарий.
- `navigate` и другие side effects выполняются через typed dispatcher, а не напрямую из graph.
- Production активирует generated flow только после явного export. Autosave и editor preview production не меняют.

## 10. Визуальный редактор

- Canvas с zoom, pan, minimap и grid.
- Добавление узла через toolbar и `Insert`.
- Drag для перемещения узла и drag из output в input для создания связи.
- Multi-select, удаление, copy/paste, auto-layout и fit.
- Панель свойств только для выбранного узла с документированными полями.
- Цвета веток: default, true, false, error.
- Клик по узлу подсвечивает связанный экран/элемент в Design mode.
- Read-only режим для before/snapshot сравнения, как в остальном редакторе.
- Один drag/edit/paste равен одному undo-шагу.

## 11. Debugger

- Start, pause, continue, step over, step into, stop и reset.
- Breakpoints на узле и на ruleId.
- Состояние route, variables, server/network/account/playback/download и текущего узла.
- Trace показывает условие, ветку, action и ошибку, а не только итоговое действие.
- Моки server/network/account/playback/download без реальных вызовов и изменения настроек.
- Повтор и сравнение двух traces с подсветкой первого различия.
- Проверка timeout и error-ветки.

## 12. Проверки

- Нет edges в несуществующий узел или self-loop.
- Нет циклов и недостижимых действий.
- Нет нескольких неупорядоченных trigger paths к одному результату.
- Типы condition values и variable.set совпадают.
- Навигация только по разрешённым routes.
- Обязательные toast/dialog/message и destination не пустые.
- Каждый trigger имеет путь к result или явному terminal action.
- Экспорт содержит отчёт покрытия: достигнутые/недостижимые узлы и ветки.

## 13. Шаблоны

- Подключение сервера -> продолжить -> каталог.
- Нет сети -> ошибка -> повторить.
- Выбор серии -> очередь -> следующая серия.
- Ошибка воспроизведения -> другой источник.
- Возврат с сохранением route, позиции и выбранного элемента.

Шаблоны создают новые уникальные node/rule/edge ids. Пользовательские изменения не меняют исходный шаблон.

## 14. Export и rebase

- Diff показывает добавленные/удалённые узлы, edges и изменённые поля.
- Rebase сливает rules, graph nodes, edges и variables по id.
- Competing changes одного узла, переменной или связи дают понятный `REBASE_CONFLICT` с путём.
- Независимые добавления и правки разных узлов сливаются без конфликта.
- Манифест, baseCommit, safePath, process lock и rollback сохраняются по существующей модели.

## 15. Проверки поставки

- Unit: schema, conditions, graph operations, runtime limits, actions, rebase и validation.
- Component: node editing, linking, clipboard, undo, read-only и template insertion.
- Debugger: breakpoints, step into/over, mocks, trace diff и error paths.
- Integration: старый flow не меняет поведение, preview/production совпадают, export защищён.
- Browser: desktop, phone, TV, zoom/pan, keyboard-only и read-only.
- Команды: `npm run test:editor`, `npx tsc --noEmit`, `npm run build:editor`, `npm run build`, `npm run build:mobile`, `npm run build:desktop`, `npm run editor:generate -- --check`, `git diff --check`.
- CI: `build`, `android`, `billing`, desktop smoke и Greptile обязательны.

## 16. Этапы

1. Совместимая graph schema, interpreter и проверки.
2. Node canvas, связи, clipboard и инспекторы.
3. Debugger, trace diff и шаблоны.
4. Export, production runtime, документация и acceptance.

Один PR после выполнения всех этапов и зелёных проверок. Без автоматического deploy или release.

## 17. Решения после независимой builder check

### Execution graph

- Каждое правило имеет один trigger и собственный направленный граф. Связи между разными правилами запрещены.
- `true` и `false` выбирают следующий узел по соответствующей ветке. Если подходящей ветки нет, выполнение завершается без действия.
- `error` выбирается только при ошибке валидации или синхронной ошибке dispatcher.
- Terminal action завершает ветку. Узел `result` не обязателен. Если он присутствует, это единственный терминальный узел ветки, который собирает итоговый route, variables, toast и trace.

### Совместимость legacy

- Старые правила выполняются первыми в исходном порядке с прежним `dispatchInteraction` и старой error-семантикой.
- Новые graph-правила выполняются только если ни одно legacy-правило не совпало.
- Cooldown, лимиты steps, graph validation и error-ветки к legacy-правилам не применяются.
- Смешанный документ не меняет порядок старых правил и не меняет их поведение при совпадении.

### Синхронный dispatcher

- Dispatcher возвращает `{ ok: boolean, error?: string }` для валидации и синхронных ошибок.
- Async приложенческие API вызываются через существующие adapters, interpreter их не ожидает.
- `dialog` и `telegram.open` являются fire-and-forget и не приостанавливают выполнение.
- Error-ветки не обещают обработку будущего отказа async API. Такие отказы остаются в существующих приложенческих обработчиках.

### Production события и variables

- Все заявленные типы событий получают publishers через существующие приложенческие API. Редактор использует те же typed events для моков.
- Timer registry сбрасывается при каждом export. До export фоновые timers не запускаются.
- Node editor работает только на desktop. Phone и TV относятся к preview и production flows, а не к отдельному мобильному интерфейсу редактора.
- Variables живут только в execution context текущей сессии. Позиция воспроизведения и история страниц сохраняются через существующие хранилища приложения.
