export function when(ms?: number) {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n: number) => (n < 10 ? '0' : '') + n;
  return p(d.getDate()) + '.' + p(d.getMonth() + 1) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
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
};

const FAIL_REASON: Record<string, string> = {
  bad_code: 'неверный код',
  expired: 'подписка истекла',
  other_device: 'чужое устройство',
};

const AUDIT_ACTION: Record<string, string> = {
  grant: 'выдача дней',
  promo_create: 'создание промо',
  bulk_promo: 'пакет промо',
  bulk_issue: 'пакет кодов',
  issue: 'выдача кода',
  login: 'вход',
  login_fail: 'неудачный вход',
  login_telegram_start: 'вход через Telegram',
  logout: 'выход',
  message: 'сообщение',
  support_reply: 'ответ поддержки',
  support_close: 'закрытие диалога',
  unbind: 'сброс устройства',
  settings_save: 'сохранение настроек',
  services_save: 'сохранение сервисов',
  password_change: 'смена пароля',
  session_revoke: 'завершение сессии',
  code_reveal: 'показ кода',
};

const PROBLEM_KIND: Record<string, string> = {
  bad_label: 'неверная метка',
  duplicate: 'повтор уведомления',
  amount: 'неверная сумма',
  bad_signature: 'неверная подпись',
  webhook: 'уведомление',
  no_account: 'нет аккаунта',
  no_subscription: 'нет подписки',
};

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
  ['message', 'Сообщение'],
  ['settings_save', 'Настройки'],
];

export const FAIL_FILTERS: [string, string][] = [
  ['', 'Все причины'],
  ['bad_code', 'Неверный код'],
  ['expired', 'Подписка истекла'],
  ['other_device', 'Чужое устройство'],
];
