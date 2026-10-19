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
  createPromos,
  formatCode,
  grantDays,
  issueActivation,
  issueMany,
  pageAudit,
  pageFails,
  pagePayments,
  promosCsv,
  subscriptionsCsv,
  usersCsv,
  logAudit,
  logWebhook,
  codeWithinLimit,
  deviceAccess,
  dueReminders,
  markReminder,
  mskDate,
  mskDateTime,
  releaseReminder,
  subAccess,
  openAppUrl,
  paymentsCsv,
  revokePromo,
  sessionForDevice,
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
  takeCliAdminLogin,
  unbindCode,
  telegramForDevice,
  unlinkDeviceTelegram,
} from './logic.mjs';
import {
  adminNotifyEnabled,
  botDeepLink,
  botReply,
  paymentAdminNotices,
  reminderMessage,
  serviceDownNotices,
  telegramOf,
} from './bot.mjs';
import {
  botPollDisabledLine,
  botPollEnabled,
  botPollSnapshot,
  conflictLogLine,
  isGetUpdatesConflict,
  noteBotPollOk,
  noteGetUpdatesConflict,
} from './botPoll.mjs';
import { codeHash, normalizeCode, randomId } from './crypto.mjs';
import { goPage } from './go.mjs';
import {
  confirmPendingPayment,
  rejectPendingPayment,
  resetSwaps,
  revokeDevice,
  seenDue,
  setDeviceLimit,
  subtractDays,
  touchDevice,
} from './deviceAdmin.mjs';
import {
  basicAuthHeader,
  indexerByLink,
  indexerOf,
  jackettIndexerTimeoutMs,
  jackettSearchDeadlineMs,
  restoreJackett,
  safeTorznabCat,
  searchJackett,
  searchJacRed,
  stripJackett,
} from './jackett.mjs';
import { sendMail } from './mail.mjs';
import { loginPage } from './panel.mjs';
import {
  activateLimitConfig,
  clientIp,
  createActivateLimiter,
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
    const actor = row.via === 'cli'
      ? { kind: 'admin', id: 'cli', label: 'cli' }
      : row.telegramId
        ? { kind: 'admin', id: String(row.telegramId), label: String(row.telegramId) }
        : { kind: 'admin', id: '', label: 'панель' };
    out.push({
      id,
      createdAt: row.createdAt || 0,
      lastSeen: row.lastSeen || row.createdAt || 0,
      exp: row.exp,
      actor,
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
      telegramId: admin.telegramId || '',
      via: admin.via || '',
    });
  }
  return { code, promo, flash, error };
}

function adminActor(admin) {
  if (admin && admin.via === 'cli') return { kind: 'admin', id: 'cli', label: 'cli' };
  const id = admin && admin.telegramId ? String(admin.telegramId) : '';
  if (id) return { kind: 'admin', id, label: id };
  return { kind: 'admin', id: '', label: 'панель' };
}

function audit(file, action, detail, admin) {
  return updateState(file, (state) => ({
    state: logAudit(state, { action, detail, now: Date.now(), actor: adminActor(admin) }),
  }));
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
  // HEAD is routed as GET. Content-Length stays the GET size; the body does not.
  if (res.headOnly) return res.end();
  res.end(buf);
}

function json(res, status, value) {
  send(res, status, JSON.stringify(value), { 'content-type': 'application/json; charset=utf-8' });
}

function headerValue(res, name) {
  const h = res && res.headers;
  if (!h) return '';
  if (typeof h.get === 'function') return String(h.get(name) || '');
  const want = String(name || '').toLowerCase();
  const keys = Object.keys(h);
  for (let i = 0; i < keys.length; i++) {
    if (String(keys[i]).toLowerCase() === want) return String(h[keys[i]] || '');
  }
  return '';
}

/** Indexer id from `/indexers/<id>/` or `/dl/<id>/`. The restored URL is not logged: it carries the API key. */
function indexerLabel(link, fallback) {
  const raw = String(link || '');
  const api = /\/indexers\/([^/?#]+)\//.exec(raw);
  const dl = /\/dl\/([^/?#]+)/.exec(raw);
  const id = (api && api[1]) || (dl && dl[1]) || '';
  if (/^[A-Za-z0-9._~-]{1,80}$/.test(id)) return id;
  return fallback || 'jackett';
}

/**
 * Jackett sometimes answers a download with a redirect to a magnet. Follow one http(s) hop,
 * and stop when Location is a magnet so the phone can add it.
 */
async function fetchDownload(net, url, headers) {
  const first = await net(url, { headers, redirect: 'manual' });
  const status = first.status || 0;
  const loc = headerValue(first, 'location');
  if (status >= 300 && status < 400 && /^magnet:/i.test(loc)) {
    return { kind: 'magnet', magnet: loc, status, res: first };
  }
  if (status >= 300 && status < 400 && /^https?:/i.test(loc)) {
    const second = await net(loc, { headers, redirect: 'manual' });
    const status2 = second.status || 0;
    const loc2 = headerValue(second, 'location');
    if (status2 >= 300 && status2 < 400 && /^magnet:/i.test(loc2)) {
      return { kind: 'magnet', magnet: loc2, status: status2, res: second };
    }
    return { kind: 'file', status: status2, res: second };
  }
  return { kind: 'file', status, res: first };
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

/**
 * BILLING_LINK_CLEAR_REQUIRE_TOKEN=1: /v1/link/clear without a subscription token is refused.
 * Off by default because the current app sends only X-Device-Id there (and a Telegram-only phone has no token).
 */
export function linkClearRequiresToken(env) {
  const raw = String((env && env.BILLING_LINK_CLEAR_REQUIRE_TOKEN) || '')
    .trim()
    .toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes';
}

function bearer(req) {
  return String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
}

function isQuiet(body) {
  const v = body && body.quiet;
  return v === true || v === 1 || v === '1' || v === 'true';
}

async function notifyAdmins(state, messages, fetchImpl) {
  const token = state && state.settings && state.settings.botToken;
  const rows = messages || [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      await telegramSend(token, row.chatId, row.text, fetchImpl, { keyboard: row.keyboard });
    } catch (e) {
      /* one admin chat can fail */
    }
  }
}

function paymentWho(state, result) {
  const subId = result && result.subscriptionId;
  if (!subId) return '';
  const sub = (state.subscriptions || []).find((s) => s.id === subId);
  if (!sub) return '';
  const acc = (state.accounts || []).find((a) => a.id === sub.accountId);
  if (!acc) return '';
  return acc.telegramId || acc.email || acc.id || '';
}

/** Why a session is refused: `device_limit` when only the lapsed extra slot is missing, else `expired`. */
function denyReason(state, token, deviceId) {
  const now = Date.now();
  const row = sessionForDevice(state, { token, deviceId });
  if (!row) return 'expired';
  const sub = state.subscriptions.find((s) => s.id === row.subscriptionId);
  if (sub && subAccess(state, sub, now).access && !codeWithinLimit(state, sub, row, now)) return 'device_limit';
  return 'expired';
}

/** The panel's destructive buttons send confirm=yes after the admin confirmed in the UI. */
function confirmed(body) {
  const v = body && body.confirm;
  return v === true || v === 'yes' || v === '1' || v === 1 || v === 'true';
}

/**
 * lastSeen / lastIp for an authenticated device request. The state is one JSON document, so this
 * writes only when the stored mark is older than SEEN_EVERY_MS; `busy` keeps parallel requests
 * of one device from writing twice. A failure here never fails the request.
 */
async function noteSeen(file, state, codeId, ip, busy, force) {
  if (!codeId || busy.has(codeId)) return;
  const now = Date.now();
  if (!force && !seenDue(state, codeId, now)) return;
  busy.add(codeId);
  try {
    await updateState(file, (cur) => ({ state: touchDevice(cur, { codeId, ip, now, force }) }));
  } catch (e) {
    /* lastSeen is best effort */
  } finally {
    busy.delete(codeId);
  }
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
    text =
      'Доп. устройство подключено до ' +
      mskDate(result.extraUntil) +
      ', дальше продлевается вместе с подпиской.\nКод для нового устройства: `' +
      result.code +
      '`\n' +
      link;
    if (link.indexOf('http') === 0) inline = { inline_keyboard: [[{ text: 'Открыть в OMP', url: link }]] };
  }
  if (result.kind === 'device' && !result.code) {
    text = 'Доп. устройство оплачено до ' + mskDate(result.extraUntil) + '. Нажмите «Код» в боте, чтобы получить код.';
  }
  if (result.kind === 'renew') {
    text = 'Подписка продлена до ' + mskDateTime(result.paidUntil) + '.';
    if (result.extras > 0) text += '\nДоп. устройств: ' + result.extras + ', тоже до ' + mskDate(result.paidUntil) + '.';
  }
  if (!text) return Promise.resolve();
  return telegramSend(state.settings.botToken, chat, text, fetchImpl, { parseMode: 'Markdown', inline });
}

export function createApp(file, fetchImpl, opts) {
  const net = fetchImpl || fetch;
  const env = (opts && opts.env) || process.env;
  const activateLimit = createActivateLimiter(activateLimitConfig(env));
  const strictLinkClear = linkClearRequiresToken(env);
  const seenBusy = new Set();
  return async function handle(req, res) {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const path = url.pathname;
    try {
      // Phone calls are native HTTP. The admin SPA is same-origin.
      // OPTIONS answers 204 with Allow only, so other sites cannot use a browser
      // to call bearer or cookie routes.
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { allow: 'GET, HEAD, POST, OPTIONS' });
        return res.end();
      }
      if (req.method === 'HEAD') {
        res.headOnly = true;
        req.method = 'GET';
      }
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
        return json(res, 200, { ok: true, services, botPoll: botPollSnapshot() });
      }
      if (req.method === 'GET' && path === '/admin/api/reveal') {
        const admin = adminOf(req);
        if (!admin) return json(res, 401, { auth: false });
        const codeId = url.searchParams.get('codeId') || '';
        const state = readState(file);
        const row = (state.codes || []).find((c) => c.id === codeId && !c.revoked && c.plain);
        if (!row) return json(res, 404, { error: 'no_code' });
        await audit(file, 'code_reveal', codeId, admin);
        return json(res, 200, {
          id: row.id,
          plain: row.plain,
          formatted: formatCode(row.plain),
          openUrl: openAppUrl(state.settings.publicOrigin || '', row.plain),
        });
      }
      if (req.method === 'GET' && path === '/admin/api/payments') {
        const admin = adminOf(req);
        if (!admin) return json(res, 401, { auth: false });
        const page = pagePayments(readState(file), {
          q: url.searchParams.get('q') || '',
          from: Number(url.searchParams.get('from')) || 0,
          to: Number(url.searchParams.get('to')) || 0,
          offset: Number(url.searchParams.get('offset')) || 0,
          limit: Number(url.searchParams.get('limit')) || 20,
        });
        return json(res, 200, page);
      }
      if (req.method === 'GET' && path === '/admin/api/audit') {
        const admin = adminOf(req);
        if (!admin) return json(res, 401, { auth: false });
        const page = pageAudit(readState(file), {
          q: url.searchParams.get('q') || '',
          action: url.searchParams.get('action') || '',
          offset: Number(url.searchParams.get('offset')) || 0,
          limit: Number(url.searchParams.get('limit')) || 30,
        });
        return json(res, 200, page);
      }
      if (req.method === 'GET' && path === '/admin/api/fails') {
        const admin = adminOf(req);
        if (!admin) return json(res, 401, { auth: false });
        const page = pageFails(readState(file), {
          reason: url.searchParams.get('reason') || '',
          q: url.searchParams.get('q') || '',
          offset: Number(url.searchParams.get('offset')) || 0,
          limit: Number(url.searchParams.get('limit')) || 30,
        });
        return json(res, 200, page);
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
      if (req.method === 'GET' && (path === '/admin/subscriptions.csv' || path === '/admin/users.csv' || path === '/admin/promos.csv')) {
        const admin = adminOf(req);
        if (!admin) return send(res, 401, 'login required');
        const state = readState(file);
        const now = Date.now();
        const csv =
          path === '/admin/users.csv'
            ? usersCsv(state)
            : path === '/admin/promos.csv'
              ? promosCsv(state)
              : subscriptionsCsv(state, now);
        const name = path === '/admin/users.csv' ? 'omp-users.csv' : path === '/admin/promos.csv' ? 'omp-promos.csv' : 'omp-subscriptions.csv';
        return send(res, 200, csv, {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': 'attachment; filename="' + name + '"',
        });
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
          return json(res, 400, { ok: false, error: 'Сначала укажите Telegram id администраторов в настройках' });
        }
        if (!state.settings.botToken || !state.settings.botUsername) {
          return json(res, 400, { ok: false, error: 'Не задан бот Telegram (токен или username)' });
        }
        const started = await updateState(file, (cur) => startAdminPanelLogin(cur, { now: Date.now() }));
        const deepLink = botDeepLink(state.settings, 'admin_' + started.token);
        await audit(file, 'login_telegram_start', 'запрос');
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
          await audit(file, 'login', 'telegram ' + (taken.telegramId || ''), { telegramId: taken.telegramId || '' });
          res.setHeader('set-cookie', adminSetCookie(req, id));
          return json(res, 200, { ok: true, status: 'ok' });
        }
        return json(res, 200, { ok: false, status: taken.status || 'expired' });
      }
      if (req.method === 'GET' && path === '/admin/login/once') {
        const token = url.searchParams.get('token') || '';
        let taken = { status: 'expired' };
        try {
          taken = await updateState(file, (cur) => takeCliAdminLogin(cur, { token, now: Date.now() }));
        } catch (e) {
          taken = { status: 'expired' };
        }
        if (!taken || taken.status !== 'ok') {
          return send(res, 403, loginPage('Ссылка недействительна или уже использована'), {
            'content-type': 'text/html; charset=utf-8',
          });
        }
        const id = randomId() + randomId();
        const csrf = randomId();
        const now = Date.now();
        sessions.set(id, {
          csrf,
          exp: now + 12 * 60 * 60 * 1000,
          createdAt: now,
          lastSeen: now,
          via: 'cli',
        });
        res.setHeader('set-cookie', adminSetCookie(req, id));
        res.writeHead(302, { location: '/admin/' });
        return res.end();
      }
      if (req.method === 'POST' && path === '/admin/login') {
        try {
          await readBody(req);
        } catch (e) {
          /* a bad body still rejects; it must not 500 */
        }
        try {
          await audit(file, 'login_fail', 'password disabled', null);
        } catch (e) {
          /* audit failure must not turn the rejection into 500 */
        }
        if (wantsJson(req)) {
          return json(res, 403, { ok: false, error: 'Вход по паролю отключён. Войдите через Telegram.' });
        }
        return send(res, 403, loginPage('Вход по паролю отключён. Войдите через Telegram.'), {
          'content-type': 'text/html; charset=utf-8',
        });
      }
      const admin = adminOf(req);
      if (req.method === 'POST' && path.indexOf('/admin/') === 0) {
        const body = await readBody(req);
        if (!admin || body.csrf !== admin.csrf) return send(res, 403, 'forbidden');
        if (path === '/admin/settings' || path === '/admin/services') {
          await updateState(file, (state) => ({
            state: { ...state, settings: mergeSettings(state.settings, body) },
          }));
          await audit(file, path === '/admin/services' ? 'services_save' : 'settings_save', 'ok', admin);
          if (wantsJson(req) && path === '/admin/services') {
            const services = await probeAllServices(readState(file).settings, net);
            return json(res, 200, { ok: true, services, botPoll: botPollSnapshot() });
          }
        }
        let flashed = '';
        let flashPromo = '';
        let flashText = '';
        let flashError = '';
        let redirectTo = '/admin';
        let extra = null;
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
          const days = Number(body.days) || 0;
          const result = await updateState(file, (state) =>
            issueActivation(state, {
              email: body.email,
              telegramId: body.telegramId,
              days,
              now: Date.now(),
            }),
          );
          if (result.error === 'device_limit') {
            flashError =
              'Лимит устройств: привязано ' +
              result.bound +
              ' из ' +
              result.deviceLimit +
              ', свободного кода нет. Отвяжите устройство или купите доп. устройство.';
            if (result.account && result.account.id) redirectTo = '/admin/?id=' + encodeURIComponent(result.account.id);
          } else if (result.error || !result.code) flashError = 'Не удалось выдать код';
          else {
            flashed = result.code;
            const until = mskDate(result.paidUntil);
            flashText = result.created
              ? 'Новая подписка на ' + result.days + ' дн. до ' + until
              : result.reused
                ? 'Свободный код подписки до ' + until + ' (новый слот не создан)'
                : 'Код добавлен к подписке до ' + until;
            const fresh = readState(file);
            const text =
              'Код подписки OMP: ' +
              result.code +
              '\nПодписка до ' +
              until +
              '.\nВведите его в OMP на телефоне. На другом устройстве он не сработает.';
            if (body.channel === 'telegram' && result.account.telegramId) {
              await telegramSend(fresh.settings.botToken, result.account.telegramId, text, net);
            }
            if (body.channel === 'email' && result.account.email) {
              await sendMail(fresh.settings, { to: result.account.email, subject: 'Код подписки OMP', text });
            }
            await audit(file, 'issue', (result.account && result.account.id) || '', admin);
            if (result.account && result.account.id) redirectTo = '/admin/?id=' + encodeURIComponent(result.account.id);
          }
        }
        if (path === '/admin/issue-bulk') {
          const result = await updateState(file, (state) =>
            issueMany(state, { count: body.count, days: Number(body.days) || 0, now: Date.now() }),
          );
          extra = { codes: result.codes || [] };
          flashText = 'Выдано кодов: ' + ((result.codes && result.codes.length) || 0);
          await audit(file, 'bulk_issue', String((result.codes && result.codes.length) || 0), admin);
          redirectTo = '/admin/?tab=subs';
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
            flashText = 'Выдано +' + result.days + ' дн. до ' + mskDate(result.paidUntil);
            if (result.limitReached) flashText += '. Лимит устройств достигнут, новый код не выдан';
            const fresh = readState(file);
            const acc = fresh.accounts.find((a) => a.id === result.accountId);
            if (acc && acc.telegramId && !result.code && result.limitReached) {
              await telegramSend(
                fresh.settings.botToken,
                acc.telegramId,
                'Админ выдал +' + result.days + ' дн. Подписка до ' + mskDate(result.paidUntil) + '.',
                net,
              );
            }
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
              if (!isQuiet(body)) flashText = 'Сообщение отправлено';
            } else flashError = 'Telegram не принял сообщение';
          }
          if (!isQuiet(body) && body.accountId) redirectTo = '/admin/?id=' + encodeURIComponent(body.accountId);
        }
        if (path === '/admin/promo') {
          const count = Number(body.count) || 1;
          const result = await updateState(file, (state) =>
            count > 1
              ? createPromos(state, {
                  count,
                  days: Number(body.days) || 1,
                  maxUses: Number(body.maxUses) || 1,
                  now: Date.now(),
                })
              : createPromo(state, {
                  code: body.code,
                  days: Number(body.days) || 1,
                  maxUses: Number(body.maxUses) || 1,
                  now: Date.now(),
                }),
          );
          if (result.error && !(result.promos && result.promos.length)) flashError = 'Не удалось создать промокод';
          else if (result.promos) {
            extra = { promos: result.promos.map((p) => ({ code: p.code, days: p.days, maxUses: p.maxUses })) };
            flashText = 'Создано промокодов: ' + result.promos.length;
            await audit(file, 'bulk_promo', String(result.promos.length), admin);
          } else if (result.promo) flashPromo = result.promo.code;
          redirectTo = '/admin/?tab=promos';
        }
        if (path === '/admin/promo-revoke') {
          await updateState(file, (state) => ({ state: revokePromo(state, body.promoId || '') }));
          flashText = 'Промокод отозван';
          redirectTo = '/admin/?tab=promos';
        }
        if (path === '/admin/unbind') {
          await updateState(file, (state) => ({
            state: logAudit(unbindCode(state, body.codeId || ''), {
              action: 'unbind',
              detail: body.codeId || '',
              now: Date.now(),
              actor: adminActor(admin),
            }),
          }));
          flashText = 'Устройство сброшено, выдан новый код';
          if (body.accountId) redirectTo = '/admin/?id=' + encodeURIComponent(body.accountId);
        }
        if (path === '/admin/device-revoke') {
          if (!confirmed(body)) flashError = 'Нужно подтверждение';
          else {
            const out = await updateState(file, (state) =>
              revokeDevice(state, { accountId: body.accountId || '', codeId: body.codeId || '', now: Date.now(), actor: adminActor(admin) }),
            );
            if (out.error === 'not_bound') flashError = 'Устройство уже отвязано';
            else if (out.error) flashError = 'Устройство не найдено';
            else flashText = 'Устройство ' + out.device + '… отозвано: токен больше не действует, для слота выпущен новый код';
          }
          if (body.accountId) redirectTo = '/admin/?id=' + encodeURIComponent(body.accountId);
        }
        if (path === '/admin/limit') {
          const out = await updateState(file, (state) =>
            setDeviceLimit(state, {
              accountId: body.accountId || '',
              deviceLimit: body.deviceLimit,
              extraSlots: body.extraSlots,
              now: Date.now(),
              actor: adminActor(admin),
            }),
          );
          if (out.error === 'no_subscription') flashError = 'Нет подписки';
          else if (out.error) flashError = 'Лимит: целое число от 1, доп. устройства от 0 (не больше 20)';
          else if (out.unchanged) flashText = 'Лимит не изменился';
          else flashText = 'Лимит устройств: ' + out.total + (out.extraSlots ? ' (' + out.deviceLimit + ' + ' + out.extraSlots + ' доп.)' : '');
          if (body.accountId) redirectTo = '/admin/?id=' + encodeURIComponent(body.accountId);
        }
        if (path === '/admin/subtract') {
          if (!confirmed(body)) flashError = 'Нужно подтверждение';
          else {
            const out = await updateState(file, (state) =>
              subtractDays(state, { accountId: body.accountId || '', days: body.days, now: Date.now(), actor: adminActor(admin) }),
            );
            if (out.error === 'no_subscription') flashError = 'Нет подписки';
            else if (out.error) flashError = 'Дней: целое число от 1 до 3650';
            else flashText = 'Убавлено ' + out.days + ' дн., подписка до ' + mskDateTime(out.paidUntil);
          }
          if (body.accountId) redirectTo = '/admin/?id=' + encodeURIComponent(body.accountId);
        }
        if (path === '/admin/swaps-reset') {
          const out = await updateState(file, (state) =>
            resetSwaps(state, { accountId: body.accountId || '', now: Date.now(), actor: adminActor(admin) }),
          );
          if (out.error) flashError = 'Нет подписки';
          else flashText = 'Счётчик смен устройства сброшен';
          if (body.accountId) redirectTo = '/admin/?id=' + encodeURIComponent(body.accountId);
        }
        if (path === '/admin/payment-confirm' || path === '/admin/payment-reject') {
          const confirm = path === '/admin/payment-confirm';
          if (!confirmed(body)) flashError = 'Нужно подтверждение';
          else {
            const args = { operationId: body.operationId || '', now: Date.now(), actor: adminActor(admin) };
            const out = await updateState(file, (state) => (confirm ? confirmPendingPayment(state, args) : rejectPendingPayment(state, args)));
            if (out.error === 'already') flashError = 'Платёж уже обработан';
            else if (out.error === 'not_found') flashError = 'Платёж не найден';
            else if (!confirm) flashText = 'Платёж отклонён';
            else if (out.error) flashError = 'Платёж снят с ожидания, но не применён: ' + out.error;
            else {
              flashText = out.kind === 'renew' ? 'Платёж подтверждён: подписка до ' + mskDateTime(out.paidUntil) : 'Платёж подтверждён';
              try {
                await tellPayment(readState(file), out, net);
              } catch (e) {
                /* the payment is applied; the Telegram notice is best effort */
              }
            }
            if (body.accountId) redirectTo = '/admin/?id=' + encodeURIComponent(body.accountId);
            else redirectTo = '/admin/?tab=finance';
          }
        }
        if (path === '/admin/password') {
          flashError = 'Вход по паролю отключён';
          redirectTo = '/admin/?tab=security';
        }
        if (path === '/admin/logout') {
          const sid = cookie(req, 'omp_admin');
          sessions.delete(sid);
          await audit(file, 'logout', 'ok', admin);
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
            await audit(file, 'session_revoke', 'ok', admin);
            flashText = 'Сессия завершена';
          }
          redirectTo = '/admin#security';
        }
        if (path === '/admin/grant' && !flashError && flashText) {
          await audit(file, 'grant', (body.accountId || '') + ' ' + flashText, admin);
        }
        if (path === '/admin/promo' && flashPromo) {
          await audit(file, 'promo_create', flashPromo, admin);
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
          await audit(file, 'message', body.accountId || '', admin);
        }
        if (path === '/admin/support' && flashText) {
          await audit(file, 'support_reply', body.telegramId || '', admin);
        }
        if (path === '/admin/support-close' && flashText) {
          await audit(file, 'support_close', body.telegramId || '', admin);
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
            extra,
          });
        }
        res.writeHead(302, { location: redirectTo });
        return res.end();
      }
      if (req.method === 'POST' && path === '/v1/activate') {
        const body = await readBody(req);
        const plain = normalizeCode(body.code);
        const wait = activateLimit.check(clientIp(req), plain.length === 8 ? codeHash(plain) : '');
        if (wait) {
          res.setHeader('retry-after', String(wait));
          return json(res, 429, { error: 'rate' });
        }
        const result = await updateState(file, (state) => activate(state, { code: body.code, deviceId: body.deviceId, now: Date.now() }));
        // device_limit is 409 like other_device: the current app then says the code is tied to another device.
        if (result.error) return json(res, result.error === 'other_device' || result.error === 'device_limit' ? 409 : 403, result);
        await noteSeen(file, null, result.codeId, clientIp(req), seenBusy, true);
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
        const token = bearer(req);
        // A token that is sent must belong to this device. A paid-up session is not needed to unlink,
        // so an expired subscription still matches on the session itself.
        if (token && !sessionForDevice(readState(file), { token, deviceId })) return json(res, 401, { error: 'bad_token' });
        if (!token && strictLinkClear) return json(res, 401, { error: 'token_required' });
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
        if (token) {
          // The token only has to belong to this device: an expired or over-limit phone still learns its status.
          const row = sessionForDevice(state, { token, deviceId: device });
          const own = row ? state.subscriptions.find((s) => s.id === row.subscriptionId) : null;
          if (row) await noteSeen(file, state, row.id, clientIp(req), seenBusy, false);
          if (own) {
            account = state.accounts.find((a) => a.id === own.accountId) || null;
            paidUntil = own.paidUntil;
          }
        }
        const viaToken = !!account;
        if (!account) account = accountByDevice(state, device);
        if (!account) return json(res, 404, { error: 'not_linked' });
        const view = subscriptionView(state, account.id, now);
        // A bound phone over the current device limit (an extra slot was not renewed) has no access.
        const mine = deviceAccess(state, device, now);
        const overLimit = !!(mine && mine.overLimit && view && mine.subscription.id === view.id);
        const isActive = (view ? view.active : false) && !overLimit;
        const telegramId = telegramForDevice(account, device);
        return json(res, 200, {
          telegramId,
          linked: !!telegramId,
          paidUntil: view ? view.paidUntil : paidUntil,
          active: isActive,
          inGrace: !!(view && view.inGrace) && !overLimit,
          accessUntil: view ? view.accessUntil : 0,
          overLimit,
          deviceLimit: view ? view.deviceLimit : 0,
          extraSlots: view ? view.extraSlots : 0,
          extraUntil: view ? view.extraUntil : 0,
          // Other devices' ids only go to a caller with a valid token; a bare deviceId gets the count via deviceLimit only.
          devices:
            view && viaToken ? view.devices.map((d) => ({ bound: d.bound, deviceId: d.bound ? (d.deviceId || '').slice(0, 8) : '' })) : [],
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
        const session = sessionOk(state, { token, deviceId, now: Date.now() });
        if (!session) return json(res, 403, { error: denyReason(state, token, deviceId) });
        await noteSeen(file, state, session.code.id, clientIp(req), seenBusy, false);
        const source = body.source === 'jacred' ? 'jacred' : 'jackett';
        if (!sourceEnabled(state.settings, source)) return json(res, 403, { error: 'disabled' });
        const rateKey = String(deviceId || token || '').slice(0, 64);
        if (!searchRate.allow(rateKey)) return json(res, 429, { error: 'rate' });
        const indexer = indexerOf(state.settings, source);
        if (!indexer.url || !indexer.key) return json(res, 403, { error: 'disabled' });
        const q = String(body.q || '');
        const cat = safeTorznabCat(body.cat);
        const cacheKey = source + '\0' + q.toLowerCase() + '\0' + cat;
        const cached = searchCache.get(cacheKey);
        if (cached !== null) {
          return send(res, 200, cached, { 'content-type': 'application/xml; charset=utf-8' });
        }
        const headers = {};
        const auth = basicAuthHeader(state.settings);
        if (auth) headers.Authorization = auth;
        // One slow indexer on /indexers/all/results used to run past the phone's 25s limit.
        // Jackett is queried per configured indexer; JacRed stays on the aggregate route.
        if (source === 'jackett') {
          const found = await searchJackett({
            origin: indexer.url,
            apiKey: indexer.key,
            query: q,
            cat,
            headers,
            fetchImpl: net,
            indexerTimeoutMs: jackettIndexerTimeoutMs(),
            deadlineMs: jackettSearchDeadlineMs(),
          });
          if (!found.ok) return json(res, 502, { error: 'down' });
          const xml = stripJackett(found.xml, indexer.url, indexer.key, indexer.mark);
          searchCache.set(cacheKey, xml);
          return send(res, 200, xml, { 'content-type': 'application/xml; charset=utf-8' });
        }
        const found = await searchJacRed({
          origin: indexer.url,
          apiKey: indexer.key,
          query: q,
          cat,
          headers,
          fetchImpl: net,
        });
        if (!found.ok) return json(res, 502, { error: 'down' });
        const xml = stripJackett(found.xml, indexer.url, indexer.key, indexer.mark);
        searchCache.set(cacheKey, xml);
        return send(res, 200, xml, { 'content-type': 'application/xml; charset=utf-8' });
      }
      if (req.method === 'POST' && path === '/v1/torrent') {
        const body = await readBody(req);
        const deviceId = req.headers['x-device-id'] || body.deviceId || '';
        const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
        const state = readState(file);
        const session = sessionOk(state, { token, deviceId, now: Date.now() });
        if (!session) return json(res, 403, { error: denyReason(state, token, deviceId) });
        await noteSeen(file, state, session.code.id, clientIp(req), seenBusy, false);
        const indexer = indexerByLink(state.settings, body.link);
        if (!sourceEnabled(state.settings, indexer.name)) return json(res, 403, { error: 'disabled' });
        const remote = restoreJackett(body.link, indexer.url, indexer.key, indexer.mark);
        if (!remote) return json(res, 400, { error: 'bad_link' });
        const headers = {};
        const auth = basicAuthHeader(state.settings);
        if (auth) headers.Authorization = auth;
        const label = indexerLabel(body.link, indexer.name);
        let upstream;
        try {
          upstream = await fetchDownload(net, remote, headers);
        } catch (e) {
          process.stderr.write('torrent upstream status=down indexer=' + label + '\n');
          return json(res, 502, { error: 'down' });
        }
        process.stderr.write('torrent upstream status=' + upstream.status + ' indexer=' + label + ' kind=' + upstream.kind + '\n');
        if (upstream.kind === 'magnet') return json(res, 200, { magnet: upstream.magnet });
        // A 401/403 here is Jackett or JacRed rejecting the download, not an expired phone session.
        // The app reads 401/403 as «Подписка закончилась»; 502 upstream is «не отдал файл раздачи».
        if (upstream.status === 401 || upstream.status === 403) return json(res, 502, { error: 'upstream' });
        const buf = Buffer.from(await upstream.res.arrayBuffer());
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
          process.stderr.write('yoomoney bad signature\n');
          return send(res, 400, 'bad signature');
        }
        const applied = await updateState(file, (cur) =>
          applyPayment(cur, {
            operationId: body.operation_id,
            label: body.label,
            amount: body.amount,
            currency: body.currency,
            unaccepted: body.unaccepted,
            now,
          }),
        );
        const freshPay = readState(file);
        if (!applied.duplicate && !applied.error) await tellPayment(freshPay, applied, net);
        if (!applied.duplicate && adminNotifyEnabled(freshPay.settings)) {
          await notifyAdmins(
            freshPay,
            paymentAdminNotices(freshPay.settings, {
              ok: !applied.error,
              pending: !!applied.pending,
              amount: body.amount,
              label: body.label,
              error: applied.error || '',
              who: paymentWho(freshPay, applied),
            }),
            net,
          );
        }
        return send(res, 200, 'ok');
      }
      return send(res, 404, 'not found');
    } catch (e) {
      return json(res, 500, { error: 'down' });
    }
  };
}

export function listen(file, port, fetchImpl, opts) {
  // One app for the whole process: the /v1/activate limiter lives inside createApp and
  // must keep its counters between requests. State is still read from the store per request.
  const app = createApp(file, fetchImpl, opts);
  const server = createServer(app);
  // BILLING_HOST=127.0.0.1 for host+tunnel; 0.0.0.0 inside Docker (Caddy reaches it on the compose network)
  const host = (opts && opts.host) || process.env.BILLING_HOST || '0.0.0.0';
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

export async function pollBot(file, fetchImpl, opts) {
  if (!botPollEnabled()) {
    process.stderr.write(botPollDisabledLine());
    return;
  }
  let offset = 0;
  let sweptAt = 0;
  let servicesAt = 0;
  let serviceSnap = {};
  /** chatId → { kind } waiting for the next free-text reply */
  const awaiting = new Map();
  /** chatId → 'user' | 'admin' — keyboard pad for admins (users always stay on user pad) */
  const pads = new Map();
  const net = fetchImpl || fetch;
  const sleep = (opts && opts.sleep) || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const nowFn = (opts && opts.now) || (() => Date.now());
  const maxLoops = opts && opts.maxLoops ? opts.maxLoops : 0;
  let loops = 0;
  for (;;) {
    if (maxLoops && loops >= maxLoops) return;
    loops += 1;
    try {
      const state = readState(file);
      const token = state.settings.botToken;
      if (!token) {
        await sleep(5000);
        continue;
      }
      if (Date.now() - sweptAt > 10 * 60 * 1000) {
        sweptAt = Date.now();
        await refreshMissingProfiles(file, token, net);
      }
      if (Date.now() - servicesAt > 5 * 60 * 1000 && adminNotifyEnabled(state.settings)) {
        servicesAt = Date.now();
        try {
          const probes = await probeAllServices(state.settings, net);
          const notes = serviceDownNotices(state.settings, probes, serviceSnap);
          serviceSnap = notes.snapshot;
          await notifyAdmins(state, notes.messages, net);
        } catch (e) {
          /* probe failure must not stop the bot loop */
        }
      }
      let updates = [];
      try {
        const res = await net('https://api.telegram.org/bot' + token + '/getUpdates?timeout=25&offset=' + offset);
        const data = await res.json();
        if (isGetUpdatesConflict(res, data)) {
          const noted = noteGetUpdatesConflict(state.settings, nowFn());
          if (noted.log) process.stderr.write(conflictLogLine());
          if (noted.messages.length) await notifyAdmins(state, noted.messages, net);
          await sleep(5000);
          continue;
        }
        if (!data || !data.ok) {
          await sleep(5000);
          continue;
        }
        noteBotPollOk(nowFn());
        updates = Array.isArray(data.result) ? data.result : [];
      } catch (e) {
        await sleep(5000);
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
      await sleep(5000);
    }
  }
}

/**
 * Claim the reminders due at `now` (marked before sending, so a second tick or a restart does not
 * repeat them), send them, and free a claim that Telegram did not take (retried up to REMINDER_TRIES).
 * @returns {Promise<{ sent: number, failed: number }>}
 */
export async function runReminders(file, fetchImpl, now) {
  const net = fetchImpl || fetch;
  const at = now || Date.now();
  const claimed = await updateState(file, (state) => {
    if (!state.settings.botToken) return { state, result: { rows: [], messages: [], token: '' } };
    const rows = dueReminders(state, at);
    let next = state;
    const messages = [];
    for (let i = 0; i < rows.length; i++) {
      messages.push(reminderMessage(state, rows[i], at));
      next = markReminder(next, { ...rows[i], now: at });
    }
    return { state: next, result: { rows, messages, token: state.settings.botToken } };
  });
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < claimed.rows.length; i++) {
    const row = claimed.rows[i];
    const msg = claimed.messages[i];
    let ok = false;
    try {
      const out = await telegramSend(claimed.token, msg.chatId, msg.text, net, { inline: msg.inline, keyboard: msg.keyboard });
      ok = out.ok;
    } catch (e) {
      ok = false;
    }
    if (ok) {
      sent += 1;
      process.stderr.write('reminder sent kind=' + row.kind + '\n');
    } else {
      failed += 1;
      process.stderr.write('reminder failed kind=' + row.kind + '\n');
      await updateState(file, (state) => ({ state: releaseReminder(state, row) }));
    }
  }
  return { sent, failed };
}

export const REMINDER_EVERY_MS = 10 * 60 * 1000;

/**
 * In-process reminder timer. Only the instance that polls the bot (BILLING_BOT_POLL on) sends,
 * so a standby copy of the server never duplicates a reminder. Returns a stop function.
 */
export function startReminders(file, fetchImpl, opts) {
  const env = (opts && opts.env) || process.env;
  if (!botPollEnabled(env)) {
    process.stderr.write('subscription reminders off: BILLING_BOT_POLL=0 on this instance\n');
    return () => {};
  }
  const every = (opts && opts.everyMs) || REMINDER_EVERY_MS;
  const clock = (opts && opts.now) || (() => Date.now());
  let busy = false;
  const tick = () => {
    if (busy) return;
    busy = true;
    runReminders(file, fetchImpl, clock())
      .catch(() => {
        /* a failed tick must not stop the timer */
      })
      .then(() => {
        busy = false;
      });
  };
  const first = setTimeout(tick, (opts && opts.firstMs) || 30 * 1000);
  const timer = setInterval(tick, every);
  if (first.unref) first.unref();
  if (timer.unref) timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
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

/** Copy service URLs from the environment. Admin passwords are not created or printed. */
export async function ensureAdmin(file) {
  const state = readState(file);
  const env = envServiceDefaults();
  const need =
    (env.jackettUrl && !state.settings.jackettUrl) ||
    (env.jacredUrl && !state.settings.jacredUrl) ||
    (env.torrserverUrl && !state.settings.torrserverUrl) ||
    (env.publicOrigin && !state.settings.publicOrigin);
  if (!need) return;
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

const started = process.argv[1] && process.argv[1].endsWith('server.mjs');
if (started) {
  const file = dataFile();
  const port = Number(process.env.PORT || 8787);
  ensureAdmin(file).then(() => listen(file, port)).then(() => {
    process.stdout.write('billing listening on ' + port + '\n');
  });
  pollBot(file);
  startReminders(file);
}
