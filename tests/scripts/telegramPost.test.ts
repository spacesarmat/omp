import { describe, it, expect } from 'vitest';
// @ts-ignore node builtins, no @types/node in this project
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
// @ts-ignore
import { tmpdir } from 'node:os';
// @ts-ignore
import { join } from 'node:path';
import { postRelease, replacePhoto, repostFiles, ALBUM_MAX, BUTTONS_TEXT, WEBHOOK_NOTICE_LOG } from '../../scripts/telegram-post.mjs';
import { UPLOAD_MAX } from '../../scripts/telegram-lib.mjs';

const TOKEN = '123:SECRET-TOKEN';

function setup(sizes: Record<string, number>) {
  const root = mkdtempSync(join(tmpdir(), 'omp-tg-'));
  mkdirSync(join(root, 'src/lib'), { recursive: true });
  mkdirSync(join(root, 'assets/telegram'), { recursive: true });
  mkdirSync(join(root, 'build'));
  writeFileSync(join(root, 'CHANGELOG.md'), '## 1.2.3\n\n- Первое\n- Второе\n\n## 1.2.2\n\n- Старое\n');
  writeFileSync(join(root, 'src/lib/donate.ts'), "export const DONATE_URL = 'https://example.org/donate';\n");
  writeFileSync(join(root, 'assets/telegram/omp-telegram.png'), 'png');
  for (const [name, size] of Object.entries(sizes)) writeFileSync(join(root, 'build', name), new Uint8Array(size).fill(1));
  return root;
}

type Call = { method: string; form: FormData };
// the pin notice lookup (getWebhookInfo, getUpdates, delete of notice 999) goes to `side`, so `calls` keeps the release flow only
const NOTICE = 999;
function fakeFetch(calls: Call[], fail: (method: string, form: FormData) => Response | Error | null = () => null, side: Call[] = []) {
  let pinned = 0;
  return async (url: string, init: { body: FormData }) => {
    const method = url.split('/').pop() as string;
    const notice = method === 'getUpdates' || method === 'getWebhookInfo' || (method === 'deleteMessages' && init.body.get('message_ids') === `[${NOTICE}]`);
    (notice ? side : calls).push({ method, form: init.body });
    const f = fail(method, init.body);
    if (f instanceof Error) throw f;
    if (f) return f;
    if (method === 'pinChatMessage') pinned = Number(init.body.get('message_id'));
    const doc = method === 'sendDocument' ? (init.body.get('document') as File) : null;
    const result =
      method === 'sendMediaGroup'
        ? JSON.parse(String(init.body.get('media'))).map((_: unknown, i: number) => ({ message_id: 50 + i }))
        : method === 'getWebhookInfo'
        ? { url: '' }
        : method === 'getUpdates'
        ? init.body.get('offset') ? [] : [{ update_id: 40, channel_post: { message_id: 5 } }, { update_id: 41, channel_post: { message_id: NOTICE, pinned_message: { message_id: pinned } } }]
        : doc ? { message_id: 100 + calls.length, document: { file_id: 'id:' + doc.name } } : { message_id: 7 };
    return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
  };
}
const names = (calls: Call[]) => calls.map((c) => c.method + (c.method === 'sendDocument' ? ':' + (c.form.get('document') as File).name : ''));

describe('postRelease', () => {
  it('posts the photo, uploads small files in order and links the big ones', async () => {
    const root = setup({
      'OMP-1.2.3-arm64.apk': UPLOAD_MAX + 1,
      'OMP-1.2.3-armv7.apk': 10,
      'OMP-1.2.3-webOS.ipk': 20,
      'OMP-1.2.3.apk': UPLOAD_MAX + 5,
    });
    const calls: Call[] = [];
    const logs: string[] = [];
    const failed = await postRelease({ tag: 'v1.2.3', dir: join(root, 'build'), root, token: TOKEN, chat: '@c', fetch: fakeFetch(calls) as any, log: (s: string) => logs.push(s) });
    expect(failed).toBe(0);
    expect(names(calls)).toEqual(['sendPhoto', 'pinChatMessage', 'sendDocument:OMP-1.2.3-armv7.apk', 'sendDocument:OMP-1.2.3-webOS.ipk', 'sendMediaGroup', 'deleteMessages']);
    expect(calls[2].form.get('disable_notification')).toBe('true');
    expect(JSON.parse(String(calls[5].form.get('message_ids')))).toEqual([103, 104]);
    expect(calls[1].form.get('message_id')).toBe('7');
    expect(calls[1].form.get('disable_notification')).toBe('true');
    expect(String(calls[0].form.get('caption'))).toContain('• Первое');
    expect(String(calls[0].form.get('reply_markup'))).toContain('OMP-1.2.3-arm64.apk');
    const album = calls[4].form;
    expect(JSON.parse(String(album.get('reply_parameters')))).toEqual({ message_id: 7 });
    const media = JSON.parse(String(album.get('media')));
    expect(media.map((m: { type: string; media: string }) => [m.type, m.media])).toEqual([['document', 'id:OMP-1.2.3-armv7.apk'], ['document', 'id:OMP-1.2.3-webOS.ipk']]);
    expect(media[0].caption).toBeUndefined();
    const text = media[1].caption as string;
    expect(media[1].parse_mode).toBe('HTML');
    expect(text).toContain('Файл OMP-1.2.3-arm64.apk больше 50 МБ — скачать: https://github.com/spacesarmat/omp/releases/download/v1.2.3/OMP-1.2.3-arm64.apk');
    expect(text).toContain('OMP-1.2.3.apk');
    expect(logs.filter((l) => l.includes('forward it manually'))).toHaveLength(2);
  });

  it('links a file Telegram refuses, logs missing files, and never leaks the token', async () => {
    const root = setup({ 'OMP-1.2.3-armv7.apk': 10 });
    const calls: Call[] = [];
    const logs: string[] = [];
    const refuse = (m: string) =>
      m === 'sendDocument' ? new Response(JSON.stringify({ ok: false, description: 'Request Entity Too Large' }), { status: 413 })
        : m === 'pinChatMessage' ? new Response(JSON.stringify({ ok: false, description: 'not enough rights' }), { status: 400 }) : null;
    const failed = await postRelease({ tag: 'v1.2.3', dir: join(root, 'build'), root, token: TOKEN, chat: '@c', fetch: fakeFetch(calls, refuse) as any, log: (s: string) => logs.push(s) });
    expect(failed).toBe(1);
    expect(names(calls)).toEqual(['sendPhoto', 'pinChatMessage', 'sendDocument:OMP-1.2.3-armv7.apk', 'sendMessage']);
    expect(String(calls[3].form.get('text'))).toContain('OMP-1.2.3-armv7.apk');
    expect(logs.some((l) => l.includes('pinChatMessage'))).toBe(true);
    expect(logs).toContain('Telegram: OMP-1.2.3-arm64.apk not found, skipped');
    expect(logs.some((l) => l.includes('forward it manually'))).toBe(true);
    expect(logs.join('\n')).not.toContain(TOKEN);
  });

  it('a network error carries no URL or token', async () => {
    const root = setup({});
    const boom = async (url: string) => {
      throw new TypeError('fetch failed for ' + url);
    };
    let msg = '';
    try {
      await postRelease({ tag: 'v1.2.3', dir: join(root, 'build'), root, token: TOKEN, chat: '@c', fetch: boom as any, log: () => {} });
    } catch (e: any) {
      msg = String(e.message);
    }
    expect(msg).toBe('Telegram sendPhoto: network error');
    expect(msg).not.toContain(TOKEN);
  });
});

describe('replacePhoto', () => {
  it('swaps the picture of a posted release and keeps its caption and buttons', async () => {
    const root = setup({});
    mkdirSync(join(root, 'docs/screenshots'), { recursive: true });
    writeFileSync(join(root, 'docs/screenshots/release-1.2.3.png'), 'cover');
    const calls: Call[] = [];
    await replacePhoto({ tag: 'v1.2.3', messageId: 8, root, token: TOKEN, chat: '@omp', fetch: fakeFetch(calls) as any, log: () => {} });
    expect(names(calls)).toEqual(['editMessageMedia', 'pinChatMessage']);
    const f = calls[0].form;
    expect(f.get('message_id')).toBe('8');
    const media = JSON.parse(f.get('media') as string);
    expect(media).toMatchObject({ type: 'photo', media: 'attach://photo', parse_mode: 'HTML' });
    expect(media.caption).toContain('Первое');
    expect(JSON.parse(f.get('reply_markup') as string).inline_keyboard.length).toBeGreaterThan(0);
    expect((f.get('photo') as File).name).toBe('release-1.2.3.png');
  });
});

describe('files as one block', () => {
  it('falls back to one file per message when Telegram refuses the album', async () => {
    const root = setup({ 'OMP-1.2.3-armv7.apk': 10, 'OMP-1.2.3-webOS.ipk': 20, 'OMP-1.2.3.apk': UPLOAD_MAX + 5 });
    const calls: Call[] = [];
    const logs: string[] = [];
    const refuse = (m: string) => (m === 'sendMediaGroup' ? new Response(JSON.stringify({ ok: false, description: 'Request Entity Too Large' }), { status: 413 }) : null);
    const failed = await postRelease({ tag: 'v1.2.3', dir: join(root, 'build'), root, token: TOKEN, chat: '@c', fetch: fakeFetch(calls, refuse) as any, log: (s: string) => logs.push(s) });
    expect(failed).toBe(0);
    expect(names(calls)).toEqual(['sendPhoto', 'pinChatMessage', 'sendDocument:OMP-1.2.3-armv7.apk', 'sendDocument:OMP-1.2.3-webOS.ipk', 'sendMediaGroup', 'deleteMessages', 'sendDocument:OMP-1.2.3-armv7.apk', 'sendDocument:OMP-1.2.3-webOS.ipk', 'sendMessage']);
    expect(JSON.parse(String(calls[5].form.get('message_ids')))).toEqual([103, 104]);
    expect(String(calls[8].form.get('text'))).toContain('OMP-1.2.3.apk');
    expect(logs.some((l) => l.includes('one by one'))).toBe(true);
  });

  it('a single file carries the links as its caption', async () => {
    const root = setup({ 'OMP-1.2.3-webOS.ipk': 20, 'OMP-1.2.3.apk': UPLOAD_MAX + 5 });
    const calls: Call[] = [];
    await postRelease({ tag: 'v1.2.3', dir: join(root, 'build'), root, token: TOKEN, chat: '@c', fetch: fakeFetch(calls) as any, log: () => {} });
    expect(names(calls)).toEqual(['sendPhoto', 'pinChatMessage', 'sendDocument:OMP-1.2.3-webOS.ipk']);
    expect(String(calls[2].form.get('caption'))).toContain('OMP-1.2.3.apk');
  });

  it('reposts the files of a posted release as one block, then deletes the old file messages', async () => {
    const root = setup({ 'OMP-1.2.3-armv7.apk': 10, 'OMP-1.2.3-webOS.ipk': 20 });
    const calls: Call[] = [];
    const failed = await repostFiles({ tag: 'v1.2.3', messageId: 8, deleteIds: [9, 10, 11], dir: join(root, 'build'), token: TOKEN, chat: '@c', fetch: fakeFetch(calls) as any, log: () => {} });
    expect(failed).toBe(0);
    expect(names(calls)).toEqual(['sendDocument:OMP-1.2.3-armv7.apk', 'sendDocument:OMP-1.2.3-webOS.ipk', 'sendMediaGroup', 'deleteMessages', 'deleteMessages']);
    expect(JSON.parse(String(calls[2].form.get('reply_parameters')))).toEqual({ message_id: 8 });
    expect(JSON.parse(String(calls[4].form.get('message_ids')))).toEqual([9, 10, 11]);
  });

  it('keeps the old file messages when the repost fails', async () => {
    const root = setup({ 'OMP-1.2.3-armv7.apk': 10, 'OMP-1.2.3-webOS.ipk': 20 });
    const calls: Call[] = [];
    const down = () => new Error('offline');
    await expect(repostFiles({ tag: 'v1.2.3', messageId: 8, deleteIds: [9], dir: join(root, 'build'), token: TOKEN, chat: '@c', fetch: fakeFetch(calls, down) as any, log: () => {} })).rejects.toThrow('network error');
    expect(names(calls)).not.toContain('deleteMessages');
  });
});

describe('photo album of a stable release', () => {
  function withShots(root: string, version: string, shots: string[]) {
    mkdirSync(join(root, `docs/screenshots/release-${version}`), { recursive: true });
    writeFileSync(join(root, `docs/screenshots/release-${version}.png`), 'cover');
    for (const s of shots) writeFileSync(join(root, `docs/screenshots/release-${version}`, s), 'shot');
  }
  const media = (c: Call) => JSON.parse(String(c.form.get('media')));

  it('posts the cover and the screenshots by name, pins the first photo, then the files and the buttons as replies', async () => {
    const root = setup({ 'OMP-1.2.3-armv7.apk': 10, 'OMP-1.2.3-webOS.ipk': 20 });
    withShots(root, '1.2.3', ['03-player.png', '01-discover.png', 'notes.txt', '02-search.jpg']);
    const calls: Call[] = [];
    const logs: string[] = [];
    const failed = await postRelease({ tag: 'v1.2.3', dir: join(root, 'build'), root, token: TOKEN, chat: '@c', fetch: fakeFetch(calls) as any, log: (s: string) => logs.push(s) });
    expect(failed).toBe(0);
    expect(names(calls)).toEqual(['sendMediaGroup', 'pinChatMessage', 'sendDocument:OMP-1.2.3-armv7.apk', 'sendDocument:OMP-1.2.3-webOS.ipk', 'sendMediaGroup', 'deleteMessages', 'sendMessage']);
    const album = calls[0].form;
    const items = media(calls[0]);
    expect(items.map((m: { type: string; media: string }) => [m.type, m.media])).toEqual([0, 1, 2, 3].map((i) => ['photo', `attach://photo${i}`]));
    expect([0, 1, 2, 3].map((i) => (album.get(`photo${i}`) as File).name)).toEqual(['release-1.2.3.png', '01-discover.png', '02-search.jpg', '03-player.png']);
    expect((album.get('photo2') as File).type).toBe('image/jpeg');
    expect(items[0].caption).toContain('• Первое');
    expect(items[0].parse_mode).toBe('HTML');
    expect(items.slice(1).every((m: { caption?: string }) => m.caption === undefined)).toBe(true);
    expect(album.get('reply_markup')).toBeNull();
    // the first photo of the album is the post: pinned silently, the files and the buttons reply to it
    expect(calls[1].form.get('message_id')).toBe('50');
    expect(calls[1].form.get('disable_notification')).toBe('true');
    expect(JSON.parse(String(calls[4].form.get('reply_parameters')))).toEqual({ message_id: 50 });
    const buttons = calls[6].form;
    expect(buttons.get('text')).toBe(BUTTONS_TEXT);
    expect(BUTTONS_TEXT).toBe('Скачать и подробности:');
    expect(JSON.parse(String(buttons.get('reply_parameters')))).toEqual({ message_id: 50 });
    expect(String(buttons.get('reply_markup'))).toContain('OMP-1.2.3-armv7.apk');
    expect(logs).toContain('Telegram: posted 1.2.3 as an album of 4 photos');
  });

  it('takes at most 10 photos: the cover and the first 9 screenshots', async () => {
    const root = setup({});
    withShots(root, '1.2.3', Array.from({ length: 12 }, (_, i) => `${String(12 - i).padStart(2, '0')}-shot.png`));
    const calls: Call[] = [];
    await postRelease({ tag: 'v1.2.3', dir: join(root, 'build'), root, token: TOKEN, chat: '@c', fetch: fakeFetch(calls) as any, log: () => {} });
    expect(media(calls[0])).toHaveLength(ALBUM_MAX);
    expect(ALBUM_MAX).toBe(10);
    const files = Array.from({ length: 10 }, (_, i) => (calls[0].form.get(`photo${i}`) as File).name);
    expect(files).toEqual(['release-1.2.3.png', ...Array.from({ length: 9 }, (_, i) => `${String(i + 1).padStart(2, '0')}-shot.png`)]);
    expect(calls[0].form.get('photo10')).toBeNull();
  });

  it('falls back to the single photo with the buttons when the album is refused', async () => {
    const root = setup({ 'OMP-1.2.3-webOS.ipk': 20 });
    withShots(root, '1.2.3', ['01-discover.png']);
    const calls: Call[] = [];
    const logs: string[] = [];
    const refuse = (m: string, f: FormData) => (m === 'sendMediaGroup' && String(f.get('media')).includes('"photo"') ? new Response(JSON.stringify({ ok: false, description: 'Bad Request: wrong file' }), { status: 400 }) : null);
    const failed = await postRelease({ tag: 'v1.2.3', dir: join(root, 'build'), root, token: TOKEN, chat: '@c', fetch: fakeFetch(calls, refuse) as any, log: (s: string) => logs.push(s) });
    expect(failed).toBe(0);
    expect(names(calls)).toEqual(['sendMediaGroup', 'sendPhoto', 'pinChatMessage', 'sendDocument:OMP-1.2.3-webOS.ipk']);
    expect((calls[1].form.get('photo') as File).name).toBe('release-1.2.3.png');
    expect(String(calls[1].form.get('reply_markup'))).toContain('inline_keyboard');
    expect(calls[2].form.get('message_id')).toBe('7');
    expect(JSON.parse(String(calls[3].form.get('reply_parameters')))).toEqual({ message_id: 7 });
    expect(logs.some((l) => l.includes('sendMediaGroup') && l.includes('posting a single photo instead'))).toBe(true);
    expect(logs.join('\n')).not.toContain(TOKEN);
  });

  it('a pre-release stays a single photo even with screenshots', async () => {
    const root = setup({});
    writeFileSync(join(root, 'CHANGELOG.md'), '## 1.2.3-rc.1\n\n- Первое\n');
    withShots(root, '1.2.3-rc.1', ['01-discover.png']);
    const calls: Call[] = [];
    await postRelease({ tag: 'v1.2.3-rc.1', dir: join(root, 'build'), root, token: TOKEN, chat: '@c', fetch: fakeFetch(calls) as any, log: () => {} });
    expect(names(calls)).toEqual(['sendPhoto', 'pinChatMessage']);
    expect((calls[0].form.get('photo') as File).name).toBe('release-1.2.3-rc.1.png');
    expect(calls[0].form.get('reply_markup')).not.toBeNull();
  });

  it('a stable release without screenshots (missing or empty folder) stays a single photo', async () => {
    for (const shots of [null, [] as string[], ['readme.txt']]) {
      const root = setup({ 'OMP-1.2.3-webOS.ipk': 20 });
      if (shots) withShots(root, '1.2.3', shots);
      const calls: Call[] = [];
      await postRelease({ tag: 'v1.2.3', dir: join(root, 'build'), root, token: TOKEN, chat: '@c', fetch: fakeFetch(calls) as any, log: () => {} });
      expect(names(calls)).toEqual(['sendPhoto', 'pinChatMessage', 'sendDocument:OMP-1.2.3-webOS.ipk']);
      expect(calls[0].form.get('reply_markup')).not.toBeNull();
    }
  });

  it('replacing the cover of an album post sends no buttons', async () => {
    const root = setup({});
    withShots(root, '1.2.3', ['01-discover.png']);
    const calls: Call[] = [];
    await replacePhoto({ tag: 'v1.2.3', messageId: 50, root, token: TOKEN, chat: '@omp', fetch: fakeFetch(calls) as any, log: () => {} });
    expect(names(calls)).toEqual(['editMessageMedia', 'pinChatMessage']);
    expect(calls[0].form.get('reply_markup')).toBeNull();
    expect((calls[0].form.get('photo') as File).name).toBe('release-1.2.3.png');
    expect(JSON.parse(String(calls[0].form.get('media'))).caption).toContain('Первое');
  });
});

describe('pin notice', () => {
  it('deletes the «pinned a message» line of the release post and confirms the updates', async () => {
    const root = setup({});
    const calls: Call[] = [];
    const side: Call[] = [];
    const logs: string[] = [];
    await postRelease({ tag: 'v1.2.3', dir: join(root, 'build'), root, token: TOKEN, chat: '@c', fetch: fakeFetch(calls, () => null, side) as any, log: (s: string) => logs.push(s) });
    expect(side.map((c) => c.method)).toEqual(['getWebhookInfo', 'getUpdates', 'getUpdates', 'deleteMessages']);
    expect(side[2].form.get('offset')).toBe('42');
    expect(logs).toContain(`Telegram: deleted the pin notice ${NOTICE}`);
  });

  it('leaves the notice when it never shows up in the updates', async () => {
    const root = setup({});
    const calls: Call[] = [];
    const side: Call[] = [];
    const logs: string[] = [];
    const none = (m: string) => (m === 'getUpdates' ? new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 }) : null);
    const pauses: number[] = [];
    await postRelease({ tag: 'v1.2.3', dir: join(root, 'build'), root, token: TOKEN, chat: '@c', fetch: fakeFetch(calls, none, side) as any, log: (s: string) => logs.push(s), pause: async (ms: number) => { pauses.push(ms); } });
    expect(side.filter((c) => c.method === 'getUpdates')).toHaveLength(5);
    expect(pauses).toHaveLength(4);
    expect(logs).toContain('Telegram: pin notice not found, left in the channel');
  });

  it('skips getUpdates when the admin bot has a webhook on the bot (the Worker deletes the notice)', async () => {
    const root = setup({});
    const calls: Call[] = [];
    const side: Call[] = [];
    const logs: string[] = [];
    const hook = (m: string) => (m === 'getWebhookInfo' ? new Response(JSON.stringify({ ok: true, result: { url: 'https://omp-admin-bot.example.workers.dev/' } }), { status: 200 }) : null);
    await postRelease({ tag: 'v1.2.3', dir: join(root, 'build'), root, token: TOKEN, chat: '@c', fetch: fakeFetch(calls, hook, side) as any, log: (s: string) => logs.push(s) });
    expect(side.map((c) => c.method)).toEqual(['getWebhookInfo']);
    expect(logs).toContain(WEBHOOK_NOTICE_LOG);
    // the release itself is unchanged
    expect(names(calls)).toEqual(['sendPhoto', 'pinChatMessage']);
  });

  it('treats a 409 from getUpdates as «a webhook is on» and goes on with the release', async () => {
    const root = setup({});
    const calls: Call[] = [];
    const side: Call[] = [];
    const logs: string[] = [];
    const conflict = (m: string) =>
      m === 'getUpdates' ? new Response(JSON.stringify({ ok: false, description: "Conflict: can't use getUpdates method while webhook is active" }), { status: 409 }) : null;
    const failed = await postRelease({ tag: 'v1.2.3', dir: join(root, 'build'), root, token: TOKEN, chat: '@c', fetch: fakeFetch(calls, conflict, side) as any, log: (s: string) => logs.push(s) });
    expect(failed).toBe(0);
    expect(side.map((c) => c.method)).toEqual(['getWebhookInfo', 'getUpdates']);
    expect(logs).toContain(WEBHOOK_NOTICE_LOG);
  });
});
