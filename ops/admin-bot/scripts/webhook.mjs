// Points the OMP bot at the admin bot Worker (setWebhook) and registers its command menu (setMyCommands), or undoes it.
//   npm run admin-bot:webhook -- https://omp-admin-bot.<you>.workers.dev   set the webhook + the menu
//   npm run admin-bot:webhook -- --info                                   show the current webhook
//   npm run admin-bot:webhook -- --delete                                 roll back: delete the webhook + the menu
// Env: TELEGRAM_BOT_TOKEN, WEBHOOK_SECRET (the same value as the Worker secret), ADMIN_CHAT_ID (default 536445442).
// A missing token / secret is asked for with hidden input, so it never lands in the shell history. Never printed.
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { COMMANDS } from '../src/commandList.mjs';

export const ALLOWED_UPDATES = ['message', 'channel_post'];
const DEFAULT_ADMIN = '536445442';

/** The setWebhook body: only our updates, the secret Telegram sends back in X-Telegram-Bot-Api-Secret-Token. */
export function webhookBody(url, secret) {
  return { url, secret_token: secret, allowed_updates: ALLOWED_UPDATES, drop_pending_updates: true, max_connections: 10 };
}

/** The setMyCommands body: the menu only in the admin's chat (other people see no commands). */
export function commandsBody(adminChatId) {
  return { commands: COMMANDS, scope: { type: 'chat', chat_id: Number(adminChatId) } };
}

/** https only, no query (the URL must be the Worker's address). Throws a readable error otherwise. */
export function checkUrl(raw) {
  let u;
  try {
    u = new URL(String(raw || ''));
  } catch {
    throw new Error('Нужен адрес Worker, например https://omp-admin-bot.<имя>.workers.dev');
  }
  if (u.protocol !== 'https:') throw new Error('Адрес должен начинаться с https://');
  return u.toString();
}

export function checkSecret(s) {
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(s || '')) throw new Error('WEBHOOK_SECRET: 16–256 символов, только A-Z a-z 0-9 _ -');
  return s;
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // hide what is typed: print the question once, then nothing
    rl._writeToOutput = (s) => {
      if (s.includes(question)) process.stdout.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

async function fromEnvOrAsk(name, question) {
  if (process.env[name]) return process.env[name];
  if (!process.stdin.isTTY) throw new Error(name + ' не задан');
  return askHidden(question);
}

async function call(token, method, body) {
  let res;
  try {
    res = await fetch('https://api.telegram.org/bot' + token + '/' + method, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  } catch {
    // the URL holds the token: never print the original error
    throw new Error('Telegram ' + method + ': нет связи');
  }
  const j = await res.json().catch(() => ({}));
  if (!j.ok) throw new Error('Telegram ' + method + ': ' + res.status + ' ' + (j.description || ''));
  return j.result;
}

function printInfo(info) {
  console.log('Webhook: ' + (info.url || '(нет — бот работает через getUpdates)'));
  if (info.url) {
    console.log('  ожидают доставки: ' + (info.pending_update_count || 0));
    console.log('  типы обновлений: ' + (info.allowed_updates || ['все']).join(', '));
    if (info.last_error_message) console.log('  последняя ошибка: ' + info.last_error_message + ' (' + new Date(info.last_error_date * 1000).toISOString() + ')');
  }
}

async function main(args) {
  const admin = process.env.ADMIN_CHAT_ID || DEFAULT_ADMIN;
  const token = await fromEnvOrAsk('TELEGRAM_BOT_TOKEN', 'Токен бота (ввод скрыт): ');
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) throw new Error('TELEGRAM_BOT_TOKEN не похож на токен бота');

  if (args[0] === '--info') {
    printInfo(await call(token, 'getWebhookInfo'));
    return;
  }
  if (args[0] === '--delete') {
    await call(token, 'deleteWebhook', { drop_pending_updates: false });
    await call(token, 'deleteMyCommands', { scope: { type: 'chat', chat_id: Number(admin) } });
    console.log('Готово: webhook удалён, меню команд убрано. Релизы снова удаляют «закрепил сообщение» через getUpdates.');
    return;
  }
  const url = checkUrl(args[0]);
  const secret = checkSecret(await fromEnvOrAsk('WEBHOOK_SECRET', 'WEBHOOK_SECRET, как в Worker (ввод скрыт): '));
  await call(token, 'setWebhook', webhookBody(url, secret));
  await call(token, 'setMyCommands', commandsBody(admin));
  console.log('Готово: webhook → ' + url + ', меню из ' + COMMANDS.length + ' команд для чата ' + admin + '.');
  printInfo(await call(token, 'getWebhookInfo'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
