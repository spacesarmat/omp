import { describe, expect, it } from 'vitest';
import { activate, createSubscription, ensureTelegramAccount } from '../src/logic.mjs';
import { createApp } from '../src/server.mjs';
import { emptyState } from '../src/state.mjs';
import { readState, writeState, testStore } from './pg';

type App = (req: unknown, res: unknown) => Promise<void>;

function mockRes() {
  return {
    status: 0,
    headers: {} as Record<string, string | number>,
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

async function me(app: App, token: string, device: string) {
  const req = {
    method: 'GET',
    url: '/v1/me',
    headers: { 'x-forwarded-proto': 'https', accept: 'application/json', authorization: 'Bearer ' + token, 'x-device-id': device },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {},
  };
  const res = mockRes();
  await app(req, res);
  return { status: res.status, body: res.body };
}

const DEV = 'a'.repeat(32);
const DAY = 86400000;

/** A friend who already paid, a referrer with access, and a bind. The bot token is optional. */
async function seeded(botToken: string) {
  const file = await testStore();
  const now = Date.now();
  let state = emptyState();
  state.settings.priceRub = 200;
  state.settings.periodDays = 30;
  if (botToken) state.settings.botToken = botToken;
  state.settings.referral = { enabled: true, referrerDays: 7, friendDays: 3, delayDays: 0 };
  const ref = ensureTelegramAccount(state, '7', now);
  const refSub = createSubscription(ref.state, { accountId: ref.account.id, now, days: 30 });
  const friend = ensureTelegramAccount(refSub.state, '42', now);
  const friendSub = createSubscription(friend.state, { accountId: friend.account.id, now, days: 30 });
  const act = activate(friendSub.state, { code: friendSub.result.code, deviceId: DEV, now });
  state = act.state;
  state.referralBinds = [{ friendId: friend.account.id, referrerId: ref.account.id, code: 'OMP-X', boundAt: now - DAY }];
  state.payments = [{ accountId: friend.account.id, at: now - DAY, amount: '200.00', label: 'sub:' + friendSub.result.subscriptionId, operationId: 'op-1' }];
  await writeState(file, state);
  return { file, token: act.result.token as string };
}

describe('/v1/me referral notices', () => {
  it('keeps the notices pending when no bot token is configured', async () => {
    const s = await seeded('');
    const calls: string[] = [];
    const app = createApp(
      s.file,
      async (url: string) => {
        calls.push(String(url));
        return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }), text: async () => '' };
      },
      { env: {} },
    );
    const res = await me(app, s.token, DEV);
    expect(res.status).toBe(200);
    expect(calls.filter((u) => u.indexOf('sendMessage') >= 0)).toHaveLength(0);
    const end = await readState(s.file);
    const days = end.referralJournal.find((row: { variant?: string }) => !row.variant || row.variant === 'days');
    expect(days.status).toBe('granted');
    expect(days.noticePending).toBe(true);
    expect(days.friendNoticePending).toBe(true);
  });

  it('claims and sends the notices once the bot token is set', async () => {
    const s = await seeded('token');
    const calls: { url: string; body: string }[] = [];
    const app = createApp(
      s.file,
      async (url: string, init?: { body?: string }) => {
        calls.push({ url: String(url), body: init && init.body ? String(init.body) : '' });
        return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }), text: async () => '' };
      },
      { env: {} },
    );
    const res = await me(app, s.token, DEV);
    expect(res.status).toBe(200);
    const sent = calls.filter((c) => c.url.indexOf('sendMessage') >= 0);
    expect(sent.some((c) => c.body.indexOf('Друг оплатил подписку') >= 0)).toBe(true);
    expect(sent.some((c) => c.body.indexOf('По приглашению вам начислено') >= 0)).toBe(true);
    const end = await readState(s.file);
    const days = end.referralJournal.find((row: { variant?: string }) => !row.variant || row.variant === 'days');
    expect(days.noticePending).toBe(false);
    expect(days.friendNoticePending).toBe(false);
  });
});
