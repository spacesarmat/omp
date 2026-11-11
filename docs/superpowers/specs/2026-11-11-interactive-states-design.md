# Интерактивные состояния дизайна

## Цель

Сделать default, hover, focus, active, disabled и error реальными состояниями preview, а не только значением state override в JSON.

## Подход

Единое состояние `DesignState` хранится в App. `TargetBar` меняет его всегда, `ThemeInspector` использует то же значение для state scope. Через `PreviewConfiguration.state` оно передаётся во все адаптеры.

## Изменения

- `TargetBar` получает select `data-testid="design-state"`.
- `ThemeInspector` получает `state` и `onStateChange` от App.
- `PreviewPane` передаёт state в init и `data-state` iframe.
- `PreviewRoot` хранит state в конфигурации и передаёт адаптерам.
- DesktopShell, legacy pages, PhonePreview, TvPreview и DOM-adapter используют state в `data-design-state` и `ThemeContext`.
- Смена страницы или платформы сбрасывает состояние на default.
- State override применяется через `activeOverrideIds`, поэтому реальный стиль меняется без имитации отдельного CSS для каждого состояния.

## Проверка

- App меняет state и отправляет его в protocol.
- Desktop/phone/TV получают атрибут и override ID выбранного состояния.
- State scope создаёт override с выбранным состоянием.
- Полный набор, TypeScript, сборка и браузерная проверка hover/focus/disabled.
