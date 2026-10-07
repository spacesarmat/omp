// The admin bot's commands: /help text in the Worker and the menu setMyCommands registers (scripts/webhook.mjs).
// Plain .mjs so the Node setup script can import it without a TypeScript step.

export const COMMANDS = [
  { command: 'status', description: 'Последняя таблица монитора парсеров' },
  { command: 'check', description: 'Проверить парсеры сейчас: /check или /check rutor' },
  { command: 'versions', description: 'Версии в фидах обновлений и даты релизов' },
  { command: 'stats', description: 'Скачивания, звёзды, открытые issues' },
  { command: 'ci', description: 'Последние запуски CI, Release, монитора' },
  { command: 'help', description: 'Список команд' },
];
