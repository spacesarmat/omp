// Device limit as a composition: base (settings.baseDevices, or the subscription's individual limit) + bonus slots
// (free; forever or until a date; from promos or the admin) + paid monthly extra slots. Plus device names.
import { describe, expect, it, vi } from 'vitest';
import { userPayload } from '../src/adminApi.mjs';
import { botReply } from '../src/bot.mjs';
import { grantBonus, removeBonus, setDeviceLimit } from '../src/deviceAdmin.mjs';
import { deviceNameOf } from '../src/registry.mjs';
import {
  activate,
  baseChangeImpact,
  codeWithinLimit,
  createPromo,
  createSubscription,
  deviceCode,
  deviceLimitNow,
  ensureTelegramAccount,
  issueCliAdminLogin,
  limitBreakdown,
  migrateLimitModel,
  overLimitReason,
  redeemPromo,
  renewalPrice,
  subscriptionView,
} from '../src/logic.mjs';
import { createApp } from '../src/server.mjs';
import { emptyState, normalizeState } from '../src/state.mjs';
import { readState, updateState, writeState, testStore } from './pg';

const NOW = Date.UTC(2026, 9, 19, 9, 0, 0); // 19.10.2026 12:00 MSK
const DAY = 24 * 60 * 60 * 1000;
const ADMIN = { kind: 'admin', id: '99', label: '99' };
const DEVS = ['a', 'b', 'c', 'd', 'e'].map((c) => c.repeat(32));

type State = ReturnType<typeof emptyState>;
type Sub = { id: string; accountId: string; limitOverride?: number | null; deviceLimit?: number; bonusSlots?: unknown[] };

function account(state: State, tg = '42') {
  const opened = ensureTelegramAccount(state, tg, NOW);
  return { state: opened.state as State, accountId: opened.account.id as string };
}

/** Account 42 with a 30-day subscription and `bound` phones. */
function setup({ bound = 1, base }: { bound?: number; base?: number } = {}) {
  let state: State = emptyState();
  Object.assign(state.settings, { priceRub: 150, extraDeviceRub: 50, periodDays: 30, yoomoneyWallet: '4100' });
  if (base !== undefined) state.settings.baseDevices = base;
  const a = account(state);
  const created = createSubscription(a.state, { accountId: a.accountId, now: NOW, days: 30 });
  state = created.state;
  const sub = created.result.subscriptionId as string;
  for (let i = 0; i < bound; i++) state = bind(state, sub, DEVS[i], NOW + i).state;
  return { state, sub, accountId: a.accountId };
}

function bind(state: State, sub: string, deviceId: string, now: number) {
  const slot = deviceCode(state, sub, now);
  if (!slot.code) return { state, error: 'limit' };
  const act = activate(slot.state, { code: slot.code, deviceId, now });
  return { state: act.state as State, error: act.result.error as string | undefined, codeId: act.result.codeId as string };
}

const subOf = (state: State, id: string) => state.subscriptions.find((s: Sub) => s.id === id);
const patchSub = (state: State, id: string, patch: object) => ({
  ...state,
  subscriptions: state.subscriptions.map((s: Sub) => (s.id === id ? { ...s, ...patch } : s)),
});
const say = (state: State, text: string, now = NOW) =>
  botReply(state, { chatId: '42', text, now })
    .messages.map((m: { text: string }) => m.text)
    .join('\n');

describe('migration to the composed limit', () => {
  /** A snapshot the previous server wrote: no limitModel, no limitOverride / bonusSlots. */
  function oldSnapshot() {
    let state: State = emptyState();
    const subs: Sub[] = [];
    for (const [tg, limit] of [
      ['41', 2],
      ['42', 3],
      ['43', 1],
    ] as [string, number][]) {
      const a = account(state, tg);
      const created = createSubscription(a.state, { accountId: a.accountId, now: NOW, days: 30 });
      state = created.state;
      subs.push({ id: created.result.subscriptionId, accountId: a.accountId, deviceLimit: limit });
    }
    const old = {
      ...state,
      meta: { deviceBase: 2, extraMonthly: 1 },
      subscriptions: state.subscriptions.map((s: Sub) => {
        const { limitOverride: _o, bonusSlots: _b, ...rest } = s as Sub & Record<string, unknown>;
        return { ...rest, deviceLimit: subs.find((x) => x.id === s.id)!.deviceLimit };
      }),
    } as Record<string, unknown>;
    delete (old.settings as Record<string, unknown>).baseDevices;
    return { old, subs };
  }

  it('a custom deviceLimit becomes the individual limit, the base one does not; nobody’s limit changes', async () => {
    const { old, subs } = oldSnapshot();
    // What a read of the stored snapshot gives: the one-time migrations run in normalizeState.
    const read = normalizeState(JSON.parse(JSON.stringify(old)));
    expect(read.meta.limitModel).toBe(1);
    expect(subs.map((s) => subOf(read, s.id).limitOverride)).toEqual([null, 3, 1]);
    expect(subs.map((s) => subOf(read, s.id).bonusSlots)).toEqual([[], [], []]);
    expect(subs.map((s) => deviceLimitNow(read, subOf(read, s.id), NOW))).toEqual([2, 3, 1]);
    // deviceLimit stays for a rollback to the previous image
    expect(subs.map((s) => subOf(read, s.id).deviceLimit)).toEqual([2, 3, 1]);
    // idempotent: once migrated, again changes nothing; a written and re-read state is the same
    expect(migrateLimitModel(read)).toBe(read);
    expect(migrateLimitModel({ ...read, meta: { ...read.meta, limitModel: 0 } }).subscriptions).toEqual(read.subscriptions);
    const file = await testStore();
    await writeState(file, read);
    expect((await readState(file)).subscriptions).toEqual(read.subscriptions);
  });

  it('migrates against the base in the settings when one is set', () => {
    const { old, subs } = oldSnapshot();
    (old.settings as Record<string, unknown>).baseDevices = 3;
    const out = migrateLimitModel(old);
    expect(subs.map((s) => subOf(out, s.id).limitOverride)).toEqual([2, null, 1]);
  });
});

describe('composition', () => {
  it('the global base applies at once to every subscription without an individual limit', () => {
    const f = setup({ bound: 2 });
    expect(deviceLimitNow(f.state, subOf(f.state, f.sub), NOW)).toBe(2);
    expect(say(f.state, 'Кабинет')).toContain('Устройства: 2 из 2');
    expect(say(f.state, 'Цены')).toContain('до 2 телефонов');
    const three = { ...f.state, settings: { ...f.state.settings, baseDevices: 3 } };
    expect(deviceLimitNow(three, subOf(three, f.sub), NOW)).toBe(3);
    expect(say(three, 'Кабинет')).toContain('Устройства: 2 из 3');
    expect(say(three, 'Цены')).toContain('до 3 телефонов');
    expect(bind(three, f.sub, DEVS[2], NOW + 10).error).toBeUndefined();
    // a subscription without one gets «до N телефонов» in the bot
    const fresh = account(three, '77');
    expect(botReply(fresh.state, { chatId: '77', text: 'Кабинет', now: NOW }).messages[0].text).toContain('до 3 телефонов');
  });

  it('the individual limit is not overwritten by the global base and is shown as such', () => {
    const f = setup({ bound: 1 });
    const own = setDeviceLimit(f.state, { accountId: f.accountId, limitOverride: '4', now: NOW, actor: ADMIN });
    expect(own.result.total).toBe(4);
    const five = { ...own.state, settings: { ...own.state.settings, baseDevices: 5 } };
    const sub = subOf(five, f.sub);
    expect(limitBreakdown(five, sub, NOW)).toMatchObject({
      total: 4,
      override: 4,
      globalBase: 5,
      text: '4 (индивидуальный лимит)',
    });
    expect(say(five, 'Кабинет')).toContain('Устройства: 1 из 4 (4 (индивидуальный лимит))');
    const user = userPayload(five, f.accountId, {});
    expect(user.subscription).toMatchObject({
      deviceLimit: 4,
      limitOverride: 4,
      globalBase: 5,
      limitText: '4 (индивидуальный лимит)',
    });
  });

  it('shows the breakdown: base + bonus (forever / until) + bought, and bonus never costs money', () => {
    const f = setup({ bound: 1 });
    const before = renewalPrice(f.state, subOf(f.state, f.sub), NOW);
    let state = grantBonus(f.state, { accountId: f.accountId, count: 1, days: '', reason: 'тест', now: NOW, actor: ADMIN }).state;
    state = grantBonus(state, { accountId: f.accountId, count: 2, days: 10, reason: '', now: NOW, actor: ADMIN }).state;
    state = setDeviceLimit(state, { accountId: f.accountId, extraSlots: 1, now: NOW, actor: ADMIN }).state;
    const sub = subOf(state, f.sub);
    const limit = limitBreakdown(state, sub, NOW);
    expect(limit.total).toBe(6);
    expect(limit.text).toBe('2 базовых + 1 бонусный (навсегда) + 2 бонусных (до 29.10.2026) + 1 купленный');
    expect(say(state, 'Устройства')).toContain(
      'Устройства: 1 из 6 (2 базовых + 1 бонусный (навсегда) + 2 бонусных (до 29.10.2026) + 1 купленный до 18.11.2026)',
    );
    // userPayload reads the clock itself: pin it to NOW, or the 10-day bonus expires in real time (29.10.2026)
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    try {
      expect(userPayload(state, f.accountId, {}).subscription.limitText).toBe(limit.text);
    } finally {
      vi.useRealTimers();
    }
    // renewal: base + the one paid extra slot; bonus slots are free
    const after = renewalPrice(state, sub, NOW);
    expect(after.extras).toBe(1);
    expect(after.total ?? after.gross ?? 0).toBe((before.total ?? before.gross ?? 0) + 50);
  });

  it('a dated bonus stops counting by itself; the phone in it is over the limit as device_limit, not extra_expired', () => {
    const f = setup({ bound: 2 });
    const granted = grantBonus(f.state, { accountId: f.accountId, count: 1, days: 3, reason: 'неделя', now: NOW, actor: ADMIN });
    expect(granted.result.bonus.until).toBe(NOW + 3 * DAY);
    const third = bind(granted.state, f.sub, DEVS[2], NOW + 5);
    expect(third.error).toBeUndefined();
    const sub = subOf(third.state, f.sub);
    const code = third.state.codes.find((c: { id: string }) => c.id === third.codeId);
    expect(codeWithinLimit(third.state, sub, code, NOW + 3 * DAY - 1)).toBe(true);
    expect(deviceLimitNow(third.state, sub, NOW + 3 * DAY)).toBe(2);
    expect(codeWithinLimit(third.state, sub, code, NOW + 3 * DAY)).toBe(false);
    expect(overLimitReason(third.state, sub, code, NOW + 3 * DAY)).toBe('device_limit');
    expect(limitBreakdown(third.state, sub, NOW + 3 * DAY).text).toBe('2 базовых');
    // the panel still lists it, marked expired; the admin can remove it
    const user = userPayload(third.state, f.accountId, {}) as { subscription: { bonus: { id: string; active: boolean }[] } };
    expect(user.subscription.bonus).toHaveLength(1);
    const gone = removeBonus(third.state, {
      accountId: f.accountId,
      bonusId: user.subscription.bonus[0].id,
      now: NOW,
      actor: ADMIN,
    });
    expect(gone.result.ok).toBe(true);
    expect(subOf(gone.state, f.sub).bonusSlots).toEqual([]);
    expect(gone.state.audit.map((a: { action: string }) => a.action)).toEqual(['bonus_grant', 'bonus_remove']);
  });

  it('extra_expired still means a lapsed paid slot when bonus slots are there too', () => {
    const f = setup({ bound: 2 });
    let state = grantBonus(f.state, { accountId: f.accountId, count: 1, days: '', now: NOW, actor: ADMIN }).state;
    state = setDeviceLimit(state, { accountId: f.accountId, extraSlots: 1, now: NOW, actor: ADMIN }).state;
    state = bind(state, f.sub, DEVS[2], NOW + 5).state;
    state = bind(state, f.sub, DEVS[3], NOW + 6).state;
    const lapsed = patchSub(state, f.sub, { extraUntil: NOW + DAY });
    const at = NOW + 5 * DAY;
    const view = subscriptionView(lapsed, f.accountId, at);
    expect(view.deviceLimit).toBe(3);
    expect(view.devices.map((d: { overReason: string }) => d.overReason)).toEqual(['', '', '', 'extra_expired']);
  });

  it('rejects bad admin input', () => {
    const f = setup();
    for (const [count, days] of [
      [0, ''],
      [21, ''],
      ['x', ''],
      [1, -1],
      [1, 3651],
      [1, 'x'],
    ]) {
      expect(grantBonus(f.state, { accountId: f.accountId, count, days, now: NOW, actor: ADMIN }).result.error).toBe('bad_args');
    }
    expect(removeBonus(f.state, { accountId: f.accountId, bonusId: 'nope', now: NOW, actor: ADMIN }).result.error).toBe(
      'not_found',
    );
  });
});

describe('promo bonus slots', () => {
  it('adds a permanent slot to a subscription, with a code for it; needs a subscription', () => {
    const f = setup({ bound: 2 });
    const made = createPromo(f.state, { code: 'PLUSONE', days: 0, maxUses: 5, bonusSlots: 1, bonusDays: 0, now: NOW });
    expect(made.result.promo).toMatchObject({ days: 0, bonusSlots: 1, bonusDays: 0 });
    const out = redeemPromo(made.state, { code: 'plusone', accountId: f.accountId, now: NOW });
    expect(out.result).toMatchObject({ kind: 'promo', days: 0, bonus: { count: 1, until: null } });
    expect(out.result.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const sub = subOf(out.state, f.sub);
    expect(sub.paidUntil).toBe(subOf(f.state, f.sub).paidUntil);
    expect(limitBreakdown(out.state, sub, NOW + 400 * DAY).bonusTotal).toBe(1);
    expect(subOf(out.state, f.sub).bonusSlots[0]).toMatchObject({
      count: 1,
      until: null,
      source: 'promo',
      reason: 'промокод PLUSONE',
    });

    const nobody = account(made.state, '55');
    const refused = redeemPromo(nobody.state, { code: 'PLUSONE', accountId: nobody.accountId, now: NOW });
    expect(refused.result.error).toBe('needs_subscription');
    expect(refused.state.promos[0].uses).toHaveLength(0);
    expect(botReply(nobody.state, { chatId: '55', text: '/promo PLUSONE', now: NOW }).messages[0].text).toContain(
      'Сначала оформите подписку',
    );
  });

  it('a dated bonus from a promo runs N days from the redemption; days and bonus together work for a new user', () => {
    const f = setup();
    const made = createPromo(f.state, { code: 'FRIEND30', days: 7, maxUses: 5, bonusSlots: 1, bonusDays: 30, now: NOW });
    const later = NOW + 2 * DAY;
    const out = redeemPromo(made.state, { code: 'FRIEND30', accountId: f.accountId, now: later });
    expect(out.result.bonus).toEqual({ count: 1, until: later + 30 * DAY });
    const fresh = account(out.state, '56');
    const first = redeemPromo(fresh.state, { code: 'FRIEND30', accountId: fresh.accountId, now: later });
    const sub = first.state.subscriptions.find((s: Sub) => s.accountId === fresh.accountId);
    expect(deviceLimitNow(first.state, sub, later)).toBe(3);
    expect(deviceLimitNow(first.state, sub, later + 30 * DAY)).toBe(2);
    const text = botReply(made.state, { chatId: '42', text: '/promo FRIEND30', now: later }).messages[0].text;
    expect(text).toContain('Промокод принят: +7 дней');
    expect(text).toContain('+1 устройство бесплатно до 20.11.2026');
  });

  it('the bonus survives a change of the global base', () => {
    const f = setup();
    const made = createPromo(f.state, { code: 'KEEPME', days: 0, maxUses: 1, bonusSlots: 2, now: NOW });
    const out = redeemPromo(made.state, { code: 'KEEPME', accountId: f.accountId, now: NOW });
    const one = { ...out.state, settings: { ...out.state.settings, baseDevices: 1 } };
    expect(limitBreakdown(one, subOf(one, f.sub), NOW).text).toBe('1 базовое + 2 бонусных (навсегда)');
  });
});

describe('device names', () => {
  it('keeps letters, digits and a few signs, 40 characters at most', () => {
    expect(deviceNameOf('Xiaomi 2201117TY')).toBe('Xiaomi 2201117TY');
    expect(deviceNameOf(' Samsung\tSM-S918B\n')).toBe('Samsung SM-S918B');
    expect(deviceNameOf('*bold*_[x](y)`')).toBe('bold x (y)');
    expect(deviceNameOf('x'.repeat(60))).toHaveLength(40);
    expect(deviceNameOf(42)).toBe('');
  });
});

/* ---------- HTTP: admin routes, settings, names ---------- */

function mockRes() {
  return {
    status: 0,
    headers: {} as Record<string, string>,
    body: '',
    writeHead(status: number, headers?: Record<string, string>) {
      this.status = status;
      if (headers) Object.assign(this.headers, headers);
    },
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
    },
    end(buf?: Buffer | string) {
      this.body = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf || '');
    },
  };
}

type App = (req: unknown, res: unknown) => Promise<void>;

async function call(
  app: App,
  method: string,
  path: string,
  opts: { cookie?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  const payload = opts.body === undefined ? '' : JSON.stringify(opts.body);
  const req = {
    method,
    url: path,
    headers: {
      cookie: opts.cookie || '',
      accept: 'application/json',
      'content-type': opts.body === undefined ? '' : 'application/json',
      ...(opts.headers || {}),
    },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload);
    },
  };
  const res = mockRes();
  await app(req, res);
  let data: Record<string, unknown> | null = null;
  try {
    data = JSON.parse(res.body) as Record<string, unknown>;
  } catch (e) {
    data = null;
  }
  return { status: res.status, data, body: res.body };
}

async function adminCookie(app: App, file: string) {
  const link = await updateState(file, (st: State) => issueCliAdminLogin(st, { now: Date.now() }));
  const res = mockRes();
  await app(
    {
      method: 'GET',
      url: '/admin/login/once?token=' + encodeURIComponent(link.token),
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
      async *[Symbol.asyncIterator]() {},
    },
    res,
  );
  const cookie = String(res.headers['set-cookie'] || '');
  const home = await call(app, 'GET', '/admin/api/home', { cookie });
  return { cookie, csrf: String((home.data && home.data.csrf) || '') };
}

async function httpSetup() {
  const file = await testStore();
  let state: State = emptyState();
  const a = account(state);
  const created = createSubscription(a.state, { accountId: a.accountId, now: Date.now(), days: 30 });
  state = created.state;
  await writeState(file, state);
  const app = createApp(
    file,
    async () => ({ ok: true, status: 200, json: async () => ({ ok: true, result: {} }), text: async () => '' }),
    { env: {} },
  );
  return { file, app, accountId: a.accountId, sub: created.result.subscriptionId as string, code: created.result.code as string };
}

describe('admin HTTP', () => {
  it('bonus routes and the base setting need an admin session and the csrf', async () => {
    const t = await httpSetup();
    const { cookie } = await adminCookie(t.app, t.file);
    const routes: [string, Record<string, unknown>][] = [
      ['/admin/bonus', { accountId: t.accountId, count: 2, days: '' }],
      ['/admin/bonus-remove', { accountId: t.accountId, bonusId: 'x', confirm: 'yes' }],
      ['/admin/limit', { accountId: t.accountId, limitOverride: 7 }],
      ['/admin/settings', { baseDevices: 9 }],
    ];
    for (const [path, body] of routes) {
      expect((await call(t.app, 'POST', path, { body: { ...body, csrf: 'x' } })).status).toBe(403);
      expect((await call(t.app, 'POST', path, { cookie, body: { ...body, csrf: 'wrong' } })).status).toBe(403);
    }
    const st = (await readState(t.file));
    expect(subOf(st, t.sub)).toMatchObject({ limitOverride: null, bonusSlots: [] });
    expect(st.settings.baseDevices).toBe(2);
  });

  it('grants and removes a bonus, sets the base with validation, all in the journal', async () => {
    const t = await httpSetup();
    const { cookie, csrf } = await adminCookie(t.app, t.file);
    const grant = await call(t.app, 'POST', '/admin/bonus', {
      cookie,
      body: { csrf, accountId: t.accountId, count: '1', days: '', reason: 'за отзыв' },
    });
    expect((grant.data as { flash?: { text?: string } }).flash?.text).toBe(
      'Бонусные устройства выданы. Лимит: 3 (2 базовых + 1 бонусный (навсегда))',
    );
    const user = await call(t.app, 'GET', '/admin/api/user?id=' + encodeURIComponent(t.accountId), { cookie });
    const sub = (user.data as { subscription: { limitText: string; bonus: { id: string; reason: string; active: boolean }[] } })
      .subscription;
    expect(sub.limitText).toBe('2 базовых + 1 бонусный (навсегда)');
    expect(sub.bonus[0]).toMatchObject({ reason: 'за отзыв', active: true });
    const noConfirm = await call(t.app, 'POST', '/admin/bonus-remove', {
      cookie,
      body: { csrf, accountId: t.accountId, bonusId: sub.bonus[0].id },
    });
    expect((noConfirm.data as { flash?: { error?: string } }).flash?.error).toBe('Нужно подтверждение');
    await call(t.app, 'POST', '/admin/bonus-remove', {
      cookie,
      body: { csrf, accountId: t.accountId, bonusId: sub.bonus[0].id, confirm: 'yes' },
    });
    expect(subOf((await readState(t.file)), t.sub).bonusSlots).toEqual([]);

    const bad = await call(t.app, 'POST', '/admin/settings', { cookie, body: { csrf, baseDevices: '21' } });
    expect((bad.data as { flash?: { error?: string } }).flash?.error).toContain('от 1 до 20');
    expect((await readState(t.file)).settings.baseDevices).toBe(2);
    await call(t.app, 'POST', '/admin/settings', { cookie, body: { csrf, baseDevices: '3' } });
    const after = (await readState(t.file));
    expect(after.settings.baseDevices).toBe(3);
    expect(deviceLimitNow(after, subOf(after, t.sub), Date.now())).toBe(3);
    const home = await call(t.app, 'GET', '/admin/api/home', { cookie });
    expect((home.data as { settings: { baseDevices: number } }).settings.baseDevices).toBe(3);
    const acts = after.audit.map((a: { action: string; detail?: string }) => a.action + ':' + (a.detail || ''));
    expect(acts.some((a: string) => a.indexOf('bonus_grant:Бонусные устройства: +1 навсегда - за отзыв') === 0)).toBe(true);
    expect(acts.some((a: string) => a.indexOf('bonus_remove:') === 0)).toBe(true);
    expect(acts).toContain('settings_save:Базовых устройств: 2 → 3');
  });

  it('stores the device name from activate and refresh; the bot and the panel show it', async () => {
    const t = await httpSetup();
    const act = await call(t.app, 'POST', '/v1/activate', {
      body: { code: t.code, deviceId: DEVS[0], tokens: 'pair', name: 'Xiaomi 2201117TY' },
      headers: { 'cf-connecting-ip': '203.0.113.9' },
    });
    expect(act.status).toBe(200);
    const db = t.file.registry;
    const codeId = (await readState(t.file)).codes[0].id;
    expect((await db.activeRowForCode(codeId)).name).toBe('Xiaomi 2201117TY');
    const pair = act.data as { refreshToken: string };
    const ref = await call(t.app, 'POST', '/v1/token/refresh', {
      body: { refreshToken: pair.refreshToken, deviceId: DEVS[0], name: '<Xiaomi> 13T\n' },
      headers: { 'x-device-id': DEVS[0] },
    });
    expect(ref.status).toBe(200);
    expect((await db.activeRowForCode(codeId)).name).toBe('Xiaomi 13T');
    // no name (an older app): the stored one stays
    const ref2 = await call(t.app, 'POST', '/v1/token/refresh', {
      body: { refreshToken: (ref.data as { refreshToken: string }).refreshToken, deviceId: DEVS[0] },
    });
    expect(ref2.status).toBe(200);
    expect((await db.listDevices(t.sub))[0].name).toBe('Xiaomi 13T');
    const { cookie } = await adminCookie(t.app, t.file);
    const user = await call(t.app, 'GET', '/admin/api/user?id=' + encodeURIComponent(t.accountId), { cookie });
    expect((user.data as { devices: { name: string }[] }).devices[0].name).toBe('Xiaomi 13T');
  });
});

describe('lowering the global base', () => {
  /** Five accounts: plain (2 bound), individual limit (2 bound), expired (2 bound), permanent bonus (2 bound), one phone. */
  function crowd() {
    let state: State = emptyState();
    const subs: Record<string, string> = {};
    const make = (tg: string, bound: number, at = NOW) => {
      const a = account(state, tg);
      const created = createSubscription(a.state, { accountId: a.accountId, now: at, days: 30 });
      state = created.state;
      const id = created.result.subscriptionId as string;
      for (let i = 0; i < bound; i++) state = bind(state, id, tg.slice(0, 1).repeat(31) + i, at + i).state;
      subs[tg] = id;
      return a.accountId;
    };
    make('11', 2);
    const own = make('22', 2);
    state = setDeviceLimit(state, { accountId: own, limitOverride: 2, now: NOW, actor: ADMIN }).state;
    make('33', 2, NOW - 60 * DAY);
    const gift = make('44', 2);
    state = grantBonus(state, { accountId: gift, count: 1, days: '', now: NOW, actor: ADMIN }).state;
    make('55', 1);
    return { state, subs };
  }

  it('counts paying subscriptions without an individual limit that lose devices, and those devices', () => {
    const { state } = crowd();
    expect(baseChangeImpact(state, 1, NOW)).toEqual({ from: 2, to: 1, lowering: true, subscriptions: 1, devices: 1 });
    expect(baseChangeImpact(state, 3, NOW)).toMatchObject({ lowering: false, subscriptions: 0, devices: 0 });
    expect(baseChangeImpact(state, 2, NOW)).toMatchObject({ lowering: false, subscriptions: 0, devices: 0 });
    // an expired dated bonus adds nothing to the count
    const plain = state.subscriptions.find((x: Sub) => deviceLimitNow(state, x, NOW) === 2 && x.limitOverride === null)!;
    const withDated = patchSub(state, plain.id, {
      bonusSlots: [{ id: 'old', count: 1, until: NOW - DAY, reason: '', grantedAt: NOW - 9 * DAY, source: 'admin' }],
    });
    expect(baseChangeImpact(withDated, 1, NOW)).toMatchObject({ subscriptions: 1, devices: 1 });
  });

  it('the server saves a lower base only with confirm=yes and says what it does; raising needs no confirm', async () => {
    const t = await httpSetup();
    const st = (await readState(t.file));
    let state = st;
    for (const d of [DEVS[0], DEVS[1]]) state = bind(state, t.sub, d, Date.now()).state;
    await writeState(t.file, state);
    const { cookie, csrf } = await adminCookie(t.app, t.file);
    expect((await call(t.app, 'GET', '/admin/api/base-impact?base=1')).status).toBe(401);
    const impact = await call(t.app, 'GET', '/admin/api/base-impact?base=1', { cookie });
    expect(impact.data).toEqual({ from: 2, to: 1, lowering: true, subscriptions: 1, devices: 1 });

    const asked = await call(t.app, 'POST', '/admin/settings', { cookie, body: { csrf, baseDevices: '1', priceRub: '999' } });
    const flash = (asked.data as { flash?: { error?: string } }).flash?.error || '';
    expect(flash).toContain('Снижение базы 2 → 1 требует подтверждения');
    expect(flash).toContain('затронет подписок: 1, перестанут работать устройств: 1');
    expect((asked.data as { extra?: { baseImpact?: unknown } }).extra?.baseImpact).toMatchObject({
      subscriptions: 1,
      devices: 1,
    });
    // nothing at all was saved
    expect((await readState(t.file)).settings).toMatchObject({ baseDevices: 2, priceRub: 0 });

    const forged = await call(t.app, 'POST', '/admin/settings', {
      cookie,
      body: { csrf: 'wrong', baseDevices: '1', confirm: 'yes' },
    });
    expect(forged.status).toBe(403);
    await call(t.app, 'POST', '/admin/settings', { cookie, body: { csrf, baseDevices: '1', confirm: 'yes' } });
    const after = (await readState(t.file));
    expect(after.settings.baseDevices).toBe(1);
    expect(after.audit.map((a: { detail?: string }) => a.detail)).toContain(
      'Базовых устройств: 2 → 1 (подписок затронуто: 1, устройств отключено: 1)',
    );
    const up = await call(t.app, 'POST', '/admin/settings', { cookie, body: { csrf, baseDevices: '2' } });
    expect((up.data as { flash?: { error?: string } }).flash?.error || '').toBe('');
    expect((await readState(t.file)).settings.baseDevices).toBe(2);
  });
});
