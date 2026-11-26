/**
 * Bot reply templates. The catalog is the in-code text. A saved row replaces it at send time.
 * With no saved row the caller keeps the string it already built.
 */
import { LANG_PACKS } from './botCopyLangs/index.mjs';

export const COPY_TEXT_LIMIT = 4096;
export const COPY_CAPTION_LIMIT = 1024;

const STATES = new Set(['', 'active', 'expired', 'trial']);
/** Supported recipient languages, RU first. '' (absent or unsupported) stays RU everywhere. */
export const LANG_CODES = ['ru', 'en', 'uk', 'be', 'kk', 'ky', 'uz', 'tg', 'tk', 'hy', 'az', 'ka', 'ro'];
const LANGS = new Set(['', ...LANG_CODES]);

/** `samples` (per-language preview values) is merged in from the CIS language packs below. */
function v(key, label, sample, sampleEn) {
  const row = { key, label, sample };
  if (sampleEn !== undefined) row.sampleEn = sampleEn;
  return row;
}

/**
 * `body` is either a RU string (legacy) or a { ru, en } pair. The RU text stays in `body` so every
 * existing consumer keeps working; the EN text lives in `bodyEn` and is picked by bodyFor(lang).
 * The CIS texts attach as `bodyI18n` from the language packs, keeping the RU/EN fields untouched.
 */
function t(id, category, title, body, variables, required) {
  const ru = body && typeof body === 'object' ? String(body.ru || '') : String(body || '');
  const en = body && typeof body === 'object' ? String(body.en || '') : '';
  return { id, category, title, body: ru, bodyEn: en, variables: variables || [], required: required || [] };
}

const name = v('name', 'Имя', 'Анна', 'Ann');
const daysLeft = v('days_left', 'Дней осталось', '12');
const expires = v('expires_at', 'Окончание', '19.11.2026 15:00 МСК', '19.11.2026 15:00 MSK');
const price = v('price', 'Цена', '150 ₽');
const promo = v('promo', 'Промокод пробного дня', 'DEMO1');
const refLink = v('ref_link', 'Реферальный код', 'OMP-K7Q');
const balance = v('balance', 'Зачёт', '50 ₽');
const status = v('status', 'Текст кабинета', 'Подписка до 19.11.2026 15:00 МСК\nУстройства: 1 из 2', 'Subscription until 19.11.2026 15:00 MSK\nDevices: 1 of 2');
const devices = v('devices', 'Устройства', 'Устройства: 1 из 2', 'Devices: 1 of 2');
const days = v('days', 'Срок', '30 дней', '30 days');
const amount = v('amount', 'Сумма', '150 ₽');
const code = v('code', 'Код', 'ABCD-EF12');
const phones = v('phones', 'Телефоны в подписке', 'до 2 телефонов', 'up to 2 phones');
const extra = v('extra', 'Доп. устройство', '50 ₽');
const trial = v('trial', 'Строка пробного дня', '\nПробный день - промокод DEMO1 в «Промокод».', '\nTrial day - promo code DEMO1 in "Promo code".');
const details = v('details', 'Состав оплаты', 'Кошелёк: 150 ₽ + 5 ₽ = 155 ₽', 'Wallet: 150 ₽ + 5 ₽ = 155 ₽');
const head = v('head', 'Шапка', '');
const renewal = v('renewal', 'Текст продления', 'Продление на 30 дней, до 19.11.2026 15:00 МСК:\n• подписка - 150 ₽', 'Renewal for 30 days, until 19.11.2026 15:00 MSK:\n• subscription - 150 ₽');
const tail = v('tail', 'Хвост оплаты', '');
const adminHint = v('admin_hint', 'Подсказка админа', '');
const prefix = v('prefix', 'Префикс', '');
const count = v('count', 'Число', '2');
const device = v('device', 'Устройство', 'abcd1234');
const who = v('who', 'Кому', 'Анна', 'Ann');
const arg = v('arg', 'Запрос', '123456789');
const text = v('text', 'Текст', 'Не открывается поиск', 'Search does not open');
const grace = v('grace', 'Льгота', '3 дня', '3 days');
const left = v('left', 'Осталось смен', '1');
const limit = v('limit', 'Лимит смен', '2');
const when = v('when', 'Когда снова', '19.12.2026 15:00 МСК', '19.12.2026 15:00 MSK');
const total = v('total', 'Итого', '200 ₽');
const extraLine = v('extra_line', 'Строка доп. устройства', '');
const discountLine = v('discount_line', 'Строка скидки по приглашению', '');
const creditLine = v('credit_line', 'Строка зачёта', '');
const totalLine = v('total_line', 'Строка итога', '');
const minRub = v('min_rub', 'Минимум', '50');
const maxRub = v('max_rub', 'Максимум', '15000');
const commentMax = v('comment_max', 'Лимит комментария', '200');
const fee = v('fee', 'Комиссия', 'Кошелёк: 100 ₽ + 5 ₽ = 105 ₽', 'Wallet: 100 ₽ + 5 ₽ = 105 ₽');
const stars = v('stars', 'Звёзды', '15');
const asset = v('asset', 'Монета', 'USDT');
const payAmount = v('pay_amount', 'Сумма к оплате', '1.5');
const method = v('method', 'Способ', 'Кошелёк', 'Wallet');
const bonus = v('bonus', 'Бонус', '+1 устройство бесплатно навсегда', '+1 device free forever');
const until = v('until', 'До', '19.11.2026');
const summary = v('summary', 'Сводка', 'Аккаунтов: 1', 'Accounts: 1');
const promoInfo = v('promo_info', 'Описание промокода', '1 день', '1 day');
const uses = v('uses', 'Лимит использований', '50');
const promoCode = v('promo_code', 'Промокод', 'DEMO1');

const person = [name, daysLeft, expires, price, promo, refLink, balance];

export const CATALOG = [
  t('cabinet.home', 'Кабинет', 'Личный кабинет', { ru: 'Личный кабинет\n\n{status}{admin_hint}', en: 'Account\n\n{status}{admin_hint}' }, [...person, status, devices, adminHint], ['status']),
  t('cabinet.unknown', 'Кабинет', 'Не понял команду', { ru: 'Не понял. Выберите кнопку ниже или «Поддержка».\n\n{status}', en: 'I did not understand. Choose a button below or "Support".\n\n{status}' }, [...person, status], ['status']),
  t('cabinet.user_mode', 'Кабинет', 'Режим пользователя', { ru: '{prefix}Личный кабинет\n\n{status}', en: '{prefix}Account\n\n{status}' }, [prefix, status, name], ['status']),

  t('pay.price', 'Оплата', 'Цена', { ru: 'Подписка OMP - {price} за {days}, {phones}: поиск в Jackett и JacRed.\nПодписка нужна только на телефоне - на ТВ она не нужна.{extra}{grace}{trial}', en: 'OMP subscription - {price} for {days}, {phones}: search in Jackett and JacRed.\nThe subscription is only needed on the phone - the TV does not need it.{extra}{grace}{trial}' }, [price, days, phones, extra, grace, trial, promo]),
  t('pay.unavailable', 'Оплата', 'Оплата не настроена', { ru: 'Оплата ещё не настроена.{trial}', en: 'Payment is not set up yet.{trial}' }, [trial, promo]),
  t('pay.new', 'Оплата', 'Новая подписка', { ru: 'Подписка OMP - {price} за {days}, {phones}. На ТВ подписка не нужна.\n{details}\nПосле оплаты в этот чат придёт код - введите его в OMP на телефоне.', en: 'OMP subscription - {price} for {days}, {phones}. The TV does not need a subscription.\n{details}\nAfter payment a code will arrive in this chat - enter it in OMP on your phone.' }, [price, days, phones, details, promo]),
  t('pay.renew', 'Оплата', 'Экран продления', { ru: '{head}{renewal}{tail}', en: '{head}{renewal}{tail}' }, [head, renewal, tail, price, expires, daysLeft, balance]),
  t('pay.received_new', 'Оплата', 'Оплата: новая подписка', { ru: '✅ Оплата получена. Подписка до {expires_at}, {phones}.\n{code}\nНа ТВ подписка не нужна.', en: '✅ Payment received. Subscription until {expires_at}, {phones}.\n{code}\nThe TV does not need a subscription.' }, [expires, phones, code, price], ['expires_at']),
  t('pay.received_renew', 'Оплата', 'Оплата: продление', { ru: '✅ Оплата получена. Подписка продлена до {expires_at}.{extra}{balance}\nПривязанные устройства продолжают работать - ничего вводить не нужно.{code}', en: '✅ Payment received. Subscription renewed until {expires_at}.{extra}{balance}\nLinked devices keep working - there is nothing to enter.{code}' }, [expires, extra, balance, code], ['expires_at']),
  t('pay.received_device', 'Оплата', 'Оплата: доп. устройство', { ru: '✅ Оплата получена: доп. устройство до {until}, дальше продлевается вместе с подпиской.\n{code}', en: '✅ Payment received: extra device until {until}, then it is renewed together with the subscription.\n{code}' }, [until, code], ['until']),
  t('pay.received_credit', 'Оплата', 'Оплата ушла в зачёт', { ru: '✅ Оплата {amount} получена, но {head}\nДоп. устройство можно купить только вместе с активной подпиской.\nМы зачли {amount}: сумма вычтется из следующего продления. Нажмите «Оплатить».', en: '✅ Payment of {amount} received, but {head}\nAn extra device can only be bought together with an active subscription.\nWe credited {amount}: the sum will be deducted from the next renewal. Press "Pay".' }, [amount, head, balance], ['amount']),
  t('pay.received_credit_repeat', 'Оплата', 'Оплата ушла в зачёт (повторный заказ)', { ru: '✅ Оплата {amount} получена и зачтена кредитом: скидка по приглашению одноразовая, а заказ уже был оплачен.\n{amount}{balance} вычтется из следующего продления. Подписка до {expires_at}.', en: '✅ Payment of {amount} received and kept as credit: the referral discount is one-time, and the order was already paid.\n{amount}{balance} will be deducted from the next renewal. Subscription until {expires_at}.' }, [amount, balance, expires], ['amount', 'expires_at']),
  t('pay.pending', 'Оплата', 'Платёж ждёт подтверждения', { ru: '⏳ Платёж{amount} получен и ждёт подтверждения. Подписка продлится сама - платить ещё раз не нужно.\nЕсли что-то не так - «Поддержка».', en: '⏳ Payment{amount} received and awaiting confirmation. The subscription will renew on its own - there is no need to pay again.\nIf something is wrong - "Support".' }, [amount]),
  t('pay.rejected', 'Оплата', 'Платёж не подтверждён', { ru: 'Платёж{amount} не подтверждён - подписка не продлена.\nЕсли деньги списались, напишите в «Поддержку».', en: 'Payment{amount} was not confirmed - the subscription was not renewed.\nIf the money was charged, write to "Support".' }, [amount]),
  t('pay.reminder_d3', 'Оплата', 'Напоминание за 3 дня', { ru: '⚠️ Подписка OMP заканчивается через 3 дня - {expires_at}.{renewal}\nНажмите «Оплатить» - ссылка на оплату придёт в этот чат.', en: '⚠️ Your OMP subscription ends in 3 days - {expires_at}.{renewal}\nPress "Pay" - the payment link will arrive in this chat.' }, [expires, renewal, price, daysLeft], ['expires_at']),
  t('pay.reminder_d1', 'Оплата', 'Напоминание за 1 день', { ru: '⚠️ Подписка OMP заканчивается завтра - {expires_at}.{renewal}\nНажмите «Оплатить» - ссылка на оплату придёт в этот чат.', en: '⚠️ Your OMP subscription ends tomorrow - {expires_at}.{renewal}\nPress "Pay" - the payment link will arrive in this chat.' }, [expires, renewal, price], ['expires_at']),
  t('pay.reminder_today', 'Оплата', 'Напоминание в день окончания', { ru: '⚠️ Подписка OMP заканчивается сегодня в {when}.{grace}{renewal}\nНажмите «Оплатить» - ссылка на оплату придёт в этот чат.', en: '⚠️ Your OMP subscription ends today at {when}.{grace}{renewal}\nPress "Pay" - the payment link will arrive in this chat.' }, [when, grace, renewal, expires], ['when']),
  t('pay.reminder_ended', 'Оплата', 'Закончилась сегодня', { ru: '⚠️ Подписка OMP закончилась сегодня в {when}.{grace}{renewal}\nНажмите «Оплатить» - ссылка на оплату придёт в этот чат.', en: '⚠️ Your OMP subscription ended today at {when}.{grace}{renewal}\nPress "Pay" - the payment link will arrive in this chat.' }, [when, grace, renewal], ['when']),
  t('pay.grace_end', 'Оплата', 'Льгота закончилась', { ru: '⚠️ {head}\n{renewal}\nНажмите «Оплатить» - ссылка на оплату придёт в этот чат.', en: '⚠️ {head}\n{renewal}\nPress "Pay" - the payment link will arrive in this chat.' }, [head, renewal, price]),
  t('pay.stars', 'Оплата', 'Счёт в звёздах', { ru: 'Счёт на {stars} звёзд. Комиссия сверху не добавляется.', en: 'Invoice for {stars} stars. No fee is added on top.' }, [stars]),
  t('pay.crypto', 'Оплата', 'Счёт в крипте', { ru: '{asset} {pay_amount}. Ссылка на оплату:', en: '{asset} {pay_amount}. Payment link:' }, [asset, payAmount]),
  t('pay.invoice_failed', 'Оплата', 'Счёт не создался', { ru: 'Не удалось создать счёт. Попробуйте ещё раз.', en: 'Could not create the invoice. Please try again.' }, []),

  t(
    'renewal.quote',
    'Продление',
    'Состав продления',
    { ru: 'Продление на {days}, до {expires_at}:\n• подписка - {price}\n{discount_line}{extra_line}{credit_line}{total_line}', en: 'Renewal for {days}, until {expires_at}:\n• subscription - {price}\n{discount_line}{extra_line}{credit_line}{total_line}' },
    [days, expires, price, discountLine, extraLine, creditLine, totalLine, total, balance],
    ['days', 'expires_at', 'price'],
  ),

  t('donate.off', 'Донаты', 'Донаты выключены', { ru: 'Поддержка проекта сейчас выключена.', en: 'Supporting the project is switched off right now.' }, []),
  t('donate.menu', 'Донаты', 'Выбор суммы', { ru: 'Поддержать проект OMP. Выберите сумму.', en: 'Support the OMP project. Choose an amount.' }, [name]),
  t('donate.comment', 'Донаты', 'Комментарий', { ru: 'Комментарий к донату, по желанию. До {comment_max} символов.', en: 'A comment for the donation, optional. Up to {comment_max} characters.' }, [commentMax]),
  t('donate.name', 'Донаты', 'Имя в благодарностях', { ru: 'Показать моё имя в списке благодарностей? Сейчас имя скрыто.', en: 'Show my name in the thanks list? The name is hidden right now.' }, [name]),
  t('donate.methods', 'Донаты', 'Способ доната', { ru: 'Как оплатить {amount}?\n{fee}', en: 'How to pay {amount}?\n{fee}' }, [amount, fee]),
  t('donate.methods_off', 'Донаты', 'Нет способов доната', { ru: 'Способы оплаты доната не включены.', en: 'Donation payment methods are not enabled.' }, []),
  t('donate.pay', 'Донаты', 'Ссылка ЮMoney', { ru: '{method} - {amount}. Комиссия уже в сумме.', en: '{method} - {amount}. The fee is already included.' }, [method, amount]),
  t('donate.stars', 'Донаты', 'Донат звёздами', { ru: 'Счёт на {stars} звёзд. Комиссия сверху не добавляется.', en: 'Invoice for {stars} stars. No fee is added on top.' }, [stars, amount]),
  t('donate.crypto', 'Донаты', 'Донат криптой', { ru: '{asset} {pay_amount}. Ссылка на оплату:', en: '{asset} {pay_amount}. Payment link:' }, [asset, payAmount]),
  t('donate.amount', 'Донаты', 'Своя сумма', { ru: 'Напишите сумму от {min_rub} до {max_rub} ₽, целым числом.', en: 'Enter an amount from {min_rub} to {max_rub} ₽, as a whole number.' }, [minRub, maxRub]),
  t('donate.amount_bad', 'Донаты', 'Сумма не подходит', { ru: 'Нужна сумма от {min_rub} до {max_rub} ₽, целым числом.', en: 'The amount must be from {min_rub} to {max_rub} ₽, as a whole number.' }, [minRub, maxRub]),
  t('donate.comment_bad', 'Донаты', 'Длинный комментарий', { ru: 'Комментарий длиннее {comment_max} символов.', en: 'The comment is longer than {comment_max} characters.' }, [commentMax]),
  t('donate.thanks', 'Донаты', 'Спасибо за донат', { ru: 'Спасибо за поддержку OMP.', en: 'Thank you for supporting OMP.' }, [name, amount]),
  t('donate.pending', 'Донаты', 'Донат ждёт подтверждения', { ru: 'Донат ждёт подтверждения в ЮMoney. Он ещё не засчитан.', en: 'The donation is awaiting confirmation in YooMoney. It is not counted yet.' }, [amount]),
  t('donate.error', 'Донаты', 'Ошибка доната', { ru: '{text}', en: '{text}' }, [text]),

  t('referral.bound', 'Рефералы', 'Приглашение сохранено', { ru: 'Приглашение сохранено. Код {ref_link}. Дни придут после оплаты друга.', en: 'Invitation saved. Code {ref_link}. The days will arrive after your friend pays.' }, [refLink, name, promo]),
  t('referral.referrer', 'Рефералы', 'Дни пригласившему', { ru: 'Друг оплатил подписку. Вам добавлено {days}. Подписка до {expires_at}.', en: 'Your friend paid for a subscription. You were granted {days}. Subscription until {expires_at}.' }, [days, expires, name, refLink], ['days']),
  t('referral.friend', 'Рефералы', 'Дни другу', { ru: 'Вам добавлено {days} за приглашение. Подписка до {expires_at}.', en: 'You were granted {days} for the invitation. Subscription until {expires_at}.' }, [days, expires, name, refLink], ['days']),

  t('devices.none', 'Устройства', 'Нет подписки', { ru: 'Подписки нет.\n«Оплатить» - {price} за {days}, {phones}. На ТВ подписка не нужна.{trial}', en: 'There is no subscription.\n"Pay" - {price} for {days}, {phones}. The TV does not need a subscription.{trial}' }, [price, days, phones, trial]),
  t('devices.list', 'Устройства', 'Список устройств', { ru: '{devices}{code}', en: '{devices}{code}' }, [devices, code, daysLeft, expires, left, limit], ['devices']),
  t('devices.extra', 'Устройства', 'Ещё одно устройство', { ru: '{text}', en: '{text}' }, [text, price, extra, expires]),
  t('devices.extra_grace', 'Устройства', 'Устройство в льготный период', { ru: 'Сейчас льготный период - отдельно устройство не купить. Продлите подписку вместе с ним одной оплатой:\n{renewal}{tail}', en: 'It is the grace period now - a device cannot be bought on its own. Renew the subscription together with it in one payment:\n{renewal}{tail}' }, [renewal, tail, price]),
  t('devices.limit', 'Устройства', 'Места заняты', { ru: 'Все места заняты - новый код не выдан. Привязанные устройства продолжают работать.', en: 'All slots are taken - no new code was issued. Linked devices keep working.' }, []),
  t('devices.unbind_ask', 'Устройства', 'Подтверждение отвязки', { ru: 'Отвязать {device}? Оно сразу перестанет работать.\nЭто 1 смена из {limit} за 30 дней (останется {left}).', en: 'Unlink {device}? It will stop working immediately.\nThis is 1 change of {limit} per 30 days ({left} will remain).' }, [device, limit, left]),
  t('devices.unbind_done', 'Устройства', 'Устройство отвязано', { ru: '{device} отвязано и больше не работает.\n{text}', en: '{device} is unlinked and no longer works.\n{text}' }, [device, text, left]),
  t('devices.unbind_all_ask', 'Устройства', 'Отвязать все', { ru: 'Отвязать все устройства ({count})? Они сразу перестанут работать.\nЭто {count} смен из {limit} за 30 дней (останется {left}).', en: 'Unlink all devices ({count})? They will stop working immediately.\nThis is {count} changes of {limit} per 30 days ({left} will remain).' }, [count, limit, left]),
  t('devices.unbind_all_block', 'Устройства', 'Все сразу нельзя', { ru: 'Отвязать все устройства ({count}) сейчас нельзя: {text}', en: 'All devices ({count}) cannot be unlinked right now: {text}' }, [count, text, left, when]),
  t('devices.unbind_all_done', 'Устройства', 'Все отвязаны', { ru: 'Все устройства отвязаны ({count}) и больше не работают.\n{text}', en: 'All devices are unlinked ({count}) and no longer work.\n{text}' }, [count, text]),
  t('devices.swap_limit', 'Устройства', 'Смены исчерпаны', { ru: 'Сменить устройство сейчас нельзя: самостоятельно - не больше {limit} раз за 30 дней.{when}\nУже привязанные устройства работают. Если нужно срочно - напишите в «Поддержку».', en: 'The device cannot be changed right now: on your own - no more than {limit} times per 30 days.{when}\nAlready linked devices keep working. If it is urgent - write to "Support".' }, [limit, when, left]),

  t('promo.ask', 'Промокод', 'Запрос промокода', { ru: 'Отправьте промокод одним сообщением.\nПример: DEMO1', en: 'Send the promo code as a single message.\nExample: DEMO1' }, []),
  t('promo.bad', 'Промокод', 'Промокод не найден', { ru: 'Промокод не найден или уже не действует.', en: 'The promo code was not found or is no longer valid.' }, [promoCode]),
  t('promo.already', 'Промокод', 'Уже активирован', { ru: 'Вы уже активировали этот промокод.', en: 'You have already activated this promo code.' }, []),
  t('promo.exhausted', 'Промокод', 'Промокод закончился', { ru: 'Этот промокод уже использовали все, кому можно.', en: 'This promo code has already been used by everyone eligible.' }, []),
  t('promo.expired', 'Промокод', 'Срок промокода истёк', { ru: 'Срок промокода истёк.', en: 'The promo code has expired.' }, []),
  t('promo.needs_sub', 'Промокод', 'Нужна подписка', { ru: 'Этот промокод добавляет устройство к подписке. Сначала оформите подписку - «Оплатить».', en: 'This promo code adds a device to a subscription. Get a subscription first - "Pay".' }, []),
  t('promo.ok', 'Промокод', 'Промокод принят', { ru: 'Промокод принят: {bonus}.{code}', en: 'Promo code accepted: {bonus}.{code}' }, [bonus, code, promoCode, days, expires]),

  t('support.ask', 'Поддержка', 'Запрос в поддержку', { ru: 'Напишите сообщение для администратора одним текстом.', en: 'Write a message for the administrator as a single text.' }, []),
  t('support.fast', 'Поддержка', 'Слишком часто', { ru: 'Слишком много сообщений подряд - подождите 10 минут. Предыдущие сообщения администратор уже получил.', en: 'Too many messages in a row - please wait 10 minutes. The administrator already received the previous messages.' }, []),
  t('support.sent', 'Поддержка', 'Передано администратору', { ru: 'Сообщение передано администратору. Ответ придёт в этот чат.', en: 'The message was passed to the administrator. The reply will arrive in this chat.' }, []),
  t('support.saved_off', 'Поддержка', 'Сохранено, уведомления выключены', { ru: 'Сообщение сохранено. Уведомления администраторам выключены.', en: 'The message was saved. Administrator notifications are switched off.' }, []),
  t('support.saved_no_admin', 'Поддержка', 'Админы не указаны', { ru: 'Сообщение сохранено. Администраторы в панели ещё не указаны.', en: 'The message was saved. Administrators are not set in the panel yet.' }, []),
  t('support.closed', 'Поддержка', 'Диалог закрыт', { ru: 'Диалог с поддержкой завершён. Если вопрос останется - нажмите «Поддержка» и напишите снова.', en: 'The support dialog is closed. If the question remains - press "Support" and write again.' }, []),
  t('support.relay', 'Поддержка', 'Ответ админа пользователю', { ru: 'Поддержка OMP:\n{text}', en: 'OMP support:\n{text}' }, [text], ['text']),
  t('support.note', 'Поддержка', 'Уведомление админу', { ru: 'Поддержка · {who}\n{text}\n\nОтветьте на это сообщение - текст уйдёт пользователю.', en: 'Support · {who}\n{text}\n\nReply to this message - the text will go to the user.' }, [who, text]),

  t('link.stale', 'Ошибки', 'Ссылка устройства устарела', { ru: 'Ссылка устарела или уже использована. В OMP нажмите «Привязать Telegram» ещё раз.', en: 'The link is out of date or already used. In OMP press "Link Telegram" again.' }, []),
  t('link.ask', 'Ошибки', 'Подтвердить привязку', { ru: 'Привязать к этому Telegram устройство {device}…?\nКод и доступ к поиску появятся только после подтверждения.', en: 'Link device {device}… to this Telegram?\nThe code and search access will appear only after confirmation.' }, [device]),
  t('link.ok', 'Ошибки', 'Телефон привязан', { ru: 'Телефон привязан к этому Telegram.\n{status}', en: 'The phone is linked to this Telegram.\n{status}' }, [status, name]),
  t('login.denied', 'Ошибки', 'Нет доступа к панели', { ru: 'Нет доступа к панели. Добавьте свой Telegram id в настройках администраторов.', en: 'No access to the panel. Add your Telegram id in the administrator settings.' }, []),
  t('login.stale', 'Ошибки', 'Ссылка входа устарела', { ru: 'Ссылка для входа устарела. Откройте панель снова и нажмите «Войти через Telegram».', en: 'The login link is out of date. Open the panel again and press "Log in with Telegram".' }, []),
  t('login.ok', 'Ошибки', 'Вход подтверждён', { ru: 'Вход в админ-панель подтверждён. Вернитесь в браузер - страница откроется сама.', en: 'Admin panel login confirmed. Return to the browser - the page will open on its own.' }, []),
  t('login.ok_short', 'Ошибки', 'Вход подтверждён коротко', { ru: 'Вход в админ-панель подтверждён. Вернитесь в браузер.', en: 'Admin panel login confirmed. Return to the browser.' }, []),
  t('login.ask', 'Ошибки', 'Запрос входа админу', { ru: 'Подтвердите вход в админку\nIP: {arg}\nУстройство: {text}', en: 'Confirm admin login\nIP: {arg}\nDevice: {text}' }, [arg, text]),
  t('error.maintenance', 'Ошибки', 'Обслуживание', { ru: 'Сейчас обслуживание биллинга. Админ-вход работает; остальные команды временно недоступны.', en: 'Billing maintenance is in progress. Admin login works; other commands are temporarily unavailable.' }, []),
  t('error.revoke', 'Ошибки', 'Устройство отключено', { ru: 'Устройство {device}… отключено администратором: поиск OMP на нём больше не работает.\nЧтобы подключить устройство снова, нажмите «Код» и введите новый код в OMP. Вопросы - «Поддержка».', en: 'Device {device}… was disabled by the administrator: OMP search no longer works on it.\nTo connect the device again, press "Code" and enter a new code in OMP. Questions - "Support".' }, [device]),
  t('issue.code', 'Ошибки', 'Код из панели', { ru: 'Код подписки OMP: {code}\nПодписка до {until}.\nВведите его в OMP на телефоне. На другом устройстве он не сработает.', en: 'OMP subscription code: {code}\nSubscription until {until}.\nEnter it in OMP on your phone. It will not work on another device.' }, [code, until], ['code']),
  t('grant.user', 'Ошибки', 'Дни от администратора', { ru: 'Вам добавлено {days}. Подписка до {expires_at}.{code}', en: 'You were granted {days}. Subscription until {expires_at}.{code}' }, [days, expires, code], ['days', 'expires_at']),

  t('admin.no_access', 'Админ', 'Нет доступа', { ru: 'Нет доступа. Добавьте свой Telegram id в настройках панели.', en: 'No access. Add your Telegram id in the panel settings.' }, []),
  t('admin.readonly', 'Админ', 'Только просмотр', { ru: 'Режим только просмотра. Выдача дней и промокоды недоступны.', en: 'Read-only mode. Granting days and promo codes are not available.' }, []),
  t('admin.home', 'Админ', 'Админ-кабинет', { ru: 'Админ-кабинет. Сводка, поиск, выдача дней и промокоды.\n«Как пользователь» - проверить кабинет подписчика.', en: 'Admin cabinet. Summary, search, granting days and promo codes.\n"As user" - check the subscriber cabinet.' }, []),
  t('admin.summary', 'Админ', 'Сводка', { ru: 'Сводка:\n{summary}', en: 'Summary:\n{summary}' }, [summary]),
  t('admin.find_ask', 'Админ', 'Поиск: запрос', { ru: 'Пришлите Telegram id, @ник, код XXXX-XXXX или начало device id.', en: 'Send a Telegram id, @nick, code XXXX-XXXX or the start of a device id.' }, []),
  t('admin.find_miss', 'Админ', 'Поиск: пусто', { ru: 'Не найдено: {arg}', en: 'Not found: {arg}' }, [arg]),
  t('admin.find_hit', 'Админ', 'Поиск: карточка', { ru: 'Аккаунт {who}\n{status}{code}', en: 'Account {who}\n{status}{code}' }, [who, status, code]),
  t('admin.grant_ask', 'Админ', 'Выдача: запрос', { ru: 'Пришлите Telegram id или @ник и число дней.\nПример: 123456789 30 или @nick 30', en: 'Send a Telegram id or @nick and a number of days.\nExample: 123456789 30 or @nick 30' }, []),
  t('admin.grant_bad_user', 'Админ', 'Пользователь не найден', { ru: 'Не найден пользователь «{arg}». Проверьте id или @ник - пользователь должен хотя бы раз написать боту. Новый аккаунт не создан.', en: 'User "{arg}" was not found. Check the id or @nick - the user must have written to the bot at least once. No new account was created.' }, [arg]),
  t('admin.grant_bad_days', 'Админ', 'Неверное число дней', { ru: 'Нужно целое число дней от 1 до 3650.\nПример: {arg} 30', en: 'A whole number of days from 1 to 3650 is required.\nExample: {arg} 30' }, [arg]),
  t('admin.grant_fail', 'Админ', 'Не вышло выдать', { ru: 'Не вышло выдать дни.', en: 'Could not grant the days.' }, []),
  t('admin.grant_ok', 'Админ', 'Дни выданы', { ru: 'Выдано +{days} - {who}, подписка до {expires_at}.\n{text}', en: 'Granted +{days} - {who}, subscription until {expires_at}.\n{text}' }, [days, who, expires, text]),
  t('admin.promo_ask', 'Админ', 'Промокод: формат', { ru: 'Формат: КОД дни лимит\nПример: DEMO1 1 50', en: 'Format: CODE days limit\nExample: DEMO1 1 50' }, []),
  t('admin.promo_exists', 'Админ', 'Промокод уже есть', { ru: 'Такой промокод уже есть.', en: 'Such a promo code already exists.' }, []),
  t('admin.promo_bad', 'Админ', 'Некорректный промокод', { ru: 'Некорректный промокод.', en: 'Invalid promo code.' }, []),
  t('admin.promo_ok', 'Админ', 'Промокод создан', { ru: 'Промокод {promo_code} ({promo_info}, до {uses} исп.).', en: 'Promo code {promo_code} ({promo_info}, up to {uses} uses).' }, [promoCode, promoInfo, uses]),
  t('admin.reply_sent', 'Админ', 'Ответ отправлен', { ru: 'Ответ отправлен пользователю {who}.', en: 'The reply was sent to user {who}.' }, [who]),
];

const BY_ID = new Map(CATALOG.map((row) => [row.id, row]));

/** Fragments are embedded into a host message, so they cannot carry their own buttons or media. */
const FRAGMENTS = new Set(['renewal.quote', 'devices.limit']);

/** Telegram invoices carry only a title, a description and the pay button: no media, no custom buttons. */
const INVOICES = new Set(['pay.stars', 'donate.stars']);

export function isFragmentTemplate(id) {
  return FRAGMENTS.has(String(id || ''));
}

export function isInvoiceTemplate(id) {
  return INVOICES.has(String(id || ''));
}

export function templateById(id) {
  return BY_ID.get(String(id || '')) || null;
}

/** Default (in-code) template body for a recipient language. No language, or unsupported, stays RU. */
export function bodyFor(template, lang) {
  if (!template) return '';
  if (lang === 'en' && template.bodyEn) return template.bodyEn;
  const i18n = template.bodyI18n;
  if (lang && lang !== 'ru' && i18n && i18n[lang]) return i18n[lang];
  return template.body;
}

export function normalizeDashes(value) {
  return String(value == null ? '' : value).replace(/\u2014|\u2013/g, '-');
}

/** Prefix match so regional variants (uk-UA, kk-KZ, en-US, ...) map to the base code. Unsupported stays ''. */
export function normalizeLang(code) {
  const c = String(code || '').toLowerCase();
  for (let i = 0; i < LANG_CODES.length; i++) {
    if (c.indexOf(LANG_CODES[i]) === 0) return LANG_CODES[i];
  }
  return '';
}

export function subscriptionCopyState(sub, paid) {
  if (!sub) return '';
  if (!sub.active || sub.inGrace) return 'expired';
  if (!paid) return 'trial';
  return 'active';
}

/**
 * Plural form for a count in a recipient language: ru/uk/be decline one/few/many, EN one/many,
 * RO one/few/many (the many form carries "de"), the other CIS languages keep one form after a
 * numeral. Absent or unsupported language declines like RU.
 */
export function pluralLang(n, lang, one, few, many) {
  const a = Math.abs(Math.floor(Number(n) || 0));
  if (lang === 'en') return a === 1 ? one : many;
  if (lang === 'ro') {
    if (a === 1) return one;
    const d100 = a % 100;
    return a === 0 || (d100 >= 2 && d100 <= 19) ? few : many;
  }
  if (lang && lang !== 'ru' && lang !== 'uk' && lang !== 'be' && LANGS.has(lang)) return one;
  const d10 = a % 10;
  const d100 = a % 100;
  if (d10 === 1 && d100 !== 11) return one;
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return few;
  return many;
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

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Bot markup as plain text, for the places Telegram takes no markup at all (an invoice description).
 * Entities are restored first: stripping tags while "&lt;b&gt;" is still an entity brings that markup back
 * in the unescape that follows. The tag pass then repeats until the string stops changing, because one pass
 * leaves a tag that hides behind an unbalanced neighbour.
 */
export function plainText(value) {
  let out = String(value ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
  for (let i = 0; i < 8; i++) {
    const next = out.replace(/<[^>]*>/g, '');
    if (next === out) break;
    out = next;
  }
  return out;
}

/**
 * `raw` lists the keys whose value is already safe HTML built by the code (a rendered fragment or a
 * <code> block). Every other value is escaped, so user and admin data never becomes markup.
 */
function fill(body, vars, escape, raw) {
  const bag = vars || {};
  const rawKeys = raw && raw.length ? new Set(raw) : null;
  return String(body || '').replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (_, key) => {
    if (!Object.prototype.hasOwnProperty.call(bag, key) || bag[key] == null) return '';
    const value = String(bag[key]);
    return escape && !(rawKeys && rawKeys.has(key)) ? escapeHtml(value) : value;
  });
}

export function renderBody(body, vars, raw) {
  return fill(body, vars, true, raw);
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
  let mediaKind = src.mediaKind === 'video' ? 'video' : src.mediaKind === 'photo' ? 'photo' : '';
  let mediaUrl = String(src.mediaUrl || '').trim();
  if (template && (mediaKind || src.buttons != null)) {
    if (isFragmentTemplate(template.id)) {
      errors.push('Этот шаблон - часть другого сообщения, кнопки и медиа для него не поддерживаются');
      mediaKind = '';
    } else if (isInvoiceTemplate(template.id)) {
      errors.push('Счёт Telegram не поддерживает свои кнопки и медиа, текст уходит в описание счёта');
      mediaKind = '';
    }
  }
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
  // Unsupported or absent language: only the default variant, never a state-only one.
  if (!ln) return hit('', '');
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

export function applyBuilt(saved, built, vars, raw) {
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
  const text = renderBody(saved.body || '', vars || {}, raw);
  // A blank render (every variable empty) must not replace the working in-code text.
  if ((!text.trim() && !saved.mediaUrl) || text.length > limit || markupError(text)) return base;
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

export function sampleVars(template, lang) {
  const out = {};
  const list = (template && template.variables) || [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (lang === 'en' && item.sampleEn !== undefined) out[item.key] = item.sampleEn;
    else if (lang && lang !== 'ru' && item.samples && item.samples[lang] !== undefined) out[item.key] = item.samples[lang];
    else out[item.key] = item.sample;
  }
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

/**
 * Plain UI strings that are not editable message templates: keyboard and inline buttons, callback
 * toasts, and the fragments the code assembles into a host message. One mechanism for all of them:
 * str(id, lang, vars). RU is the default; an unsupported or absent language stays RU. Values are
 * interpolated without HTML escaping - callers escape when they mix a fragment into HTML.
 */
const STRINGS = {
  'btn.cabinet': { ru: 'Кабинет', en: 'Account' },
  'btn.pay': { ru: 'Оплатить', en: 'Pay' },
  'btn.devices': { ru: 'Устройства', en: 'Devices' },
  'btn.promo': { ru: 'Промокод', en: 'Promo code' },
  'btn.price': { ru: 'Цены', en: 'Prices' },
  'btn.support': { ru: 'Поддержка', en: 'Support' },
  'btn.donate': { ru: 'Поддержать проект', en: 'Support the project' },
  'btn.buy': { ru: 'Подписка', en: 'Subscription' },
  'btn.renew': { ru: 'Продлить', en: 'Renew' },
  'btn.code': { ru: 'Код', en: 'Code' },
  'btn.unlink': { ru: 'Отвязать', en: 'Unlink' },
  'btn.admin_summary': { ru: 'Сводка', en: 'Summary' },
  'btn.admin_find': { ru: 'Найти', en: 'Find' },
  'btn.admin_grant': { ru: 'Выдать дни', en: 'Grant days' },
  'btn.admin_promo': { ru: 'Новый промо', en: 'New promo' },
  'btn.admin_user': { ru: 'Как пользователь', en: 'As user' },
  'btn.open_omp': { ru: 'Открыть в OMP', en: 'Open in OMP' },
  'btn.unbind_n': { ru: 'Отвязать {n}', en: 'Unlink {n}' },
  'btn.unbind_all': { ru: 'Отвязать все', en: 'Unlink all' },
  'btn.yes_unbind': { ru: 'Да, отвязать', en: 'Yes, unlink' },
  'btn.cancel': { ru: 'Отмена', en: 'Cancel' },
  'btn.yes_unbind_all': { ru: 'Да, отвязать все', en: 'Yes, unlink all' },
  'btn.link': { ru: 'Привязать', en: 'Link' },
  'btn.wallet': { ru: 'Кошелёк - {amount}', en: 'Wallet - {amount}' },
  'btn.card': { ru: 'Карта - {amount}', en: 'Card - {amount}' },
  'btn.stars': { ru: 'Звёзды - {amount}', en: 'Stars - {amount}' },
  'btn.sub_only_wallet': { ru: 'Только подписка, кошелёк - {amount}', en: 'Subscription only, wallet - {amount}' },
  'btn.sub_only_card': { ru: 'Только подписка, карта - {amount}', en: 'Subscription only, card - {amount}' },
  'btn.sub_only_prefix': { ru: 'Только подписка', en: 'Subscription only' },
  'btn.pay_site': { ru: 'Оплатить на сайте', en: 'Pay on the website' },
  'btn.pay_crypto_bot': { ru: 'Оплатить в Crypto Bot', en: 'Pay in Crypto Bot' },
  'btn.custom_amount': { ru: 'Своя сумма', en: 'Custom amount' },
  'btn.no_comment': { ru: 'Без комментария', en: 'No comment' },
  'btn.show_name': { ru: 'Показать имя', en: 'Show name' },
  'btn.hide_name': { ru: 'Не показывать', en: 'Hide name' },

  'toast.stale': { ru: 'Кнопка устарела - откройте «Устройства» ещё раз.', en: 'The button is out of date - open "Devices" again.' },
  'toast.stale_short': { ru: 'Кнопка устарела', en: 'The button is out of date' },
  'toast.cancelled': { ru: 'Отменено', en: 'Cancelled' },
  'toast.linked': { ru: 'Привязано', en: 'Linked' },
  'toast.unbound': { ru: 'Отвязано', en: 'Unlinked' },
  'toast.already_paid': { ru: 'Этот счёт уже оплачен', en: 'This invoice is already paid' },
  'toast.stars_off': { ru: 'Оплата звёздами выключена', en: 'Stars payment is switched off' },
  'toast.crypto_off': { ru: 'Крипта недоступна', en: 'Crypto is not available' },
  'toast.device_gone': { ru: 'Устройство уже отвязано или сменилось.', en: 'The device is already unlinked or has changed.' },
  'toast.list_changed': { ru: 'Список устройств изменился.', en: 'The device list has changed.' },
  'toast.login_ok': { ru: 'Вход подтверждён', en: 'Login confirmed' },
  'toast.login_stale': { ru: 'Ссылка устарела', en: 'The link is out of date' },
  'toast.donate_off': { ru: 'Выключено', en: 'Switched off' },
  'toast.amount_bad': { ru: 'Сумма не подходит', en: 'The amount does not fit' },
  'toast.held': { ru: 'Платёж уже у ЮMoney и ждёт подтверждения', en: 'The payment is already with YooMoney and awaiting confirmation' },

  'code.head_device': { ru: 'Код для нового устройства', en: 'Code for a new device' },
  'code.head_sub': { ru: 'Код подписки', en: 'Subscription code' },
  'code.head_for_it': { ru: 'Код для него', en: 'Code for it' },
  'code.tap': { ru: 'Нажмите на код, чтобы скопировать, и введите его в OMP на телефоне', en: 'Tap the code to copy it, then enter it in OMP on your phone' },
  'code.or_button': { ru: ' - или кнопка «Открыть в OMP».', en: ' - or use the "Open in OMP" button.' },

  'trial.line': { ru: '\nПробный день - промокод {code} в «Промокод».', en: '\nTrial day - promo code {code} in "Promo code".' },

  'sub.until': { ru: 'Подписка до {when}', en: 'Subscription until {when}' },
  'sub.ended': { ru: 'Подписка закончилась {when} - поиск отключён на всех устройствах.', en: 'The subscription ended {when} - search is disabled on all devices.' },
  'sub.grace': { ru: '⚠️ Подписка закончилась {when}.\nЛьготный период: поиск работает до {access}. Продлите - «Оплатить».', en: '⚠️ The subscription ended {when}.\nGrace period: search works until {access}. Renew - "Pay".' },
  'sub.none': { ru: 'Подписки нет.', en: 'There is no subscription.' },
  'sub.none_hint': { ru: '\n«Оплатить» - {price} за {days}, {phones}. На ТВ подписка не нужна.', en: '\n"Pay" - {price} for {days}, {phones}. The TV does not need a subscription.' },
  'sub.credit': { ru: '\nЗачёт: {amount} - вычтем из следующего продления.', en: '\nCredit: {amount} - we will deduct it from the next renewal.' },
  'sub.pay_hint': { ru: '\nНажмите «Оплатить».', en: '\nPress "Pay".' },
  'sub.bound_count': { ru: '\nПривязано устройств: {n}. После оплаты они заработают сами, код вводить не нужно.', en: '\nLinked devices: {n}. After payment they will work on their own, no code needed.' },
  'sub.bound_list': { ru: '\nПривязаны: {list}', en: '\nLinked: {list}' },
  'sub.hint_grace': { ru: '\n«Устройства» - список и коды.', en: '\n"Devices" - the list and codes.' },
  'sub.hint_free': { ru: '\n«Устройства» - код для нового устройства и список. «Оплатить» - продлить.', en: '\n"Devices" - a code for a new device and the list. "Pay" - to renew.' },
  'sub.hint_full': { ru: '\nВсе места заняты. «Устройства» - список, отвязка{extra}.', en: '\nAll slots are taken. "Devices" - the list, unlinking{extra}.' },
  'sub.hint_full_extra': { ru: ' и ещё одно устройство за {price}', en: ' and one more device for {price}' },

  'dev.line': { ru: 'Устройства: {used} из {limit}', en: 'Devices: {used} of {limit}' },
  'dev.online': { ru: ' · в сети {when}', en: ' · online {when}' },
  'dev.bound_at': { ru: ' · привязано {when}', en: ' · linked {when}' },
  'dev.over_extra': { ru: ' · не работает: доп. устройство не продлено', en: ' · not working: the extra device was not renewed' },
  'dev.over_limit': { ru: ' · не работает: сверх лимита устройств', en: ' · not working: over the device limit' },
  'dev.swap_left': { ru: 'Смен устройства осталось: {left} из {limit} за 30 дней.', en: 'Device changes left: {left} of {limit} per 30 days.' },
  'dev.swap_left_note': { ru: ' Отвязанное устройство сразу перестаёт работать.', en: ' An unlinked device stops working immediately.' },
  'dev.swap_used': { ru: 'Смены устройства на 30 дней исчерпаны: следующая - с {when}.', en: 'Device changes for 30 days are used up: the next one - from {when}.' },
  'dev.last_swap': { ru: 'Это была последняя смена на 30 дней: следующая - с {when}.', en: 'That was the last change for 30 days: the next one - from {when}.' },
  'dev.next_swap': { ru: '\nСледующая смена - с {when}.', en: '\nThe next change - from {when}.' },
  'dev.pay_hint': { ru: '\nНажмите «Оплатить» - устройства заработают сами.', en: '\nPress "Pay" - the devices will work on their own.' },
  'dev.label': { ru: 'Устройство {n} ({id}…)', en: 'Device {n} ({id}…)' },
  'dev.unbind_ask': { ru: 'Отвязать {device}? Оно сразу перестанет работать.\nЭто 1 смена из {limit} за 30 дней (останется {left}).', en: 'Unlink {device}? It will stop working immediately.\nThis is 1 change of {limit} per 30 days ({left} will remain).' },
  'dev.unbind_done': { ru: '{device} отвязано и больше не работает.\n{text}', en: '{device} is unlinked and no longer works.\n{text}' },
  'dev.unbind_all_ask': { ru: 'Отвязать все устройства ({count})? Они сразу перестанут работать.\nЭто {count} {changes} из {limit} за 30 дней (останется {left}).', en: 'Unlink all devices ({count})? They will stop working immediately.\nThis is {count} {changes} of {limit} per 30 days ({left} will remain).' },
  'dev.unbind_all_block': { ru: 'Отвязать все устройства ({count}) сейчас нельзя: {text}', en: 'All devices ({count}) cannot be unlinked right now: {text}' },
  'dev.unbind_all_done': { ru: 'Все устройства отвязаны ({count}) и больше не работают.\n{text}', en: 'All devices are unlinked ({count}) and no longer work.\n{text}' },
  'dev.unbind_one_hint': { ru: '\nОтвяжите по одному кнопками «Отвязать N».', en: '\nUnlink them one by one with the "Unlink N" buttons.' },
  'dev.swap_limit': { ru: 'Сменить устройство сейчас нельзя: самостоятельно - не больше {limit} раз за 30 дней.{when}\nУже привязанные устройства работают. Если нужно срочно - напишите в «Поддержку».', en: 'The device cannot be changed right now: on your own - no more than {limit} times per 30 days.{when}\nAlready linked devices keep working. If it is urgent - write to "Support".' },
  'dev.limit_text': { ru: 'Все места заняты - новый код не выдан. Привязанные устройства продолжают работать.', en: 'All slots are taken - no new code was issued. Linked devices keep working.' },

  'ren.head': { ru: 'Продление на {days}, до {when}:', en: 'Renewal for {days}, until {when}:' },
  'ren.sub_line': { ru: '• подписка - {price}', en: '• subscription - {price}' },
  'ren.discount_line': { ru: '• скидка по приглашению - {off}', en: '• referral discount - {off}' },
  'ren.extra_line': { ru: '• доп. устройство × {n} - {sum}', en: '• extra device × {n} - {sum}' },
  'ren.credit_line': { ru: '• зачёт - −{amount}', en: '• credit - −{amount}' },
  'ren.total': { ru: 'Итого: {amount}', en: 'Total: {amount}' },
  'ren.price_line': { ru: 'Продление на {days}: {total}{bits}.', en: 'Renewal for {days}: {total}{bits}.' },
  'ren.bit_sub': { ru: 'подписка {base} + доп. устройство {extra} × {n}', en: 'subscription {base} + extra device {extra} × {n}' },
  'ren.bit_credit': { ru: 'зачёт −{amount}', en: 'credit −{amount}' },
  'ren.bit_discount': { ru: 'скидка по приглашению {off}', en: 'referral discount {off}' },

  'offer.fee_note': { ru: 'Комиссия ЮMoney удерживается с получателя и уже включена в сумму, чтобы после неё осталась цена подписки.\n', en: 'The YooMoney fee is withheld from the recipient and is already included in the amount, so the subscription price remains after it.\n' },
  'offer.donate_fee_note': { ru: 'Комиссия ЮMoney удерживается с получателя и уже включена в сумму, чтобы после неё осталась сумма доната.\n', en: 'The YooMoney fee is withheld from the recipient and is already included in the amount, so the donation amount remains after it.\n' },
  'offer.wallet_line': { ru: 'Кошелёк: {base} + {fee} = {gross}', en: 'Wallet: {base} + {fee} = {gross}' },
  'offer.card_line': { ru: 'Карта: {base} + {fee} = {gross}', en: 'Card: {base} + {fee} = {gross}' },
  'alt.stars_line': { ru: 'Звёзды: {n}. Комиссия сверху не добавляется.', en: 'Stars: {n}. No fee is added on top.' },

  'paymsg.new': { ru: '✅ Оплата получена. Подписка до {when}, {phones}.\n{code}\nНа ТВ подписка не нужна.', en: '✅ Payment received. Subscription until {when}, {phones}.\n{code}\nThe TV does not need a subscription.' },
  'paymsg.renew': { ru: '✅ Оплата получена. Подписка продлена до {when}.', en: '✅ Payment received. Subscription renewed until {when}.' },
  'paymsg.renew_extra': { ru: '\nДоп. устройств: {n}, тоже до {when}.', en: '\nExtra devices: {n}, also until {when}.' },
  'paymsg.renew_credit': { ru: '\nЗачтено: {amount}.', en: '\nCredited: {amount}.' },
  'paymsg.renew_devices': { ru: '\nПривязанные устройства продолжают работать - ничего вводить не нужно.', en: '\nLinked devices keep working - there is nothing to enter.' },
  'paymsg.device': { ru: '✅ Оплата получена: доп. устройство до {when}, дальше продлевается вместе с подпиской.', en: '✅ Payment received: extra device until {when}, then it is renewed together with the subscription.' },
  'paymsg.device_no_code': { ru: '\nКод для него - в «Устройства».', en: '\nThe code for it - in "Devices".' },
  'paymsg.credit_repeat': { ru: '✅ Оплата {amount} получена и зачтена кредитом: скидка по приглашению одноразовая, а заказ уже был оплачен.\n{amount}{balance} вычтется из следующего продления.{until}', en: '✅ Payment of {amount} received and kept as credit: the referral discount is one-time, and the order was already paid.\n{amount}{balance} will be deducted from the next renewal.{until}' },
  'paymsg.credit': { ru: '✅ Оплата {amount} получена, но {head}.\nДоп. устройство можно купить только вместе с активной подпиской.\nМы зачли {amount}{balance}: сумма вычтется из следующего продления. Нажмите «Оплатить».', en: '✅ Payment of {amount} received, but {head}.\nAn extra device can only be bought together with an active subscription.\nWe credited {amount}{balance}: the sum will be deducted from the next renewal. Press "Pay".' },
  'paymsg.credit_total': { ru: ' (всего зачёт {amount})', en: ' (total credit {amount})' },
  'paymsg.head_grace': { ru: 'подписка сейчас в льготном периоде', en: 'the subscription is in the grace period now' },
  'paymsg.head_ended': { ru: 'подписка уже закончилась', en: 'the subscription has already ended' },
  'paymsg.until': { ru: ' Подписка до {when}.', en: ' Subscription until {when}.' },
  'paymsg.pending': { ru: '⏳ Платёж{amount} получен и ждёт подтверждения. Подписка продлится сама - платить ещё раз не нужно.\nЕсли что-то не так - «Поддержка».', en: '⏳ Payment{amount} received and awaiting confirmation. The subscription will renew on its own - there is no need to pay again.\nIf something is wrong - "Support".' },
  'paymsg.rejected': { ru: 'Платёж{amount} не подтверждён - подписка не продлена.\nЕсли деньги списались, напишите в «Поддержку».', en: 'Payment{amount} was not confirmed - the subscription was not renewed.\nIf the money was charged, write to "Support".' },

  'grant.user': { ru: 'Вам добавлено {days}. Подписка до {when}.', en: 'You were granted {days}. Subscription until {when}.' },

  'rem.d3': { ru: '⚠️ Подписка OMP заканчивается через 3 дня - {when}.', en: '⚠️ Your OMP subscription ends in 3 days - {when}.' },
  'rem.d1': { ru: '⚠️ Подписка OMP заканчивается завтра - {when}.', en: '⚠️ Your OMP subscription ends tomorrow - {when}.' },
  'rem.today': { ru: '⚠️ Подписка OMP заканчивается сегодня в {when}.', en: '⚠️ Your OMP subscription ends today at {when}.' },
  'rem.ended': { ru: '⚠️ Подписка OMP закончилась сегодня в {when}.', en: '⚠️ Your OMP subscription ended today at {when}.' },
  'rem.grace_after': { ru: '\nПосле этого ещё {days} льготного периода: поиск будет работать до {when}.', en: '\nAfter that there are {days} more of grace period: search will work until {when}.' },
  'rem.grace_now': { ru: '\nЛьготный период: поиск работает до {when}.', en: '\nGrace period: search works until {when}.' },
  'rem.pay_hint': { ru: 'Нажмите «Оплатить» - ссылка на оплату придёт в этот чат.', en: 'Press "Pay" - the payment link will arrive in this chat.' },
  'rem.grace_end_grace': { ru: '⚠️ Льготный период закончился - поиск в OMP отключён.', en: '⚠️ The grace period has ended - OMP search is disabled.' },
  'rem.grace_end_sub': { ru: '⚠️ Подписка OMP закончилась - поиск отключён.', en: '⚠️ Your OMP subscription has ended - search is disabled.' },
  'rem.devices_auto': { ru: 'Привязанные устройства заработают сами, код вводить не нужно.', en: 'Linked devices will work on their own, no code needed.' },
  'rem.without_extra': { ru: 'Без доп. устройств - {amount}.', en: 'Without extra devices - {amount}.' },
  'rem.renew_continue': { ru: 'Продлите подписку, чтобы продолжить.', en: 'Renew the subscription to continue.' },
  'rem.expires_var': { ru: '{date} в {time} МСК', en: '{date} at {time} MSK' },
  'rem.when_var': { ru: '{time} МСК', en: '{time} MSK' },

  'price.body': { ru: 'Подписка OMP - {price} за {days}, {phones}: поиск в Jackett и JacRed.\nПодписка нужна только на телефоне - на ТВ она не нужна.{extra}{grace}{trial}', en: 'OMP subscription - {price} for {days}, {phones}: search in Jackett and JacRed.\nThe subscription is only needed on the phone - the TV does not need it.{extra}{grace}{trial}' },
  'price.extra': { ru: '\nДоп. устройство - {price} в месяц, продлевается вместе с подпиской.', en: '\nExtra device - {price} per month, renewed together with the subscription.' },
  'price.grace': { ru: '\nПосле окончания ещё {days} поиск работает - можно спокойно продлить.', en: '\nAfter it ends, search works for {days} more - you can renew at your own pace.' },

  'new.head': { ru: 'Подписка OMP - {price} за {days}, {phones}. На ТВ подписка не нужна.', en: 'OMP subscription - {price} for {days}, {phones}. The TV does not need a subscription.' },
  'new.discount': { ru: 'Скидка по приглашению: {off}.', en: 'Referral discount: {off}.' },
  'new.code_hint': { ru: '\nПосле оплаты в этот чат придёт код - введите его в OMP на телефоне.', en: '\nAfter payment a code will arrive in this chat - enter it in OMP on your phone.' },
  'new.sub_only_active': { ru: '\nТолько подписка: доп. устройство перестанет работать после окончания текущего периода (привязка сохранится).', en: '\nSubscription only: the extra device will stop working after the current period ends (the link is kept).' },
  'new.sub_only_ended': { ru: '\nТолько подписка: доп. устройство останется отключённым (привязка сохранится).', en: '\nSubscription only: the extra device will stay disabled (the link is kept).' },
  'new.sub_only_until': { ru: '\nТолько подписка: доп. устройство перестанет работать после {when} (привязка сохранится).', en: '\nSubscription only: the extra device will stop working after {when} (the link is kept).' },

  'extra.head': { ru: 'Ещё одно устройство.', en: 'One more device.' },
  'extra.lapsing': { ru: 'Ещё одно устройство - {base}: {extra} за новое и {extra} × {n} за доп. устройство, не продлённое вместе с подпиской. Все доп. устройства будут работать до {when}, дальше продлеваются вместе с подпиской: продление станет {next}.', en: 'One more device - {base}: {extra} for the new one and {extra} × {n} for the extra device not renewed together with the subscription. All extra devices will work until {when}, then they are renewed together with the subscription: the renewal will become {next}.' },
  'extra.simple': { ru: 'Ещё одно устройство - {extra} до {when} (конец оплаченного периода), дальше продлевается вместе с подпиской: продление станет {next}.', en: 'One more device - {extra} until {when} (the end of the paid period), then it is renewed together with the subscription: the renewal will become {next}.' },
  'extra.grace_open': { ru: 'Сейчас льготный период - отдельно устройство не купить. Продлите подписку вместе с ним одной оплатой:\n', en: 'It is the grace period now - a device cannot be bought on its own. Renew the subscription together with it in one payment:\n' },

  'promo.ok_head': { ru: 'Промокод принят: {bonus}.', en: 'Promo code accepted: {bonus}.' },
  'promo.bonus_days': { ru: '+{days}, подписка до {when}', en: '+{days}, subscription until {when}' },
  'promo.bonus_slots': { ru: '+{n} {device} бесплатно {until}', en: '+{n} {device} free {until}' },
  'promo.bonus_until': { ru: 'до {when}', en: 'until {when}' },
  'promo.bonus_forever': { ru: 'навсегда', en: 'forever' },
  'promo.devices_keep': { ru: '\nПривязанные устройства продолжают работать.', en: '\nLinked devices keep working.' },
  'promo.devices_keep_var': { ru: '\nПривязанные устройства продолжают работать', en: '\nLinked devices keep working' },

  'sup.relay': { ru: 'Поддержка OMP:\n{text}', en: 'OMP support:\n{text}' },
  'sup.note': { ru: 'Поддержка · {who}\n{text}\n\nОтветьте на это сообщение - текст уйдёт пользователю.', en: 'Support · {who}\n{text}\n\nReply to this message - the text will go to the user.' },

  'cab.home': { ru: 'Личный кабинет\n\n{status}{hint}', en: 'Account\n\n{status}{hint}' },
  'cab.unknown': { ru: 'Не понял. Выберите кнопку ниже или «Поддержка».\n\n{status}', en: 'I did not understand. Choose a button below or "Support".\n\n{status}' },
  'cab.admin_hint': { ru: '\n\nВы админ. /admin - админ-кабинет.', en: '\n\nYou are an admin. /admin - the admin cabinet.' },
  'cab.user_mode_prefix': { ru: 'Режим пользователя - те же кнопки, что у подписчика. /admin - снова админ-кабинет.\n\n', en: 'User mode - the same buttons as a subscriber. /admin - the admin cabinet again.\n\n' },
  'cab.user_mode': { ru: '{prefix}Личный кабинет\n\n{status}', en: '{prefix}Account\n\n{status}' },

  'adm.home': { ru: 'Админ-кабинет. Сводка, поиск, выдача дней и промокоды.\n«Как пользователь» - проверить кабинет подписчика.', en: 'Admin cabinet. Summary, search, granting days and promo codes.\n"As user" - check the subscriber cabinet.' },
  'adm.summary': { ru: 'Сводка:\n{summary}', en: 'Summary:\n{summary}' },
  'adm.summary_body': { ru: 'Аккаунтов: {accounts}\nАктивных подписок: {active}\nПромокодов: {promos}\nПривязанных устройств: {bound}\nОтказов за сутки: {fails}', en: 'Accounts: {accounts}\nActive subscriptions: {active}\nPromo codes: {promos}\nLinked devices: {bound}\nFailures per day: {fails}' },
  'adm.find_ask': { ru: 'Пришлите Telegram id, @ник, код XXXX-XXXX или начало device id.', en: 'Send a Telegram id, @nick, code XXXX-XXXX or the start of a device id.' },
  'adm.find_miss': { ru: 'Не найдено: {arg}', en: 'Not found: {arg}' },
  'adm.find_hit': { ru: 'Аккаунт {who}\n{status}{code}', en: 'Account {who}\n{status}{code}' },
  'adm.free_code': { ru: '\nСвободный код: {code}', en: '\nFree code: {code}' },
  'adm.grant_ask': { ru: 'Пришлите Telegram id или @ник и число дней.\nПример: 123456789 30 или @nick 30', en: 'Send a Telegram id or @nick and a number of days.\nExample: 123456789 30 or @nick 30' },
  'adm.grant_bad_user': { ru: 'Не найден пользователь «{arg}». Проверьте id или @ник - пользователь должен хотя бы раз написать боту. Новый аккаунт не создан.', en: 'User "{arg}" was not found. Check the id or @nick - the user must have written to the bot at least once. No new account was created.' },
  'adm.grant_bad_days': { ru: 'Нужно целое число дней от 1 до 3650.\nПример: {arg} 30', en: 'A whole number of days from 1 to 3650 is required.\nExample: {arg} 30' },
  'adm.grant_fail': { ru: 'Не вышло выдать дни.', en: 'Could not grant the days.' },
  'adm.grant_ok': { ru: 'Выдано +{days} - {who}, подписка до {when}.\n{text}', en: 'Granted +{days} - {who}, subscription until {when}.\n{text}' },
  'adm.grant_note_code': { ru: 'Пользователю отправлены сообщение и код для свободного места.', en: 'The user was sent a message and a code for a free slot.' },
  'adm.grant_note_nocode': { ru: 'Пользователю отправлено сообщение. Свободных мест нет, новый код не выдан.', en: 'The user was sent a message. There are no free slots, no new code was issued.' },
  'adm.promo_ask': { ru: 'Формат: КОД дни лимит\nПример: DEMO1 1 50', en: 'Format: CODE days limit\nExample: DEMO1 1 50' },
  'adm.promo_exists': { ru: 'Такой промокод уже есть.', en: 'Such a promo code already exists.' },
  'adm.promo_bad': { ru: 'Некорректный промокод.', en: 'Invalid promo code.' },
  'adm.promo_ok': { ru: 'Промокод {code} ({info}, до {uses} исп.).', en: 'Promo code {code} ({info}, up to {uses} uses).' },
  'adm.reply_sent': { ru: 'Ответ отправлен пользователю {who}.', en: 'The reply was sent to user {who}.' },
  'adm.no_access': { ru: 'Нет доступа. Добавьте свой Telegram id в настройках панели.', en: 'No access. Add your Telegram id in the panel settings.' },
  'adm.readonly': { ru: 'Режим только просмотра. Выдача дней и промокоды недоступны.', en: 'Read-only mode. Granting days and promo codes are not available.' },

  'lnk.stale': { ru: 'Ссылка устарела или уже использована. В OMP нажмите «Привязать Telegram» ещё раз.', en: 'The link is out of date or already used. In OMP press "Link Telegram" again.' },
  'lnk.ask': { ru: 'Привязать к этому Telegram устройство {device}…?\nКод и доступ к поиску появятся только после подтверждения.', en: 'Link device {device}… to this Telegram?\nThe code and search access will appear only after confirmation.' },
  'lnk.ok': { ru: 'Телефон привязан к этому Telegram.\n{status}', en: 'The phone is linked to this Telegram.\n{status}' },
  'lnk.denied': { ru: 'Нет доступа к панели. Добавьте свой Telegram id в настройках администраторов.', en: 'No access to the panel. Add your Telegram id in the administrator settings.' },
  'lnk.login_stale': { ru: 'Ссылка для входа устарела. Откройте панель снова и нажмите «Войти через Telegram».', en: 'The login link is out of date. Open the panel again and press "Log in with Telegram".' },
  'lnk.login_ok': { ru: 'Вход в админ-панель подтверждён. Вернитесь в браузер - страница откроется сама.', en: 'Admin panel login confirmed. Return to the browser - the page will open on its own.' },
  'lnk.login_ok_short': { ru: 'Вход в админ-панель подтверждён. Вернитесь в браузер.', en: 'Admin panel login confirmed. Return to the browser.' },

  'don.off': { ru: 'Поддержка проекта сейчас выключена.', en: 'Supporting the project is switched off right now.' },
  'don.menu': { ru: 'Поддержать проект OMP. Выберите сумму.', en: 'Support the OMP project. Choose an amount.' },
  'don.comment': { ru: 'Комментарий к донату, по желанию. До {max} символов.', en: 'A comment for the donation, optional. Up to {max} characters.' },
  'don.name': { ru: 'Показать моё имя в списке благодарностей? Сейчас имя скрыто.', en: 'Show my name in the thanks list? The name is hidden right now.' },
  'don.methods': { ru: 'Как оплатить {amount} ₽?', en: 'How to pay {amount} ₽?' },
  'don.methods_off': { ru: 'Способы оплаты доната не включены.', en: 'Donation payment methods are not enabled.' },
  'don.pay': { ru: '{method} - {amount}. Комиссия уже в сумме.', en: '{method} - {amount}. The fee is already included.' },
  'don.stars': { ru: 'Счёт на {stars} звёзд. Комиссия сверху не добавляется.', en: 'Invoice for {stars} stars. No fee is added on top.' },
  'don.crypto': { ru: '{asset} {amount}. Ссылка на оплату:', en: '{asset} {amount}. Payment link:' },
  'don.amount': { ru: 'Напишите сумму от {min} до {max} ₽, целым числом.', en: 'Enter an amount from {min} to {max} ₽, as a whole number.' },
  'don.amount_bad': { ru: 'Нужна сумма от {min} до {max} ₽, целым числом.', en: 'The amount must be from {min} to {max} ₽, as a whole number.' },
  'don.comment_bad': { ru: 'Комментарий длиннее {max} символов.', en: 'The comment is longer than {max} characters.' },
  'don.pending': { ru: 'Донат ждёт подтверждения в ЮMoney. Он ещё не засчитан.', en: 'The donation is awaiting confirmation in YooMoney. It is not counted yet.' },
  'don.wallet': { ru: 'Кошелёк', en: 'Wallet' },
  'don.card': { ru: 'Карта', en: 'Card' },
  'don.invoice_title': { ru: 'Донат OMP', en: 'OMP donation' },
  'don.invoice_desc': { ru: 'Донат OMP, {amount} ₽', en: 'OMP donation, {amount} ₽' },
  'don.err_yoomoney_off': { ru: 'ЮMoney для доната выключена', en: 'YooMoney for donations is switched off' },
  'don.err_amount': { ru: 'Сумма не подходит', en: 'The amount does not fit' },
  'don.err_stars_off': { ru: 'Звёзды для доната выключены', en: 'Stars for donations are switched off' },
  'don.err_crypto_off': { ru: 'Крипта для доната выключена', en: 'Crypto for donations is switched off' },
  'don.err_stale': { ru: 'Кнопка устарела', en: 'The button is out of date' },
  'don.err_no_invoice': { ru: 'Счёт не найден', en: 'The invoice was not found' },
  'don.notice': { ru: 'Донат {amount} ₽, {method}, от {who}', en: 'Donation {amount} ₽, {method}, from {who}' },
  'don.no_name': { ru: 'без имени', en: 'no name' },
  'don.method_wallet': { ru: 'ЮMoney, кошелёк', en: 'YooMoney, wallet' },
  'don.method_card': { ru: 'ЮMoney, карта', en: 'YooMoney, card' },
  'don.thanks_default': { ru: 'Спасибо! Вы поддержали проект OMP.', en: 'Thank you! You supported the OMP project.' },

  'pm.blurb_sub': { ru: 'Подписка OMP, {n} дн.', en: 'OMP subscription, {n} days' },
  'pm.blurb_dev': { ru: 'Доп. устройство OMP', en: 'OMP extra device' },
  'pm.invoice_title': { ru: 'Подписка OMP', en: 'OMP subscription' },
  'pm.err_stars_off': { ru: 'Оплата звёздами выключена', en: 'Stars payment is switched off' },
  'pm.err_no_invoice': { ru: 'Счёт не найден', en: 'The invoice was not found' },
  'pm.err_other_account': { ru: 'Счёт выставлен другому аккаунту', en: 'The invoice was issued to another account' },
  'pm.err_already': { ru: 'Этот счёт уже оплачен', en: 'This invoice is already paid' },
  'pm.err_discount_used': { ru: 'Скидка по приглашению уже использована', en: 'The referral discount is already used' },
  'pm.err_currency': { ru: 'Неверная валюта', en: 'Wrong currency' },
  'pm.err_amount': { ru: 'Сумма не сходится', en: 'The amount does not match' },
  'pm.err_donate_stars_off': { ru: 'Донат звёздами выключен', en: 'Star donations are switched off' },

  'ref.referrer': { ru: 'Друг оплатил подписку. Вам начислено {parts}.', en: 'Your friend paid for a subscription. You were granted {parts}.' },
  'ref.friend': { ru: 'По приглашению вам начислено {days} дн.', en: 'You were granted {days} days for the invitation.' },
  'ref.days': { ru: '{n} дн.', en: '{n} days' },
  'ref.retention': { ru: 'удержание {n} дн.', en: 'retention {n} days' },
  'ref.credit': { ru: '{n} ₽ на баланс', en: '{n} ₽ to the balance' },
  'ref.and': { ru: ' и ', en: ' and ' },

  'srv.invoice_failed': { ru: 'Не удалось создать счёт. Попробуйте ещё раз.', en: 'Could not create the invoice. Please try again.' },

  'lim.custom': { ru: '{n} (индивидуальный лимит)', en: '{n} (custom limit)' },
  'lim.forever': { ru: 'навсегда', en: 'forever' },
  'lim.until': { ru: 'до {date}', en: 'until {date}' },
};

/** Translate a plain UI string. `vars` fills {key} placeholders without HTML escaping. */
export function str(id, lang, vars) {
  const row = STRINGS[String(id || '')];
  if (!row) return '';
  const alt = lang && lang !== 'ru' && LANGS.has(lang) ? row[lang] : undefined;
  const body = alt != null ? alt : row.ru;
  return fill(body, vars, false, null);
}

export function hasString(id) {
  return Object.prototype.hasOwnProperty.call(STRINGS, String(id || ''));
}

/** Raw plain-string row with every language text, for the completeness test and tools. */
export function stringRow(id) {
  return STRINGS[String(id || '')] || null;
}

/** In-code base text of a catalog template for a recipient language, with {key} vars filled (no escaping).
 * Used where a message has a template id but is built by the code rather than a saved variant. */
export function copyText(id, lang, vars) {
  const template = templateById(id);
  if (!template) return '';
  return fill(bodyFor(template, lang), vars, false, null);
}

/** Every plain string id, for the catalog completeness test. */
export function stringIds() {
  return Object.keys(STRINGS);
}

/**
 * Attach the CIS language packs (botCopyLangs/<code>.mjs) to the existing rows. RU stays in
 * `body`/`ru`, EN in `bodyEn`/`en`; the new codes live in `bodyI18n`, in the string rows and in
 * `samples` on the shared variable rows. A missing entry keeps the RU text via the fallbacks above.
 */
for (const code of Object.keys(LANG_PACKS)) {
  const pack = LANG_PACKS[code];
  for (const row of CATALOG) {
    const text = pack.catalog[row.id];
    if (text) (row.bodyI18n || (row.bodyI18n = {}))[code] = String(text);
    for (const item of row.variables) {
      const sample = pack.samples[item.key];
      if (sample != null) (item.samples || (item.samples = {}))[code] = String(sample);
    }
  }
  for (const id of Object.keys(STRINGS)) {
    const text = pack.strings[id];
    if (text != null) STRINGS[id][code] = String(text);
  }
}
