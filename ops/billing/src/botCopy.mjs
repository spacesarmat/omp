/**
 * Bot reply templates. The catalog is the in-code text. A saved row replaces it at send time.
 * With no saved row the caller keeps the string it already built.
 */

export const COPY_TEXT_LIMIT = 4096;
export const COPY_CAPTION_LIMIT = 1024;

const STATES = new Set(['', 'active', 'expired', 'trial']);
const LANGS = new Set(['', 'ru', 'en']);

function v(key, label, sample) {
  return { key, label, sample };
}

function t(id, category, title, body, variables, required) {
  return { id, category, title, body, variables: variables || [], required: required || [] };
}

const name = v('name', 'Имя', 'Анна');
const daysLeft = v('days_left', 'Дней осталось', '12');
const expires = v('expires_at', 'Окончание', '19.11.2026 15:00 МСК');
const price = v('price', 'Цена', '150 ₽');
const promo = v('promo', 'Промокод пробного дня', 'DEMO1');
const refLink = v('ref_link', 'Реферальный код', 'OMP-K7Q');
const balance = v('balance', 'Зачёт', '50 ₽');
const status = v('status', 'Текст кабинета', 'Подписка до 19.11.2026 15:00 МСК\nУстройства: 1 из 2');
const devices = v('devices', 'Устройства', 'Устройства: 1 из 2');
const days = v('days', 'Срок', '30 дней');
const amount = v('amount', 'Сумма', '150 ₽');
const code = v('code', 'Код', 'ABCD-EF12');
const phones = v('phones', 'Телефоны в подписке', 'до 2 телефонов');
const extra = v('extra', 'Доп. устройство', '50 ₽');
const trial = v('trial', 'Строка пробного дня', '\nПробный день - промокод DEMO1 в «Промокод».');
const details = v('details', 'Состав оплаты', 'Кошелёк: 150 ₽ + 5 ₽ = 155 ₽');
const head = v('head', 'Шапка', '');
const renewal = v('renewal', 'Текст продления', 'Продление на 30 дней, до 19.11.2026 15:00 МСК:\n• подписка - 150 ₽');
const tail = v('tail', 'Хвост оплаты', '');
const adminHint = v('admin_hint', 'Подсказка админа', '');
const prefix = v('prefix', 'Префикс', '');
const count = v('count', 'Число', '2');
const device = v('device', 'Устройство', 'abcd1234');
const who = v('who', 'Кому', 'Анна');
const arg = v('arg', 'Запрос', '123456789');
const text = v('text', 'Текст', 'Не открывается поиск');
const grace = v('grace', 'Льгота', '3 дня');
const left = v('left', 'Осталось смен', '1');
const limit = v('limit', 'Лимит смен', '2');
const when = v('when', 'Когда снова', '19.12.2026 15:00 МСК');
const total = v('total', 'Итого', '200 ₽');
const extraLine = v('extra_line', 'Строка доп. устройства', '');
const creditLine = v('credit_line', 'Строка зачёта', '');
const totalLine = v('total_line', 'Строка итога', '');
const minRub = v('min_rub', 'Минимум', '50');
const maxRub = v('max_rub', 'Максимум', '15000');
const commentMax = v('comment_max', 'Лимит комментария', '200');
const fee = v('fee', 'Комиссия', 'Кошелёк: 100 ₽ + 5 ₽ = 105 ₽');
const stars = v('stars', 'Звёзды', '15');
const asset = v('asset', 'Монета', 'USDT');
const payAmount = v('pay_amount', 'Сумма к оплате', '1.5');
const method = v('method', 'Способ', 'Кошелёк');
const bonus = v('bonus', 'Бонус', '+1 устройство бесплатно навсегда');
const until = v('until', 'До', '19.11.2026');
const summary = v('summary', 'Сводка', 'Аккаунтов: 1');
const promoInfo = v('promo_info', 'Описание промокода', '1 день');
const uses = v('uses', 'Лимит использований', '50');
const promoCode = v('promo_code', 'Промокод', 'DEMO1');

const person = [name, daysLeft, expires, price, promo, refLink, balance];

export const CATALOG = [
  t('cabinet.home', 'Кабинет', 'Личный кабинет', 'Личный кабинет\n\n{status}{admin_hint}', [...person, status, devices, adminHint], ['status']),
  t('cabinet.unknown', 'Кабинет', 'Не понял команду', 'Не понял. Выберите кнопку ниже или «Поддержка».\n\n{status}', [...person, status], ['status']),
  t('cabinet.user_mode', 'Кабинет', 'Режим пользователя', '{prefix}Личный кабинет\n\n{status}', [prefix, status, name], ['status']),

  t('pay.price', 'Оплата', 'Цена', 'Подписка OMP - {price} за {days}, {phones}: поиск в Jackett и JacRed.\nПодписка нужна только на телефоне - на ТВ она не нужна.{extra}{grace}{trial}', [price, days, phones, extra, grace, trial, promo]),
  t('pay.unavailable', 'Оплата', 'Оплата не настроена', 'Оплата ещё не настроена.{trial}', [trial, promo]),
  t('pay.new', 'Оплата', 'Новая подписка', 'Подписка OMP - {price} за {days}, {phones}. На ТВ подписка не нужна.\n{details}\nПосле оплаты в этот чат придёт код - введите его в OMP на телефоне.', [price, days, phones, details, promo]),
  t('pay.renew', 'Оплата', 'Экран продления', '{head}{renewal}{tail}', [head, renewal, tail, price, expires, daysLeft, balance]),
  t('pay.received_new', 'Оплата', 'Оплата: новая подписка', '✅ Оплата получена. Подписка до {expires_at}, {phones}.\n{code}\nНа ТВ подписка не нужна.', [expires, phones, code, price], ['expires_at']),
  t('pay.received_renew', 'Оплата', 'Оплата: продление', '✅ Оплата получена. Подписка продлена до {expires_at}.{extra}{balance}\nПривязанные устройства продолжают работать - ничего вводить не нужно.{code}', [expires, extra, balance, code], ['expires_at']),
  t('pay.received_device', 'Оплата', 'Оплата: доп. устройство', '✅ Оплата получена: доп. устройство до {until}, дальше продлевается вместе с подпиской.\n{code}', [until, code], ['until']),
  t('pay.received_credit', 'Оплата', 'Оплата ушла в зачёт', '✅ Оплата {amount} получена, но {head}\nДоп. устройство можно купить только вместе с активной подпиской.\nМы зачли {amount}: сумма вычтется из следующего продления. Нажмите «Оплатить».', [amount, head, balance], ['amount']),
  t('pay.pending', 'Оплата', 'Платёж ждёт подтверждения', '⏳ Платёж{amount} получен и ждёт подтверждения. Подписка продлится сама - платить ещё раз не нужно.\nЕсли что-то не так - «Поддержка».', [amount]),
  t('pay.rejected', 'Оплата', 'Платёж не подтверждён', 'Платёж{amount} не подтверждён - подписка не продлена.\nЕсли деньги списались, напишите в «Поддержку».', [amount]),
  t('pay.reminder_d3', 'Оплата', 'Напоминание за 3 дня', '⚠️ Подписка OMP заканчивается через 3 дня - {expires_at}.{renewal}\nНажмите «Оплатить» - ссылка на оплату придёт в этот чат.', [expires, renewal, price, daysLeft], ['expires_at']),
  t('pay.reminder_d1', 'Оплата', 'Напоминание за 1 день', '⚠️ Подписка OMP заканчивается завтра - {expires_at}.{renewal}\nНажмите «Оплатить» - ссылка на оплату придёт в этот чат.', [expires, renewal, price], ['expires_at']),
  t('pay.reminder_today', 'Оплата', 'Напоминание в день окончания', '⚠️ Подписка OMP заканчивается сегодня в {when}.{grace}{renewal}\nНажмите «Оплатить» - ссылка на оплату придёт в этот чат.', [when, grace, renewal, expires], ['when']),
  t('pay.reminder_ended', 'Оплата', 'Закончилась сегодня', '⚠️ Подписка OMP закончилась сегодня в {when}.{grace}{renewal}\nНажмите «Оплатить» - ссылка на оплату придёт в этот чат.', [when, grace, renewal], ['when']),
  t('pay.grace_end', 'Оплата', 'Льгота закончилась', '⚠️ {head}\n{renewal}\nНажмите «Оплатить» - ссылка на оплату придёт в этот чат.', [head, renewal, price]),
  t('pay.stars', 'Оплата', 'Счёт в звёздах', 'Счёт на {stars} звёзд. Комиссия сверху не добавляется.', [stars]),
  t('pay.crypto', 'Оплата', 'Счёт в крипте', '{asset} {pay_amount}. Ссылка на оплату:', [asset, payAmount]),
  t('pay.invoice_failed', 'Оплата', 'Счёт не создался', 'Не удалось создать счёт. Попробуйте ещё раз.', []),

  t(
    'renewal.quote',
    'Продление',
    'Состав продления',
    'Продление на {days}, до {expires_at}:\n• подписка - {price}\n{extra_line}{credit_line}{total_line}',
    [days, expires, price, extraLine, creditLine, totalLine, total, balance],
    ['days', 'expires_at', 'price'],
  ),

  t('donate.off', 'Донаты', 'Донаты выключены', 'Поддержка проекта сейчас выключена.', []),
  t('donate.menu', 'Донаты', 'Выбор суммы', 'Поддержать проект OMP. Выберите сумму.', [name]),
  t('donate.comment', 'Донаты', 'Комментарий', 'Комментарий к донату, по желанию. До {comment_max} символов.', [commentMax]),
  t('donate.name', 'Донаты', 'Имя в благодарностях', 'Показать моё имя в списке благодарностей? Сейчас имя скрыто.', [name]),
  t('donate.methods', 'Донаты', 'Способ доната', 'Как оплатить {amount}?\n{fee}', [amount, fee]),
  t('donate.methods_off', 'Донаты', 'Нет способов доната', 'Способы оплаты доната не включены.', []),
  t('donate.pay', 'Донаты', 'Ссылка ЮMoney', '{method} - {amount}. Комиссия уже в сумме.', [method, amount]),
  t('donate.stars', 'Донаты', 'Донат звёздами', 'Счёт на {stars} звёзд. Комиссия сверху не добавляется.', [stars, amount]),
  t('donate.crypto', 'Донаты', 'Донат криптой', '{asset} {pay_amount}. Ссылка на оплату:', [asset, payAmount]),
  t('donate.amount', 'Донаты', 'Своя сумма', 'Напишите сумму от {min_rub} до {max_rub} ₽, целым числом.', [minRub, maxRub]),
  t('donate.amount_bad', 'Донаты', 'Сумма не подходит', 'Нужна сумма от {min_rub} до {max_rub} ₽, целым числом.', [minRub, maxRub]),
  t('donate.comment_bad', 'Донаты', 'Длинный комментарий', 'Комментарий длиннее {comment_max} символов.', [commentMax]),
  t('donate.thanks', 'Донаты', 'Спасибо за донат', 'Спасибо за поддержку OMP.', [name, amount]),
  t('donate.pending', 'Донаты', 'Донат ждёт подтверждения', 'Донат ждёт подтверждения в ЮMoney. Он ещё не засчитан.', [amount]),
  t('donate.error', 'Донаты', 'Ошибка доната', '{text}', [text]),

  t('referral.bound', 'Рефералы', 'Приглашение сохранено', 'Приглашение сохранено. Код {ref_link}. Дни придут после оплаты друга.', [refLink, name, promo]),
  t('referral.referrer', 'Рефералы', 'Дни пригласившему', 'Друг оплатил подписку. Вам добавлено {days}. Подписка до {expires_at}.', [days, expires, name, refLink], ['days']),
  t('referral.friend', 'Рефералы', 'Дни другу', 'Вам добавлено {days} за приглашение. Подписка до {expires_at}.', [days, expires, name, refLink], ['days']),

  t('devices.none', 'Устройства', 'Нет подписки', 'Подписки нет.\n«Оплатить» - {price} за {days}, {phones}. На ТВ подписка не нужна.{trial}', [price, days, phones, trial]),
  t('devices.list', 'Устройства', 'Список устройств', '{devices}{code}', [devices, code, daysLeft, expires, left, limit], ['devices']),
  t('devices.extra', 'Устройства', 'Ещё одно устройство', '{text}', [text, price, extra, expires]),
  t('devices.extra_grace', 'Устройства', 'Устройство в льготный период', 'Сейчас льготный период - отдельно устройство не купить. Продлите подписку вместе с ним одной оплатой:\n{renewal}{tail}', [renewal, tail, price]),
  t('devices.limit', 'Устройства', 'Места заняты', 'Все места заняты - новый код не выдан. Привязанные устройства продолжают работать.', []),
  t('devices.unbind_ask', 'Устройства', 'Подтверждение отвязки', 'Отвязать {device}? Оно сразу перестанет работать.\nЭто 1 смена из {limit} за 30 дней (останется {left}).', [device, limit, left]),
  t('devices.unbind_done', 'Устройства', 'Устройство отвязано', '{device} отвязано и больше не работает.\n{text}', [device, text, left]),
  t('devices.unbind_all_ask', 'Устройства', 'Отвязать все', 'Отвязать все устройства ({count})? Они сразу перестанут работать.\nЭто {count} смен из {limit} за 30 дней (останется {left}).', [count, limit, left]),
  t('devices.unbind_all_block', 'Устройства', 'Все сразу нельзя', 'Отвязать все устройства ({count}) сейчас нельзя: {text}', [count, text, left, when]),
  t('devices.unbind_all_done', 'Устройства', 'Все отвязаны', 'Все устройства отвязаны ({count}) и больше не работают.\n{text}', [count, text]),
  t('devices.swap_limit', 'Устройства', 'Смены исчерпаны', 'Сменить устройство сейчас нельзя: самостоятельно - не больше {limit} раз за 30 дней.{when}\nУже привязанные устройства работают. Если нужно срочно - напишите в «Поддержку».', [limit, when, left]),

  t('promo.ask', 'Промокод', 'Запрос промокода', 'Отправьте промокод одним сообщением.\nПример: DEMO1', []),
  t('promo.bad', 'Промокод', 'Промокод не найден', 'Промокод не найден или уже не действует.', [promoCode]),
  t('promo.already', 'Промокод', 'Уже активирован', 'Вы уже активировали этот промокод.', []),
  t('promo.exhausted', 'Промокод', 'Промокод закончился', 'Этот промокод уже использовали все, кому можно.', []),
  t('promo.expired', 'Промокод', 'Срок промокода истёк', 'Срок промокода истёк.', []),
  t('promo.needs_sub', 'Промокод', 'Нужна подписка', 'Этот промокод добавляет устройство к подписке. Сначала оформите подписку - «Оплатить».', []),
  t('promo.ok', 'Промокод', 'Промокод принят', 'Промокод принят: {bonus}.{code}', [bonus, code, promoCode, days, expires]),

  t('support.ask', 'Поддержка', 'Запрос в поддержку', 'Напишите сообщение для администратора одним текстом.', []),
  t('support.fast', 'Поддержка', 'Слишком часто', 'Слишком много сообщений подряд - подождите 10 минут. Предыдущие сообщения администратор уже получил.', []),
  t('support.sent', 'Поддержка', 'Передано администратору', 'Сообщение передано администратору. Ответ придёт в этот чат.', []),
  t('support.saved_off', 'Поддержка', 'Сохранено, уведомления выключены', 'Сообщение сохранено. Уведомления администраторам выключены.', []),
  t('support.saved_no_admin', 'Поддержка', 'Админы не указаны', 'Сообщение сохранено. Администраторы в панели ещё не указаны.', []),
  t('support.closed', 'Поддержка', 'Диалог закрыт', 'Диалог с поддержкой завершён. Если вопрос останется - нажмите «Поддержка» и напишите снова.', []),
  t('support.relay', 'Поддержка', 'Ответ админа пользователю', 'Поддержка OMP:\n{text}', [text], ['text']),
  t('support.note', 'Поддержка', 'Уведомление админу', 'Поддержка · {who}\n{text}\n\nОтветьте на это сообщение - текст уйдёт пользователю.', [who, text]),

  t('link.stale', 'Ошибки', 'Ссылка устройства устарела', 'Ссылка устарела или уже использована. В OMP нажмите «Привязать Telegram» ещё раз.', []),
  t('link.ask', 'Ошибки', 'Подтвердить привязку', 'Привязать к этому Telegram устройство {device}…?\nКод и доступ к поиску появятся только после подтверждения.', [device]),
  t('link.ok', 'Ошибки', 'Телефон привязан', 'Телефон привязан к этому Telegram.\n{status}', [status, name]),
  t('login.denied', 'Ошибки', 'Нет доступа к панели', 'Нет доступа к панели. Добавьте свой Telegram id в настройках администраторов.', []),
  t('login.stale', 'Ошибки', 'Ссылка входа устарела', 'Ссылка для входа устарела. Откройте панель снова и нажмите «Войти через Telegram».', []),
  t('login.ok', 'Ошибки', 'Вход подтверждён', 'Вход в админ-панель подтверждён. Вернитесь в браузер - страница откроется сама.', []),
  t('login.ok_short', 'Ошибки', 'Вход подтверждён коротко', 'Вход в админ-панель подтверждён. Вернитесь в браузер.', []),
  t('login.ask', 'Ошибки', 'Запрос входа админу', 'Подтвердите вход в админку\nIP: {arg}\nУстройство: {text}', [arg, text]),
  t('error.maintenance', 'Ошибки', 'Обслуживание', 'Сейчас обслуживание биллинга. Админ-вход работает; остальные команды временно недоступны.', []),
  t('error.revoke', 'Ошибки', 'Устройство отключено', 'Устройство {device}… отключено администратором: поиск OMP на нём больше не работает.\nЧтобы подключить устройство снова, нажмите «Код» и введите новый код в OMP. Вопросы - «Поддержка».', [device]),
  t('error.stale', 'Ошибки', 'Кнопка устарела', 'Кнопка устарела - откройте «Устройства» ещё раз.', []),
  t('issue.code', 'Ошибки', 'Код из панели', 'Код подписки OMP: {code}\nПодписка до {until}.\nВведите его в OMP на телефоне. На другом устройстве он не сработает.', [code, until], ['code']),
  t('grant.user', 'Ошибки', 'Дни от администратора', 'Вам добавлено {days}. Подписка до {expires_at}.{code}', [days, expires, code], ['days', 'expires_at']),

  t('admin.no_access', 'Админ', 'Нет доступа', 'Нет доступа. Добавьте свой Telegram id в настройках панели.', []),
  t('admin.readonly', 'Админ', 'Только просмотр', 'Режим только просмотра. Выдача дней и промокоды недоступны.', []),
  t('admin.home', 'Админ', 'Админ-кабинет', 'Админ-кабинет. Сводка, поиск, выдача дней и промокоды.\n«Как пользователь» - проверить кабинет подписчика.', []),
  t('admin.summary', 'Админ', 'Сводка', 'Сводка:\n{summary}', [summary]),
  t('admin.find_ask', 'Админ', 'Поиск: запрос', 'Пришлите Telegram id, @ник, код XXXX-XXXX или начало device id.', []),
  t('admin.find_miss', 'Админ', 'Поиск: пусто', 'Не найдено: {arg}', [arg]),
  t('admin.find_hit', 'Админ', 'Поиск: карточка', 'Аккаунт {who}\n{status}{code}', [who, status, code]),
  t('admin.grant_ask', 'Админ', 'Выдача: запрос', 'Пришлите Telegram id или @ник и число дней.\nПример: 123456789 30 или @nick 30', []),
  t('admin.grant_bad_user', 'Админ', 'Пользователь не найден', 'Не найден пользователь «{arg}». Проверьте id или @ник - пользователь должен хотя бы раз написать боту. Новый аккаунт не создан.', [arg]),
  t('admin.grant_bad_days', 'Админ', 'Неверное число дней', 'Нужно целое число дней от 1 до 3650.\nПример: {arg} 30', [arg]),
  t('admin.grant_fail', 'Админ', 'Не вышло выдать', 'Не вышло выдать дни.', []),
  t('admin.grant_ok', 'Админ', 'Дни выданы', 'Выдано +{days} - {who}, подписка до {expires_at}.\n{text}', [days, who, expires, text]),
  t('admin.promo_ask', 'Админ', 'Промокод: формат', 'Формат: КОД дни лимит\nПример: DEMO1 1 50', []),
  t('admin.promo_exists', 'Админ', 'Промокод уже есть', 'Такой промокод уже есть.', []),
  t('admin.promo_bad', 'Админ', 'Некорректный промокод', 'Некорректный промокод.', []),
  t('admin.promo_ok', 'Админ', 'Промокод создан', 'Промокод {promo_code} ({promo_info}, до {uses} исп.).', [promoCode, promoInfo, uses]),
  t('admin.reply_sent', 'Админ', 'Ответ отправлен', 'Ответ отправлен пользователю {who}.', [who]),
];

const BY_ID = new Map(CATALOG.map((row) => [row.id, row]));

export function templateById(id) {
  return BY_ID.get(String(id || '')) || null;
}

export function normalizeDashes(value) {
  return String(value == null ? '' : value).replace(/\u2014|\u2013/g, '-');
}

export function normalizeLang(code) {
  const c = String(code || '').toLowerCase();
  if (c.indexOf('en') === 0) return 'en';
  if (c.indexOf('ru') === 0) return 'ru';
  return '';
}

export function subscriptionCopyState(sub, paid) {
  if (!sub) return '';
  if (!sub.active || sub.inGrace) return 'expired';
  if (!paid) return 'trial';
  return 'active';
}

export function variablesIn(body) {
  const out = [];
  const re = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;
  const src = String(body || '');
  let m = re.exec(src);
  while (m) {
    if (out.indexOf(m[1]) < 0) out.push(m[1]);
    m = re.exec(src);
  }
  return out;
}

function htmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fill(body, vars, escape) {
  const bag = vars || {};
  return String(body || '').replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (_, key) => {
    if (!Object.prototype.hasOwnProperty.call(bag, key) || bag[key] == null) return '';
    const raw = String(bag[key]);
    return escape ? htmlEscape(raw) : raw;
  });
}

export function renderBody(body, vars) {
  return fill(body, vars, true);
}

const ALLOWED = { b: 1, i: 1, u: 1, s: 1, code: 1, pre: 1, a: 1 };

export function markupError(html) {
  const s = String(html || '');
  const stack = [];
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt < 0) break;
    const gt = s.indexOf('>', lt + 1);
    if (gt < 0) return 'Неверная разметка';
    const raw = s.slice(lt + 1, gt).trim();
    i = gt + 1;
    if (!raw) return 'Неверная разметка';
    const close = raw.charAt(0) === '/';
    const body = close ? raw.slice(1).trim() : raw;
    const nameTag = body.split(/\s+/)[0].toLowerCase();
    if (!ALLOWED[nameTag]) return 'Неверная разметка';
    if (close) {
      if (body.toLowerCase() !== nameTag) return 'Неверная разметка';
      if (!stack.length || stack.pop() !== nameTag) return 'Неверная разметка';
      continue;
    }
    if (nameTag === 'a') {
      const href = /\bhref\s*=\s*"([^"]*)"/i.exec(body) || /\bhref\s*=\s*'([^']*)'/i.exec(body);
      if (!href) return 'Неверная разметка';
      const url = href[1];
      if (!/^https?:\/\//i.test(url) && !/^tg:\/\//i.test(url)) return 'Неверная разметка';
      const rest = body.replace(/^a\b/i, '').replace(href[0], '').trim();
      if (rest) return 'Неверная разметка';
    } else if (body.toLowerCase() !== nameTag) {
      return 'Неверная разметка';
    }
    stack.push(nameTag);
  }
  if (stack.length) return 'Неверная разметка';
  return '';
}

function pushVarErrors(errors, body, known) {
  const used = variablesIn(body);
  const unknown = used.filter((key) => !known.has(key));
  if (unknown.length) errors.push('Неизвестные переменные: ' + unknown.map((key) => '{' + key + '}').join(', '));
  return used;
}

function normalizeButtons(buttons, known, errors) {
  if (buttons == null) return null;
  if (!Array.isArray(buttons)) {
    errors.push('Неверные кнопки');
    return null;
  }
  if (buttons.length > 20) errors.push('Слишком много рядов кнопок');
  const rows = [];
  let total = 0;
  for (let r = 0; r < buttons.length; r++) {
    const row = buttons[r];
    if (!Array.isArray(row) || row.length < 1 || row.length > 8) {
      errors.push('В ряду от 1 до 8 кнопок');
      continue;
    }
    const next = [];
    for (let i = 0; i < row.length; i++) {
      const btn = row[i] || {};
      total += 1;
      const label = normalizeDashes(btn.text).trim();
      const kind = btn.kind === 'callback' ? 'callback' : btn.kind === 'url' ? 'url' : '';
      const value = normalizeDashes(btn.value).trim();
      if (!label || label.length > 64) errors.push('Текст кнопки: от 1 до 64 символов');
      if (!kind) errors.push('Кнопка: ссылка или команда');
      pushVarErrors(errors, label + ' ' + value, known);
      if (kind === 'url' && !variablesIn(value).length && !/^https?:\/\//i.test(value) && !/^tg:\/\//i.test(value)) {
        errors.push('Ссылка кнопки должна начинаться с http или tg://');
      }
      if (kind === 'callback' && !value) errors.push('Пустая команда кнопки');
      if (kind === 'callback' && Buffer.byteLength(value) > 64) errors.push('Команда кнопки длиннее 64 байт');
      next.push({ text: label, kind: kind || 'url', value });
    }
    rows.push(next);
  }
  if (total > 40) errors.push('Слишком много кнопок');
  return rows;
}

export function validateCopy(template, input) {
  const errors = [];
  const src = input || {};
  const body = normalizeDashes(src.body);
  const mediaKind = src.mediaKind === 'video' ? 'video' : src.mediaKind === 'photo' ? 'photo' : '';
  let mediaUrl = String(src.mediaUrl || '').trim();
  if (!mediaKind) mediaUrl = '';
  if (mediaKind && (!/^https:\/\/\S+$/i.test(mediaUrl) || mediaUrl.length > 500)) {
    errors.push('Ссылка на фото или видео должна начинаться с https://');
  }
  const limit = mediaKind ? COPY_CAPTION_LIMIT : COPY_TEXT_LIMIT;
  if (body.length > limit) errors.push('Текст длиннее ' + limit + ' символов');
  if (!body.trim() && !mediaKind) errors.push('Пустой текст');
  const known = new Set(((template && template.variables) || []).map((item) => item.key));
  const used = pushVarErrors(errors, body, known);
  const required = (template && template.required) || [];
  const missing = required.filter((key) => used.indexOf(key) < 0);
  if (missing.length) errors.push('Нет обязательных переменных: ' + missing.map((key) => '{' + key + '}').join(', '));
  const mark = markupError(body);
  if (mark) errors.push(mark);
  const buttons = normalizeButtons(src.buttons, known, errors);
  return {
    ok: errors.length === 0,
    errors,
    value: errors.length ? null : { body, mediaKind, mediaUrl, buttons },
  };
}

export function pickVariant(rows, state, lang) {
  const list = rows || [];
  const hit = (subState, code) => list.find((row) => String(row.subState || '') === subState && String(row.lang || '') === code) || null;
  const st = STATES.has(state) ? state : String(state || '');
  const ln = LANGS.has(lang) ? lang : '';
  if (st && ln) {
    const exact = hit(st, ln);
    if (exact) return exact;
  }
  if (ln) {
    const byLang = hit('', ln);
    if (byLang) return byLang;
  }
  if (st) {
    const byState = hit(st, '');
    if (byState) return byState;
  }
  return hit('', '');
}

function renderButtons(rows, vars) {
  const out = [];
  const list = rows || [];
  for (let r = 0; r < list.length; r++) {
    const next = [];
    const row = list[r] || [];
    for (let i = 0; i < row.length; i++) {
      const btn = row[i];
      const label = fill(btn.text, vars, false).trim().slice(0, 64);
      const value = fill(btn.value, vars, false).trim();
      if (!label) continue;
      if (btn.kind === 'callback') {
        if (!value || Buffer.byteLength(value) > 64) continue;
        next.push({ text: label, callback_data: value });
      } else if (/^https?:\/\//i.test(value) || /^tg:\/\//i.test(value)) {
        next.push({ text: label, url: value });
      }
    }
    if (next.length) out.push(next);
  }
  return out;
}

export function applyBuilt(saved, built, vars) {
  const base = {
    text: built && built.text ? built.text : '',
    inline: built && built.inline,
    parseMode: built && built.parseMode,
    keyboard: built && built.keyboard,
    media: null,
    used: 'code',
  };
  if (!saved || !saved.body && !(saved && saved.mediaUrl)) return base;
  const limit = saved.mediaUrl ? COPY_CAPTION_LIMIT : COPY_TEXT_LIMIT;
  const text = renderBody(saved.body || '', vars || {});
  if (text.length > limit || markupError(text)) return base;
  let inline = base.inline;
  if (Array.isArray(saved.buttons)) {
    const keyboard = renderButtons(saved.buttons, vars || {});
    inline = keyboard.length ? { inline_keyboard: keyboard } : undefined;
  }
  return {
    text,
    inline,
    parseMode: 'HTML',
    keyboard: base.keyboard,
    media: saved.mediaUrl ? { kind: saved.mediaKind === 'video' ? 'video' : 'photo', url: saved.mediaUrl } : null,
    used: 'template',
  };
}

export function sampleVars(template) {
  const out = {};
  const list = (template && template.variables) || [];
  for (let i = 0; i < list.length; i++) out[list[i].key] = list[i].sample;
  return out;
}

export function previewNodes(html) {
  const src = String(html || '');
  if (markupError(src)) return [{ type: 'text', text: src }];
  const root = [];
  const stack = [root];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      if (i < src.length) stack[stack.length - 1].push({ type: 'text', text: src.slice(i) });
      break;
    }
    if (lt > i) stack[stack.length - 1].push({ type: 'text', text: src.slice(i, lt) });
    const gt = src.indexOf('>', lt + 1);
    const raw = src.slice(lt + 1, gt).trim();
    i = gt + 1;
    if (raw.charAt(0) === '/') {
      stack.pop();
      continue;
    }
    const nameTag = raw.split(/\s+/)[0].toLowerCase();
    const node = { type: nameTag, children: [] };
    if (nameTag === 'a') {
      const href = /\bhref\s*=\s*"([^"]*)"/i.exec(raw) || /\bhref\s*=\s*'([^']*)'/i.exec(raw);
      node.href = href ? href[1] : '';
    }
    stack[stack.length - 1].push(node);
    stack.push(node.children);
  }
  return root;
}

export function referralNotes(before, after) {
  const prev = new Map();
  const oldRows = before || [];
  for (let i = 0; i < oldRows.length; i++) {
    const row = oldRows[i];
    if (row && row.id) prev.set(row.id, row);
  }
  const out = [];
  const next = after || [];
  for (let i = 0; i < next.length; i++) {
    const row = next[i];
    if (!row || row.status !== 'granted') continue;
    const old = prev.get(row.id);
    if (!(old && old.status === 'granted') && Number(row.days) > 0) {
      out.push({ accountId: String(row.referrerId || ''), role: 'referrer', days: Number(row.days) || 0 });
    }
    if (row.friendGranted && !(old && old.friendGranted)) {
      out.push({ accountId: String(row.friendId || ''), role: 'friend', days: 0 });
    }
  }
  return out;
}

export function copyStateOk(state) {
  return STATES.has(String(state || ''));
}

export function copyLangOk(lang) {
  return LANGS.has(String(lang || ''));
}
