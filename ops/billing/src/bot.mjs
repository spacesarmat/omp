import { payUrl } from './yoomoney.mjs';
import { ensureTelegramAccount, priceText, subscriptionView } from './logic.mjs';

function rub(n) {
  return (Number(n) || 0).toFixed(0) + ' ₽';
}

export function botReply(state, { chatId, text, now }) {
  const cmd = String(text || '').trim().split(/\s+/)[0].toLowerCase();
  const ensured = ensureTelegramAccount(state, chatId, now);
  const account = ensured.account;
  const prices = priceText(ensured.state.settings);
  const sub = subscriptionView(ensured.state, account.id, now);
  const wallet = ensured.state.settings.yoomoneyWallet;
  const messages = [];
  const say = (body) => messages.push({ chatId: String(chatId), text: body });

  if (cmd === '/price' || cmd === '/prices') {
    say('Jackett OMP — ' + rub(prices.price) + ' за ' + prices.days + ' дн.\nДополнительное устройство — ' + rub(prices.extra) + '.');
  } else if (cmd === '/renew' || cmd === '/pay' || (cmd === '/start' && !sub)) {
    if (!wallet || !prices.price) say('Оплата ещё не настроена.');
    else if (cmd === '/renew' && sub) {
      say('Продлить подписку:\n' + payUrl(wallet, { sum: prices.price, label: 'sub:' + sub.id, targets: 'OMP Jackett, продление' }));
    } else {
      say(
        'Jackett OMP — ' +
          rub(prices.price) +
          ' за ' +
          prices.days +
          ' дн. Один код работает на одном устройстве.\n' +
          payUrl(wallet, { sum: prices.price, label: 'new:' + account.id, targets: 'OMP Jackett' }),
      );
    }
  } else if (cmd === '/device') {
    if (!sub || !sub.active) say('Сначала нужна действующая подписка. /pay');
    else if (!wallet || !prices.extra) say('Добавление устройства ещё не настроено.');
    else say('Новый код для ещё одного устройства:\n' + payUrl(wallet, { sum: prices.extra, label: 'dev:' + sub.id, targets: 'OMP Jackett, устройство' }));
  } else {
    if (!sub) say('Подписки нет. Цена: /price. Оплатить: /pay');
    else {
      const when = new Date(sub.paidUntil).toISOString().slice(0, 10);
      const used = sub.devices.filter((d) => d.bound).length;
      say(
        (sub.active ? 'Подписка до ' + when : 'Подписка закончилась ' + when) +
          '\nУстройства: ' +
          used +
          ' из ' +
          sub.deviceLimit +
          '\nПродлить: /renew\nДобавить устройство: /device',
      );
    }
  }
  return { state: ensured.state, messages };
}

export function telegramOf(state, accountId) {
  const found = state.accounts.find((a) => a.id === accountId);
  return found && found.telegramId ? found.telegramId : '';
}
