import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { botReply } from '../src/bot.mjs';
import { restoreJackett, stripJackett } from '../src/jackett.mjs';
import {
  createRateLimit,
  createSearchCache,
  keepSecret,
  mergeSettings,
  publicAdminSettings,
  SECRET_MASK,
  sourceEnabled,
} from '../src/services.mjs';
import {
  accountCard,
  activate,
  adminDashboard,
  adminFind,
  applyPayment,
  ensureTelegramAccount,
  paymentCovers,
  confirmDeviceLink,
  createPromo,
  createSubscription,
  financeReport,
  grantDays,
  logAudit,
  openAccount,
  openAppUrl,
  paymentsCsv,
  usersCsv,
  redeemPromo,
  rememberSupportReply,
  rememberTelegramProfile,
  closeSupportThread,
  startAdminPanelLogin,
  startDeviceLink,
  supportThreads,
  takeAdminPanelLogin,
  telegramDisplay,
  quotePurchase,
  telegramForDevice,
  unlinkDeviceTelegram,
} from '../src/logic.mjs';
import { emptyState, readState, resolveDbPath, updateState, writeState } from '../src/store.mjs';
import { notificationHash, notificationOk } from '../src/yoomoney.mjs';

const NOW = Date.parse('2026-10-14T12:00:00Z');

function paid() {
  const opened = openAccount(emptyState(), { telegramId: '42', email: '', now: NOW });
  const created = createSubscription(opened.state, { accountId: opened.account.id, now: NOW, days: 30 });
  return { state: created.state, code: created.result.code, sub: created.result.subscriptionId, account: opened.account.id };
}

describe('subscription codes', () => {
  it('binds the first device and refuses the second', () => {
    const start = paid();
    const first = activate(start.state, { code: start.code, deviceId: 'a'.repeat(32), now: NOW });
    expect(first.result.token).toBeTruthy();
    const again = activate(first.state, { code: start.code, deviceId: 'a'.repeat(32), now: NOW });
    expect(again.result.token).toBeTruthy();
    const other = activate(first.state, { code: start.code, deviceId: 'b'.repeat(32), now: NOW });
    expect(other.result.error).toBe('other_device');
    expect(other.state.attempts.some((a: { reason: string }) => a.reason === 'other_device')).toBe(true);
  });

  it('a second payment for the same account extends the subscription', () => {
    const start = paid();
    start.state.settings.priceRub = 100;
    const applied = applyPayment(start.state, {
      operationId: 'op1',
      label: 'new:' + start.account,
      amount: '100.00',
      currency: '643',
      now: NOW + 1000,
    });
    expect(applied.result.kind).toBe('renew');
    expect(applied.result.paidUntil).toBeGreaterThan(NOW + 30 * 24 * 60 * 60 * 1000);
  });

  it('an extra-device payment issues a new code', () => {
    const start = paid();
    start.state.settings.extraDeviceRub = 50;
    const applied = applyPayment(start.state, {
      operationId: 'op2',
      label: 'dev:' + start.sub,
      amount: '50.00',
      currency: '643',
      now: NOW,
    });
    expect(applied.result.kind).toBe('device');
    expect(applied.result.code).not.toBe(start.code);
    const bound = activate(applied.state, { code: applied.result.code, deviceId: 'c'.repeat(32), now: NOW });
    expect(bound.result.error).toBeUndefined();
  });
});

describe('YooMoney', () => {
  it('checks the notification signature', () => {
    const fields = {
      notification_type: 'p2p-incoming',
      operation_id: '1',
      amount: '100.00',
      currency: '643',
      datetime: '2026-10-14T12:00:00Z',
      sender: '41001',
      codepro: 'false',
      label: 'sub:abc',
      sha1_hash: '',
    };
    fields.sha1_hash = notificationHash(fields, 'secret');
    expect(notificationOk(fields, 'secret')).toBe(true);
    expect(notificationOk({ ...fields, amount: '1.00' }, 'secret')).toBe(false);
    expect(notificationOk({ ...fields, codepro: 'true' }, 'secret')).toBe(false);
  });
});

describe('Jackett proxy', () => {
  it('strips the key and the origin, then restores the download', () => {
    const xml = '<enclosure url="http://127.0.0.1:9117/dl/a?apikey=SECRET" /> SECRET';
    const clean = stripJackett(xml, 'http://127.0.0.1:9117', 'SECRET');
    expect(clean).not.toContain('SECRET');
    expect(clean).not.toContain('127.0.0.1:9117');
    expect(clean).toContain('omp-fetch:/dl/a?');
    const back = restoreJackett('omp-fetch:/dl/a', 'http://127.0.0.1:9117', 'SECRET');
    expect(back).toBe('http://127.0.0.1:9117/dl/a?apikey=SECRET');
  });

  it('keeps a JacRed download on the JacRed origin', () => {
    const xml = '<enclosure url="http://127.0.0.1:9118/dl/b?apikey=OTHER" />';
    const clean = stripJackett(xml, 'http://127.0.0.1:9118', 'OTHER', 'omp-jacred:');
    expect(clean).not.toContain('OTHER');
    expect(clean).toContain('omp-jacred:/dl/b?');
    const back = restoreJackett('omp-jacred:/dl/b', 'http://127.0.0.1:9118', 'OTHER', 'omp-jacred:');
    expect(back).toBe('http://127.0.0.1:9118/dl/b?apikey=OTHER');
    expect(restoreJackett('omp-jacred:/dl/b', 'http://127.0.0.1:9117', 'SECRET')).toBe('');
  });

  it('rejects absolute URLs and path traversal in the download link', () => {
    expect(restoreJackett('omp-fetch://evil.example/x', 'http://127.0.0.1:9117', 'SECRET')).toBe('');
    expect(restoreJackett('omp-fetch:http://evil.example/x', 'http://127.0.0.1:9117', 'SECRET')).toBe('');
    expect(restoreJackett('omp-fetch:/api/../admin', 'http://127.0.0.1:9117', 'SECRET')).toBe('');
    expect(restoreJackett('omp-fetch:/dl\\a', 'http://127.0.0.1:9117', 'SECRET')).toBe('');
  });

  it('restores a download and refuses a search through the torrent route', () => {
    const search = 'omp-fetch:/api/v2.0/indexers/all/results/torznab/api?t=search&q=film';
    expect(restoreJackett(search, 'http://127.0.0.1:9117', 'SECRET')).toBe('');
    expect(restoreJackett('omp-fetch:/api/v2.0/indexers/all/results/torznab/download', 'http://127.0.0.1:9117', 'SECRET')).toBe('');
    expect(restoreJackett('omp-fetch:/dl/%2e%2e/admin', 'http://127.0.0.1:9117', 'SECRET')).toBe('');
    const download = restoreJackett(
      'omp-fetch:/api/v2.0/indexers/rutor/results/torznab/download?id=1',
      'http://127.0.0.1:9117',
      'SECRET',
    );
    expect(download).toBe(
      'http://127.0.0.1:9117/api/v2.0/indexers/rutor/results/torznab/download?id=1&apikey=SECRET',
    );
  });

  it('restores a download when the indexer URL has a path prefix', () => {
    const xml = '<enclosure url="https://host/jackett/dl/a?apikey=SECRET" />';
    const clean = stripJackett(xml, 'https://host/jackett', 'SECRET');
    expect(clean).toContain('omp-fetch:/dl/a?');
    expect(clean).not.toContain('/jackett');
    const back = restoreJackett('omp-fetch:/dl/a', 'https://host/jackett', 'SECRET');
    expect(back).toBe('https://host/jackett/dl/a?apikey=SECRET');
    const api = restoreJackett(
      'omp-fetch:/api/v2.0/indexers/rutor/results/torznab/download?id=1',
      'https://host/jackett',
      'SECRET',
    );
    expect(api).toBe('https://host/jackett/api/v2.0/indexers/rutor/results/torznab/download?id=1&apikey=SECRET');
    const search = 'omp-fetch:/api/v2.0/indexers/all/results/torznab/api?t=search&q=film';
    expect(restoreJackett(search, 'https://host/jackett', 'SECRET')).toBe('');
    expect(restoreJackett('omp-fetch:/%2e%2e/dl/a', 'https://host/jackett', 'SECRET')).toBe('');
  });
});

describe('bot', () => {
  it('shows the pay link from the Подписка button and attaches the cabinet keyboard', () => {
    const state = emptyState();
    state.settings.yoomoneyWallet = '41001';
    state.settings.priceRub = 100;
    const out = botReply(state, { chatId: 7, text: 'Подписка', now: NOW });
    expect(out.messages[0].text).toContain('https://yoomoney.ru/quickpay/confirm?');
    expect(out.messages[0].text).toContain('label=buy%3A');
    expect(out.state.purchases).toHaveLength(1);
    expect(out.state.purchases[0].price).toBe(100);
    expect(out.messages[0].keyboard.keyboard[0][0].text).toBe('Кабинет');
  });

  it('asks for a promo code, then redeems the next message', () => {
    let state = emptyState();
    state.settings.publicOrigin = 'http://192.168.1.191:8787';
    const made = createPromo(state, { code: 'DEMO1', days: 1, maxUses: 1, now: NOW });
    state = made.state;
    const ask = botReply(state, { chatId: 9, text: 'Промокод', now: NOW });
    expect(ask.messages[0].await).toEqual({ kind: 'promo' });
    const out = botReply(ask.state, { chatId: 9, text: 'DEMO1', now: NOW, awaiting: { kind: 'promo' } });
    expect(out.messages[0].text).toContain('Промокод принят');
    expect(out.messages[0].text).toMatch(/[A-Z2-9]{4}-[A-Z2-9]{4}/);
    expect(out.messages[0].text).toContain('http://192.168.1.191:8787/go/');
    expect(out.messages[0].inline.inline_keyboard[0][0].url).toContain('/go/');
    expect(out.state.promos[0].uses).toHaveLength(1);
    const again = botReply(out.state, { chatId: 9, text: '/promo DEMO1', now: NOW + 1000 });
    expect(again.messages[0].text).toContain('уже активировали');
  });

  it('confirms a phone link from /start link_TOKEN', () => {
    const device = 'a'.repeat(32);
    const started = startDeviceLink(emptyState(), { deviceId: device, now: NOW });
    const out = botReply(started.state, {
      chatId: 55,
      text: '/start link_' + started.result.token,
      now: NOW + 1000,
    });
    expect(out.messages[0].text).toContain('привязан');
    const acc = out.state.accounts.find((a: { telegramId: string }) => a.telegramId === '55');
    expect(acc.linkedDevices).toContain(device);
  });

  it('opens the admin cabinet only for listed telegram ids', () => {
    const state = emptyState();
    state.settings.adminTelegramIds = '99';
    const denied = botReply(state, { chatId: 1, text: '/admin', now: NOW });
    expect(denied.messages[0].text).toContain('Нет доступа');
    const ok = botReply(state, { chatId: 99, text: '/admin', now: NOW });
    expect(ok.messages[0].text).toContain('Админ-кабинет');
    expect(ok.pad).toBe('admin');
    expect(ok.messages[0].keyboard.keyboard[0][0].text).toBe('Сводка');
    expect(ok.messages[0].keyboard.keyboard[2][0].text).toBe('Как пользователь');
  });

  it('lets an admin switch to the user pad to test subscriber buttons', () => {
    const state = emptyState();
    state.settings.adminTelegramIds = '99';
    const adminPad = botReply(state, { chatId: 99, text: '/admin', now: NOW });
    expect(adminPad.pad).toBe('admin');
    const userPad = botReply(adminPad.state, {
      chatId: 99,
      text: 'Как пользователь',
      now: NOW + 1,
      pad: 'admin',
    });
    expect(userPad.pad).toBe('user');
    expect(userPad.messages[0].text).toContain('Режим пользователя');
    const keys = userPad.messages[0].keyboard.keyboard.flat().map((b: { text: string }) => b.text);
    expect(keys).toContain('Кабинет');
    expect(keys).toContain('Подписка');
    expect(keys).not.toContain('Сводка');
    expect(keys).not.toContain('Админ');
    const stay = botReply(userPad.state, {
      chatId: 99,
      text: 'Цены',
      now: NOW + 2,
      pad: 'user',
    });
    expect(stay.pad).toBe('user');
    expect(stay.messages[0].keyboard.keyboard[0][0].text).toBe('Кабинет');
  });

  it('confirms admin panel login only for listed telegram ids', () => {
    const state = emptyState();
    state.settings.adminTelegramIds = '99';
    const started = startAdminPanelLogin(state, { now: NOW });
    const pending = takeAdminPanelLogin(started.state, { token: started.result.token, now: NOW + 1000 });
    expect(pending.result.status).toBe('pending');
    const denied = botReply(started.state, {
      chatId: 1,
      text: '/start admin_' + started.result.token,
      now: NOW + 2000,
    });
    expect(denied.messages[0].text).toContain('Нет доступа');
    const deniedStatus = takeAdminPanelLogin(denied.state, { token: started.result.token, now: NOW + 3000 });
    expect(deniedStatus.result.status).toBe('denied');

    const again = startAdminPanelLogin(state, { now: NOW });
    const ok = botReply(again.state, {
      chatId: 99,
      text: '/start admin_' + again.result.token,
      now: NOW + 1000,
    });
    expect(ok.messages[0].text).toContain('подтверждён');
    const taken = takeAdminPanelLogin(ok.state, { token: again.result.token, now: NOW + 2000 });
    expect(taken.result.status).toBe('ok');
    expect(taken.result.telegramId).toBe('99');
    const reuse = takeAdminPanelLogin(taken.state, { token: again.result.token, now: NOW + 3000 });
    expect(reuse.result.status).toBe('expired');
  });

  it('renews from the app deep link /start renew', () => {
    const start = paid();
    start.state.settings.yoomoneyWallet = '410011';
    start.state.settings.priceRub = 100;
    const out = botReply(start.state, { chatId: '42', text: '/start renew', now: NOW });
    expect(out.messages[0].text).toContain('Продлить');
    expect(out.messages[0].text).toContain('yoomoney.ru');
  });

  it('stores support text and notifies every admin', () => {
    const state = emptyState();
    state.settings.adminTelegramIds = '99, 100';
    const ask = botReply(state, { chatId: '7', text: '/start support', now: NOW });
    expect(ask.messages[0].await.kind).toBe('support');
    const sent = botReply(ask.state, {
      chatId: '7',
      text: 'не открывается',
      now: NOW + 1,
      awaiting: { kind: 'support' },
    });
    expect(sent.state.supportMessages).toHaveLength(1);
    expect(sent.state.supportMessages[0].direction).toBe('in');
    const notes = sent.messages.filter((m: { supportNotify?: string }) => m.supportNotify);
    expect(notes.map((m: { chatId: string }) => m.chatId).sort()).toEqual(['100', '99']);
  });

  it('delivers an admin reply on the notification back to that user', () => {
    const state = emptyState();
    state.settings.adminTelegramIds = '99';
    const asked = botReply(state, { chatId: '7', text: 'Поддержка не открывается', now: NOW });
    const mapped = rememberSupportReply(asked.state, {
      adminChatId: '99',
      messageId: 55,
      telegramId: '7',
      now: NOW,
    });
    const reply = botReply(mapped, { chatId: '99', text: 'проверьте код', now: NOW + 2, replyTo: 55 });
    expect(reply.messages.some((m: { chatId: string; text: string }) => m.chatId === '7' && m.text === 'проверьте код')).toBe(
      true,
    );
    expect(reply.state.supportMessages.some((m: { direction: string }) => m.direction === 'out')).toBe(true);
  });
});

describe('device link and grant', () => {
  it('binds a device to telegram and grants days with a revealable code', () => {
    const device = 'b'.repeat(32);
    const started = startDeviceLink(emptyState(), { deviceId: device, now: NOW });
    const linked = confirmDeviceLink(started.state, { token: started.result.token, telegramId: '77', now: NOW });
    expect(linked.result.ok).toBe(true);
    const granted = grantDays(linked.state, { telegramId: '77', days: 3, now: NOW });
    expect(granted.result.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(openAppUrl('http://nas:8787', granted.result.code)).toContain('/go/');
    const act = activate(granted.state, { code: granted.result.code, deviceId: device, now: NOW });
    expect(act.result.token).toBeTruthy();
  });
});

describe('admin account card', () => {
  it('finds by telegram and builds a card with codes and history hooks', () => {
    const start = paid();
    const card = adminFind(start.state, '42', NOW);
    expect(card.account.telegramId).toBe('42');
    expect(card.reveal.code).toBe(start.code);
    const byId = accountCard(start.state, start.account, NOW);
    expect(byId.codes).toHaveLength(1);
    const granted = grantDays(start.state, { accountId: start.account, days: 2, now: NOW });
    expect(granted.result.paidUntil).toBeGreaterThan(NOW + 30 * 24 * 60 * 60 * 1000);
  });
});

describe('admin dashboard', () => {
  it('lists config alerts and payment events', () => {
    const start = paid();
    start.state.settings.priceRub = 100;
    const paidState = applyPayment(start.state, {
      operationId: 'op-dash',
      label: 'new:' + start.account,
      amount: '100.00',
      currency: '643',
      now: NOW + 5000,
    }).state;
    paidState.attempts.push({ at: NOW + 4000, ok: false, reason: 'bad_code', deviceId: 'abcdef0123456789', hash: 'x' });
    const dash = adminDashboard(paidState, NOW + 5000);
    expect(dash.alerts.some((a) => a.text.indexOf('Jackett') >= 0 || a.text.indexOf('бота') >= 0)).toBe(true);
    expect(dash.events.some((e) => e.kind === 'pay')).toBe(true);
    const fail = dash.events.find((e) => e.kind === 'fail');
    expect(fail?.text).toContain('неверный код');
    expect(fail?.text).not.toContain('bad_code');
  });
});

describe('audit', () => {
  it('appends admin actions', () => {
    const next = logAudit(emptyState(), { action: 'grant', detail: '+7', now: NOW });
    expect(next.audit).toHaveLength(1);
    expect(next.audit[0].action).toBe('grant');
  });
});

describe('finance', () => {
  it('sums payments, flags bad labels, and exports csv', () => {
    const start = paid();
    start.state.settings.priceRub = 150;
    let state = applyPayment(start.state, {
      operationId: 'op-ok',
      label: 'new:' + start.account,
      amount: '150.00',
      currency: '643',
      now: NOW + 1000,
    }).state;
    const bad = applyPayment(state, { operationId: 'op-bad', label: 'new:missing', amount: '10.00', currency: '643', now: NOW + 2000 });
    expect(bad.result.error).toBe('bad_label');
    state = bad.state;
    const dup = applyPayment(state, {
      operationId: 'op-ok',
      label: 'new:' + start.account,
      amount: '150.00',
      currency: '643',
      now: NOW + 3000,
    });
    expect(dup.result.duplicate).toBe(true);
    state = dup.state;
    const fin = financeReport(state, NOW + 3000);
    expect(fin.summary.total.sum).toBe(150);
    expect(fin.problems.some((p) => p.kind === 'bad_label')).toBe(true);
    expect(fin.problems.some((p) => p.kind === 'duplicate')).toBe(true);
    const csv = paymentsCsv(state, NOW, NOW + 4000);
    expect(csv).toContain('op-ok');
    expect(csv).not.toContain('op-bad');
  });

  it('prefixes formula characters in csv cells', () => {
    const opened = openAccount(emptyState(), { telegramId: '7', email: 'a@b.c', now: NOW });
    const names = ['=1+1', '+cmd', '-1', '@sum', '\t=1', '\r=1'];
    for (let i = 0; i < names.length; i++) {
      opened.state.accounts[0].telegramName = names[i];
      const csv = usersCsv(opened.state);
      expect(csv).toContain('"\'' + names[i].replace(/"/g, '""') + '"');
      expect(csv).not.toContain('"' + names[i] + '"');
    }
    opened.state.accounts[0].telegramName = 'Andy';
    expect(usersCsv(opened.state)).toContain('"Andy"');
    const pay = emptyState();
    pay.payments.push({ operationId: 'op-formula', label: '=HYPERLINK("http://evil")', amount: '1.00', at: NOW });
    expect(paymentsCsv(pay, NOW - 1, NOW + 1)).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });
});

describe('promos', () => {
  it('extends an existing subscription by one day', () => {
    const start = paid();
    const made = createPromo(start.state, { code: 'PLUS1', days: 1, maxUses: 5, now: NOW });
    const out = redeemPromo(made.state, { code: 'PLUS1', accountId: start.account, now: NOW });
    expect(out.result.error).toBeUndefined();
    expect(out.result.paidUntil).toBe(NOW + 31 * 24 * 60 * 60 * 1000);
    expect(out.result.code).toBeTruthy();
  });
});

describe('sqlite store', () => {
  it('migrates state.json and round-trips', () => {
    const dir = mkdtempSync(join(tmpdir(), 'omp-bill-'));
    const jsonFile = join(dir, 'state.json');
    const start = paid();
    writeFileSync(jsonFile, JSON.stringify(start.state));
    const db = resolveDbPath(jsonFile);
    const loaded = readState(jsonFile);
    expect(loaded.accounts).toHaveLength(1);
    expect(db.endsWith('.db')).toBe(true);
    writeState(db, { ...loaded, settings: { ...loaded.settings, priceRub: 199 } });
    expect(readState(db).settings.priceRub).toBe(199);
  });

  it('leaves unreadable legacy json and a bad snapshot untouched', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'omp-bill-bad-'));
    const jsonFile = join(dir, 'state.json');
    writeFileSync(jsonFile, 'NOT JSON');
    await expect(updateState(jsonFile, (cur) => ({ state: cur }))).rejects.toThrow(/unreadable/);
    expect(readFileSync(jsonFile, 'utf8')).toBe('NOT JSON');
    const dbPath = resolveDbPath(jsonFile);
    const fresh = new DatabaseSync(dbPath);
    expect(fresh.prepare('SELECT id FROM snapshot WHERE id = 1').get()).toBeUndefined();
    fresh.close();
    writeFileSync(jsonFile, JSON.stringify(paid().state));
    expect(readState(jsonFile).accounts).toHaveLength(1);

    const broken = join(mkdtempSync(join(tmpdir(), 'omp-bill-snap-')), 'state.json');
    writeFileSync(broken, JSON.stringify(paid().state));
    readState(broken);
    const snap = new DatabaseSync(resolveDbPath(broken));
    snap.prepare('UPDATE snapshot SET data = ? WHERE id = 1').run('{');
    snap.close();
    await expect(updateState(broken, (cur) => ({ state: { ...cur, accounts: [] } }))).rejects.toThrow(/unreadable/);
    const still = new DatabaseSync(resolveDbPath(broken));
    expect(still.prepare('SELECT data FROM snapshot WHERE id = 1').get().data).toBe('{');
    still.close();
  });
});

describe('telegram unlink', () => {
  it('drops the phone and keeps the paying account telegram id', () => {
    const device = 'd'.repeat(32);
    let state = emptyState();
    const link = startDeviceLink(state, { deviceId: device, now: NOW });
    state = link.state;
    const confirmed = confirmDeviceLink(state, { token: link.result.token, telegramId: '99', now: NOW });
    state = confirmed.state;
    const accountId = state.accounts[0].id;
    expect(state.accounts[0].telegramId).toBe('99');
    const out = unlinkDeviceTelegram(state, { deviceId: device, now: NOW + 1 });
    expect(out.result.ok).toBe(true);
    expect(out.result.telegramId).toBe('');
    expect(out.state.accounts[0].telegramId).toBe('99');
    expect(out.state.accounts[0].linkedDevices).toEqual([]);
    expect(telegramForDevice(out.state.accounts[0], device)).toBe('');
    expect(telegramForDevice(confirmed.state.accounts[0], device)).toBe('99');
    const again = ensureTelegramAccount(out.state, '99', NOW + 2);
    expect(again.account.id).toBe(accountId);
    expect(again.state.accounts).toHaveLength(1);
  });
});

describe('billing files', () => {
  it('NAS compose runs start.sh through a shell, and the admin build keeps the logos', () => {
    expect(readFileSync('ops/billing/docker-compose.yml', 'utf8')).toContain('/bin/sh');
    expect(readFileSync('ops/billing/casaos-docker-compose.yml', 'utf8')).toContain('/bin/sh');
    expect(readFileSync('ops/billing/.tunnel-bin/set-public-origin.mjs', 'utf8')).toContain("from '../src/store.mjs'");
    const vite = readFileSync('ops/billing/admin/vite.config.ts', 'utf8');
    expect(vite).toContain('emptyOutDir: false');
    expect(vite).toContain("'/admin/support'");
    expect(vite).toContain("'/admin/support-close'");
    expect(vite).toContain("'/admin/services'");
    const pkg = JSON.parse(readFileSync('ops/billing/package.json', 'utf8'));
    expect(pkg.scripts.test).toBe('cd ../.. && npx vitest run --config ops/billing/vitest.config.ts');
    expect(existsSync('ops/billing/admin/public/logo.svg')).toBe(true);
    expect(existsSync('ops/billing/admin/public/tunnel.svg')).toBe(true);
  });
});

describe('payment amount', () => {
  it('refuses a smaller sum and a non-ruble notice, and accepts the price after the fee', () => {
    const start = paid();
    start.state.settings.priceRub = 100;
    const until = start.state.subscriptions[0].paidUntil;
    const short = applyPayment(start.state, {
      operationId: 'op-short',
      label: 'sub:' + start.sub,
      amount: '1.00',
      currency: '643',
      now: NOW + 1000,
    });
    expect(short.result.error).toBe('amount');
    expect(short.state.subscriptions[0].paidUntil).toBe(until);
    const foreign = applyPayment(start.state, {
      operationId: 'op-usd',
      label: 'sub:' + start.sub,
      amount: '100.00',
      currency: '840',
      now: NOW + 1000,
    });
    expect(foreign.result.error).toBe('amount');
    expect(paymentCovers('97.00', '643', 100)).toBe(true);
    expect(paymentCovers('96.00', '643', 100)).toBe(false);
    const fee = applyPayment(start.state, {
      operationId: 'op-fee',
      label: 'sub:' + start.sub,
      amount: '97.00',
      currency: '643',
      now: NOW + 1000,
    });
    expect(fee.result.kind).toBe('renew');
    expect(fee.result.paidUntil).toBeGreaterThan(until);
  });

  it('honours the quoted price after the list price goes up', () => {
    const start = paid();
    start.state.settings.priceRub = 100;
    const quoted = quotePurchase(start.state, { kind: 'sub', accountId: start.account, subscriptionId: start.sub, now: NOW });
    expect(quoted.result.label.indexOf('buy:')).toBe(0);
    quoted.state.settings.priceRub = 150;
    const until = quoted.state.subscriptions[0].paidUntil;
    const paidQuote = applyPayment(quoted.state, {
      operationId: 'op-quote',
      label: quoted.result.label,
      amount: '100.00',
      currency: '643',
      now: NOW + 1000,
    });
    expect(paidQuote.result.kind).toBe('renew');
    expect(paidQuote.result.paidUntil).toBeGreaterThan(until);
    const shaved = applyPayment(quoted.state, {
      operationId: 'op-shaved',
      label: quoted.result.label,
      amount: '1.00',
      currency: '643',
      now: NOW + 1000,
    });
    expect(shaved.result.error).toBe('amount');
    expect(shaved.state.subscriptions[0].paidUntil).toBe(until);
    expect(accountCard(paidQuote.state, start.account, NOW + 1000).payments.some((p) => p.label === quoted.result.label)).toBe(true);
    expect(adminDashboard(paidQuote.state, NOW + 1000).events.some((e) => e.kind === 'pay' && e.accountId === start.account)).toBe(true);
  });

  it('keeps an unpaid quote after newer checkouts pass the cap', () => {
    const start = paid();
    start.state.settings.priceRub = 100;
    const first = quotePurchase(start.state, { kind: 'sub', subscriptionId: start.sub, accountId: start.account, now: NOW });
    let state = first.state;
    for (let i = 0; i < 2000; i++) {
      state = quotePurchase(state, { kind: 'sub', subscriptionId: start.sub, accountId: start.account, now: NOW + i }).state;
    }
    expect(state.purchases.some((p) => p.id === first.result.id)).toBe(true);
    const late = applyPayment(state, {
      operationId: 'op-late',
      label: first.result.label,
      amount: '100.00',
      currency: '643',
      now: NOW + 3000,
    });
    expect(late.result.kind).toBe('renew');
  });
});

describe('telegram nickname', () => {
  it('shows @username next to the numeric id', () => {
    const saved = rememberTelegramProfile(emptyState(), { telegramId: '55', username: '@Andy', name: 'Andy B' }, NOW);
    expect(saved.account.telegramUsername).toBe('Andy');
    expect(telegramDisplay(saved.account)).toBe('@Andy · 55');
    const again = rememberTelegramProfile(saved.state, { telegramId: '55', username: 'Andy', name: 'Andy B' }, NOW + 1);
    expect(again.state).toBe(saved.state);

    const found = adminFind(saved.state, '@andy', NOW);
    expect(found.account.telegramId).toBe('55');

    const withAdmin = {
      ...saved.state,
      settings: { ...saved.state.settings, adminTelegramIds: '1' },
    };
    const replied = botReply(withAdmin, {
      chatId: '55',
      text: 'сломалось',
      now: NOW + 2,
      awaiting: { kind: 'support' },
      from: { username: 'andy', firstName: 'Andy', lastName: '' },
    });
    const threads = supportThreads(replied.state);
    expect(threads[0].username).toBe('andy');
    expect(threads[0].telegramId).toBe('55');
    const note = replied.messages.find((m) => String(m.text).indexOf('Поддержка') === 0);
    expect(note.text).toContain('@andy · 55');
  });

  it('hides a closed support thread until the user writes again', () => {
    const state = emptyState();
    const asked = botReply(state, { chatId: '7', text: '/start support', now: NOW });
    const sent = botReply(asked.state, {
      chatId: '7',
      text: 'не открывается',
      now: NOW + 1,
      awaiting: { kind: 'support' },
    });
    const closed = closeSupportThread(sent.state, { telegramId: '7', now: NOW + 5 });
    expect(closed.result.ok).toBe(true);
    expect(closed.result.text).toContain('завершён');
    expect(supportThreads(closed.state)).toHaveLength(0);
    const again = botReply(closed.state, {
      chatId: '7',
      text: 'ещё вопрос',
      now: NOW + 6,
      awaiting: { kind: 'support' },
    });
    expect(supportThreads(again.state)).toHaveLength(1);
    expect(supportThreads(again.state)[0].lastText).toBe('ещё вопрос');
  });
});

describe('services settings', () => {
  it('masks secrets in the admin payload and keeps them on save', () => {
    const cur = emptyState().settings;
    cur.jackettApiKey = 'secret-key';
    cur.indexerPass = 'pass';
    cur.jackettUrl = 'http://jackett:9117';
    const pub = publicAdminSettings(cur);
    expect(pub.jackettApiKey).toBe(SECRET_MASK);
    expect(pub.indexerPass).toBe(SECRET_MASK);
    expect(pub.jackettUrl).toBe('http://jackett:9117');
    expect(keepSecret(SECRET_MASK, 'secret-key')).toBe('secret-key');
    const next = mergeSettings(cur, {
      jackettApiKey: SECRET_MASK,
      jackettEnabled: 'false',
      jacredEnabled: 'true',
      torrserverUrl: 'http://torrserver:8090',
    });
    expect(next.jackettApiKey).toBe('secret-key');
    expect(next.jackettEnabled).toBe(false);
    expect(next.jacredEnabled).toBe(true);
    expect(next.torrserverUrl).toBe('http://torrserver:8090');
    expect(sourceEnabled(next, 'jackett')).toBe(false);
  });

  it('rate-limits and caches search answers', () => {
    const limit = createRateLimit(2, 60_000);
    expect(limit.allow('d1')).toBe(true);
    expect(limit.allow('d1')).toBe(true);
    expect(limit.allow('d1')).toBe(false);
    expect(limit.allow('d2')).toBe(true);
    const cache = createSearchCache(60_000);
    cache.set('k', '<rss/>');
    expect(cache.get('k')).toBe('<rss/>');
  });
});
