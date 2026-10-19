import { payUrl } from './yoomoney.mjs';
import { selfUnbind, swapStatus } from './deviceAdmin.mjs';
import {
  adminFind,
  adminSummary,
  appSchemeUrl,
  adminChatIds,
  appendSupportMessage,
  confirmAdminPanelLogin,
  confirmDeviceLink,
  createPromo,
  DEVICE_BASE,
  deviceCode,
  ensureTelegramAccount,
  formatCode,
  graceDays,
  mskDate,
  mskDateTime,
  mskTime,
  rememberTelegramProfile,
  renewalPrice,
  telegramDisplay,
  grantDays,
  isAdminChat,
  mainSubscription,
  openAppUrl,
  priceText,
  quotePurchase,
  redeemPromo,
  subscriptionView,
  supportReplyTarget,
} from './logic.mjs';

function rub(n) {
  return (Number(n) || 0).toFixed(0) + ' ₽';
}

/** Reply keyboard — personal cabinet (same for users and for admins in user mode). */
export const BTN = {
  cabinet: 'Кабинет',
  pay: 'Подписка',
  renew: 'Продлить',
  code: 'Код',
  promo: 'Промокод',
  price: 'Цены',
  unlink: 'Отвязать',
  support: 'Поддержка',
  admin: 'Админ',
};

export const ADMIN_BTN = {
  summary: 'Сводка',
  find: 'Найти',
  grant: 'Выдать дни',
  promo: 'Новый промо',
  /** Leave admin pad and use the same keyboard as a regular subscriber. */
  user: 'Как пользователь',
};

/** User pad — no admin entry so admins can test the subscriber flow as-is. */
export function mainKeyboard() {
  return {
    keyboard: [
      [{ text: BTN.cabinet }, { text: BTN.pay }],
      [{ text: BTN.renew }, { text: BTN.code }],
      [{ text: BTN.promo }, { text: BTN.price }],
      [{ text: BTN.unlink }, { text: BTN.support }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

export function adminKeyboard() {
  return {
    keyboard: [
      [{ text: ADMIN_BTN.summary }, { text: ADMIN_BTN.find }],
      [{ text: ADMIN_BTN.grant }, { text: ADMIN_BTN.promo }],
      [{ text: ADMIN_BTN.user }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

/** Reason labels for a failed /start admin_ login. The token is never included. */
const ADMIN_LOGIN_FAIL_REASON = {
  unknown: 'unknown token',
  expired: 'expired',
  used: 'already used',
  wrong_user: 'wrong user',
};

export function adminLoginFailureLine(error) {
  const reason = ADMIN_LOGIN_FAIL_REASON[error] || 'unknown token';
  return 'admin login failed reason=' + reason + '\n';
}

/** Missing flag means on, so existing installs keep admin Telegram notices. */
export function adminNotifyEnabled(settings) {
  const v = settings && settings.adminNotify;
  return v !== false && v !== 'false' && v !== 0 && v !== '0';
}

export function adminBroadcast(settings, text) {
  if (!adminNotifyEnabled(settings)) return [];
  const body = String(text || '').trim();
  if (!body) return [];
  return adminChatIds(settings).map((chatId) => ({
    chatId,
    text: body,
    keyboard: adminKeyboard(),
  }));
}

export function paymentAdminNotices(settings, { ok, pending, amount, label, error, who }) {
  const sum = String(amount || '').trim();
  const mark = String(label || '').trim();
  const person = String(who || '').trim();
  const lines = [];
  if (ok) lines.push('Новая оплата' + (sum ? ': ' + sum + ' ₽' : ''));
  else if (pending) {
    lines.push('Платёж ждёт подтверждения в ЮMoney (unaccepted)' + (sum ? ': ' + sum + ' ₽' : ''));
    lines.push('Подписка не продлена. Примите перевод в кошельке.');
  } else {
    lines.push('Ошибка оплаты: ' + (error || 'неизвестно'));
    if (sum) lines.push('Сумма: ' + sum);
  }
  if (person) lines.push(person);
  if (mark) lines.push('Метка: ' + mark);
  return adminBroadcast(settings, lines.join('\n'));
}

/**
 * Notify when a configured service goes down. A repeat waits until it recovers.
 * @param prev map of service key → 'ok' | 'down' | 'skip'
 */
export function serviceDownNotices(settings, probes, prev) {
  const names = [
    ['jackett', 'Jackett'],
    ['jacred', 'JacRed'],
    ['torrserver', 'TorrServer'],
  ];
  const snapshot = { ...(prev || {}) };
  const messages = [];
  const list = probes || {};
  for (let i = 0; i < names.length; i++) {
    const key = names[i][0];
    const label = names[i][1];
    const row = list[key];
    if (!row || !row.configured) {
      snapshot[key] = 'skip';
      continue;
    }
    const down = !row.ok;
    const was = snapshot[key];
    snapshot[key] = down ? 'down' : 'ok';
    if (down && was !== 'down') {
      const why = row.error ? ' (' + row.error + ')' : '';
      messages.push(...adminBroadcast(settings, 'Сервис недоступен: ' + label + why));
    }
  }
  return { snapshot, messages };
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
  if (head === '/start' && rest.toLowerCase().indexOf('admin_') === 0) {
    return { action: 'admin_login', arg: rest.slice(6) };
  }
  if (head === '/start' && rest.toLowerCase() === 'renew') return { action: 'renew', arg: '' };
  if (head === '/start' && rest.toLowerCase().indexOf('support') === 0) {
    return { action: 'support', arg: rest.slice('support'.length).trim() };
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
  if (raw === BTN.support || raw === '/support') return { action: 'support', arg: '' };
  if (raw === BTN.admin || raw === '/admin') return { action: 'admin', arg: '' };
  if (raw === ADMIN_BTN.user || raw === '/user' || raw === 'В кабинет') return { action: 'user_mode', arg: '' };
  if (raw === ADMIN_BTN.summary || raw === '/summary') return { action: 'admin_summary', arg: '' };
  if (raw === ADMIN_BTN.find || raw === '/find') return { action: 'admin_find', arg: '' };
  if (raw === ADMIN_BTN.grant || raw === '/grant') return { action: 'admin_grant', arg: '' };
  if (raw === ADMIN_BTN.promo) return { action: 'admin_promo', arg: '' };

  const cmd = head.toLowerCase();
  if (cmd === '/promo' && rest) return { action: 'promo', arg: rest.replace(/\s+/g, '') };
  if (cmd === '/support' && rest) return { action: 'support', arg: rest };
  if (cmd === '/find' && rest) return { action: 'admin_find', arg: rest };
  if (cmd === '/grant' && rest) return { action: 'admin_grant', arg: rest };
  if (cmd === '/admin_promo' && rest) return { action: 'admin_promo', arg: rest };
  return { action: 'unknown', arg: raw };
}

/** «Устройства: 2 из 3 (2 в подписке + 1 доп. до 18.11.2026)» */
function devicesLine(sub) {
  const used = sub.devices.filter((d) => d.bound).length;
  let line = 'Устройства: ' + used + ' из ' + sub.deviceLimit;
  if (sub.extraSlots > 0) {
    line += ' (' + sub.baseLimit + ' в подписке + ' + sub.extraSlots + ' доп. до ' + mskDate(sub.extraUntil) + ')';
  }
  return line;
}

/** Subscription head line(s): paid, grace period, or ended. Times are Moscow time. */
export function subscriptionHead(sub) {
  if (sub.inGrace) {
    return (
      'Подписка закончилась ' +
      mskDateTime(sub.paidUntil) +
      '.\nЛьготный период: поиск работает до ' +
      mskDateTime(sub.accessUntil) +
      '. Продлите — «Продлить».'
    );
  }
  if (sub.active) return 'Подписка до ' + mskDateTime(sub.paidUntil);
  return 'Подписка закончилась ' + mskDate(sub.paidUntil);
}

function statusText(sub, account) {
  const tg = account && account.telegramId ? 'Telegram: ' + (telegramDisplay(account) || account.telegramId) + '\n' : '';
  if (!sub) return tg + 'Подписки нет.\n«Подписка» — оплата, «Промокод» — пробный день.';
  const devices = sub.devices
    .filter((d) => d.bound)
    .map((d) => (d.deviceId || '').slice(0, 8) + '…' + (d.overLimit ? ' (не работает: доп. устройство не продлено)' : ''))
    .join(', ');
  return (
    tg +
    subscriptionHead(sub) +
    '\n' +
    devicesLine(sub) +
    (devices ? '\nПривязаны: ' + devices : '') +
    '\n«Код» — показать код или ссылку в OMP.'
  );
}

/**
 * Renewal breakdown for the bot: base + extra slots that still count.
 * «Продление на 30 дн., до 18.11.2026:\n• подписка — 150 ₽\n• доп. устройство × 1 — 50 ₽\nИтого: 200 ₽»
 */
export function renewalText(state, subRow, sub, now) {
  const quote = renewalPrice(state, subRow, now);
  const from = sub.active ? sub.paidUntil : now;
  const lines = ['Продление на ' + quote.days + ' дн., до ' + mskDate(from + quote.days * 86400000) + ':'];
  lines.push('• подписка — ' + rub(quote.base));
  if (quote.extras > 0) {
    lines.push('• доп. устройство × ' + quote.extras + ' — ' + rub(quote.extraSum));
    lines.push('Итого: ' + rub(quote.total));
  }
  return { text: lines.join('\n'), quote };
}

/**
 * One-time notice when access is over (the grace period ended, or the subscription with graceDays 0).
 * After the grace period extra slots have lapsed too, so the renewal is the base price; a lapsed
 * slot is listed with its monthly price and comes back through «Код» after renewal.
 */
function graceEndMessage(state, row, subRow, grace, now) {
  const lines = [
    grace > 0
      ? 'Льготный период закончился — поиск в OMP отключён.'
      : 'Подписка OMP закончилась — поиск отключён.',
  ];
  // The renewal brings back the extra slots that lapsed with the subscription (same price as before).
  const quote = subRow ? renewalPrice(state, subRow, now) : null;
  if (quote && quote.base > 0) {
    let price = 'Продлите подписку, чтобы продолжить: ' + rub(quote.total) + ' на ' + quote.days + ' дн.';
    if (quote.extras > 0) {
      price += ' (подписка ' + rub(quote.base) + ' + доп. устройство ' + rub(quote.extraRub) + ' × ' + quote.extras + ').';
      price += '\nПривязанные устройства заработают сами, код вводить не нужно. Без доп. устройств — ' + rub(quote.base) + '.';
    }
    lines.push(price);
  } else {
    lines.push('Продлите подписку, чтобы продолжить.');
  }
  lines.push('Нажмите «Продлить» — ссылка на оплату придёт в этот чат.');
  return {
    chatId: String(row.telegramId),
    text: lines.join('\n'),
    keyboard: mainKeyboard(),
    inline: { inline_keyboard: [[{ text: 'Продлить', url: botDeepLink(state.settings, 'renew') }]] },
  };
}

/**
 * Telegram reminder before / on the expiry day. `row` comes from dueReminders.
 * @returns {{ chatId, text, keyboard, inline }}
 */
export function reminderMessage(state, row, now) {
  const subRow = (state.subscriptions || []).find((s) => s.id === row.subscriptionId);
  const grace = graceDays(state.settings);
  const until = row.paidUntil;
  const accessEnd = until + grace * 86400000;
  if (row.kind === 'end') return graceEndMessage(state, row, subRow, grace, now);
  let head = '';
  if (row.kind === 'd3') head = 'Подписка OMP заканчивается через 3 дня — ' + mskDate(until) + ' в ' + mskTime(until) + ' МСК.';
  else if (row.kind === 'd1') head = 'Подписка OMP заканчивается завтра — ' + mskDate(until) + ' в ' + mskTime(until) + ' МСК.';
  else if (until > now) {
    head = 'Подписка OMP заканчивается сегодня в ' + mskTime(until) + ' МСК.';
    if (grace > 0) head += '\nПосле этого ещё ' + grace + ' дн. льготного периода: поиск будет работать до ' + mskDateTime(accessEnd) + '.';
  } else {
    head = 'Подписка OMP закончилась сегодня в ' + mskTime(until) + ' МСК.';
    if (grace > 0) head += '\nЛьготный период: поиск работает до ' + mskDateTime(accessEnd) + '.';
  }
  const lines = [head];
  const quote = subRow ? renewalPrice(state, subRow, now) : null;
  if (quote && quote.base > 0) {
    if (quote.extras > 0) {
      lines.push(
        'Продление на ' + quote.days + ' дн.: ' + rub(quote.total) + ' (подписка ' + rub(quote.base) + ' + доп. устройство ' + rub(quote.extraRub) + ' × ' + quote.extras + ').',
      );
    } else {
      lines.push('Продление на ' + quote.days + ' дн.: ' + rub(quote.base) + '.');
    }
  }
  lines.push('Нажмите «Продлить» — ссылка на оплату придёт в этот чат.');
  return {
    chatId: String(row.telegramId),
    text: lines.join('\n'),
    keyboard: mainKeyboard(),
    inline: { inline_keyboard: [[{ text: 'Продлить', url: botDeepLink(state.settings, 'renew') }]] },
  };
}

/** Shown instead of a code when every device slot of the subscription is taken. */
export const DEVICE_LIMIT_TEXT =
  'Все устройства подписки уже привязаны, новый код не выдан. Уже привязанные устройства продолжают работать. Чтобы подключить другое, отвяжите одно в «Отвязать» или купите доп. устройство.';

/** «Смен устройства осталось: 1 из 2 за 30 дней.» */
export function swapLeftLine(status) {
  return 'Смен устройства осталось: ' + status.left + ' из ' + status.limit + ' за 30 дней.';
}

/** Refusal when the self-service changes of the last 30 days are used up. */
export function swapLimitText(status) {
  const when = Number.isFinite(status.nextAt) && status.nextAt > 0 ? mskDateTime(status.nextAt) : '';
  return (
    'Сменить устройство сейчас нельзя: самостоятельно — не больше ' +
    status.limit +
    ' раз за 30 дней.' +
    (when ? '\nСледующая смена — с ' + when + '.' : '') +
    '\nУже привязанные устройства работают. Если нужно срочно — напишите в «Поддержку».'
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
 * @param awaiting — { kind: 'promo'|'admin_find'|'admin_grant'|'admin_promo'|'unlink_device'|'support' } | null
 * @param pad — 'user' | 'admin' | null — keyboard mode for this chat (admins only; users always 'user')
 * @param replyTo — Telegram message id this update replies to
 * @returns {{ state, messages: { chatId, text, keyboard?, inline?, await?, parseMode?, supportNotify? }[], pad: 'user'|'admin' }}
 */
export function botReply(state, { chatId, text, now, awaiting, replyTo, from, pad }) {
  const ensured = from
    ? rememberTelegramProfile(
        state,
        {
          telegramId: chatId,
          username: from.username || '',
          name: [from.firstName, from.lastName].filter(Boolean).join(' '),
        },
        now,
      )
    : ensureTelegramAccount(state, chatId, now);
  let cur = ensured.state;
  const account = ensured.account;
  const admin = isAdminChat(cur.settings, chatId);
  const prices = priceText(cur.settings);
  const sub = subscriptionView(cur, account.id, now);
  const wallet = cur.settings.yoomoneyWallet;
  const origin = cur.settings.publicOrigin || '';
  const messages = [];
  let { action, arg } = parseAction(text);

  /** Admins default to user pad so they can exercise the subscriber flow; /admin switches. */
  let mode = admin && pad === 'admin' ? 'admin' : 'user';
  if (admin && (action === 'admin' || String(action).indexOf('admin_') === 0)) mode = 'admin';
  if (action === 'user_mode') mode = 'user';

  const checkout = (opts, targets) => {
    const quoted = quotePurchase(cur, { ...opts, now });
    if (quoted.result.error) return '';
    cur = quoted.state;
    return payUrl(wallet, { sum: quoted.result.price, label: quoted.result.label, targets });
  };

  const say = (body, extra) => {
    const forceAdmin = extra && extra.adminPad === true;
    const forceUser = extra && extra.adminPad === false;
    const adminPad = forceUser ? false : forceAdmin || mode === 'admin';
    const rest = { ...(extra || {}) };
    delete rest.adminPad;
    messages.push({
      chatId: String(chatId),
      text: body,
      keyboard: admin && adminPad ? adminKeyboard() : mainKeyboard(),
      ...rest,
    });
  };

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
    } else if (awaiting.kind === 'support') {
      action = 'support';
      arg = String(text || '').trim();
    }
  }

  // An ended subscription is renewed, not bought anew: the renewal keeps its extra slots and devices.
  if (action === 'pay' && sub && !sub.active && wallet && prices.price) action = 'renew';

  if (replyTo && admin) {
    const target = supportReplyTarget(cur, chatId, replyTo);
    const body = String(text || '').trim();
    if (target && body) {
      const saved = appendSupportMessage(cur, {
        telegramId: target,
        text: body,
        direction: 'out',
        now,
        via: 'bot',
      });
      cur = saved.state;
      messages.push({
        chatId: String(target),
        text: body,
        keyboard: mainKeyboard(),
      });
      say('Ответ отправлен пользователю ' + target + '.');
      return { state: cur, messages, pad: mode };
    }
  }

  if (action === 'link') {
    const out = confirmDeviceLink(cur, { token: arg, telegramId: chatId, now });
    cur = out.state;
    if (out.result.error) say('Ссылка устарела или уже использована. В OMP нажмите «Привязать Telegram» ещё раз.');
    else say('Телефон привязан к этому Telegram.\n' + statusText(subscriptionView(cur, account.id, now), account));
    return { state: cur, messages, pad: mode };
  }

  if (action === 'admin_login') {
    const out = confirmAdminPanelLogin(cur, { token: arg, telegramId: chatId, now });
    cur = out.state;
    if (out.result.error) {
      process.stderr.write(adminLoginFailureLine(out.result.error));
      if (out.result.error === 'wrong_user') {
        say('Нет доступа к панели. Добавьте свой Telegram id в настройках администраторов.');
      } else {
        say('Ссылка для входа устарела. Откройте панель снова и нажмите «Войти через Telegram».');
      }
    } else {
      say('Вход в админ-панель подтверждён. Вернитесь в браузер — страница откроется сама.');
    }
    return { state: cur, messages, pad: mode };
  }

  if (action === 'admin' || action === 'admin_summary' || action === 'admin_find' || action === 'admin_grant' || action === 'admin_promo') {
    if (!admin) {
      say('Нет доступа. Добавьте свой Telegram id в настройках панели.');
      return { state: cur, messages, pad: 'user' };
    }
  }

  if (action === 'user_mode') {
    say(
      (admin ? 'Режим пользователя — те же кнопки, что у подписчика. /admin — снова админ-кабинет.\n\n' : '') +
        'Личный кабинет\n\n' +
        statusText(sub, account),
      { adminPad: false },
    );
  } else if (action === 'admin') {
    say(
      'Админ-кабинет. Сводка, поиск, выдача дней и промокоды.\n«Как пользователь» — проверить кабинет подписчика.',
      { adminPad: true },
    );
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
      const head = 'Выдано +' + out.result.days + ' дн. до ' + mskDate(out.result.paidUntil) + '.\n';
      if (out.result.code) {
        say(head + codeMessage(origin, out.result.code), {
          adminPad: true,
          inline: codeButtons(origin, out.result.code),
          parseMode: 'Markdown',
        });
      } else {
        say(head + 'Лимит устройств достигнут, новый код не выдан. Привязанные устройства продлены.', { adminPad: true });
      }
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
      const until = mskDate(out.result.paidUntil);
      const head = 'Промокод принят (+' + out.result.days + ' дн., до ' + until + ').\n\n';
      if (out.result.code) {
        say(head + codeMessage(origin, out.result.code), { inline: codeButtons(origin, out.result.code), parseMode: 'Markdown' });
      } else {
        say(head + DEVICE_LIMIT_TEXT);
      }
    }
  } else if (action === 'price') {
    const grace = graceDays(cur.settings);
    say(
      'OMP (Jackett и JacRed) — ' +
        rub(prices.price) +
        ' за ' +
        prices.days +
        ' дн., до ' +
        DEVICE_BASE +
        ' устройств.' +
        (prices.extra
          ? '\nДоп. устройство — ' + rub(prices.extra) + ' в месяц: действует до конца оплаченного периода и продлевается вместе с подпиской.'
          : '') +
        (grace > 0 ? '\nПосле окончания ещё ' + grace + ' дн. льготного периода: поиск работает, можно спокойно продлить.' : '') +
        '\nПромокод на день — «Промокод».',
    );
  } else if (action === 'pay') {
    if (!wallet || !prices.price) say('Оплата ещё не настроена. Можно ввести промокод.');
    else if (sub && sub.active) say(statusText(sub, account) + '\nЧтобы продлить — «Продлить».');
    else {
      say(
        'OMP (Jackett и JacRed) — ' +
          rub(prices.price) +
          ' за ' +
          prices.days +
          ' дн. До ' +
          DEVICE_BASE +
          ' устройств, один код — одно устройство.\n' +
          checkout({ kind: 'new', accountId: account.id }, 'OMP Jackett и JacRed'),
      );
    }
  } else if (action === 'renew') {
    if (!sub) say('Подписки ещё нет. Нажмите «Подписка».');
    else if (!wallet || !prices.price) say('Оплата ещё не настроена.');
    else {
      const subRow = cur.subscriptions.find((s) => s.id === sub.id);
      const renewal = renewalText(cur, subRow, sub, now);
      const head = sub.inGrace ? subscriptionHead(sub) + '\n\n' : '';
      say(head + renewal.text + '\n' + checkout({ kind: 'sub', accountId: account.id, subscriptionId: sub.id }, 'OMP, продление'));
      if (renewal.quote.extras > 0) {
        say(
          'Без доп. устройств — ' +
            rub(renewal.quote.base) +
            (sub.active
              ? '. Доп. устройство тогда перестанет работать после ' +
                mskDateTime((Number(subRow.extraUntil) || 0) + graceDays(cur.settings) * 86400000) +
                ' (привязка сохранится):\n'
              : '. Доп. устройство тогда останется отключённым (привязка сохранится):\n') +
            checkout({ kind: 'sub', accountId: account.id, subscriptionId: sub.id, withExtras: false }, 'OMP, продление'),
        );
      }
    }
  } else if (action === 'code') {
    if (!sub || !sub.active) say('Сначала нужна действующая подписка. «Подписка» или «Промокод».');
    else {
      // A showable free code first; otherwise a new one while a device slot is free.
      const slot = deviceCode(cur, sub.id, now);
      cur = slot.state;
      if (slot.code) {
        say(codeMessage(origin, slot.code), { inline: codeButtons(origin, slot.code), parseMode: 'Markdown' });
      } else {
        const swap = swapStatus(mainSubscription(cur, account.id), now, 1);
        const later =
          swap.left > 0 ? '\n' + swapLeftLine(swap) : '\nСмены устройства на 30 дней исчерпаны: следующая — с ' + mskDateTime(swap.nextAt) + '.';
        say(devicesLine(sub) + '.\n' + DEVICE_LIMIT_TEXT + later);
      }
      if (wallet && prices.extra) {
        const nextRenewal = prices.price + (sub.extraSlots + 1) * prices.extra;
        say(
          'Ещё одно устройство — ' +
            rub(prices.extra) +
            ' до ' +
            mskDate(Math.max(sub.paidUntil, sub.extraUntil || 0)) +
            ' (конец оплаченного периода). Дальше оно продлевается вместе с подпиской: продление станет ' +
            rub(nextRenewal) +
            '.\n' +
            checkout({ kind: 'dev', accountId: account.id, subscriptionId: sub.id }, 'OMP, устройство'),
        );
      }
    }
  } else if (action === 'unlink') {
    const bound = (sub && sub.devices.filter((d) => d.bound)) || [];
    const swap = swapStatus(mainSubscription(cur, account.id), now, 1);
    if (!bound.length) say('Нет привязанных устройств.');
    else if (swap.left < 1) say(swapLimitText(swap));
    else {
      say(
        'Пришлите начало device id для отвязки (или «все»):\n' +
          bound.map((d) => (d.deviceId || '').slice(0, 8) + '…').join('\n') +
          '\n\n' +
          swapLeftLine(swap) +
          ' Отвязанное устройство сразу перестаёт работать.',
        { await: { kind: 'unlink_device' } },
      );
    }
  } else if (action === 'unlink_confirm') {
    const q = String(arg || '').toLowerCase();
    const bound = (sub && sub.devices.filter((d) => d.bound)) || [];
    const all = q === 'все' || q === 'all';
    const hit = all ? null : bound.find((d) => q && (d.deviceId || '').indexOf(q) === 0);
    const ids = all ? bound.map((d) => d.deviceId) : hit ? [hit.deviceId] : [];
    if (!ids.length) say(all ? 'Нет привязанных устройств.' : 'Устройство не найдено.');
    else {
      const out = selfUnbind(cur, { accountId: account.id, deviceIds: ids, now });
      if (out.result.error === 'swap_limit') {
        if (ids.length > 1 && out.result.left > 0) {
          say(
            'Отвязать все устройства (' +
              ids.length +
              ') сейчас нельзя: ' +
              swapLeftLine(out.result).toLowerCase() +
              '\nОтвяжите по одному: «Отвязать» и начало device id.',
          );
        } else {
          say(swapLimitText(out.result));
        }
      } else if (out.result.error) say('Устройство не найдено.');
      else {
        cur = out.state;
        const head = all
          ? 'Все устройства отвязаны (' + out.result.unbound + ').'
          : 'Устройство ' + hit.deviceId.slice(0, 8) + '… отвязано.';
        const tail =
          out.result.left > 0
            ? swapLeftLine(out.result)
            : 'Это была последняя смена на 30 дней: следующая — с ' + mskDateTime(out.result.nextAt) + '.';
        say(head + ' Нажмите «Код», чтобы получить новый код и открыть его в OMP.\n' + tail);
      }
    }
  } else if (action === 'support' && !arg) {
    say('Напишите сообщение для администратора одним текстом.', { await: { kind: 'support' } });
  } else if (action === 'support' && arg) {
    const saved = appendSupportMessage(cur, {
      telegramId: String(chatId),
      text: arg,
      direction: 'in',
      now,
      via: 'bot',
    });
    cur = saved.state;
    const admins = adminChatIds(cur.settings);
    const notify = adminNotifyEnabled(cur.settings);
    say(
      admins.length
        ? notify
          ? 'Сообщение передано администратору. Ответ придёт в этот чат.'
          : 'Сообщение сохранено. Уведомления администраторам выключены.'
        : 'Сообщение сохранено. Администраторы в панели ещё не указаны.',
    );
    if (notify) {
      const note =
        'Поддержка · ' +
        (telegramDisplay(account) || chatId) +
        '\n' +
        arg +
        '\n\nОтветьте на это сообщение — текст уйдёт пользователю.';
      for (let i = 0; i < admins.length; i++) {
        messages.push({
          chatId: admins[i],
          text: note,
          keyboard: adminKeyboard(),
          supportNotify: String(chatId),
        });
      }
    }
  } else if (action === 'unknown') {
    say('Не понял. Выберите кнопку ниже или «Поддержка».\n\n' + statusText(sub, account));
  } else {
    const hint =
      admin && mode === 'user'
        ? '\n\nВы админ. /admin — админ-кабинет.'
        : '';
    say('Личный кабинет\n\n' + statusText(sub, account) + hint);
  }
  return { state: cur, messages, pad: mode };
}

export function telegramOf(state, accountId) {
  const found = state.accounts.find((a) => a.id === accountId);
  return found && found.telegramId ? found.telegramId : '';
}

export function botDeepLink(settings, startPayload) {
  const user = String((settings && settings.botUsername) || 'OMPBILLINGBOT').replace(/^@/, '');
  return 'https://t.me/' + user + '?start=' + encodeURIComponent(startPayload);
}
