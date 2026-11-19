import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { expect, test } from '@playwright/test';
import { ADMIN_PAGES } from '../admin/src/lib/nav.ts';
import { ADMIN_SECTIONS } from '../src/adminSections.mjs';
import { createPgStore } from '../src/db/pg/store.mjs';
import { createPromo, issueCliAdminLogin } from '../src/logic.mjs';
import { createApp } from '../src/server.mjs';

const URL = process.env.BILLING_TEST_DATABASE_URL || '';
const NOW = Date.now();
const HOUR = 60 * 60 * 1000;

function pin(rub: number) {
  return { rub, until: NOW + 24 * HOUR, at: NOW, reason: 'тест' };
}

function quote(rub: number, source: string) {
  return { rub, source, at: NOW };
}

test('login, every section, revoke confirm, and the subscription rate', async ({ page }) => {
  test.skip(!URL, 'needs BILLING_TEST_DATABASE_URL');
  const schema = 'e2e_' + NOW.toString(36) + '_' + randomBytes(3).toString('hex');
  const store = await createPgStore({ connectionString: URL, schema });
  let token = '';
  await store.update((state: { settings?: Record<string, unknown> }) => {
    const priced = {
      ...state,
      settings: {
        ...(state.settings || {}),
        priceRub: 200,
        extraDeviceRub: 50,
        rates: {
          refreshMin: 12,
          pins: { star: pin(1.3), usdt: pin(90), ton: pin(200), btc: pin(8_000_000) },
          cache: {
            usd: quote(90, 'cbr'),
            usdt: quote(90, 'cryptopay'),
            ton: quote(200, 'cryptopay'),
            btc: quote(8_000_000, 'cryptopay'),
          },
          fetchedAt: NOW,
        },
      },
    };
    const promo = createPromo(priced, { code: 'E2EPROMO', days: 7, maxUses: 1, now: NOW });
    const login = issueCliAdminLogin(promo.state, { now: NOW });
    token = login.result.token;
    return { state: login.state };
  });
  const app = createApp(store, async () => ({
    ok: true,
    status: 200,
    headers: { get: () => '' },
    json: async () => ({ ok: true }),
    text: async () => '',
  }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : 0;
  const origin = 'http://127.0.0.1:' + port;
  await page.route('**/*fonts.google*', (route) => route.abort());
  await page.route('**/*fonts.gstatic*', (route) => route.abort());
  const posts: string[] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST') posts.push(req.url());
  });
  try {
    await page.goto(origin + '/admin/login/once?token=' + encodeURIComponent(token), { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Обзор' })).toBeVisible();

    for (const id of ADMIN_SECTIONS) {
      if (id === 'home') continue;
      const res = await page.request.get(origin + '/admin/' + id);
      expect(res.status(), id).toBe(200);
      expect(await res.text(), id).toContain('id="root"');
    }
    for (const item of ADMIN_PAGES) {
      if (item.id === 'home') continue;
      await page.getByRole('button', { name: item.label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp('/admin/' + item.id + '($|\\?)'));
    }

    await page.goto(origin + '/admin/settings', { waitUntil: 'domcontentloaded' });
    const rateLine = page.getByText(/подписка \d+/);
    await expect(rateLine).toBeVisible();
    const before = ((await rateLine.innerText()).match(/подписка (\d+)/) || [])[1];
    expect(before).toBeTruthy();
    await page.locator('#priceRub').fill('250');
    const saved = page.waitForResponse((res) => res.request().method() === 'POST' && res.url().indexOf('/admin/settings') >= 0);
    const refreshed = page.waitForResponse((res) => res.request().method() === 'GET' && res.url().indexOf('/admin/api/home') >= 0);
    await page.getByRole('button', { name: 'Сохранить' }).first().click();
    await saved;
    await refreshed;
    await expect(rateLine).toContainText('подписка ');
    const after = ((await rateLine.innerText()).match(/подписка (\d+)/) || [])[1];
    expect(after).toBeTruthy();
    expect(after).not.toBe(before);

    await page.goto(origin + '/admin/promos', { waitUntil: 'domcontentloaded' });
    const dialog = page.getByRole('dialog', { name: 'Отозвать промокод' });
    const row = page.getByRole('row', { name: 'E2EPROMO' });
    await row.getByRole('button', { name: 'Отозвать', exact: true }).click();
    await expect(dialog).toBeVisible();
    expect(posts.filter((url) => url.indexOf('promo-revoke') >= 0)).toEqual([]);
    await dialog.getByRole('button', { name: 'Отмена' }).click();
    await expect(dialog).toBeHidden();
    expect(posts.filter((url) => url.indexOf('promo-revoke') >= 0)).toEqual([]);
    await row.getByRole('button', { name: 'Отозвать', exact: true }).click();
    await dialog.getByRole('button', { name: 'Отозвать', exact: true }).click();
    await expect(row.getByText('отозван', { exact: true })).toBeVisible();
    expect(posts.filter((url) => url.indexOf('promo-revoke') >= 0)).toHaveLength(1);
  } finally {
    await page.context().close().catch(() => undefined);
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await store.close();
    const pg = (await import('pg')).default;
    const client = new pg.Client({ connectionString: URL });
    await client.connect();
    try {
      await client.query('DROP SCHEMA IF EXISTS "' + schema.replace(/"/g, '""') + '" CASCADE');
    } finally {
      await client.end();
    }
  }
});
