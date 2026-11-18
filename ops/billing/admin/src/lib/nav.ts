/** One list for the sidebar and the search palette, so a section cannot exist in only one of them. */
export const ADMIN_PAGES: { id: string; label: string; group: string }[] = [
  { id: 'home', label: 'Обзор', group: 'Обзор' },
  { id: 'users', label: 'Пользователи', group: 'Обзор' },
  { id: 'subs', label: 'Подписки и оплаты', group: 'Обзор' },
  { id: 'devices', label: 'Устройства', group: 'Обзор' },
  { id: 'sources', label: 'Источники', group: 'Сеть' },
  { id: 'rank', label: 'Подбор', group: 'Сеть' },
  { id: 'cache', label: 'Кэш', group: 'Сеть' },
  { id: 'nuc', label: 'NUC', group: 'Сеть' },
  { id: 'funnel', label: 'Воронка', group: 'Деньги' },
  { id: 'revenue', label: 'Выручка', group: 'Деньги' },
  { id: 'finance', label: 'Финансы', group: 'Деньги' },
  { id: 'donations', label: 'Донаты', group: 'Деньги' },
  { id: 'promos', label: 'Промо', group: 'Деньги' },
  { id: 'referral', label: 'Рефералы', group: 'Деньги' },
  { id: 'support', label: 'Поддержка', group: 'Работа' },
  { id: 'replies', label: 'Ответы бота', group: 'Работа' },
  { id: 'fails', label: 'Отказы', group: 'Работа' },
  { id: 'ads', label: 'Реклама', group: 'Работа' },
  { id: 'services', label: 'Сервисы', group: 'Работа' },
  { id: 'dht', label: 'DHT', group: 'Работа' },
  { id: 'monitor', label: 'Мониторинг', group: 'Работа' },
  { id: 'changes', label: 'Изменения', group: 'Работа' },
  { id: 'settings', label: 'Настройки', group: 'Система' },
  { id: 'audit', label: 'Журнал', group: 'Система' },
  { id: 'security', label: 'Доступ', group: 'Система' },
  { id: 'crashes', label: 'Сбои', group: 'Система' },
  { id: 'broadcast', label: 'Рассылка', group: 'Система' },
  { id: 'versions', label: 'Версии', group: 'Система' },
];

export const TAB_IDS = ADMIN_PAGES.map((p) => p.id);

export const NAV = ADMIN_PAGES.reduce<{ title: string; items: [string, string][] }[]>((groups, page) => {
  const last = groups[groups.length - 1];
  if (!last || last.title !== page.group) groups.push({ title: page.group, items: [[page.id, page.label]] });
  else last.items.push([page.id, page.label]);
  return groups;
}, []);
