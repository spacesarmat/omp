import { describe, expect, it } from 'vitest';
import { searchDesk } from '../src/desk.mjs';
import { ADMIN_PAGES } from '../admin/src/lib/nav.ts';
import { tabFromSearch, urlForTab } from '../admin/src/lib/tabUrl.ts';
import { auditAction, referralStatus, searchKindLabel } from '../admin/src/lib/text.ts';

describe('admin section url', () => {
  it('reads a known tab and falls back to home', () => {
    expect(tabFromSearch('?tab=donations')).toBe('donations');
    expect(tabFromSearch('?tab=replies&id=1')).toBe('replies');
    expect(tabFromSearch('?tab=nope')).toBe('home');
    expect(tabFromSearch('')).toBe('home');
  });

  it('writes the tab and keeps the other query', () => {
    expect(urlForTab('finance', '?tg=9')).toBe('/admin/?tg=9&tab=finance');
    expect(urlForTab('home', '?tab=finance&tg=9')).toBe('/admin/?tg=9');
  });
});

describe('admin palette pages', () => {
  it('lists every menu section, including finance, donations and bot replies', () => {
    const ids = ADMIN_PAGES.map((p) => p.id);
    expect(ids).toContain('finance');
    expect(ids).toContain('donations');
    expect(ids).toContain('replies');
    expect(new Set(ids).size).toBe(ids.length);
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
    expect(searchDesk(state, [], 'welcome')[0]).toMatchObject({ kind: 'promo', href: '/admin/?tab=promos' });
    const ref = searchDesk(state, [], 'acc2')[0];
    expect(ref.kind).toBe('referral');
    expect(ref.href).toBe('/admin/?tab=referral');
  });
});
