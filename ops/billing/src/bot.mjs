import { payUrl } from './yoomoney.mjs';
import {
  adminFind,
  adminSummary,
  appSchemeUrl,
  confirmDeviceLink,
  createPromo,
  ensureTelegramAccount,
  formatCode,
  grantDays,
  isAdminChat,
  openAppUrl,
  priceText,
  redeemPromo,
  revealableCode,
  subscriptionView,
  unbindDevice,
} from './logic.mjs';

function rub(n) {
  return (Number(n) || 0).toFixed(0) + ' ₽';
}

/** Reply keyboard — personal cabinet. */
export const BTN = {
  cabinet: 'Кабинет',
  pay: 'Подписка',
  renew: 'Продлить',
  code: 'Код',
  promo: 'Промокод',
  price: 'Цены',
  unlink: 'Отвязать',
  admin: 'Админ',
};

export const ADMIN_BTN = {
  summary: 'Сводка',
  find: 'Найти',
  grant: 'Выдать дни',
  promo: 'Новый промо',
  back: 'В кабинет',
};

export function mainKeyboard(isAdmin) {
  const rows = [
    [{ text: BTN.cabinet }, { text: BTN.pay }],
    [{ text: BTN.renew }, { text: BTN.code }],
    [{ text: BTN.promo }, { text: BTN.price }],
    [{ text: BTN.unlink }],
  ];
  if (isAdmin) rows.push([{ text: BTN.admin }]);
  return { keyboard: rows, resize_keyboard: true, is_persistent: true };
}

export function adminKeyboard() {
  return {
    keyboard: [
      [{ text: ADMIN_BTN.summary }, { text: ADMIN_BTN.find }],
      [{ text: ADMIN_BTN.grant }, { text: ADMIN_BTN.promo }],
      [{ text: ADMIN_BTN.back }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

function codeButtons(origin, code) {
  const url = openAppUrl(origin, code);
  // Telegram inline url buttons require http(s).
  if (url.indexOf('http') !== 0) return null;
  return { inline_keyboard: [[{ text: 'Открыть в OMP', url }]] };
}

/** Maps a button label or /command to an internal action. */
export function parseAction(text) {
  const raw = String(text || '').trim();
  if (!raw) return { action: 'cabinet', arg: '' };
  const parts = raw.split(/\s+/);
  const head = parts[0];
  const rest = parts.slice(1).join(' ').trim();

  if (head === '/start' && rest.toLowerCase().indexOf('link_') === 0) {
    return { action: 'link', arg: rest.slice(5) };
  }
  if (raw === BTN.cabinet || raw === '/status' || raw === '/start' || raw === '/menu' || raw === '/cabinet') {
    return { action: 'cabinet', arg: '' };
  }
  if (raw === BTN.pay || raw === '/pay' || raw === '/buy') return { action: 'pay', arg: '' };
  if (raw === BTN.renew || raw === '/renew') return { action: 'renew', arg: '' };
  if (raw === BTN.code || raw === '/code' || raw === '/device') return { action: 'code', arg: '' };
  if (raw === BTN.promo || raw === '/promo') return { action: 'promo', arg: '' };
  if (raw === BTN.price || raw === '/price' || raw === '/prices') return { action: 'price', arg: '' };
  if (raw === BTN.unlink || raw === '/unlink') return { action: 'unlink', arg: '' };
  if (raw === BTN.admin || raw === '/admin') return { action: 'admin', arg: '' };
  if (raw === ADMIN_BTN.summary || raw === '/summary') return { action: 'admin_summary', arg: '' };
  if (raw === ADMIN_BTN.find || raw === '/find') return { action: 'admin_find', arg: '' };
  if (raw === ADMIN_BTN.grant || raw === '/grant') return { action: 'admin_grant', arg: '' };
  if (raw === ADMIN_BTN.promo) return { action: 'admin_promo', arg: '' };
  if (raw === ADMIN_BTN.back) return { action: 'cabinet', arg: '' };

  const cmd = head.toLowerCase();
  if (cmd === '/promo' && rest) return { action: 'promo', arg: rest.replace(/\s+/g, '') };
  if (cmd === '/find' && rest) return { action: 'admin_find', arg: rest };
  if (cmd === '/grant' && rest) return { action: 'admin_grant', arg: rest };
  if (cmd === '/admin_promo' && rest) return { action: 'admin_promo', arg: rest };
  return { action: 'unknown', arg: raw };
}

function statusText(sub, account) {
  const tg = account && account.telegramId ? 'Telegram: ' + account.telegramId + '\n' : '';
  if (!sub) return tg + 'Подписки нет.\n«Подписка» — оплата, «Промокод» — пробный день.';
  const when = new Date(sub.paidUntil).toISOString().slice(0, 10);
  const used = sub.devices.filter((d) => d.bound).length;
  const devices = sub.devices
    .filter((d) => d.bound)
    .map((d) => (d.deviceId || '').slice(0, 8) + '…')
    .join(', ');
  return (
    tg +
    (sub.active ? 'Подписка до ' + when : 'Подписка закончилась ' + when) +
    '\nУстройства: ' +
    used +
    ' из ' +
    sub.deviceLimit +
    (devices ? '\nПривязаны: ' + devices : '') +
    '\n«Код» — показать код или ссылку в OMP.'
  );
}

function codeMessage(origin, code) {
  const dashed = formatCode(code);
  return (
    'Код подписки (долгое нажатие — копировать):\n`' +
    dashed +
    '`\n\nИли откройте в приложении:\n' +
    openAppUrl(origin, dashed) +
    '\n\nСхема: ' +
    appSchemeUrl(dashed)
  );
}

/**
 * @param awaiting — { kind: 'promo'|'admin_find'|'admin_grant'|'admin_promo'|'unlink_device' } | null
 * @returns {{ state, messages: { chatId, text, keyboard?, inline?, await?, parseMode? }[] }}
 */
export function botReply(state, { chatId, text, now, awaiting }) {
  const ensured = ensureTelegramAccount(state, chatId, now);
  let cur = ensured.state;
  const account = ensured.account;
  const admin = isAdminChat(cur.settings, chatId);
  const prices = priceText(cur.settings);
  const sub = subscriptionView(cur, account.id, now);
  const wallet = cur.settings.yoomoneyWallet;
  const origin = cur.settings.publicOrigin || '';
  const messages = [];
  const say = (body, extra) =>
    messages.push({
      chatId: String(chatId),
      text: body,
      keyboard: extra && extra.adminPad ? adminKeyboard() : mainKeyboard(admin),
      ...(extra || {}),
    });

  let { action, arg } = parseAction(text);

  if (awaiting && awaiting.kind && action === 'unknown') {
    if (awaiting.kind === 'promo') {
      action = 'promo';
      arg = String(text || '').replace(/\s+/g, '');
    } else if (awaiting.kind === 'admin_find') {
      action = 'admin_find';
      arg = String(text || '').trim();
    } else if (awaiting.kind === 'admin_grant') {
      action = 'admin_grant';
      arg = String(text || '').trim();
    } else if (awaiting.kind === 'admin_promo') {
      action = 'admin_promo';
      arg = String(text || '').trim();
    } else if (awaiting.kind === 'unlink_device') {
      action = 'unlink_confirm';
      arg = String(text || '').trim();
    }
  }

  if (action === 'link') {
    const out = confirmDeviceLink(cur, { token: arg, telegramId: chatId, now });
    cur = out.state;
    if (out.result.error) say('Ссылка устарела или уже использована. В OMP нажмите «Привязать Telegram» ещё раз.');
    else say('Телефон привязан к этому Telegram.\n' + statusText(subscriptionView(cur, account.id, now), account));
    return { state: cur, messages };
  }

  if (action === 'admin' || action === 'admin_summary' || action === 'admin_find' || action === 'admin_grant' || action === 'admin_promo') {
    if (!admin) {
      say('Нет доступа. Добавьте свой Telegram id в настройках панели (adminTelegramIds).');
      return { state: cur, messages };
    }
  }

  if (action === 'admin') {
    say('Админ-кабинет. Сводка, поиск, выдача дней и промокоды.', { adminPad: true });
  } else if (action === 'admin_summary') {
    const s = adminSummary(cur, now);
    say(
      'Сводка:\nАккаунтов: ' +
        s.accounts +
        '\nАктивных подписок: ' +
        s.active +
        '\nПромокодов: ' +
        s.promos +
        '\nПривязанных устройств: ' +
        s.bound +
        '\nОтказов за сутки: ' +
        s.fails,
      { adminPad: true },
    );
  } else if (action === 'admin_find' && !arg) {
    say('Пришлите Telegram id, код XXXX-XXXX или начало device id.', { adminPad: true, await: { kind: 'admin_find' } });
  } else if (action === 'admin_find' && arg) {
    const found = adminFind(cur, arg, now);
    if (!found) say('Не найдено: ' + arg, { adminPad: true });
    else {
      const who = found.account.telegramId || found.account.id;
      let body = 'Аккаунт ' + who + '\n' + statusText(found.sub, found.account);
      if (found.reveal) body += '\nСвободный код: ' + formatCode(found.reveal.code);
      say(body, { adminPad: true });
    }
  } else if (action === 'admin_grant' && !arg) {
    say('Формат: telegramId дни\nПример: 123456789 30', { adminPad: true, await: { kind: 'admin_grant' } });
  } else if (action === 'admin_grant' && arg) {
    const bits = arg.split(/\s+/);
    const tg = bits[0];
    const days = Number(bits[1]) || 0;
    const out = grantDays(cur, { telegramId: tg, days, now });
    cur = out.state;
    if (out.result.error) say('Не вышло. Нужны telegramId и число дней.', { adminPad: true });
    else {
      say(
        'Выдано +' +
          out.result.days +
          ' дн. до ' +
          new Date(out.result.paidUntil).toISOString().slice(0, 10) +
          '.\n' +
          codeMessage(origin, out.result.code),
        { adminPad: true, inline: codeButtons(origin, out.result.code), parseMode: 'Markdown' },
      );
    }
  } else if (action === 'admin_promo' && !arg) {
    say('Формат: КОД дни лимит\nПример: DEMO1 1 50', { adminPad: true, await: { kind: 'admin_promo' } });
  } else if (action === 'admin_promo' && arg) {
    const bits = arg.split(/\s+/);
    const out = createPromo(cur, {
      code: bits[0],
      days: Number(bits[1]) || 1,
      maxUses: Number(bits[2]) || 1,
      now,
    });
    cur = out.state;
    if (out.result.error === 'exists') say('Такой промокод уже есть.', { adminPad: true });
    else if (out.result.error) say('Некорректный промокод.', { adminPad: true });
    else say('Промокод ' + out.result.promo.code + ' (+' + out.result.promo.days + ' дн., до ' + out.result.promo.maxUses + ' исп.).', { adminPad: true });
  } else if (action === 'promo' && !arg) {
    say('Отправьте промокод одним сообщением.\nПример: DEMO1', { await: { kind: 'promo' } });
  } else if (action === 'promo' && arg) {
    const out = redeemPromo(cur, { code: arg, accountId: account.id, now });
    cur = out.state;
    if (out.result.error === 'bad_promo') say('Промокод не найден или уже не действует.');
    else if (out.result.error === 'already') say('Вы уже активировали этот промокод.');
    else if (out.result.error === 'exhausted') say('Этот промокод уже использовали все, кому можно.');
    else {
      const until = new Date(out.result.paidUntil).toISOString().slice(0, 10);
      say(
        'Промокод принят (+' + out.result.days + ' дн., до ' + until + ').\n\n' + codeMessage(origin, out.result.code),
        { inline: codeButtons(origin, out.result.code), parseMode: 'Markdown' },
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
        '.\nПромокод на день — «Промокод».',
    );
  } else if (action === 'pay') {
    if (!wallet || !prices.price) say('Оплата ещё не настроена. Можно ввести промокод.');
    else if (sub && sub.active) say(statusText(sub, account) + '\nЧтобы продлить — «Продлить».');
    else {
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
    else {
      say(
        'Продлить до ' +
          new Date(Math.max(sub.paidUntil, now) + prices.days * 86400000).toISOString().slice(0, 10) +
          ':\n' +
          payUrl(wallet, { sum: prices.price, label: 'sub:' + sub.id, targets: 'OMP Jackett, продление' }),
      );
    }
  } else if (action === 'code') {
    if (!sub || !sub.active) say('Сначала нужна действующая подписка. «Подписка» или «Промокод».');
    else {
      const reveal = revealableCode(cur, account.id);
      if (reveal) {
        say(codeMessage(origin, reveal.code), { inline: codeButtons(origin, reveal.code), parseMode: 'Markdown' });
      } else if (sub.devices.some((d) => d.bound)) {
        say('Код уже привязан к устройству ' + (sub.devices.find((d) => d.bound).deviceId || '').slice(0, 8) + '…\nНовый слот — оплата доп. устройства через панель или продление с новым кодом после отвязки.');
      } else {
        say('Свободного кода нет. Напишите в поддержку или админу.');
      }
      if (wallet && prices.extra) {
        say(
          'Ещё одно устройство:\n' +
            payUrl(wallet, { sum: prices.extra, label: 'dev:' + sub.id, targets: 'OMP Jackett, устройство' }),
        );
      }
    }
  } else if (action === 'unlink') {
    const bound = (sub && sub.devices.filter((d) => d.bound)) || [];
    if (!bound.length) say('Нет привязанных устройств.');
    else {
      say(
        'Пришлите начало device id для отвязки (или «все»):\n' +
          bound.map((d) => (d.deviceId || '').slice(0, 8) + '…').join('\n'),
        { await: { kind: 'unlink_device' } },
      );
    }
  } else if (action === 'unlink_confirm') {
    const q = String(arg || '').toLowerCase();
    const bound = (sub && sub.devices.filter((d) => d.bound)) || [];
    if (q === 'все' || q === 'all') {
      let next = cur;
      for (let i = 0; i < bound.length; i++) next = unbindDevice(next, { accountId: account.id, deviceId: bound[i].deviceId });
      cur = next;
      say('Все устройства отвязаны. Код можно ввести заново после выдачи нового (обратитесь к админу) или оплатите слот.');
    } else {
      const hit = bound.find((d) => (d.deviceId || '').indexOf(q) === 0);
      if (!hit) say('Устройство не найдено.');
      else {
        cur = unbindDevice(cur, { accountId: account.id, deviceId: hit.deviceId });
        say('Устройство ' + hit.deviceId.slice(0, 8) + '… отвязано. Нажмите «Код», чтобы получить новый и открыть в OMP.');
      }
    }
  } else if (action === 'unknown') {
    say('Не понял. Выберите кнопку ниже.\n\n' + statusText(sub, account));
  } else {
    say('Личный кабинет\n\n' + statusText(sub, account));
  }
  return { state: cur, messages };
}

export function telegramOf(state, accountId) {
  const found = state.accounts.find((a) => a.id === accountId);
  return found && found.telegramId ? found.telegramId : '';
}

export function botDeepLink(settings, startPayload) {
  const user = String((settings && settings.botUsername) || 'OMPBILLINGBOT').replace(/^@/, '');
  return 'https://t.me/' + user + '?start=' + encodeURIComponent(startPayload);
}
