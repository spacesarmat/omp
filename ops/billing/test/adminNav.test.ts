import { describe, expect, it } from 'vitest';
import { codeHash } from '../src/crypto.mjs';
import { searchDesk } from '../src/desk.mjs';
import { createApp } from '../src/server.mjs';
import { ADMIN_SECTIONS } from '../src/adminSections.mjs';
import { ADMIN_PAGES, TAB_IDS } from '../admin/src/lib/nav.ts';
import { tabFromPath, tabFromSearch, urlForTab } from '../admin/src/lib/tabUrl.ts';
import { auditAction, referralStatus, searchKindLabel } from '../admin/src/lib/text.ts';

describe('admin section url', () => {
  it('reads a known tab and falls back to home', () => {
    expect(tabFromSearch('?tab=donations')).toBe('donations');
    expect(tabFromSearch('?tab=replies&id=1')).toBe('replies');
    expect(tabFromSearch('?tab=nope')).toBe('home');
    expect(tabFromSearch('')).toBe('home');
    expect(tabFromPath('/admin/finance')).toBe('finance');
    expect(tabFromPath('/admin/')).toBe('home');
    expect(tabFromPath('/finance')).toBe('finance');
  });

  it('writes the section path and keeps the other query', () => {
    expect(urlForTab('finance', '?tg=9')).toBe('/admin/finance?tg=9');
    expect(urlForTab('home', '?tab=finance&tg=9')).toBe('/admin/?tg=9');
  });

  it('serves the admin page for a section path and 404s an unknown one', async () => {
    const store = { read: async () => ({}), update: async (fn: (s: object) => unknown) => fn({}), registry: {} };
    const app = createApp(store, async () => ({ ok: true, status: 200, text: async () => '', json: async () => ({}) }));
    const finance = await call(app, 'GET', '/admin/finance');
    expect(finance.status).toBe(200);
    expect(finance.body).toContain('id="root"');
    const missing = await call(app, 'GET', '/admin/not-a-section');
    expect(missing.status).toBe(404);
    const asset = await call(app, 'GET', '/admin/logo.svg');
    expect(asset.status).toBe(200);
  });
});

function call(app: (req: unknown, res: unknown) => Promise<void>, method: string, path: string) {
  const req = {
    method,
    url: path,
    headers: { accept: 'text/html' },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {},
  };
  const res = {
    status: 0,
    body: '',
    writeHead(status: number) {
      this.status = status;
    },
    setHeader() {},
    end(buf?: Buffer | string) {
      this.body = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf || '');
    },
  };
  return app(req, res).then(() => res);
}

describe('admin palette pages', () => {
  it('lists every menu section, including finance, donations and bot replies', () => {
    const ids = ADMIN_PAGES.map((p) => p.id);
    expect(ids).toContain('finance');
    expect(ids).toContain('donations');
    expect(ids).toContain('replies');
    expect(new Set(ids).size).toBe(ids.length);
    expect(TAB_IDS).toEqual(ADMIN_SECTIONS);
  });
});

describe('admin russian labels', () => {
  it('names search hits and referral statuses in russian', () => {
    expect(searchKindLabel('account')).toBe('аккаунт');
    expect(searchKindLabel('donation')).toBe('донат');
    expect(searchKindLabel('promo')).toBe('промо');
    expect(searchKindLabel('referral')).toBe('реферал');
    expect(referralStatus('granted')).toBe('начислено');
    expect(referralStatus('waiting')).toBe('ждёт');
    expect(referralStatus('cancelled')).toBe('отменено');
    expect(referralStatus('rejected')).toBe('отклонено');
  });

  it('names audit actions that used to show the raw code', () => {
    expect(auditAction('donate_settings')).toBe('настройки доната');
    expect(auditAction('donate_hide')).toBe('скрытие в донате');
    expect(auditAction('referral_cancel')).toBe('отмена реферала');
    expect(auditAction('stars_refund')).toBe('возврат звёзд');
    expect(auditAction('credit')).toBe('зачёт');
    expect(auditAction('settings_rollback')).toBe('откат настроек');
    expect(auditAction('watch_rank_mod')).toBe('подбор');
    expect(auditAction('broadcast')).toBe('рассылка');
    expect(auditAction('tg_unlink')).toBe('отвязка Telegram');
    expect(auditAction('unknown_code')).toBe('unknown_code');
  });
});

describe('searchDesk', () => {
  const state = {
    accounts: [{ id: 'acc1', telegramUsername: 'mira', telegramId: '2002' }],
    payments: [],
    watchRank: [],
    donations: [{ id: 'd1', accountId: 'acc1', displayName: 'Мира', comment: 'на кофе', amountRub: 300, telegramId: '2002' }],
    promos: [{ id: 'p1', code: 'WELCOME' }],
    referralJournal: [{ id: 'r1', referrerId: 'acc1', friendId: 'acc2', status: 'granted', variant: 'days' }],
  };

  it('finds a donation, a promo and a referral', () => {
    expect(searchDesk(state, [], 'кофе').map((h: { kind: string }) => h.kind)).toContain('donation');
    const hidden = {
      ...state,
      donations: [{ id: 'd2', accountId: 'acc1', displayName: 'Мира', comment: 'черновик', status: 'draft', amountRub: 50 }],
    };
    expect(searchDesk(hidden, [], 'черновик')).toEqual([]);
    expect(searchDesk(state, [], 'welcome')[0]).toMatchObject({ kind: 'promo', href: '/admin/?tab=promos' });
    const ref = searchDesk(state, [], 'acc2')[0];
    expect(ref.kind).toBe('referral');
    expect(ref.href).toBe('/admin/?tab=referral');
    expect(ref.title).toContain('acc2');
  });

  it('keeps the old find paths: @name and an activation code', () => {
    const hash = codeHash('ABCD-2345');
    const found = {
      accounts: [{ id: 'acc1', telegramUsername: 'mira' }],
      subscriptions: [{ id: 'sub1', accountId: 'acc1' }],
      codes: [{ id: 'c1', hash, subscriptionId: 'sub1' }],
      payments: [],
      watchRank: [],
      donations: [],
      promos: [],
      referralJournal: [],
    };
    expect(searchDesk(found, [], '@mira')[0]).toMatchObject({ kind: 'account', id: 'acc1', href: '/admin/?id=acc1' });
    expect(searchDesk(found, [], 'ABCD-2345')[0]).toMatchObject({ kind: 'account', id: 'acc1' });
    found.codes[0].plain = 'ABCD-2345';
    expect(searchDesk(found, [], '@@')).toEqual([]);
  });

  it('names the friend and the referrer on a referral hit', () => {
    const named = {
      accounts: [
        { id: 'acc1', telegramUsername: 'mira' },
        { id: 'acc2', telegramName: 'Олег' },
      ],
      payments: [],
      watchRank: [],
      donations: [],
      promos: [],
      referralJournal: [{ id: 'r1', referrerId: 'acc1', friendId: 'acc2', status: 'granted', variant: 'days' }],
    };
    const hit = searchDesk(named, [], 'олег').find((row: { kind: string }) => row.kind === 'referral');
    expect(hit).toBeTruthy();
    expect(hit.title).toContain('@mira');
    expect(hit.title).toContain('Олег');
  });
});
