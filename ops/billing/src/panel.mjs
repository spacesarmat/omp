export function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const CSS = `
  body { margin: 0; background: #0F1115; color: #E8EAF0; font: 16px/1.4 Manrope, Segoe UI, sans-serif; }
  main { max-width: 880px; margin: 0 auto; padding: 24px 16px 48px; }
  h1 { font-size: 22px; margin: 0 0 16px; }
  h2 { font-size: 16px; margin: 28px 0 8px; color: #9AA1B2; font-weight: 600; }
  form, .card { background: #181B22; border-radius: 12px; padding: 16px; margin: 0 0 12px; }
  label { display: block; color: #9AA1B2; font-size: 13px; margin: 10px 0 4px; }
  input, select { width: 100%; box-sizing: border-box; background: #252A35; color: #E8EAF0; border: 0; border-radius: 8px; padding: 10px 12px; }
  button { background: #F5B700; color: #0F1115; border: 0; border-radius: 8px; padding: 10px 14px; font-weight: 700; margin-top: 12px; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; }
  .muted { color: #9AA1B2; }
  .bad { color: #E5484D; }
  .code { font: 20px/1.2 ui-monospace, Consolas, monospace; letter-spacing: 0.08em; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 8px 6px; border-top: 1px solid #252A35; vertical-align: top; }
`;

function page(title, body) {
  return '<!doctype html><html lang="ru"><meta charset="utf-8"><title>' + esc(title) + '</title><style>' + CSS + '</style><main>' + body + '</main>';
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

export function homePage(state, extra) {
  const s = state.settings;
  const note = extra && extra.code ? '<p class="card">Код: <span class="code">' + esc(extra.code) + '</span></p>' : '';
  const err = extra && extra.error ? '<p class="bad">' + esc(extra.error) + '</p>' : '';
  const csrf = '<input type="hidden" name="csrf" value="' + esc(extra.csrf) + '">';
  const settings =
    '<form method="post" action="/admin/settings">' +
    csrf +
    field('botToken', 'Токен бота Telegram', s.botToken) +
    field('yoomoneyWallet', 'Кошелёк ЮMoney', s.yoomoneyWallet) +
    field('yoomoneySecret', 'Секрет уведомлений ЮMoney', s.yoomoneySecret) +
    field('jackettUrl', 'Адрес Jackett', s.jackettUrl) +
    field('jackettApiKey', 'API-ключ Jackett', s.jackettApiKey) +
    field('smtpHost', 'SMTP-сервер', s.smtpHost) +
    field('smtpUser', 'SMTP-логин', s.smtpUser) +
    field('smtpPass', 'SMTP-пароль', s.smtpPass, 'password') +
    field('smtpFrom', 'Почта отправителя', s.smtpFrom) +
    field('priceRub', 'Цена за период, ₽', s.priceRub, 'number') +
    field('periodDays', 'Дней в периоде', s.periodDays, 'number') +
    field('extraDeviceRub', 'Цена ещё одного устройства, ₽', s.extraDeviceRub, 'number') +
    '<button>Сохранить</button></form>';
  const issue =
    '<form method="post" action="/admin/issue">' +
    csrf +
    field('email', 'Почта', '') +
    field('telegramId', 'Telegram id', '') +
    '<label>Куда отправить код</label><select name="channel"><option value="panel">Показать здесь</option><option value="email">На почту</option><option value="telegram">В Telegram</option></select>' +
    '<button>Выдать код</button></form>';
  const rows = state.subscriptions
    .map((sub) => {
      const account = state.accounts.find((a) => a.id === sub.accountId);
      const who = account ? account.email || account.telegramId || account.id : sub.accountId;
      const codes = state.codes.filter((c) => c.subscriptionId === sub.id && !c.revoked);
      const devices = codes
        .map((c) => {
          const bound = c.deviceId ? c.deviceId.slice(0, 8) : 'ещё не вводили';
          return (
            bound +
            ' <form method="post" action="/admin/unbind" style="display:inline">' +
            csrf +
            '<input type="hidden" name="codeId" value="' +
            esc(c.id) +
            '"><button>Сбросить</button></form>'
          );
        })
        .join('<br>');
      const until = new Date(sub.paidUntil).toISOString().slice(0, 10);
      return '<tr><td>' + esc(who) + '</td><td>' + esc(until) + '</td><td>' + codes.length + ' / ' + sub.deviceLimit + '</td><td>' + devices + '</td></tr>';
    })
    .join('');
  const fails = state.attempts
    .filter((a) => !a.ok)
    .slice(-12)
    .reverse()
    .map((a) => '<tr><td>' + esc(a.reason) + '</td><td>' + esc((a.deviceId || '').slice(0, 8)) + '</td><td class="muted">' + esc(new Date(a.at).toISOString().slice(0, 16).replace('T', ' ')) + '</td></tr>')
    .join('');
  return page(
    'OMP',
    '<h1>Подписки</h1>' +
      note +
      err +
      '<h2>Выдать код</h2>' +
      issue +
      '<h2>Цены, бот, Jackett, ЮMoney</h2>' +
      settings +
      '<h2>Кто подключён</h2><div class="card"><table><tr class="muted"><td>Аккаунт</td><td>До</td><td>Коды</td><td>Устройства</td></tr>' +
      rows +
      '</table></div><h2>Чужие попытки</h2><div class="card"><table>' +
      fails +
      '</table></div>',
  );
}
