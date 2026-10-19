import { describe, expect, it } from 'vitest';
import { activate, createSubscription, ensureTelegramAccount, issueCliAdminLogin } from '../src/logic.mjs';
import { createApp } from '../src/server.mjs';
import { emptyState } from '../src/state.mjs';
import { readState, writeState, testStore } from './pg';
import { toStore } from '../src/db/index.mjs';
import { createAdminAuthMemory } from '../src/adminAuthMemory.mjs';

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

async function call(app: App, path: string, headers: Record<string, string> = {}) {
  const req = {
    method: 'GET',
    url: path,
    headers: { accept: 'application/json', ...headers },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {},
  };
  const res = mockRes();
  await app(req, res);
  return { status: res.status, body: res.body, headers: res.headers };
}

const MD = '# Изменения\n\n## 0.20.5\n\n- Подписка: лимит\n- [tech] Биллинг на Postgres 17\n';

async function seeded() {
  const file = await testStore();
  const now = Date.now();
  let state = emptyState();
  const opened = ensureTelegramAccount(state, '42', now);
  const created = createSubscription(opened.state, { accountId: opened.account.id, now, days: 30 });
  state = activate(created.state, { code: created.result.code, deviceId: 'a'.repeat(32), now }).state;
  await writeState(file, state);
  return file;
}

function changelogNet() {
  const calls: string[] = [];
  const net = async (url: string) => {
    calls.push(String(url));
    if (String(url).startsWith('https://raw.githubusercontent.com/spacesarmat/omp/main/CHANGELOG')) {
      return { ok: true, status: 200, text: async () => (String(url).endsWith('.en.md') ? '# Changes\n' : MD), json: async () => ({}) };
    }
    return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
  };
  return { net, calls };
}

async function login(app: App, file: unknown) {
  const issued = await toStore(file).update((cur: any) => issueCliAdminLogin(cur, { now: Date.now() }));
  const once = await call(app, '/admin/login/once?token=' + encodeURIComponent(issued.token));
  expect(once.status).toBe(302);
  const cookie = String(once.headers['set-cookie'] || '');
  const m = /omp_admin=([^;]+)/.exec(cookie);
  expect(m).toBeTruthy();
  return 'omp_admin=' + m![1];
}

describe('GET /admin/api/changelog', () => {
  it('is 401 without an admin session and never asks GitHub', async () => {
    const file = await seeded();
    const { net, calls } = changelogNet();
    const app = createApp(file, net, { env: {} });
    const res = await call(app, '/admin/api/changelog');
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body)).toEqual({ auth: false });
    const forged = await call(app, '/admin/api/changelog', { cookie: 'omp_admin=forged' });
    expect(forged.status).toBe(401);
    expect(calls.filter((u) => u.includes('CHANGELOG'))).toEqual([]);
  });

  it('an admin gets the parsed versions with the tech flag, cached between calls', async () => {
    const file = await seeded();
    const { net, calls } = changelogNet();
    const app = createApp(file, net, { env: {} });
    const cookie = await login(app, file);
    const res = await call(app, '/admin/api/changelog', { cookie });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.ru).toEqual([
      {
        version: '0.20.5',
        unreleased: false,
        beta: false,
        items: [
          { text: 'Подписка: лимит', tech: false, platform: '' },
          { text: 'Биллинг на Postgres 17', tech: true, platform: '' },
        ],
      },
    ]);
    await call(app, '/admin/api/changelog', { cookie });
    expect(calls.filter((u) => u.includes('CHANGELOG'))).toHaveLength(2);
  });

  it('works in a read-only admin login (BILLING_READONLY) without writing', async () => {
    const file = await seeded();
    const { net } = changelogNet();
    const app = createApp(file, net, { env: {}, readOnly: true, adminAuthMem: createAdminAuthMemory() });
    const cookie = await login(app, file);
    const frozen = JSON.stringify(await readState(file));
    const res = await call(app, '/admin/api/changelog', { cookie });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).ru[0].items[1].tech).toBe(true);
    expect(JSON.stringify(await readState(file))).toBe(frozen);
  });
});
