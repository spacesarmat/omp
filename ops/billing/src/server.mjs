import { createServer } from 'node:http';
import {
  accountByDevice,
  accountCard,
  activate,
  adminFind,
  applyPayment,
  createPromo,
  createSubscription,
  grantDays,
  logWebhook,
  openAccount,
  openAppUrl,
  paymentsCsv,
  revokePromo,
  sessionOk,
  startDeviceLink,
  subscriptionView,
  unbindCode,
} from './logic.mjs';
import { botDeepLink, botReply, telegramOf } from './bot.mjs';
import { hashPassword, passwordMatches, randomCode, randomId } from './crypto.mjs';
import { goPage } from './go.mjs';
import { jackettSearchUrl, restoreJackett, stripJackett } from './jackett.mjs';
import { sendMail } from './mail.mjs';
import { homePage, loginPage, userPage } from './panel.mjs';
import { readState, updateState } from './store.mjs';
import { notificationOk } from './yoomoney.mjs';

const sessions = new Map();

function cookie(req, name) {
  const raw = req.headers.cookie || '';
  const parts = raw.split(';');
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i].trim();
    if (p.indexOf(name + '=') === 0) return decodeURIComponent(p.slice(name.length + 1));
  }
  return '';
}

function adminOf(req) {
  const id = cookie(req, 'omp_admin');
  const row = sessions.get(id);
  if (!row || row.exp < Date.now()) return null;
  return row;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  const type = String(req.headers['content-type'] || '');
  if (type.indexOf('application/json') >= 0) {
    try {
      return JSON.parse(raw || '{}');
    } catch (e) {
      return {};
    }
  }
  const params = new URLSearchParams(raw);
  const out = {};
  for (const [k, v] of params) out[k] = v;
  return out;
}

function send(res, status, body, headers) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(status, { 'content-length': buf.length, ...(headers || {}) });
  res.end(buf);
}

function json(res, status, value) {
  send(res, status, JSON.stringify(value), { 'content-type': 'application/json; charset=utf-8' });
}

async function telegramSend(token, chatId, text, fetchImpl, opts) {
  if (!token || !chatId) return false;
  const body = { chat_id: chatId, text, disable_web_page_preview: true };
  if (opts && opts.parseMode) body.parse_mode = opts.parseMode;
  if (opts && opts.inline) body.reply_markup = opts.inline;
  else if (opts && opts.keyboard) body.reply_markup = opts.keyboard;
  const res = await fetchImpl('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.ok;
}

function tellPayment(state, result, fetchImpl) {
  const accountId = result.subscriptionId
    ? (state.subscriptions.find((s) => s.id === result.subscriptionId) || {}).accountId
    : '';
  const chat = telegramOf(state, accountId);
  if (!chat) return Promise.resolve();
  const origin = state.settings.publicOrigin || '';
  let text = '';
  let inline = null;
  if (result.kind === 'new' && result.code) {
    const link = openAppUrl(origin, result.code);
    text =
      'Код Jackett OMP: `' +
      result.code +
      '`\n' +
      link +
      '\nДолгое нажатие на код — копировать.';
    if (link.indexOf('http') === 0) inline = { inline_keyboard: [[{ text: 'Открыть в OMP', url: link }]] };
  }
  if (result.kind === 'device' && result.code) {
    const link = openAppUrl(origin, result.code);
    text = 'Код для нового устройства: `' + result.code + '`\n' + link;
    if (link.indexOf('http') === 0) inline = { inline_keyboard: [[{ text: 'Открыть в OMP', url: link }]] };
  }
  if (result.kind === 'renew') text = 'Подписка продлена до ' + new Date(result.paidUntil).toISOString().slice(0, 10);
  if (!text) return Promise.resolve();
  return telegramSend(state.settings.botToken, chat, text, fetchImpl, { parseMode: 'Markdown', inline });
}

export function createApp(file, fetchImpl) {
  const net = fetchImpl || fetch;
  return async function handle(req, res) {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const path = url.pathname;
    try {
      if (req.method === 'GET' && path === '/health') return json(res, 200, { ok: true });
      if (req.method === 'GET' && path.indexOf('/go/') === 0) {
        const code = decodeURIComponent(path.slice(4));
        return send(res, 200, goPage(code), { 'content-type': 'text/html; charset=utf-8' });
      }
      if (req.method === 'GET' && (path === '/admin' || path === '/admin/')) {
        const admin = adminOf(req);
        if (!admin) return send(res, 200, loginPage(''), { 'content-type': 'text/html; charset=utf-8' });
        const code = admin.flash || '';
        const promo = admin.flashPromo || '';
        const flash = admin.flashText || '';
        const err = admin.flashError || '';
        if (code || promo || flash || err) sessions.set(cookie(req, 'omp_admin'), { csrf: admin.csrf, exp: admin.exp });
        return send(res, 200, homePage(readState(file), { csrf: admin.csrf, code, promo, flash, error: err }), {
          'content-type': 'text/html; charset=utf-8',
        });
      }
      if (req.method === 'GET' && path === '/admin/user') {
        const admin = adminOf(req);
        if (!admin) return send(res, 200, loginPage(''), { 'content-type': 'text/html; charset=utf-8' });
        const id = url.searchParams.get('id') || '';
        const state = readState(file);
        const card = accountCard(state, id, Date.now());
        if (!card) {
          return send(
            res,
            200,
            homePage(state, { csrf: admin.csrf, error: 'Пользователь не найден', q: id }),
            { 'content-type': 'text/html; charset=utf-8' },
          );
        }
        const code = admin.flash || '';
        const flash = admin.flashText || '';
        const err = admin.flashError || '';
        if (code || flash || err) sessions.set(cookie(req, 'omp_admin'), { csrf: admin.csrf, exp: admin.exp });
        return send(
          res,
          200,
          userPage(state, card, { csrf: admin.csrf, code, flash, error: err }),
          { 'content-type': 'text/html; charset=utf-8' },
        );
      }
      if (req.method === 'GET' && path === '/admin/finance.csv') {
        const admin = adminOf(req);
        if (!admin) return send(res, 401, 'login required');
        const now = Date.now();
        const from = Number(url.searchParams.get('from')) || now - 30 * 24 * 60 * 60 * 1000;
        const to = Number(url.searchParams.get('to')) || now;
        const csv = paymentsCsv(readState(file), from, to);
        return send(res, 200, csv, {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': 'attachment; filename="omp-payments.csv"',
        });
      }
      if (req.method === 'POST' && path === '/admin/login') {
        const body = await readBody(req);
        const state = readState(file);
        if (!passwordMatches(body.password || '', state.settings.adminSalt, state.settings.adminHash)) {
          return send(res, 401, loginPage('Неверный пароль'), { 'content-type': 'text/html; charset=utf-8' });
        }
        const id = randomId() + randomId();
        const csrf = randomId();
        sessions.set(id, { csrf, exp: Date.now() + 12 * 60 * 60 * 1000 });
        res.setHeader('set-cookie', 'omp_admin=' + id + '; HttpOnly; SameSite=Lax; Path=/');
        res.writeHead(302, { location: '/admin' });
        return res.end();
      }
      const admin = adminOf(req);
      if (req.method === 'POST' && path.indexOf('/admin/') === 0) {
        const body = await readBody(req);
        if (!admin || body.csrf !== admin.csrf) return send(res, 403, 'forbidden');
        if (path === '/admin/settings') {
          await updateState(file, (state) => {
            const num = (v, d) => {
              const n = Number(v);
              return Number.isFinite(n) ? n : d;
            };
            return {
              state: {
                ...state,
                settings: {
                  ...state.settings,
                  botToken: body.botToken || '',
                  botUsername: (body.botUsername || 'OMPBILLINGBOT').replace(/^@/, ''),
                  publicOrigin: (body.publicOrigin || '').replace(/\/+$/, ''),
                  adminTelegramIds: body.adminTelegramIds || '',
                  yoomoneyWallet: body.yoomoneyWallet || '',
                  yoomoneySecret: body.yoomoneySecret || '',
                  jackettUrl: (body.jackettUrl || '').replace(/\/+$/, ''),
                  jackettApiKey: body.jackettApiKey || '',
                  smtpHost: body.smtpHost || '',
                  smtpUser: body.smtpUser || '',
                  smtpPass: body.smtpPass || '',
                  smtpFrom: body.smtpFrom || '',
                  priceRub: num(body.priceRub, 0),
                  periodDays: num(body.periodDays, 30),
                  extraDeviceRub: num(body.extraDeviceRub, 0),
                },
              },
            };
          });
        }
        let flashed = '';
        let flashPromo = '';
        let flashText = '';
        let flashError = '';
        let redirectTo = '/admin';
        if (path === '/admin/find') {
          const found = adminFind(readState(file), body.q || '', Date.now());
          if (found) {
            res.writeHead(302, { location: '/admin/user?id=' + encodeURIComponent(found.account.id) });
            return res.end();
          }
          flashError = 'Никого не нашли по «' + (body.q || '') + '»';
          redirectTo = '/admin';
        }
        if (path === '/admin/issue') {
          const result = await updateState(file, (state) => {
            const opened = openAccount(state, { email: body.email, telegramId: body.telegramId, now: Date.now() });
            const created = createSubscription(opened.state, { accountId: opened.account.id, now: Date.now() });
            return { state: created.state, result: { code: created.result.code, account: opened.account, channel: body.channel } };
          });
          flashed = result.code;
          const fresh = readState(file);
          const text = 'Код Jackett OMP: ' + result.code + '\nВведите его в OMP на телефоне. На другом устройстве он не сработает.';
          if (body.channel === 'telegram' && result.account.telegramId) {
            await telegramSend(fresh.settings.botToken, result.account.telegramId, text, net);
          }
          if (body.channel === 'email' && result.account.email) {
            await sendMail(fresh.settings, { to: result.account.email, subject: 'Код Jackett OMP', text });
          }
          if (result.account && result.account.id) redirectTo = '/admin/user?id=' + encodeURIComponent(result.account.id);
        }
        if (path === '/admin/grant') {
          const days =
            body.days === 'custom' ? Number(body.daysCustom) || 0 : Number(body.days) || 0;
          const result = await updateState(file, (state) =>
            grantDays(state, { accountId: body.accountId, telegramId: body.telegramId, days, now: Date.now() }),
          );
          if (result.error) flashError = 'Не удалось выдать дни';
          else {
            flashed = result.code || '';
            flashText = 'Выдано +' + result.days + ' дн. до ' + new Date(result.paidUntil).toISOString().slice(0, 10);
            const fresh = readState(file);
            const acc = fresh.accounts.find((a) => a.id === result.accountId);
            if (acc && acc.telegramId && result.code) {
              const link = openAppUrl(fresh.settings.publicOrigin || '', result.code);
              await telegramSend(
                fresh.settings.botToken,
                acc.telegramId,
                'Админ выдал +' + result.days + ' дн.\nКод: `' + result.code + '`\n' + link,
                net,
                {
                  parseMode: 'Markdown',
                  inline:
                    link.indexOf('http') === 0
                      ? { inline_keyboard: [[{ text: 'Открыть в OMP', url: link }]] }
                      : null,
                },
              );
            }
          }
          if (body.accountId) redirectTo = '/admin/user?id=' + encodeURIComponent(body.accountId);
        }
        if (path === '/admin/message') {
          const state = readState(file);
          const acc = state.accounts.find((a) => a.id === body.accountId);
          const text = String(body.text || '').trim();
          if (!acc || !acc.telegramId || !text) flashError = 'Нет Telegram или пустой текст';
          else {
            const ok = await telegramSend(state.settings.botToken, acc.telegramId, text, net);
            flashText = ok ? 'Сообщение отправлено' : 'Telegram не принял сообщение';
          }
          if (body.accountId) redirectTo = '/admin/user?id=' + encodeURIComponent(body.accountId);
        }
        if (path === '/admin/promo') {
          const result = await updateState(file, (state) =>
            createPromo(state, {
              code: body.code,
              days: Number(body.days) || 1,
              maxUses: Number(body.maxUses) || 1,
              now: Date.now(),
            }),
          );
          if (result.promo) flashPromo = result.promo.code;
        }
        if (path === '/admin/promo-revoke') {
          await updateState(file, (state) => ({ state: revokePromo(state, body.promoId || '') }));
        }
        if (path === '/admin/unbind') {
          await updateState(file, (state) => ({ state: unbindCode(state, body.codeId || '') }));
          flashText = 'Устройство сброшено, выдан новый код';
          if (body.accountId) redirectTo = '/admin/user?id=' + encodeURIComponent(body.accountId);
        }
        res.writeHead(302, { location: redirectTo });
        if (flashed || flashPromo || flashText || flashError) {
          sessions.set(cookie(req, 'omp_admin'), {
            ...admin,
            flash: flashed,
            flashPromo,
            flashText,
            flashError,
          });
        }
        return res.end();
      }
      if (req.method === 'POST' && path === '/v1/activate') {
        const body = await readBody(req);
        const result = await updateState(file, (state) => activate(state, { code: body.code, deviceId: body.deviceId, now: Date.now() }));
        if (result.error) return json(res, result.error === 'other_device' ? 409 : 403, result);
        return json(res, 200, { token: result.token, paidUntil: result.paidUntil });
      }
      if (req.method === 'POST' && path === '/v1/link/start') {
        const body = await readBody(req);
        const result = await updateState(file, (state) => startDeviceLink(state, { deviceId: body.deviceId, now: Date.now() }));
        if (result.error) return json(res, 400, result);
        const state = readState(file);
        const deepLink = botDeepLink(state.settings, 'link_' + result.token);
        return json(res, 200, { token: result.token, deepLink, expiresAt: result.expiresAt });
      }
      if (req.method === 'GET' && path === '/v1/me') {
        const device = String(req.headers['x-device-id'] || url.searchParams.get('deviceId') || '');
        const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
        const state = readState(file);
        const now = Date.now();
        let account = null;
        let paidUntil = 0;
        let active = false;
        if (token) {
          const sess = sessionOk(state, { token, deviceId: device, now });
          if (sess) {
            account = state.accounts.find((a) => a.id === sess.subscription.accountId) || null;
            paidUntil = sess.subscription.paidUntil;
            active = paidUntil > now;
          }
        }
        if (!account) account = accountByDevice(state, device);
        if (!account) return json(res, 404, { error: 'not_linked' });
        const view = subscriptionView(state, account.id, now);
        return json(res, 200, {
          telegramId: account.telegramId || '',
          paidUntil: view ? view.paidUntil : paidUntil,
          active: view ? view.active : active,
          deviceLimit: view ? view.deviceLimit : 0,
          devices: view ? view.devices.map((d) => ({ bound: d.bound, deviceId: d.bound ? (d.deviceId || '').slice(0, 8) : '' })) : [],
        });
      }
      if (req.method === 'POST' && path === '/v1/search') {
        const body = await readBody(req);
        const deviceId = req.headers['x-device-id'] || body.deviceId;
        const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
        const state = readState(file);
        if (!sessionOk(state, { token, deviceId, now: Date.now() })) return json(res, 403, { error: 'expired' });
        const search = jackettSearchUrl(state.settings.jackettUrl, state.settings.jackettApiKey, body.q || '');
        const upstream = await net(search);
        const xml = stripJackett(await upstream.text(), state.settings.jackettUrl, state.settings.jackettApiKey);
        return send(res, upstream.status, xml, { 'content-type': 'application/xml; charset=utf-8' });
      }
      if (req.method === 'POST' && path === '/v1/torrent') {
        const body = await readBody(req);
        const deviceId = req.headers['x-device-id'] || '';
        const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
        const state = readState(file);
        if (!sessionOk(state, { token, deviceId, now: Date.now() })) return json(res, 403, { error: 'expired' });
        const remote = restoreJackett(body.link, state.settings.jackettUrl, state.settings.jackettApiKey);
        if (!remote) return json(res, 400, { error: 'bad_link' });
        const upstream = await net(remote);
        const buf = Buffer.from(await upstream.arrayBuffer());
        return send(res, upstream.status, buf, { 'content-type': 'application/octet-stream' });
      }
      if (req.method === 'POST' && path === '/v1/yoomoney') {
        const body = await readBody(req);
        const state = readState(file);
        const now = Date.now();
        if (!notificationOk(body, state.settings.yoomoneySecret)) {
          await updateState(file, (cur) => ({
            state: logWebhook(cur, {
              kind: 'bad_signature',
              operationId: body.operation_id || '',
              label: body.label || '',
              amount: body.amount || '',
              at: now,
            }),
          }));
          return send(res, 400, 'bad signature');
        }
        const applied = await updateState(file, (cur) =>
          applyPayment(cur, { operationId: body.operation_id, label: body.label, amount: body.amount, now }),
        );
        if (!applied.duplicate && !applied.error) await tellPayment(readState(file), applied, net);
        return send(res, 200, 'ok');
      }
      return send(res, 404, 'not found');
    } catch (e) {
      return json(res, 500, { error: 'down' });
    }
  };
}

export function listen(file, port, fetchImpl) {
  const server = createServer((req, res) => {
    createApp(file, fetchImpl)(req, res);
  });
  // 0.0.0.0: phone on the LAN (and Docker publish) can reach the panel and API
  return new Promise((resolve) => server.listen(port, '0.0.0.0', () => resolve(server)));
}

export async function pollBot(file, fetchImpl) {
  let offset = 0;
  /** chatId → { kind } waiting for the next free-text reply */
  const awaiting = new Map();
  const net = fetchImpl || fetch;
  for (;;) {
    const state = readState(file);
    const token = state.settings.botToken;
    if (!token) {
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    let updates = [];
    try {
      const res = await net('https://api.telegram.org/bot' + token + '/getUpdates?timeout=25&offset=' + offset);
      const data = await res.json();
      updates = data.ok ? data.result : [];
    } catch (e) {
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    for (let i = 0; i < updates.length; i++) {
      const u = updates[i];
      offset = u.update_id + 1;
      const msg = u.message;
      if (!msg || !msg.chat) continue;
      const chatId = String(msg.chat.id);
      const wait = awaiting.get(chatId) || null;
      const replied = await updateState(file, (cur) => {
        const out = botReply(cur, { chatId, text: msg.text || '', now: Date.now(), awaiting: wait });
        return { state: out.state, result: out.messages };
      });
      awaiting.delete(chatId);
      for (let m = 0; m < replied.length; m++) {
        const row = replied[m];
        if (row.await) awaiting.set(chatId, row.await);
        await telegramSend(token, row.chatId, row.text, net, {
          keyboard: row.keyboard,
          inline: row.inline,
          parseMode: row.parseMode,
        });
      }
    }
  }
}

export function dataFile() {
  const fromEnv = process.env.BILLING_DATA;
  if (fromEnv) return fromEnv;
  const path = new URL('../data/state.json', import.meta.url).pathname;
  return path.replace(/^\/([A-Za-z]:)/, '$1');
}

export async function ensureAdmin(file) {
  const state = readState(file);
  const jackettUrl = process.env.BILLING_JACKETT_URL || '';
  const publicOrigin = process.env.BILLING_PUBLIC_ORIGIN || '';
  if (state.settings.adminHash) {
    if ((jackettUrl && !state.settings.jackettUrl) || (publicOrigin && !state.settings.publicOrigin)) {
      await updateState(file, (s) => ({
        state: {
          ...s,
          settings: {
            ...s.settings,
            jackettUrl: s.settings.jackettUrl || jackettUrl,
            publicOrigin: s.settings.publicOrigin || publicOrigin,
          },
        },
      }));
    }
    return '';
  }
  const password = process.env.BILLING_ADMIN_PASSWORD || randomCode();
  const hashed = hashPassword(password);
  await updateState(file, (s) => ({
    state: {
      ...s,
      settings: {
        ...s.settings,
        adminHash: hashed.hash,
        adminSalt: hashed.salt,
        jackettUrl: s.settings.jackettUrl || jackettUrl,
        publicOrigin: s.settings.publicOrigin || publicOrigin,
      },
    },
  }));
  return process.env.BILLING_ADMIN_PASSWORD ? '' : password;
}

const started = process.argv[1] && process.argv[1].endsWith('server.mjs');
if (started) {
  const file = dataFile();
  const port = Number(process.env.PORT || 8787);
  ensureAdmin(file).then((password) => {
    if (password) process.stdout.write('admin password: ' + password + '\n');
    return listen(file, port);
  }).then(() => {
    process.stdout.write('billing listening on ' + port + '\n');
  });
  pollBot(file);
}
