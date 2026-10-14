import { adminDashboard } from './logic.mjs';

export function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const CSS = `
  body { margin: 0; background: #0F1115; color: #E8EAF0; font: 16px/1.45 Manrope, Segoe UI, sans-serif; }
  main { max-width: 960px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  h2 { font-size: 15px; margin: 0 0 10px; color: #9AA1B2; font-weight: 600; letter-spacing: 0.02em; }
  .lead { color: #9AA1B2; margin: 0 0 20px; }
  nav { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 24px; }
  nav a { color: #0F1115; background: #F5B700; text-decoration: none; padding: 8px 12px; border-radius: 8px; font-weight: 700; font-size: 13px; }
  section { margin: 0 0 28px; scroll-margin-top: 16px; }
  form, .card { background: #181B22; border-radius: 12px; padding: 16px; margin: 0 0 12px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin: 0 0 20px; }
  .stat { background: #181B22; border-radius: 12px; padding: 14px 16px; }
  .stat b { display: block; font-size: 22px; margin: 0 0 4px; }
  .stat span { color: #9AA1B2; font-size: 13px; }
  label { display: block; color: #9AA1B2; font-size: 13px; margin: 10px 0 4px; }
  input, select { width: 100%; box-sizing: border-box; background: #252A35; color: #E8EAF0; border: 0; border-radius: 8px; padding: 10px 12px; }
  .fields { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
  @media (max-width: 640px) { .fields { grid-template-columns: 1fr; } }
  button { background: #F5B700; color: #0F1115; border: 0; border-radius: 8px; padding: 10px 14px; font-weight: 700; margin-top: 12px; cursor: pointer; }
  button.ghost { background: #252A35; color: #E8EAF0; }
  button.inline { margin: 0 6px 0 0; padding: 8px 10px; font-size: 13px; }
  .row-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .row-actions form { background: none; padding: 0; margin: 0; display: inline; }
  .muted { color: #9AA1B2; }
  .ok { color: #3FB950; }
  .bad { color: #E5484D; }
  .flash { background: #252A35; border-left: 4px solid #F5B700; }
  .code { font: 20px/1.2 ui-monospace, Consolas, monospace; letter-spacing: 0.08em; }
  .search { display: flex; gap: 8px; align-items: end; }
  .search label { flex: 1; margin: 0; }
  .search input { margin: 0; }
  .search button { margin: 0; white-space: nowrap; }
  a.link { color: #F5B700; }
  .alert { padding: 10px 12px; border-radius: 8px; margin: 0 0 8px; font-size: 14px; }
  .alert.bad { background: #3a1518; border-left: 4px solid #E5484D; }
  .alert.warn { background: #2a2410; border-left: 4px solid #F5B700; }
  .pill { display: inline-block; font-size: 11px; padding: 2px 6px; border-radius: 4px; background: #252A35; color: #9AA1B2; margin-right: 6px; text-transform: uppercase; }
  .pill.pay { color: #3FB950; }
  .pill.promo { color: #F5B700; }
  .pill.activate { color: #79b8ff; }
  .pill.fail { color: #E5484D; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; color: #9AA1B2; font-weight: 600; font-size: 13px; padding: 8px 6px; border-bottom: 1px solid #252A35; }
  td { padding: 10px 6px; border-top: 1px solid #252A35; vertical-align: top; font-size: 14px; }
  .kv { display: grid; grid-template-columns: 140px 1fr; gap: 6px 12px; margin: 0 0 12px; font-size: 14px; }
  .kv span { color: #9AA1B2; }
`;

function page(title, body) {
  return '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + esc(title) + '</title><style>' + CSS + '</style><main>' + body + '</main>';
}

export function loginPage(error) {
  const err = error ? '<p class="bad">' + esc(error) + '</p>' : '';
  return page(
    'OMP',
    '<h1>OMP — подписки</h1>' + err + '<form method="post" action="/admin/login"><label>Пароль</label><input type="password" name="password" autofocus><button>Войти</button></form>',
  );
}

function field(name, label, value, type) {
  return '<label>' + esc(label) + '</label><input name="' + esc(name) + '" type="' + (type || 'text') + '" value="' + esc(value) + '">';
}

function when(ms) {
  if (!ms) return '—';
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
}

function searchForm(csrf, q) {
  return (
    '<form class="card search" method="post" action="/admin/find">' +
    csrf +
    '<label>Найти пользователя<input name="q" value="' +
    esc(q || '') +
    '" placeholder="Telegram id, код XXXX-XXXX, device, email" autofocus></label>' +
    '<button>Найти</button></form>'
  );
}

/** Card for one account: profile, subscription, codes, history, Telegram message. */
export function userCardHtml(state, card, extra) {
  const csrf = '<input type="hidden" name="csrf" value="' + esc(extra.csrf) + '">';
  const a = card.account;
  const sub = card.sub;
  const origin = (state.settings.publicOrigin || '').replace(/\/+$/, '');
  const until = sub ? new Date(sub.paidUntil).toISOString().slice(0, 10) : '—';
  const live = sub && sub.active ? '<span class="ok">активна до ' + until + '</span>' : sub ? '<span class="bad">закончилась ' + until + '</span>' : '<span class="muted">нет подписки</span>';
  const linked = (Array.isArray(a.linkedDevices) ? a.linkedDevices : []).map((d) => d.slice(0, 8) + '…').join(', ') || '—';

  const grant =
    '<form method="post" action="/admin/grant">' +
    csrf +
    '<input type="hidden" name="accountId" value="' +
    esc(a.id) +
    '">' +
    '<div class="row-actions">' +
    '<button class="inline" name="days" value="1">+1 день</button>' +
    '<button class="inline" name="days" value="7">+7 дней</button>' +
    '<button class="inline" name="days" value="30">+30 дней</button>' +
    '<label style="margin:0;display:flex;gap:6px;align-items:center">Своё <input name="daysCustom" type="number" min="1" value="14" style="width:72px;margin:0"> <button class="inline ghost" name="days" value="custom">Выдать</button></label>' +
    '</div></form>';

  const codeRows = (card.codes || [])
    .map((c) => {
      const plain = c.plain
        ? '<span class="code" style="font-size:15px">' +
          esc(c.plain) +
          '</span>' +
          (origin
            ? ' <a class="link" href="' + esc(origin + '/go/' + encodeURIComponent(c.plain)) + '" target="_blank" rel="noopener">Открыть в OMP</a>'
            : '')
        : '<span class="muted">скрыт после привязки</span>';
      const device = c.deviceId ? esc(c.deviceId.slice(0, 8)) + '…' : '<span class="muted">свободен</span>';
      const reset =
        '<form method="post" action="/admin/unbind" style="display:inline">' +
        csrf +
        '<input type="hidden" name="codeId" value="' +
        esc(c.id) +
        '"><input type="hidden" name="accountId" value="' +
        esc(a.id) +
        '"><button type="submit" class="ghost inline">Сбросить</button></form>';
      return '<tr><td>' + plain + '</td><td>' + device + '</td><td class="muted">' + esc(when(c.boundAt || c.createdAt)) + '</td><td>' + reset + '</td></tr>';
    })
    .join('');

  const payRows = (card.payments || [])
    .map(
      (p) =>
        '<tr><td>' +
        esc(p.amount || '') +
        '</td><td>' +
        esc(p.label || '') +
        '</td><td class="muted">' +
        esc(when(p.at)) +
        '</td><td class="muted">' +
        esc((p.operationId || '').slice(0, 12)) +
        '</td></tr>',
    )
    .join('');

  const promoRows = (card.promos || [])
    .map(
      (p) =>
        '<tr><td>' +
        esc(p.code) +
        '</td><td>+' +
        p.days +
        ' дн.</td><td class="muted">' +
        esc(when(p.at)) +
        '</td><td>' +
        esc(p.activation || '') +
        '</td></tr>',
    )
    .join('');

  const failRows = (card.attempts || [])
    .map(
      (x) =>
        '<tr><td>' +
        esc(x.ok ? 'ok' : x.reason) +
        '</td><td>' +
        esc((x.deviceId || '').slice(0, 8)) +
        '</td><td class="muted">' +
        esc(when(x.at)) +
        '</td></tr>',
    )
    .join('');

  const msg =
    '<form method="post" action="/admin/message">' +
    csrf +
    '<input type="hidden" name="accountId" value="' +
    esc(a.id) +
    '">' +
    '<label>Сообщение в Telegram</label><input name="text" placeholder="Текст пользователю" ' +
    (a.telegramId ? '' : 'disabled ') +
    '>' +
    '<button' +
    (a.telegramId ? '' : ' disabled') +
    '>Отправить</button>' +
    (a.telegramId ? '' : '<p class="muted">Нет Telegram id — отправить нельзя</p>') +
    '</form>';

  return (
    '<section id="user"><h2>Карточка пользователя</h2>' +
    '<div class="card">' +
    '<div class="kv">' +
    '<span>Telegram</span><div>' +
    esc(a.telegramId || '—') +
    '</div>' +
    '<span>Почта</span><div>' +
    esc(a.email || '—') +
    '</div>' +
    '<span>Account id</span><div class="muted">' +
    esc(a.id) +
    '</div>' +
    '<span>Создан</span><div class="muted">' +
    esc(when(a.createdAt)) +
    '</div>' +
    '<span>Linked devices</span><div>' +
    esc(linked) +
    '</div>' +
    '<span>Подписка</span><div>' +
    live +
    (sub ? ' · устройств ' + sub.devices.filter((d) => d.bound).length + ' / ' + sub.deviceLimit : '') +
    '</div>' +
    '</div>' +
    '<h2 style="margin-top:16px">Продлить / выдать дни</h2>' +
    grant +
    '</div>' +
    '<div class="card"><h2>Коды</h2><table><tr><th>Код</th><th>Устройство</th><th>Когда</th><th></th></tr>' +
    (codeRows || '<tr><td colspan="4" class="muted">Нет кодов</td></tr>') +
    '</table>' +
    (card.reveal
      ? '<p class="flash">Свободный код: <span class="code">' +
        esc(card.reveal.code) +
        '</span>' +
        (origin ? ' · <a class="link" href="' + esc(origin + '/go/' + encodeURIComponent(card.reveal.code)) + '" target="_blank" rel="noopener">Открыть в OMP</a>' : '') +
        '</p>'
      : '') +
    '</div>' +
    '<div class="card"><h2>История платежей</h2><table><tr><th>Сумма</th><th>Label</th><th>Когда</th><th>Op</th></tr>' +
    (payRows || '<tr><td colspan="4" class="muted">Пусто</td></tr>') +
    '</table></div>' +
    '<div class="card"><h2>Промокоды</h2><table><tr><th>Промо</th><th>Срок</th><th>Когда</th><th>Код</th></tr>' +
    (promoRows || '<tr><td colspan="4" class="muted">Пусто</td></tr>') +
    '</table></div>' +
    '<div class="card"><h2>Попытки ввода</h2><table><tr><th>Результат</th><th>Устройство</th><th>Когда</th></tr>' +
    (failRows || '<tr><td colspan="3" class="muted">Пусто</td></tr>') +
    '</table></div>' +
    '<div class="card"><h2>Сообщение</h2>' +
    msg +
    '</div>' +
    '<p><a class="link" href="/admin">← На главную</a></p></section>'
  );
}

export function userPage(state, card, extra) {
  const csrf = '<input type="hidden" name="csrf" value="' + esc(extra.csrf) + '">';
  const flash =
    (extra && extra.flash ? '<p class="card flash">' + esc(extra.flash) + '</p>' : '') +
    (extra && extra.code ? '<p class="card flash">Код: <span class="code">' + esc(extra.code) + '</span></p>' : '') +
    (extra && extra.error ? '<p class="bad">' + esc(extra.error) + '</p>' : '');
  return page(
    'OMP · пользователь',
    '<h1>OMP — пользователь</h1>' +
      flash +
      searchForm(csrf, extra.q || (card.account.telegramId || '')) +
      userCardHtml(state, card, extra),
  );
}

export function homePage(state, extra) {
  const s = state.settings;
  const now = Date.now();
  const activeSubs = state.subscriptions.filter((sub) => sub.paidUntil > now).length;
  const promosLive = (state.promos || []).filter((p) => !p.revoked).length;
  const bound = state.codes.filter((c) => !c.revoked && c.deviceId).length;
  const flash =
    (extra && extra.code
      ? '<p class="card flash">Код активации: <span class="code">' + esc(extra.code) + '</span></p>'
      : '') +
    (extra && extra.promo
      ? '<p class="card flash">Промокод: <span class="code">' + esc(extra.promo) + '</span> — в боте кнопка «Промокод» или /promo ' + esc(extra.promo) + '</p>'
      : '') +
    (extra && extra.flash ? '<p class="card flash">' + esc(extra.flash) + '</p>' : '') +
    (extra && extra.error ? '<p class="bad">' + esc(extra.error) + '</p>' : '');
  const csrf = '<input type="hidden" name="csrf" value="' + esc(extra.csrf) + '">';

  const settings =
    '<form method="post" action="/admin/settings">' +
    csrf +
    '<div class="fields">' +
    '<div>' +
    field('botToken', 'Токен бота Telegram', s.botToken) +
    field('botUsername', 'Username бота без @', s.botUsername || 'OMPBILLINGBOT') +
    field('publicOrigin', 'Публичный URL сервера (http://IP:8787)', s.publicOrigin || '') +
    field('adminTelegramIds', 'Telegram id админов через запятую', s.adminTelegramIds || '') +
    field('yoomoneyWallet', 'Кошелёк ЮMoney', s.yoomoneyWallet) +
    field('yoomoneySecret', 'Секрет уведомлений ЮMoney', s.yoomoneySecret) +
    field('jackettUrl', 'Адрес Jackett', s.jackettUrl) +
    field('jackettApiKey', 'API-ключ Jackett', s.jackettApiKey) +
    '</div><div>' +
    field('smtpHost', 'SMTP-сервер', s.smtpHost) +
    field('smtpUser', 'SMTP-логин', s.smtpUser) +
    field('smtpPass', 'SMTP-пароль', s.smtpPass, 'password') +
    field('smtpFrom', 'Почта отправителя', s.smtpFrom) +
    field('priceRub', 'Цена за период, ₽', s.priceRub, 'number') +
    field('periodDays', 'Дней в периоде', s.periodDays, 'number') +
    field('extraDeviceRub', 'Цена ещё одного устройства, ₽', s.extraDeviceRub, 'number') +
    '</div></div><button>Сохранить настройки</button></form>';

  const issue =
    '<form method="post" action="/admin/issue">' +
    csrf +
    '<div class="fields"><div>' +
    field('email', 'Почта', '') +
    '</div><div>' +
    field('telegramId', 'Telegram id', '') +
    '</div></div>' +
    '<label>Куда отправить код</label><select name="channel"><option value="panel">Показать здесь</option><option value="email">На почту</option><option value="telegram">В Telegram</option></select>' +
    '<button>Выдать код активации</button></form>';

  const promoForm =
    '<form method="post" action="/admin/promo">' +
    csrf +
    '<div class="fields"><div>' +
    field('code', 'Промокод (пусто — сгенерировать)', '') +
    '</div><div>' +
    field('days', 'Дней', '1', 'number') +
    field('maxUses', 'Сколько раз можно активировать', '1', 'number') +
    '</div></div><button>Создать промокод</button></form>';

  const promoRows = (state.promos || [])
    .slice()
    .reverse()
    .map((p) => {
      const uses = (p.uses || [])
        .map((u) => {
          const acc = state.accounts.find((a) => a.id === u.accountId);
          const who = acc ? acc.telegramId || acc.email || acc.id : u.accountId;
          return esc(who) + ' · ' + esc(new Date(u.at).toISOString().slice(0, 16).replace('T', ' '));
        })
        .join('<br>') || '<span class="muted">ещё не активировали</span>';
      const status = p.revoked
        ? '<span class="bad">отозван</span>'
        : p.uses.length >= p.maxUses
          ? '<span class="muted">' + p.uses.length + ' / ' + p.maxUses + ' (закончился)</span>'
          : '<span class="ok">' + p.uses.length + ' / ' + p.maxUses + '</span>';
      const revoke = p.revoked
        ? ''
        : '<form method="post" action="/admin/promo-revoke" style="display:inline">' +
          csrf +
          '<input type="hidden" name="promoId" value="' +
          esc(p.id) +
          '"><button type="submit" class="ghost">Отозвать</button></form>';
      return (
        '<tr><td><span class="code" style="font-size:15px">' +
        esc(p.code) +
        '</span></td><td>' +
        p.days +
        ' дн.</td><td>' +
        status +
        '</td><td>' +
        uses +
        '</td><td>' +
        revoke +
        '</td></tr>'
      );
    })
    .join('');

  const rows = state.subscriptions
    .slice()
    .sort((a, b) => b.paidUntil - a.paidUntil)
    .map((sub) => {
      const account = state.accounts.find((a) => a.id === sub.accountId);
      const who = account ? account.email || account.telegramId || account.id : sub.accountId;
      const codes = state.codes.filter((c) => c.subscriptionId === sub.id && !c.revoked);
      const devices = codes
        .map((c) => {
          const bound = c.deviceId ? c.deviceId.slice(0, 8) + '…' : '<span class="muted">не вводили</span>';
          return (
            bound +
            ' <form method="post" action="/admin/unbind" style="display:inline">' +
            csrf +
            '<input type="hidden" name="codeId" value="' +
            esc(c.id) +
            '"><button class="ghost">Сбросить</button></form>'
          );
        })
        .join('<br>');
      const until = new Date(sub.paidUntil).toISOString().slice(0, 10);
      const live = sub.paidUntil > now ? '<span class="ok">' + until + '</span>' : '<span class="bad">' + until + '</span>';
      const whoLink = account
        ? '<a class="link" href="/admin/user?id=' + encodeURIComponent(account.id) + '">' + esc(who) + '</a>'
        : esc(who);
      return '<tr><td>' + whoLink + '</td><td>' + live + '</td><td>' + codes.length + ' / ' + sub.deviceLimit + '</td><td>' + devices + '</td></tr>';
    })
    .join('');

  const fails = state.attempts
    .filter((a) => !a.ok)
    .slice(-12)
    .reverse()
    .map(
      (a) =>
        '<tr><td>' +
        esc(a.reason) +
        '</td><td>' +
        esc((a.deviceId || '').slice(0, 8)) +
        '</td><td class="muted">' +
        esc(new Date(a.at).toISOString().slice(0, 16).replace('T', ' ')) +
        '</td></tr>',
    )
    .join('');

  const dash = adminDashboard(state, now);
  const alertBlock =
    dash.alerts.length === 0
      ? '<p class="muted">Алертов нет</p>'
      : dash.alerts
          .map((a) => {
            const body = a.accountId
              ? '<a class="link" href="/admin/user?id=' + encodeURIComponent(a.accountId) + '">' + esc(a.text) + '</a>'
              : esc(a.text);
            return '<div class="alert ' + (a.level === 'bad' ? 'bad' : 'warn') + '">' + body + '</div>';
          })
          .join('');

  const quickPromos =
    '<div class="card"><p class="muted" style="margin-top:0">Шаблоны — сразу создают промокод</p><div class="row-actions">' +
    '<form method="post" action="/admin/promo">' +
    csrf +
    '<input type="hidden" name="days" value="1"><input type="hidden" name="maxUses" value="10">' +
    '<button class="inline" type="submit">1 день × 10</button></form>' +
    '<form method="post" action="/admin/promo">' +
    csrf +
    '<input type="hidden" name="days" value="7"><input type="hidden" name="maxUses" value="1">' +
    '<button class="inline" type="submit">7 дней × 1</button></form>' +
    '<form method="post" action="/admin/promo">' +
    csrf +
    '<input type="hidden" name="days" value="1"><input type="hidden" name="maxUses" value="1">' +
    '<button class="inline ghost" type="submit">1 день × 1</button></form>' +
    '</div></div>';

  const feedRows = dash.events
    .map((e) => {
      const who = e.accountId
        ? '<a class="link" href="/admin/user?id=' + encodeURIComponent(e.accountId) + '">карточка</a>'
        : '<span class="muted">—</span>';
      return (
        '<tr><td class="muted">' +
        esc(when(e.at)) +
        '</td><td><span class="pill ' +
        esc(e.kind) +
        '">' +
        esc(e.kind) +
        '</span>' +
        esc(e.text) +
        '</td><td>' +
        who +
        '</td></tr>'
      );
    })
    .join('');

  return page(
    'OMP',
    '<h1>OMP — подписки</h1>' +
      '<p class="lead">Панель биллинга · бот @OMPBILLINGBOT · Jackett на NAS</p>' +
      flash +
      '<div class="grid">' +
      '<div class="stat"><b>' +
      activeSubs +
      '</b><span>активных подписок</span></div>' +
      '<div class="stat"><b>' +
      bound +
      '</b><span>привязанных устройств</span></div>' +
      '<div class="stat"><b>' +
      promosLive +
      '</b><span>живых промокодов</span></div>' +
      '<div class="stat"><b>' +
      (s.priceRub || 0) +
      ' ₽</b><span>за ' +
      (s.periodDays || 30) +
      ' дн.</span></div>' +
      '</div>' +
      '<nav><a href="#find">Найти</a><a href="#alerts">Алерты</a><a href="#feed">Лента</a><a href="#quick">Промо</a><a href="#issue">Выдать код</a><a href="#promos">Все промо</a><a href="#subs">Подписки</a><a href="#settings">Настройки</a><a href="#fails">Отказы</a></nav>' +
      '<section id="find"><h2>Найти пользователя</h2>' +
      searchForm(csrf, extra.q || '') +
      '</section>' +
      '<section id="alerts"><h2>Алерты</h2><div class="card">' +
      alertBlock +
      '</div></section>' +
      '<section id="quick"><h2>Быстрые промокоды</h2>' +
      quickPromos +
      '</section>' +
      '<section id="feed"><h2>Лента событий</h2><div class="card"><table><tr><th>Когда</th><th>Событие</th><th></th></tr>' +
      (feedRows || '<tr><td colspan="3" class="muted">Пока пусто</td></tr>') +
      '</table></div></section>' +
      '<section id="issue"><h2>Выдать код активации</h2>' +
      issue +
      '</section>' +
      '<section id="promos"><h2>Промокоды</h2><p class="muted">В боте: кнопка «Промокод» или команда /promo КОД</p>' +
      promoForm +
      '<div class="card"><table><tr><th>Код</th><th>Срок</th><th>Использовано</th><th>Кто</th><th></th></tr>' +
      (promoRows || '<tr><td colspan="5" class="muted">Пока нет промокодов</td></tr>') +
      '</table></div></section>' +
      '<section id="subs"><h2>Кто подключён</h2><div class="card"><table><tr><th>Аккаунт</th><th>До</th><th>Коды</th><th>Устройства</th></tr>' +
      (rows || '<tr><td colspan="4" class="muted">Пока пусто</td></tr>') +
      '</table></div></section>' +
      '<section id="settings"><h2>Цены, бот, Jackett, ЮMoney</h2>' +
      settings +
      '</section>' +
      '<section id="fails"><h2>Чужие попытки ввода кода</h2><div class="card"><table><tr><th>Причина</th><th>Устройство</th><th>Когда</th></tr>' +
      (fails || '<tr><td colspan="3" class="muted">Пока нет</td></tr>') +
      '</table></div></section>',
  );
}
