import { payUrl } from './yoomoney.mjs';
import { ensureTelegramAccount, priceText, redeemPromo, subscriptionView } from './logic.mjs';

function rub(n) {
  return (Number(n) || 0).toFixed(0) + ' ₽';
}

/** Reply keyboard shown under the chat. */
export const BTN = {
  status: 'Статус',
  pay: 'Подписка',
  renew: 'Продлить',
  device: 'Устройство',
  promo: 'Промокод',
  price: 'Цены',
};

export function mainKeyboard() {
  return {
    keyboard: [
      [{ text: BTN.status }, { text: BTN.pay }],
      [{ text: BTN.renew }, { text: BTN.device }],
      [{ text: BTN.promo }, { text: BTN.price }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

/** Maps a button label or /command to an internal action. */
export function parseAction(text) {
  const raw = String(text || '').trim();
  if (!raw) return { action: 'status', arg: '' };
  if (raw === BTN.status || raw === '/status' || raw === '/start' || raw === '/menu') return { action: 'status', arg: '' };
  if (raw === BTN.pay || raw === '/pay' || raw === '/buy') return { action: 'pay', arg: '' };
  if (raw === BTN.renew || raw === '/renew') return { action: 'renew', arg: '' };
  if (raw === BTN.device || raw === '/device') return { action: 'device', arg: '' };
  if (raw === BTN.promo || raw === '/promo') return { action: 'promo', arg: '' };
  if (raw === BTN.price || raw === '/price' || raw === '/prices') return { action: 'price', arg: '' };
  const parts = raw.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  if (cmd === '/promo' && parts.length > 1) return { action: 'promo', arg: parts.slice(1).join('') };
  // bare promo code while waiting, or "/promo CODE" already handled
  return { action: 'unknown', arg: raw };
}

function statusText(sub) {
  if (!sub) return 'Подписки нет.\nНажмите «Подписка», чтобы оплатить, или «Промокод».';
  const when = new Date(sub.paidUntil).toISOString().slice(0, 10);
  const used = sub.devices.filter((d) => d.bound).length;
  return (
    (sub.active ? 'Подписка до ' + when : 'Подписка закончилась ' + when) +
    '\nУстройства: ' +
    used +
    ' из ' +
    sub.deviceLimit +
    '\nКод вводится в OMP → Источники поиска → Jackett OMP.'
  );
}

/**
 * @param awaitingPromo — true when the previous message asked for a promo code
 * @returns {{ state, messages: { chatId, text, keyboard?, awaitPromo? }[] }}
 */
export function botReply(state, { chatId, text, now, awaitingPromo }) {
  const ensured = ensureTelegramAccount(state, chatId, now);
  let cur = ensured.state;
  const account = ensured.account;
  const prices = priceText(cur.settings);
  const sub = subscriptionView(cur, account.id, now);
  const wallet = cur.settings.yoomoneyWallet;
  const messages = [];
  const say = (body, extra) =>
    messages.push({
      chatId: String(chatId),
      text: body,
      keyboard: mainKeyboard(),
      ...(extra || {}),
    });

  let { action, arg } = parseAction(text);
  if (awaitingPromo && action === 'unknown') {
    action = 'promo';
    arg = String(text || '').replace(/\s+/g, '');
  }

  if (action === 'promo' && !arg) {
    say('Отправьте промокод одним сообщением.\nПример: DEMO1', { awaitPromo: true });
  } else if (action === 'promo' && arg) {
    const out = redeemPromo(cur, { code: arg, accountId: account.id, now });
    cur = out.state;
    if (out.result.error === 'bad_promo') say('Промокод не найден или уже не действует.');
    else if (out.result.error === 'already') say('Вы уже активировали этот промокод.');
    else if (out.result.error === 'exhausted') say('Этот промокод уже использовали все, кому можно.');
    else {
      const until = new Date(out.result.paidUntil).toISOString().slice(0, 10);
      say(
        'Промокод принят (+' +
          out.result.days +
          ' дн., до ' +
          until +
          ').\nКод для OMP на телефоне:\n' +
          out.result.code +
          '\nНа другом устройстве этот код не сработает.',
      );
    }
  } else if (action === 'price') {
    say(
      'Jackett OMP — ' +
        rub(prices.price) +
        ' за ' +
        prices.days +
        ' дн.\nДополнительное устройство — ' +
        rub(prices.extra) +
        '.\nПромокод на день — кнопка «Промокод».',
    );
  } else if (action === 'pay') {
    if (!wallet || !prices.price) say('Оплата ещё не настроена. Можно ввести промокод.');
    else if (sub && sub.active) {
      say(statusText(sub) + '\nЧтобы продлить — «Продлить».');
    } else {
      say(
        'Jackett OMP — ' +
          rub(prices.price) +
          ' за ' +
          prices.days +
          ' дн. Один код — одно устройство.\n' +
          payUrl(wallet, { sum: prices.price, label: 'new:' + account.id, targets: 'OMP Jackett' }),
      );
    }
  } else if (action === 'renew') {
    if (!sub) say('Подписки ещё нет. Нажмите «Подписка».');
    else if (!wallet || !prices.price) say('Оплата ещё не настроена.');
    else say('Продлить до ' + new Date(Math.max(sub.paidUntil, now) + prices.days * 86400000).toISOString().slice(0, 10) + ':\n' + payUrl(wallet, { sum: prices.price, label: 'sub:' + sub.id, targets: 'OMP Jackett, продление' }));
  } else if (action === 'device') {
    if (!sub || !sub.active) say('Сначала нужна действующая подписка. «Подписка» или «Промокод».');
    else if (!wallet || !prices.extra) say('Добавление устройства ещё не настроено.');
    else say('Новый код для ещё одного устройства:\n' + payUrl(wallet, { sum: prices.extra, label: 'dev:' + sub.id, targets: 'OMP Jackett, устройство' }));
  } else if (action === 'unknown') {
    say('Не понял. Выберите кнопку ниже.\n' + statusText(sub));
  } else {
    say(statusText(sub));
  }
  return { state: cur, messages };
}

export function telegramOf(state, accountId) {
  const found = state.accounts.find((a) => a.id === accountId);
  return found && found.telegramId ? found.telegramId : '';
}
