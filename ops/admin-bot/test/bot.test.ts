// The Worker end to end with a fake fetch: no network.
import { describe, expect, it } from 'vitest';
import { handleRequest, sameSecret } from '../src/index';
import { handleUpdate, type Deps, type Env } from '../src/bot';

const SECRET = 'test-secret-0123456789';
const ENV: Env = {
  TELEGRAM_BOT_TOKEN: '123:TEST-TOKEN',
  GH_TOKEN: 'gh-test',
  WEBHOOK_SECRET: SECRET,
  ADMIN_CHAT_ID: '536445442',
  GITHUB_REPO: 'spacesarmat/omp',
  CHANNEL_ID: '@ompplyaer',
};
const NOW = Date.parse('2026-10-08T12:00:00Z');

type Sent = { url: string; method: string; body: any; headers: Record<string, string> };

function fakeFetch(routes: Record<string, unknown> = {}) {
  const sent: Sent[] = [];
  const fn = async (url: string, init: RequestInit = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    sent.push({ url, method: init.method || 'GET', body, headers: (init.headers || {}) as Record<string, string> });
    if (url.startsWith('https://api.telegram.org/')) {
      return new Response(JSON.stringify({ ok: true, result: { message_id: 500 } }), { status: 200 });
    }
    const path = url.replace('https://api.github.com', '');
    const key = Object.keys(routes).find((k) => path.startsWith(k));
    if (!key) return new Response('{}', { status: 404 });
    const v = routes[key];
    if (v instanceof Response) return v;
    return new Response(typeof v === 'string' ? v : JSON.stringify(v), { status: 200 });
  };
  return { fn, sent, tg: () => sent.filter((s) => s.url.startsWith('https://api.telegram.org/')) };
}

function deps(f: ReturnType<typeof fakeFetch>, later: Promise<unknown>[] = []): Deps {
  return { fetch: f.fn as any, waitUntil: (p) => later.push(p), now: () => NOW, sleep: async () => undefined, log: () => undefined };
}

const update = (chatId: number, text: string) => ({ update_id: 1, message: { message_id: 3, chat: { id: chatId, type: 'private' }, from: { id: chatId }, text } });
const post = (body: unknown, secret: string | null = SECRET) =>
  new Request('https://bot.example/', { method: 'POST', headers: secret ? { 'X-Telegram-Bot-Api-Secret-Token': secret } : {}, body: JSON.stringify(body) });

describe('webhook request', () => {
  it('refuses a request without the right secret and touches nothing', async () => {
    const f = fakeFetch();
    const ctx = { waitUntil: () => undefined };
    expect((await handleRequest(post(update(536445442, '/help'), null), ENV, ctx, f.fn as any)).status).toBe(403);
    expect((await handleRequest(post(update(536445442, '/help'), 'wrong-secret-0123456789'), ENV, ctx, f.fn as any)).status).toBe(403);
    expect((await handleRequest(post(update(536445442, '/help')), { ...ENV, WEBHOOK_SECRET: '' }, ctx, f.fn as any)).status).toBe(403);
    expect((await handleRequest(new Request('https://bot.example/'), ENV, ctx, f.fn as any)).status).toBe(404);
    expect(f.sent).toHaveLength(0);
    expect(sameSecret('abc', 'abc')).toBe(true);
    expect(sameSecret('abc', 'abd')).toBe(false);
  });

  it('answers the admin', async () => {
    const f = fakeFetch();
    const res = await handleRequest(post(update(536445442, '/help')), ENV, { waitUntil: () => undefined }, f.fn as any);
    expect(res.status).toBe(200);
    expect(f.tg()).toHaveLength(1);
    expect(f.tg()[0].url).toBe('https://api.telegram.org/bot123:TEST-TOKEN/sendMessage');
    expect(f.tg()[0].body.chat_id).toBe(536445442);
    expect(f.tg()[0].body.text).toContain('/status');
  });

  it('ignores everyone else silently (200, no message)', async () => {
    const f = fakeFetch();
    const res = await handleRequest(post(update(111, '/status')), ENV, { waitUntil: () => undefined }, f.fn as any);
    expect(res.status).toBe(200);
    expect(f.sent).toHaveLength(0);
  });
});

describe('pin notices in the channel', () => {
  it('deletes the «pinned a message» post of the OMP channel', async () => {
    const f = fakeFetch();
    await handleUpdate(
      { update_id: 9, channel_post: { message_id: 88, chat: { id: -1009, type: 'channel', username: 'ompplyaer' }, pinned_message: { message_id: 87 } } },
      ENV,
      deps(f),
    );
    expect(f.tg().map((s) => s.url.split('/').pop())).toEqual(['deleteMessage']);
    expect(f.tg()[0].body).toEqual({ chat_id: -1009, message_id: 88 });
  });

  it('leaves the channel posts themselves alone', async () => {
    const f = fakeFetch();
    await handleUpdate({ update_id: 9, channel_post: { message_id: 88, chat: { id: -1009, type: 'channel', username: 'ompplyaer' }, text: 'релиз' } }, ENV, deps(f));
    expect(f.sent).toHaveLength(0);
  });
});

describe('commands', () => {
  it('/status reads parser-monitor.json of monitor-state with the token', async () => {
    const f = fakeFetch({
      '/repos/spacesarmat/omp/contents/parser-monitor.json?ref=monitor-state': JSON.stringify({
        updated: '2026-10-08T09:00:00Z',
        sources: { rutor: { status: 'OK', detail: '100 / 99 / 100 результатов' }, torrentby: { status: 'BLOCKED', detail: 'бан IP' } },
      }),
      '/repos/spacesarmat/omp/actions/workflows/parser-monitor.yml/runs': { workflow_runs: [] },
    });
    await handleUpdate(update(536445442, '/status'), ENV, deps(f));
    const gh = f.sent.find((s) => s.url.includes('/contents/parser-monitor.json'))!;
    expect(gh.headers.Authorization).toBe('Bearer gh-test');
    expect(gh.headers['User-Agent']).toBe('omp-admin-bot');
    const reply = f.tg().find((s) => s.url.endsWith('/sendMessage'))!.body;
    expect(reply.parse_mode).toBe('HTML');
    expect(reply.text).toContain('✅ Rutor: 100 / 99 / 100 результатов');
    expect(reply.text).toContain('🚫 torrent.by: бан IP');
    expect(reply.text).toContain('08.10 12:00 МСК (3 ч назад)');
  });

  it('/check rutor starts the monitor with notify and later adds the run link', async () => {
    const f = fakeFetch({
      '/repos/spacesarmat/omp/actions/workflows/parser-monitor.yml/dispatches': new Response(null, { status: 204 }),
      '/repos/spacesarmat/omp/actions/workflows/parser-monitor.yml/runs': {
        workflow_runs: [{ html_url: 'https://github.com/spacesarmat/omp/actions/runs/99', status: 'queued', conclusion: null, created_at: '2026-10-08T12:00:03Z', run_number: 99 }],
      },
    });
    const later: Promise<unknown>[] = [];
    await handleUpdate(update(536445442, '/check rutor'), ENV, deps(f, later));
    const dispatch = f.sent.find((s) => s.url.endsWith('/dispatches'))!;
    expect(dispatch.method).toBe('POST');
    expect(dispatch.body).toEqual({ ref: 'main', inputs: { sources: 'rutor', summary: 'false', dry_run: 'false', notify: 'true' } });
    expect(f.tg()[0].body.text).toContain('🚀 Запустил проверку: Rutor');
    await Promise.all(later);
    const edit = f.tg().find((s) => s.url.endsWith('/editMessageText'))!;
    expect(edit.body.message_id).toBe(500);
    expect(edit.body.text).toContain('<a href="https://github.com/spacesarmat/omp/actions/runs/99">Запуск #99</a>');
  });

  it('/check with an unknown source starts nothing', async () => {
    const f = fakeFetch();
    await handleUpdate(update(536445442, '/check piratebay'), ENV, deps(f));
    expect(f.sent.some((s) => s.url.includes('api.github.com'))).toBe(false);
    expect(f.tg()[0].body.text).toContain('Не знаю источник: piratebay');
  });

  it('a GitHub error becomes a short message without the token', async () => {
    const f = fakeFetch({ '/repos/spacesarmat/omp/actions/workflows/parser-monitor.yml/dispatches': new Response('{"message":"Resource not accessible"}', { status: 403 }) });
    await handleUpdate(update(536445442, '/check'), ENV, deps(f));
    const text = f.tg()[0].body.text as string;
    expect(text).toContain('⚠️ Не получилось: GitHub запуск parser-monitor.yml: HTTP 403 Resource not accessible');
    expect(text).not.toContain('gh-test');
  });

  it('/ci asks for the main CI runs on main', async () => {
    const f = fakeFetch({ '/repos/spacesarmat/omp/actions/workflows/': { workflow_runs: [] } });
    await handleUpdate(update(536445442, '/ci'), ENV, deps(f));
    expect(f.sent.some((s) => s.url.includes('/actions/workflows/ci.yml/runs?per_page=1&branch=main'))).toBe(true);
    expect(f.sent.some((s) => s.url.includes('/actions/workflows/release.yml/runs'))).toBe(true);
    expect(f.tg().find((s) => s.url.endsWith('/sendMessage'))!.body.text).toContain('запусков нет');
  });

  it('an unknown command or plain text points to /help', async () => {
    const f = fakeFetch();
    await handleUpdate(update(536445442, '/nope'), ENV, deps(f));
    await handleUpdate(update(536445442, 'привет'), ENV, deps(f));
    expect(f.tg().map((s) => s.body.text)).toEqual(['Нет такой команды. /help — список.', 'Не понял. /help — список команд.']);
  });
});
