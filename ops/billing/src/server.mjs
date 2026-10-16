import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homePayload, userPayload } from './adminApi.mjs';
import {
  accountByDevice,
  activate,
  adminFind,
  appendSupportMessage,
  applyPayment,
  createPromo,
  createSubscription,
  grantDays,
  logAudit,
  logWebhook,
  openAccount,
  openAppUrl,
  paymentsCsv,
  revokePromo,
  sessionOk,
  rememberSupportReply,
  rememberTelegramProfile,
  startAdminPanelLogin,
  startDeviceLink,
  subscriptionView,
  supportThread,
  closeSupportThread,
  SUPPORT_CLOSED_TEXT,
  takeAdminPanelLogin,
  unbindCode,
  telegramForDevice,
  unlinkDeviceTelegram,
} from './logic.mjs';
import { botDeepLink, botReply, telegramOf } from './bot.mjs';
import { hashPassword, passwordMatches, randomCode, randomId } from './crypto.mjs';
import { goPage } from './go.mjs';
import { basicAuthHeader, indexerByLink, indexerOf, jackettSearchUrl, restoreJackett, stripJackett } from './jackett.mjs';
import { sendMail } from './mail.mjs';
import { loginPage } from './panel.mjs';
import {
  createRateLimit,
  createSearchCache,
  mergeSettings,
  probeAllServices,
  sourceEnabled,
} from './services.mjs';
import { readState, resolveDbPath, updateState } from './store.mjs';
import { notificationOk } from './yoomoney.mjs';

const EMPTY_RSS = '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel></channel></rss>';
const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));
const SPA_INDEX = join(PUBLIC_DIR, 'index.html');
const searchRate = createRateLimit(30, 60 * 1000);
const searchCache = createSearchCache(45 * 1000);

function wantsJson(req) {
  const accept = String(req.headers.accept || '');
  const type = String(req.headers['content-type'] || '');
  return accept.indexOf('application/json') >= 0 || type.indexOf('application/json') >= 0;
}

function mimeFor(file) {
  const ext = extname(file);
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.woff2') return 'font/woff2';
  return 'application/octet-stream';
}

function serveSpa(res) {
  if (!existsSync(SPA_INDEX)) return false;
  send(res, 200, readFileSync(SPA_INDEX), { 'content-type': 'text/html; charset=utf-8' });
  return true;
}

function servePublic(path, res) {
  const staticFile = path.indexOf('/admin/assets/') === 0 || path === '/admin/logo.svg' || path === '/admin/tunnel.svg';
  if (!staticFile && path !== '/admin/' && path !== '/admin') return false;
  if (!existsSync(PUBLIC_DIR)) return false;
  if (path === '/admin' || path === '/admin/') return serveSpa(res);
  const rel = path.replace(/^\/admin\//, '');
  if (rel.indexOf('..') >= 0) return false;
  const file = join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR) || !existsSync(file)) return false;
  send(res, 200, readFileSync(file), { 'content-type': mimeFor(file) });
  return true;
}

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

/** Admin session cookie: HttpOnly + SameSite=Lax; Secure when the request (or public origin) is HTTPS. */
function adminSetCookie(req, id, maxAge) {
  const proto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const origin = String(process.env.BILLING_PUBLIC_ORIGIN || '');
  const secure = proto === 'https' || origin.indexOf('https://') === 0;
  let value = 'omp_admin=' + encodeURIComponent(id) + '; HttpOnly; SameSite=Lax; Path=/';
  if (secure) value += '; Secure';
  if (maxAge !== undefined) value += '; Max-Age=' + maxAge;
  return value;
}

function adminOf(req) {
  const id = cookie(req, 'omp_admin');
  const row = sessions.get(id);
  if (!row || row.exp < Date.now()) {
    if (row) sessions.delete(id);
    return null;
  }
  row.lastSeen = Date.now();
  row.id = id;
  return row;
}

function listSessions() {
  const now = Date.now();
  const out = [];
  for (const [id, row] of sessions) {
    if (row.exp < now) {
      sessions.delete(id);
      continue;
    }
    out.push({
      id,
      createdAt: row.createdAt || 0,
      lastSeen: row.lastSeen || row.createdAt || 0,
      exp: row.exp,
    });
  }
  out.sort((a, b) => b.lastSeen - a.lastSeen);
  return out;
}

function takeFlash(admin, sid) {
  const code = admin.flash || '';
  const promo = admin.flashPromo || '';
  const flash = admin.flashText || '';
  const error = admin.flashError || '';
  if (code || promo || flash || error) {
    sessions.set(sid, {
      csrf: admin.csrf,
      exp: admin.exp,
      createdAt: admin.createdAt,
      lastSeen: Date.now(),
    });
  }
  return { code, promo, flash, error };
}

function audit(file, action, detail) {
  return updateState(file, (state) => ({ state: logAudit(state, { action, detail, now: Date.now() }) }));
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
  if (!token || !chatId) return { ok: false, messageId: 0 };
  const body = { chat_id: chatId, text, disable_web_page_preview: true };
  if (opts && opts.parseMode) body.parse_mode = opts.parseMode;
  if (opts && opts.inline) body.reply_markup = opts.inline;
  else if (opts && opts.keyboard) body.reply_markup = opts.keyboard;
  const res = await fetchImpl('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data = {};
  try {
    data = await res.json();
  } catch (e) {
    data = {};
  }
  const messageId = data && data.result && data.result.message_id ? data.result.message_id : 0;
  return { ok: !!(res.ok && data.ok !== false && messageId), messageId };
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
      'Код подписки OMP: `' +
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
      if (req.method === 'GET' && (path.indexOf('/admin/assets/') === 0 || path === '/admin/logo.svg' || path === '/admin/tunnel.svg')) {
        if (servePublic(path, res)) return;
        return send(res, 404, 'not found');
      }
      if (req.method === 'GET' && path === '/admin/api/home') {
        const admin = adminOf(req);
        if (!admin) return json(res, 401, { auth: false });
        const sid = cookie(req, 'omp_admin');
        const flash = takeFlash(admin, sid);
        return json(
          res,
          200,
          homePayload(readState(file), file, {
            csrf: admin.csrf,
            sessionId: sid,
            ...flash,
            sessions: listSessions(),
          }),
        );
      }
      if (req.method === 'GET' && path === '/admin/api/support') {
        const admin = adminOf(req);
        if (!admin) return json(res, 401, { auth: false });
        const telegramId = url.searchParams.get('telegramId') || '';
        return json(res, 200, { telegramId, messages: supportThread(readState(file), telegramId).slice(-80) });
      }
      if (req.method === 'GET' && path === '/admin/api/services') {
        const admin = adminOf(req);
        if (!admin) return json(res, 401, { auth: false });
        const services = await probeAllServices(readState(file).settings, net);
        return json(res, 200, { ok: true, services });
      }
      if (req.method === 'GET' && path === '/admin/api/user') {
        const admin = adminOf(req);
        if (!admin) return json(res, 401, { auth: false });
        const id = url.searchParams.get('id') || '';
        const sid = cookie(req, 'omp_admin');
        const flash = takeFlash(admin, sid);
        const payload = userPayload(readState(file), id, { csrf: admin.csrf, ...flash });
        if (!payload) return json(res, 404, { error: 'not_found' });
        return json(res, 200, payload);
      }
      if (req.method === 'GET' && (path === '/admin' || path === '/admin/')) {
        if (existsSync(SPA_INDEX)) return serveSpa(res);
        return send(res, 200, loginPage(adminOf(req) ? '' : ''), { 'content-type': 'text/html; charset=utf-8' });
      }
      if (req.method === 'GET' && path === '/admin/user') {
        const id = url.searchParams.get('id') || '';
        res.writeHead(302, { location: '/admin/?id=' + encodeURIComponent(id) });
        return res.end();
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
      if (req.method === 'POST' && path === '/admin/login/telegram') {
        const state = readState(file);
        if (!String(state.settings.adminTelegramIds || '').trim()) {
          return json(res, 400, { ok: false, error: 'Сначала укажите adminTelegramIds в настройках или через пароль' });
        }
        if (!state.settings.botToken || !state.settings.botUsername) {
          return json(res, 400, { ok: false, error: 'Не задан бот Telegram (токен или username)' });
        }
        const started = await updateState(file, (cur) => startAdminPanelLogin(cur, { now: Date.now() }));
        const deepLink = botDeepLink(state.settings, 'admin_' + started.token);
        await audit(file, 'login_telegram_start', started.token.slice(0, 8));
        return json(res, 200, { ok: true, token: started.token, deepLink, expiresAt: started.expiresAt });
      }
      if (req.method === 'GET' && path === '/admin/login/telegram/status') {
        const token = url.searchParams.get('token') || '';
        const taken = await updateState(file, (cur) => takeAdminPanelLogin(cur, { token, now: Date.now() }));
        if (taken.status === 'ok') {
          const id = randomId() + randomId();
          const csrf = randomId();
          const now = Date.now();
          sessions.set(id, {
            csrf,
            exp: now + 12 * 60 * 60 * 1000,
            createdAt: now,
            lastSeen: now,
            telegramId: taken.telegramId || '',
          });
          await audit(file, 'login', 'telegram ' + (taken.telegramId || ''));
          res.setHeader('set-cookie', adminSetCookie(req, id));
          return json(res, 200, { ok: true, status: 'ok' });
        }
        return json(res, 200, { ok: false, status: taken.status || 'expired' });
      }
      if (req.method === 'POST' && path === '/admin/login') {
        const body = await readBody(req);
        const state = readState(file);
        if (!passwordMatches(body.password || '', state.settings.adminSalt, state.settings.adminHash)) {
          await audit(file, 'login_fail', 'bad password');
          if (wantsJson(req)) return json(res, 401, { ok: false, error: 'Неверный пароль' });
          return send(res, 401, loginPage('Неверный пароль'), { 'content-type': 'text/html; charset=utf-8' });
        }
        const id = randomId() + randomId();
        const csrf = randomId();
        const now = Date.now();
        sessions.set(id, { csrf, exp: now + 12 * 60 * 60 * 1000, createdAt: now, lastSeen: now });
        await audit(file, 'login', 'ok');
        res.setHeader('set-cookie', adminSetCookie(req, id));
        if (wantsJson(req)) return json(res, 200, { ok: true });
        res.writeHead(302, { location: '/admin' });
        return res.end();
      }
      const admin = adminOf(req);
      if (req.method === 'POST' && path.indexOf('/admin/') === 0) {
        const body = await readBody(req);
        if (!admin || body.csrf !== admin.csrf) return send(res, 403, 'forbidden');
        if (path === '/admin/settings' || path === '/admin/services') {
          await updateState(file, (state) => ({
            state: { ...state, settings: mergeSettings(state.settings, body) },
          }));
          await audit(file, path === '/admin/services' ? 'services_save' : 'settings_save', 'ok');
          if (wantsJson(req) && path === '/admin/services') {
            const services = await probeAllServices(readState(file).settings, net);
            return json(res, 200, { ok: true, services });
          }
        }
        let flashed = '';
        let flashPromo = '';
        let flashText = '';
        let flashError = '';
        let redirectTo = '/admin';
        if (path === '/admin/find') {
          const found = adminFind(readState(file), body.q || '', Date.now());
          if (found) {
            redirectTo = '/admin/?id=' + encodeURIComponent(found.account.id);
            if (wantsJson(req)) return json(res, 200, { ok: true, redirect: redirectTo });
            res.writeHead(302, { location: redirectTo });
            return res.end();
          }
          flashError = 'Никого не нашли по «' + (body.q || '') + '»';
          redirectTo = '/admin/';
        }
        if (path === '/admin/issue') {
          const result = await updateState(file, (state) => {
            const opened = openAccount(state, { email: body.email, telegramId: body.telegramId, now: Date.now() });
            const created = createSubscription(opened.state, { accountId: opened.account.id, now: Date.now() });
            return { state: created.state, result: { code: created.result.code, account: opened.account, channel: body.channel } };
          });
          flashed = result.code;
          const fresh = readState(file);
          const text = 'Код подписки OMP: ' + result.code + '\nВведите его в OMP на телефоне. На другом устройстве он не сработает.';
          if (body.channel === 'telegram' && result.account.telegramId) {
            await telegramSend(fresh.settings.botToken, result.account.telegramId, text, net);
          }
          if (body.channel === 'email' && result.account.email) {
            await sendMail(fresh.settings, { to: result.account.email, subject: 'Код подписки OMP', text });
          }
          if (result.account && result.account.id) redirectTo = '/admin/?id=' + encodeURIComponent(result.account.id);
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
          if (body.accountId) redirectTo = '/admin/?id=' + encodeURIComponent(body.accountId);
        }
        if (path === '/admin/message') {
          const state = readState(file);
          const acc = state.accounts.find((a) => a.id === body.accountId);
          const text = String(body.text || '').trim();
          if (!acc || !acc.telegramId || !text) flashError = 'Нет Telegram или пустой текст';
          else {
            const sent = await telegramSend(state.settings.botToken, acc.telegramId, text, net);
            if (sent.ok) {
              await updateState(file, (cur) =>
                appendSupportMessage(cur, {
                  telegramId: acc.telegramId,
                  text,
                  direction: 'out',
                  now: Date.now(),
                  via: 'panel',
                }),
              );
              flashText = 'Сообщение отправлено';
            } else flashError = 'Telegram не принял сообщение';
          }
          if (body.accountId) redirectTo = '/admin/?id=' + encodeURIComponent(body.accountId);
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
          await updateState(file, (state) => ({
            state: logAudit(unbindCode(state, body.codeId || ''), {
              action: 'unbind',
              detail: body.codeId || '',
              now: Date.now(),
            }),
          }));
          flashText = 'Устройство сброшено, выдан новый код';
          if (body.accountId) redirectTo = '/admin/?id=' + encodeURIComponent(body.accountId);
        }
        if (path === '/admin/password') {
          const state = readState(file);
          if (!passwordMatches(body.current || '', state.settings.adminSalt, state.settings.adminHash)) {
            flashError = 'Текущий пароль неверный';
            redirectTo = '/admin#security';
          } else if (!body.next || body.next !== body.next2 || String(body.next).length < 6) {
            flashError = 'Новый пароль: минимум 6 символов и совпадение';
            redirectTo = '/admin#security';
          } else {
            const hashed = hashPassword(body.next);
            await updateState(file, (s) => ({
              state: logAudit(
                {
                  ...s,
                  settings: { ...s.settings, adminHash: hashed.hash, adminSalt: hashed.salt },
                },
                { action: 'password_change', detail: 'ok', now: Date.now() },
              ),
            }));
            const keep = cookie(req, 'omp_admin');
            for (const [id] of sessions) {
              if (id !== keep) sessions.delete(id);
            }
            flashText = 'Пароль сменён, другие сессии завершены';
            redirectTo = '/admin#security';
          }
        }
        if (path === '/admin/logout') {
          const sid = cookie(req, 'omp_admin');
          sessions.delete(sid);
          await audit(file, 'logout', sid.slice(0, 8));
          res.setHeader('set-cookie', adminSetCookie(req, '', 0));
          if (wantsJson(req)) return json(res, 200, { ok: true, redirect: '/admin/' });
          res.writeHead(302, { location: '/admin/' });
          return res.end();
        }
        if (path === '/admin/session-revoke') {
          const target = body.sessionId || '';
          const sid = cookie(req, 'omp_admin');
          if (target && target !== sid) {
            sessions.delete(target);
            await audit(file, 'session_revoke', target.slice(0, 8));
            flashText = 'Сессия завершена';
          }
          redirectTo = '/admin#security';
        }
        if (path === '/admin/grant' && !flashError && flashText) {
          await audit(file, 'grant', (body.accountId || '') + ' ' + flashText);
        }
        if (path === '/admin/promo' && flashPromo) {
          await audit(file, 'promo_create', flashPromo);
        }
        if (path === '/admin/support') {
          const telegramId = String(body.telegramId || '').trim();
          const text = String(body.text || '').trim();
          if (!telegramId || !text) flashError = 'Нужны Telegram id и текст';
          else {
            const state = readState(file);
            const sent = await telegramSend(state.settings.botToken, telegramId, text, net);
            if (!sent.ok) flashError = 'Telegram не принял сообщение';
            else {
              await updateState(file, (cur) =>
                appendSupportMessage(cur, { telegramId, text, direction: 'out', now: Date.now(), via: 'panel' }),
              );
              flashText = 'Ответ отправлен';
            }
          }
          redirectTo = '/admin/';
        }
        if (path === '/admin/support-close') {
          const telegramId = String(body.telegramId || '').trim();
          const state = readState(file);
          const rows = supportThread(state, telegramId);
          const closedAt = Number((state.supportClosed || {})[telegramId] || 0);
          const lastAt = rows.reduce((max, row) => Math.max(max, row.at || 0), 0);
          if (!telegramId || !rows.length || (closedAt && lastAt <= closedAt)) flashError = 'Диалог уже закрыт';
          else {
            const sent = await telegramSend(state.settings.botToken, telegramId, SUPPORT_CLOSED_TEXT, net);
            if (!sent.ok) flashError = 'Telegram не принял сообщение';
            else {
              await updateState(file, (cur) => closeSupportThread(cur, { telegramId, now: Date.now() }));
              flashText = 'Диалог завершён';
            }
          }
          redirectTo = '/admin/';
        }
        if (path === '/admin/message' && flashText.indexOf('отправлено') >= 0) {
          await audit(file, 'message', body.accountId || '');
        }
        if (path === '/admin/support' && flashText) {
          await audit(file, 'support_reply', body.telegramId || '');
        }
        if (path === '/admin/support-close' && flashText) {
          await audit(file, 'support_close', body.telegramId || '');
        }
        if (flashed || flashPromo || flashText || flashError) {
          const sid = cookie(req, 'omp_admin');
          const cur = sessions.get(sid) || admin;
          sessions.set(sid, {
            ...cur,
            flash: flashed,
            flashPromo,
            flashText,
            flashError,
          });
        }
        if (wantsJson(req)) {
          return json(res, 200, {
            ok: !flashError,
            redirect: redirectTo,
            flash: { code: flashed, promo: flashPromo, text: flashText, error: flashError },
          });
        }
        res.writeHead(302, { location: redirectTo });
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
      if (req.method === 'POST' && path === '/v1/link/clear') {
        const body = await readBody(req);
        const deviceId = String(req.headers['x-device-id'] || body.deviceId || '');
        const result = await updateState(file, (state) => unlinkDeviceTelegram(state, { deviceId, now: Date.now() }));
        if (result.error) return json(res, result.error === 'not_linked' ? 404 : 400, result);
        return json(res, 200, result);
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
        const isActive = view ? view.active : active;
        const telegramId = telegramForDevice(account, device);
        return json(res, 200, {
          telegramId,
          linked: !!telegramId,
          paidUntil: view ? view.paidUntil : paidUntil,
          active: isActive,
          deviceLimit: view ? view.deviceLimit : 0,
          devices: view ? view.devices.map((d) => ({ bound: d.bound, deviceId: d.bound ? (d.deviceId || '').slice(0, 8) : '' })) : [],
          sources: {
            jackett: isActive && sourceEnabled(state.settings, 'jackett') && !!state.settings.jackettUrl && !!state.settings.jackettApiKey,
            jacred: isActive && sourceEnabled(state.settings, 'jacred') && !!state.settings.jacredUrl && !!state.settings.jacredApiKey,
          },
        });
      }
      if (req.method === 'POST' && path === '/v1/search') {
        const body = await readBody(req);
        const deviceId = req.headers['x-device-id'] || body.deviceId;
        const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
        const state = readState(file);
        if (!sessionOk(state, { token, deviceId, now: Date.now() })) return json(res, 403, { error: 'expired' });
        const source = body.source === 'jacred' ? 'jacred' : 'jackett';
        if (!sourceEnabled(state.settings, source)) return json(res, 403, { error: 'disabled' });
        const rateKey = String(deviceId || token || '').slice(0, 64);
        if (!searchRate.allow(rateKey)) return json(res, 429, { error: 'rate' });
        const indexer = indexerOf(state.settings, source);
        if (!indexer.url || !indexer.key) return json(res, 403, { error: 'disabled' });
        const q = String(body.q || '');
        const cacheKey = source + '\0' + q.toLowerCase();
        const cached = searchCache.get(cacheKey);
        if (cached !== null) {
          return send(res, 200, cached, { 'content-type': 'application/xml; charset=utf-8' });
        }
        const search = jackettSearchUrl(indexer.url, indexer.key, q);
        const headers = {};
        const auth = basicAuthHeader(state.settings);
        if (auth) headers.Authorization = auth;
        let upstream;
        try {
          upstream = await net(search, { headers });
        } catch (e) {
          return json(res, 502, { error: 'down' });
        }
        if (upstream.status < 200 || upstream.status >= 300) {
          return json(res, 502, { error: 'down' });
        }
        const xml = stripJackett(await upstream.text(), indexer.url, indexer.key, indexer.mark);
        searchCache.set(cacheKey, xml);
        return send(res, 200, xml, { 'content-type': 'application/xml; charset=utf-8' });
      }
      if (req.method === 'POST' && path === '/v1/torrent') {
        const body = await readBody(req);
        const deviceId = req.headers['x-device-id'] || body.deviceId || '';
        const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
        const state = readState(file);
        if (!sessionOk(state, { token, deviceId, now: Date.now() })) return json(res, 403, { error: 'expired' });
        const indexer = indexerByLink(state.settings, body.link);
        if (!sourceEnabled(state.settings, indexer.name)) return json(res, 403, { error: 'disabled' });
        const remote = restoreJackett(body.link, indexer.url, indexer.key, indexer.mark);
        if (!remote) return json(res, 400, { error: 'bad_link' });
        const headers = {};
        const auth = basicAuthHeader(state.settings);
        if (auth) headers.Authorization = auth;
        let upstream;
        try {
          upstream = await net(remote, { headers });
        } catch (e) {
          return json(res, 502, { error: 'down' });
        }
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
          applyPayment(cur, {
            operationId: body.operation_id,
            label: body.label,
            amount: body.amount,
            currency: body.currency,
            now,
          }),
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
  // BILLING_HOST=127.0.0.1 for host+tunnel; 0.0.0.0 inside Docker (Caddy reaches it on the compose network)
  const host = process.env.BILLING_HOST || '0.0.0.0';
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

export async function refreshMissingProfiles(file, token, net) {
  const state = readState(file);
  const missing = (state.accounts || [])
    .filter((a) => a.telegramId && !a.telegramUsername && !a.telegramName)
    .slice(0, 30);
  if (!missing.length) return;
  const found = [];
  for (let i = 0; i < missing.length; i++) {
    try {
      const res = await net(
        'https://api.telegram.org/bot' + token + '/getChat?chat_id=' + encodeURIComponent(missing[i].telegramId),
      );
      const data = await res.json();
      if (!data.ok || !data.result) continue;
      const chat = data.result;
      found.push({
        telegramId: String(missing[i].telegramId),
        username: chat.username || '',
        name: [chat.first_name, chat.last_name].filter(Boolean).join(' '),
      });
    } catch (e) {
      /* one chat can fail; the rest still update */
    }
  }
  const useful = found.filter((row) => row.username || row.name);
  if (!useful.length) return;
  await updateState(file, (latest) => {
    let next = latest;
    for (let i = 0; i < useful.length; i++) next = rememberTelegramProfile(next, useful[i], Date.now()).state;
    return { state: next };
  });
}

export async function pollBot(file, fetchImpl) {
  let offset = 0;
  let sweptAt = 0;
  /** chatId → { kind } waiting for the next free-text reply */
  const awaiting = new Map();
  /** chatId → 'user' | 'admin' — keyboard pad for admins (users always stay on user pad) */
  const pads = new Map();
  const net = fetchImpl || fetch;
  for (;;) {
    try {
      const state = readState(file);
      const token = state.settings.botToken;
      if (!token) {
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }
      if (Date.now() - sweptAt > 10 * 60 * 1000) {
        sweptAt = Date.now();
        await refreshMissingProfiles(file, token, net);
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
        const pad = pads.get(chatId) || null;
        const replyTo = msg.reply_to_message && msg.reply_to_message.message_id ? msg.reply_to_message.message_id : 0;
        const from = msg.from
          ? {
              username: msg.from.username || '',
              firstName: msg.from.first_name || '',
              lastName: msg.from.last_name || '',
            }
          : null;
        const replied = await updateState(file, (cur) => {
          const out = botReply(cur, {
            chatId,
            text: msg.text || '',
            now: Date.now(),
            awaiting: wait,
            replyTo,
            from,
            pad,
          });
          return { state: out.state, result: { messages: out.messages, pad: out.pad } };
        });
        awaiting.delete(chatId);
        if (replied && replied.pad) pads.set(chatId, replied.pad);
        const rows = replied && replied.messages ? replied.messages : replied || [];
        for (let m = 0; m < rows.length; m++) {
          const row = rows[m];
          if (row.await) awaiting.set(chatId, row.await);
          try {
            const sent = await telegramSend(token, row.chatId, row.text, net, {
              keyboard: row.keyboard,
              inline: row.inline,
              parseMode: row.parseMode,
            });
            if (row.supportNotify && sent.messageId) {
              await updateState(file, (cur) => ({
                state: rememberSupportReply(cur, {
                  adminChatId: row.chatId,
                  messageId: sent.messageId,
                  telegramId: row.supportNotify,
                  now: Date.now(),
                }),
              }));
            }
          } catch (e) {
            /* Telegram unreachable from NAS — keep polling */
          }
        }
      }
    } catch (e) {
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

export function dataFile() {
  const fromEnv = process.env.BILLING_DATA;
  if (fromEnv) return resolveDbPath(fromEnv);
  const path = new URL('../data/billing.db', import.meta.url).pathname;
  return path.replace(/^\/([A-Za-z]:)/, '$1');
}

function envServiceDefaults() {
  return {
    jackettUrl: process.env.BILLING_JACKETT_URL || '',
    jacredUrl: process.env.BILLING_JACRED_URL || '',
    torrserverUrl: process.env.BILLING_TORRSERVER_URL || '',
    publicOrigin: process.env.BILLING_PUBLIC_ORIGIN || '',
  };
}

export async function ensureAdmin(file) {
  const state = readState(file);
  const env = envServiceDefaults();
  if (state.settings.adminHash) {
    const need =
      (env.jackettUrl && !state.settings.jackettUrl) ||
      (env.jacredUrl && !state.settings.jacredUrl) ||
      (env.torrserverUrl && !state.settings.torrserverUrl) ||
      (env.publicOrigin && !state.settings.publicOrigin);
    if (need) {
      await updateState(file, (s) => ({
        state: {
          ...s,
          settings: {
            ...s.settings,
            jackettUrl: s.settings.jackettUrl || env.jackettUrl,
            jacredUrl: s.settings.jacredUrl || env.jacredUrl,
            torrserverUrl: s.settings.torrserverUrl || env.torrserverUrl,
            publicOrigin: s.settings.publicOrigin || env.publicOrigin,
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
        jackettUrl: s.settings.jackettUrl || env.jackettUrl,
        jacredUrl: s.settings.jacredUrl || env.jacredUrl,
        torrserverUrl: s.settings.torrserverUrl || env.torrserverUrl,
        publicOrigin: s.settings.publicOrigin || env.publicOrigin,
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
