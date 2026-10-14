import { createServer } from 'node:http';
import { activate, applyPayment, createSubscription, openAccount, sessionOk, unbindCode } from './logic.mjs';
import { botReply, telegramOf } from './bot.mjs';
import { hashPassword, passwordMatches, randomCode, randomId } from './crypto.mjs';
import { jackettSearchUrl, restoreJackett, stripJackett } from './jackett.mjs';
import { sendMail } from './mail.mjs';
import { homePage, loginPage } from './panel.mjs';
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

async function telegramSend(token, chatId, text, fetchImpl) {
  if (!token || !chatId) return false;
  const res = await fetchImpl('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  return res.ok;
}

function tellPayment(state, result, fetchImpl) {
  const accountId = result.subscriptionId
    ? (state.subscriptions.find((s) => s.id === result.subscriptionId) || {}).accountId
    : '';
  const chat = telegramOf(state, accountId);
  if (!chat) return Promise.resolve();
  let text = '';
  if (result.kind === 'new' && result.code) text = 'Код Jackett OMP: ' + result.code + '\nВведите его в OMP на телефоне. На другом устройстве он не сработает.';
  if (result.kind === 'device' && result.code) text = 'Код для нового устройства: ' + result.code;
  if (result.kind === 'renew') text = 'Подписка продлена до ' + new Date(result.paidUntil).toISOString().slice(0, 10);
  if (!text) return Promise.resolve();
  return telegramSend(state.settings.botToken, chat, text, fetchImpl);
}

export function createApp(file, fetchImpl) {
  const net = fetchImpl || fetch;
  return async function handle(req, res) {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const path = url.pathname;
    try {
      if (req.method === 'GET' && path === '/health') return json(res, 200, { ok: true });
      if (req.method === 'GET' && (path === '/admin' || path === '/admin/')) {
        const admin = adminOf(req);
        if (!admin) return send(res, 200, loginPage(''), { 'content-type': 'text/html; charset=utf-8' });
        const code = admin.flash || '';
        if (code) sessions.set(cookie(req, 'omp_admin'), { csrf: admin.csrf, exp: admin.exp });
        return send(res, 200, homePage(readState(file), { csrf: admin.csrf, code }), { 'content-type': 'text/html; charset=utf-8' });
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
        }
        if (path === '/admin/unbind') {
          await updateState(file, (state) => ({ state: unbindCode(state, body.codeId || '') }));
        }
        res.writeHead(302, { location: '/admin' });
        if (flashed) sessions.set(cookie(req, 'omp_admin'), { ...admin, flash: flashed });
        return res.end();
      }
      if (req.method === 'POST' && path === '/v1/activate') {
        const body = await readBody(req);
        const result = await updateState(file, (state) => activate(state, { code: body.code, deviceId: body.deviceId, now: Date.now() }));
        if (result.error) return json(res, result.error === 'other_device' ? 409 : 403, result);
        return json(res, 200, { token: result.token, paidUntil: result.paidUntil });
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
        if (!notificationOk(body, state.settings.yoomoneySecret)) return send(res, 400, 'bad signature');
        const applied = await updateState(file, (cur) =>
          applyPayment(cur, { operationId: body.operation_id, label: body.label, amount: body.amount, now: Date.now() }),
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
      const replied = await updateState(file, (cur) => {
        const out = botReply(cur, { chatId: msg.chat.id, text: msg.text || '', now: Date.now() });
        return { state: out.state, result: out.messages };
      });
      for (let m = 0; m < replied.length; m++) await telegramSend(token, replied[m].chatId, replied[m].text, net);
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
  if (state.settings.adminHash) {
    if (jackettUrl && !state.settings.jackettUrl) {
      await updateState(file, (s) => ({ state: { ...s, settings: { ...s.settings, jackettUrl } } }));
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
