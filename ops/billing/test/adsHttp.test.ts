import { describe, expect, it } from 'vitest';
import { issueCliAdminLogin } from '../src/logic.mjs';
import { createApp } from '../src/server.mjs';
import { emptyState } from '../src/state.mjs';
import { readOnlyStore } from '../src/readOnly.mjs';
import { testStore, updateState, writeState } from './pg';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function mockRes() {
  return {
    status: 0,
    headers: {} as Record<string, string | number>,
    body: Buffer.alloc(0),
    writeHead(status: number, headers?: Record<string, string>) {
      this.status = status;
      if (headers) Object.assign(this.headers, headers);
    },
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
    },
    end(buf?: Buffer | string) {
      this.body = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf || ''));
    },
  };
}

async function call(app: Any, method: string, path: string, opts: { headers?: Record<string, string>; body?: unknown; form?: Record<string, string> } = {}) {
  const payload = opts.form ? new URLSearchParams(opts.form).toString() : opts.body === undefined ? '' : JSON.stringify(opts.body);
  const req = {
    method,
    url: path,
    headers: {
      accept: 'application/json',
      'content-type': opts.form ? 'application/x-www-form-urlencoded' : 'application/json',
      ...(opts.headers || {}),
    },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload);
    },
  };
  const res = mockRes();
  await app(req, res);
  let data: Any = null;
  try {
    data = JSON.parse(res.body.toString('utf8'));
  } catch (e) {
    data = null;
  }
  return { status: res.status, headers: res.headers, data, raw: res.body };
}

const noFetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }), text: async () => '', headers: {} });
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);

async function admin(store: Any, app: Any) {
  const link = await updateState(store, (s: Any) => issueCliAdminLogin(s, { now: Date.now() }));
  const once = await call(app, 'GET', '/admin/login/once?token=' + encodeURIComponent(link.token));
  const cookie = String(once.headers['set-cookie'] || '').split(';')[0];
  const home = await call(app, 'GET', '/admin/api/home', { headers: { cookie } });
  return { cookie, csrf: home.data.csrf as string };
}

describe('ads over HTTP (Postgres)', () => {
  it('off by default; the admin uploads an image, saves a banner (erid required), turns ads on; the app reads and counts', async () => {
    const store = await testStore();
    await writeState(store, emptyState());
    const app = createApp(store, noFetch, { env: {} });

    const off = await call(app, 'GET', '/v1/ads-config');
    expect(off.status).toBe(200);
    expect(off.data).toEqual({ v: 1, enabled: false, ttlSec: 300 });
    expect(off.headers['cache-control']).toBe('public, max-age=300');
    const again = await call(app, 'GET', '/v1/ads-config', { headers: { 'if-none-match': String(off.headers.etag) } });
    expect(again.status).toBe(304);

    // the admin needs a session and the csrf
    expect((await call(app, 'GET', '/admin/api/ads')).status).toBe(401);
    const { cookie, csrf } = await admin(store, app);
    expect((await call(app, 'POST', '/admin/ads/config', { headers: { cookie }, body: { enabled: true } })).status).toBe(403);

    const up = await call(app, 'POST', '/admin/ads/image', { headers: { cookie }, body: { csrf, mime: 'image/png', data: PNG.toString('base64') } });
    expect(up.data.ok).toBe(true);
    const imageId = up.data.extra.imageId as string;
    const img = await call(app, 'GET', '/v1/ads/img/' + imageId);
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.raw.equals(PNG)).toBe(true);
    expect((await call(app, 'GET', '/v1/ads/img/' + 'f'.repeat(24))).status).toBe(404);
    expect((await call(app, 'GET', '/v1/ads/img/..%2Fx')).status).toBe(404);

    const fields = { title: 'Приставка', text: 'Скидка', advertiser: 'ООО Ромашка', url: 'https://shop.example/', image: imageId };
    const noErid = await call(app, 'POST', '/admin/ads/banner', { headers: { cookie }, body: { csrf, banner: fields } });
    expect(noErid.data.ok).toBe(false);
    expect(noErid.data.flash.error).toContain('erid');
    const saved = await call(app, 'POST', '/admin/ads/banner', { headers: { cookie }, body: { csrf, banner: { ...fields, erid: '2SDnjcVm1aB' } } });
    expect(saved.data.ok).toBe(true);
    const bannerId = saved.data.extra.bannerId as string;

    // still off: a banner alone does not turn ads on
    expect((await call(app, 'GET', '/v1/ads-config')).data.enabled).toBe(false);
    const bad = await call(app, 'POST', '/admin/ads/config', { headers: { cookie }, body: { csrf, everyN: 2 } });
    expect(bad.data.flash.error).toContain('6-30');
    const on = await call(app, 'POST', '/admin/ads/config', { headers: { cookie }, body: { csrf, enabled: true, everyN: 12 } });
    expect(on.data.ok).toBe(true);
    const cfg = await call(app, 'GET', '/v1/ads-config');
    expect(cfg.data.enabled).toBe(true);
    expect(cfg.data.everyN).toBe(12);
    expect(cfg.data.banners.map((b: Any) => b.id)).toEqual([bannerId]);
    expect(cfg.data.banners[0].url).toBe('https://shop.example/?erid=2SDnjcVm1aB');
    expect(cfg.raw.toString()).not.toMatch(/token|secret|password/i);

    // events: a form field with JSON (the app's native http posts forms); no device id is stored
    const ev = JSON.stringify([
      { b: bannerId, s: 'mine', p: 'phone', t: 'i', n: 2 },
      { b: bannerId, s: 'mine', p: 'phone', t: 'c' },
      { b: 'unknown0', s: 'mine', p: 'phone', t: 'i' },
    ]);
    const posted = await call(app, 'POST', '/v1/ads/event', { form: { events: ev, deviceId: 'd'.repeat(32) } });
    expect(posted.status).toBe(200);
    expect(posted.data).toEqual({ ok: true, accepted: 1, dropped: 1 });
    await call(app, 'POST', '/v1/ads/event', { body: { events: [{ b: bannerId, s: 'discoverGrid', p: 'phone', t: 'i' }] } });
    expect((await call(app, 'POST', '/v1/ads/event', { body: { events: 'x' } })).status).toBe(400);
    const cols = (await store.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'ad_stats' AND table_schema = current_schema()")).rows.map((r: Any) => r.column_name).sort();
    expect(cols).toEqual(['banner_id', 'clicks', 'day', 'impressions', 'platform', 'section']);

    const stats = await call(app, 'GET', '/admin/api/ads?days=7', { headers: { cookie } });
    expect(stats.data.config.banners).toHaveLength(1);
    expect(stats.data.stats.total).toEqual({ impressions: 3, clicks: 1 });
    expect(stats.data.stats.bySection.map((x: Any) => x.key)).toEqual(['mine', 'discoverGrid']);

    // the audit has every change
    const audit = (await store.read()).audit.map((a: Any) => a.action);
    expect(audit).toEqual(expect.arrayContaining(['ads_banner_add', 'ads_config']));

    // removal needs confirm=yes
    expect((await call(app, 'POST', '/admin/ads/banner-remove', { headers: { cookie }, body: { csrf, id: bannerId } })).data.ok).toBe(false);
    const rm = await call(app, 'POST', '/admin/ads/banner-remove', { headers: { cookie }, body: { csrf, id: bannerId, confirm: 'yes' } });
    expect(rm.data.ok).toBe(true);
    expect((await call(app, 'GET', '/v1/ads-config')).data.enabled).toBe(false);
  });

  it('read-only mode: the config is still served, events get 503', async () => {
    const store = await testStore();
    await writeState(store, emptyState());
    const app = createApp(store, noFetch, { env: {}, readOnly: true });
    expect((await call(app, 'GET', '/v1/ads-config')).status).toBe(200);
    const ev = await call(app, 'POST', '/v1/ads/event', { body: { events: [] } });
    expect(ev.status).toBe(503);
    await expect(readOnlyStore(store).ads.bump('2026-10-19', [{ banner: 'x', section: 'mine', platform: 'phone', impressions: 1, clicks: 0 }])).rejects.toThrow(/read-only/);
  });

  it('public ad GETs allow any origin without credentials; other routes stay closed', async () => {
    const store = await testStore();
    await writeState(store, emptyState());
    const app = createApp(store, noFetch, { env: {} });
    const cfg = await call(app, 'GET', '/v1/ads-config');
    expect(cfg.status).toBe(200);
    expect(cfg.headers['access-control-allow-origin']).toBe('*');
    expect(cfg.headers['access-control-allow-credentials']).toBeUndefined();
    const again = await call(app, 'GET', '/v1/ads-config', { headers: { 'if-none-match': String(cfg.headers.etag) } });
    expect(again.status).toBe(304);
    expect(again.headers['access-control-allow-origin']).toBe('*');
    const missing = await call(app, 'GET', '/v1/ads/img/' + 'a'.repeat(24));
    expect(missing.status).toBe(404);
    expect(missing.headers['access-control-allow-origin']).toBe('*');
    const health = await call(app, 'GET', '/health');
    expect(health.headers['access-control-allow-origin']).toBeUndefined();
    const ev = await call(app, 'POST', '/v1/ads/event', { form: { events: '[]' } });
    expect(ev.headers['access-control-allow-origin']).toBeUndefined();
    const opt = await call(app, 'OPTIONS', '/v1/ads-config');
    expect(opt.status).toBe(204);
    expect(opt.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('re-uploading an unused image renews the grace period', async () => {
    const store = await testStore();
    const id = '4'.repeat(24);
    const now = Date.now();
    await store.ads.putImage({ id, mime: 'image/png', bytes: PNG }, now - 2 * 24 * 60 * 60 * 1000);
    await store.ads.putImage({ id, mime: 'image/png', bytes: PNG }, now);
    expect(await store.ads.gcImages([], now)).toBe(0);
    expect(await store.ads.getImage(id)).not.toBeNull();
  });

  it('retention drops ad counters older than 90 days and unused images', async () => {
    const store = await testStore();
    await writeState(store, emptyState());
    const now = Date.UTC(2026, 9, 19, 12, 0, 0);
    await store.ads.bump('2026-07-01', [{ banner: 'b1', section: 'mine', platform: 'phone', impressions: 5, clicks: 0 }]);
    await store.ads.bump('2026-10-01', [{ banner: 'b1', section: 'mine', platform: 'phone', impressions: 2, clicks: 1 }]);
    await store.ads.bump('2026-10-01', [{ banner: 'b1', section: 'mine', platform: 'phone', impressions: 1, clicks: 0 }]);
    const r = await store.retention(now);
    expect(r.adStats).toBe(1);
    expect(await store.ads.since('2026-01-01')).toEqual([{ day: '2026-10-01', banner: 'b1', section: 'mine', platform: 'phone', impressions: 3, clicks: 1 }]);
    await store.ads.putImage({ id: '1'.repeat(24), mime: 'image/png', bytes: PNG }, now - 2 * 24 * 60 * 60 * 1000);
    await store.ads.putImage({ id: '2'.repeat(24), mime: 'image/png', bytes: PNG }, now - 2 * 24 * 60 * 60 * 1000);
    await store.ads.putImage({ id: '3'.repeat(24), mime: 'image/png', bytes: PNG }, now);
    expect(await store.ads.gcImages(['1'.repeat(24)], now)).toBe(1);
    expect(await store.ads.getImage('2'.repeat(24))).toBeNull();
    expect(await store.ads.getImage('3'.repeat(24))).not.toBeNull();
  });
});
