import { listStamp } from './time';

export function when(ms?: number) {
  if (!ms) return '';
  return listStamp(ms) + ' МСК';
}

const ACTOR_KIND: Record<string, string> = {
  user: 'пользователь',
  device: 'устройство',
  admin: 'админ',
  system: 'система',
};

/** «пользователь · @nick · 42» or «устройство · abcd1234». */
export function actorLine(
  actor?: { kind?: string; label?: string } | null,
  opts?: { deviceId?: string; fallback?: string },
) {
  const deviceId = opts?.deviceId || '';
  const fallback = opts?.fallback || 'система';
  if (!actor || !actor.kind) {
    if (deviceId) return 'устройство · ' + deviceId.slice(0, 8);
    return fallback;
  }
  const kind = ACTOR_KIND[actor.kind] || actor.kind;
  const label = actor.label ? ' · ' + actor.label : '';
  let line = kind + label;
  const shortDev = deviceId.slice(0, 8);
  if (actor.kind === 'user' && shortDev && line.indexOf(shortDev) < 0) line += ' · устройство ' + shortDev;
  return line;
}

export function personLabel(id: string, username?: string, name?: string) {
  const nick = username ? '@' + username.replace(/^@/, '') : name || '';
  if (nick && id) return nick + ' · ' + id;
  return nick || id;
}

const EVENT_KIND: Record<string, string> = {
  pay: 'оплата',
  promo: 'промо',
  activate: 'активация',
  fail: 'отказ',
  admin: 'админ',
  device: 'устройство',
};

const FAIL_REASON: Record<string, string> = {
  bad_code: 'неверный код',
  expired: 'подписка истекла',
  other_device: 'чужое устройство',
  device_limit: 'лимит устройств',
};

const AUDIT_ACTION: Record<string, string> = {
  grant: 'выдача дней',
  promo_create: 'создание промо',
  bulk_promo: 'пакет промо',
  bulk_issue: 'пакет кодов',
  issue: 'выдача кода',
  login: 'вход',
  login_fail: 'неудачный вход',
  login_cli: 'аварийная ссылка',
  login_telegram_start: 'вход через Telegram',
  logout: 'выход',
  message: 'сообщение',
  support_reply: 'ответ поддержки',
  support_close: 'закрытие диалога',
  unbind: 'сброс устройства',
  settings_save: 'сохранение настроек',
  services_save: 'сохранение сервисов',
  monitor_run: 'проверка мониторинга',
  monitor_config: 'интервал мониторинга',
  password_change: 'смена пароля',
  session_revoke: 'завершение сессии',
  code_reveal: 'показ кода',
  device_revoke: 'отзыв устройства',
  device_clone: 'отключение клона',
  limit_set: 'смена лимита устройств',
  bonus_grant: 'выдача бонусных устройств',
  bonus_remove: 'снятие бонусных устройств',
  days_subtract: 'убавление дней',
  payment_confirm: 'подтверждение платежа',
  payment_reject: 'отклонение платежа',
  swaps_reset: 'сброс счётчика смен',
};

const PROBLEM_KIND: Record<string, string> = {
  bad_label: 'неверная метка',
  duplicate: 'повтор уведомления',
  amount: 'неверная сумма',
  bad_signature: 'неверная подпись',
  webhook: 'уведомление',
  no_account: 'нет аккаунта',
  no_subscription: 'нет подписки',
  unaccepted: 'ждёт подтверждения',
  rejected: 'отклонён',
};

const PURCHASE_KIND: Record<string, string> = {
  new: 'новая подписка',
  sub: 'продление',
  dev: 'доп. устройство',
};

/** «продление · 200 ₽» for a held payment. */
export function purchaseKind(kind?: string, price?: number) {
  const name = (kind && PURCHASE_KIND[kind]) || 'метка не найдена';
  return price ? name + ' · ' + price + ' ₽' : name;
}

export function eventKind(kind: string) {
  return EVENT_KIND[kind] || kind;
}

export function failReason(reason: string) {
  return FAIL_REASON[reason] || reason || 'неизвестно';
}

export function auditAction(action: string) {
  return AUDIT_ACTION[action] || action;
}

export function problemKind(kind: string) {
  return PROBLEM_KIND[kind] || kind || 'проблема';
}

export function serviceError(error?: string) {
  if (!error || error === 'down') return 'недоступен';
  if (error === 'timeout') return 'таймаут';
  if (error.indexOf('http_') === 0) return 'ошибка HTTP ' + error.slice(5);
  return error;
}

export function downloadCsv(filename: string, rows: string[][]) {
  const esc = (v: string) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const body = rows.map((r) => r.map((c) => esc(c)).join(',')).join('\n') + '\n';
  const blob = new Blob([body], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export const AUDIT_FILTERS: [string, string][] = [
  ['', 'Все действия'],
  ['login', 'Вход'],
  ['grant', 'Выдача дней'],
  ['issue', 'Выдача кода'],
  ['promo_create', 'Промо'],
  ['code_reveal', 'Показ кода'],
  ['device_revoke', 'Отзыв устройства'],
  ['device_clone', 'Отключение клона'],
  ['limit_set', 'Лимит устройств'],
  ['bonus_grant', 'Бонусные устройства'],
  ['bonus_remove', 'Снятие бонуса'],
  ['days_subtract', 'Убавление дней'],
  ['payment_confirm', 'Подтверждение платежа'],
  ['payment_reject', 'Отклонение платежа'],
  ['swaps_reset', 'Сброс смен'],
  ['message', 'Сообщение'],
  ['settings_save', 'Настройки'],
];

export const FAIL_FILTERS: [string, string][] = [
  ['', 'Все причины'],
  ['bad_code', 'Неверный код'],
  ['expired', 'Подписка истекла'],
  ['other_device', 'Чужое устройство'],
  ['device_limit', 'Лимит устройств'],
  ['extra_expired', 'Доп. устройство не продлено'],
];

/** 1 536 → «1,5 КБ». */
export function bytesText(n?: number) {
  const v = Number(n) || 0;
  if (v < 1024) return v + ' Б';
  const units = ['КБ', 'МБ', 'ГБ'];
  let x = v / 1024;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i++;
  }
  return x.toFixed(x < 10 ? 1 : 0).replace('.', ',') + ' ' + units[i];
}
