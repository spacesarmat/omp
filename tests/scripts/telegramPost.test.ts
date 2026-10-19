import { describe, it, expect } from 'vitest';
// @ts-ignore node builtins, no @types/node in this project
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
// @ts-ignore
import { tmpdir } from 'node:os';
// @ts-ignore
import { join } from 'node:path';
import { postRelease, replacePhoto, ALBUM_MAX, BUTTONS_TEXT } from '../../scripts/telegram-post.mjs';

const TOKEN = '123:SECRET-TOKEN';

function setup(sizes: Record<string, number>) {
  const root = mkdtempSync(join(tmpdir(), 'omp-tg-'));
  mkdirSync(join(root, 'src/lib'), { recursive: true });
  mkdirSync(join(root, 'assets/telegram'), { recursive: true });
  mkdirSync(join(root, 'build'));
  writeFileSync(join(root, 'CHANGELOG.md'), '# Изменения\n\n## 1.2.3\n\n- Первое\n- Второе\n\n## 1.2.2\n\n- Старое\n');
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
  it('posts only the photo with the caption and the buttons: no files, no links text, even with builds in build/', async () => {
    const root = setup({ 'OMP-1.2.3-arm64.apk': 30, 'OMP-1.2.3-armv7.apk': 10, 'OMP-1.2.3-webOS.ipk': 20, 'OMP-1.2.3.apk': 40 });
    const calls: Call[] = [];
    const logs: string[] = [];
    const failed = await postRelease({ tag: 'v1.2.3', root, token: TOKEN, chat: '@c', fetch: fakeFetch(calls) as any, log: (s: string) => logs.push(s) });
    expect(failed).toBe(0);
    expect(names(calls)).toEqual(['sendPhoto', 'pinChatMessage']);
    expect(calls[1].form.get('message_id')).toBe('7');
    expect(calls[1].form.get('disable_notification')).toBe('true');
    const caption = String(calls[0].form.get('caption'));
    expect(caption).toContain('• Первое');
    expect(caption).not.toMatch(/<a |https?:|GitHub/);
    const urls = JSON.parse(String(calls[0].form.get('reply_markup'))).inline_keyboard.flat().map((b: { url: string }) => b.url);
    for (const f of ['OMP-1.2.3-arm64.apk', 'OMP-1.2.3-armv7.apk', 'OMP-1.2.3-webOS.ipk', 'OMP-1.2.3.apk']) {
      expect(urls).toContain(`https://github.com/spacesarmat/omp/releases/download/v1.2.3/${f}`);
    }
    expect(urls).toContain('https://github.com/spacesarmat/omp/releases/tag/v1.2.3');
    expect(logs.some((l) => /forward it manually|not found, skipped/.test(l))).toBe(false);
    expect(logs.join('\n')).not.toContain(TOKEN);
  });

  it('a network error carries no URL or token', async () => {
    const root = setup({});
    const boom = async (url: string) => {
      throw new TypeError('fetch failed for ' + url);
    };
    let msg = '';
    try {
      await postRelease({ tag: 'v1.2.3', root, token: TOKEN, chat: '@c', fetch: boom as any, log: () => {} });
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

describe('photo album of a stable release', () => {
  function withShots(root: string, version: string, shots: string[]) {
    mkdirSync(join(root, `docs/screenshots/release-${version}`), { recursive: true });
    writeFileSync(join(root, `docs/screenshots/release-${version}.png`), 'cover');
    for (const s of shots) writeFileSync(join(root, `docs/screenshots/release-${version}`, s), 'shot');
  }
  const media = (c: Call) => JSON.parse(String(c.form.get('media')));

  it('posts the cover and the screenshots by name, pins the first photo, then only the buttons as a reply', async () => {
    const root = setup({ 'OMP-1.2.3-armv7.apk': 10, 'OMP-1.2.3-webOS.ipk': 20 });
    withShots(root, '1.2.3', ['03-player.png', '01-discover.png', 'notes.txt', '02-search.jpg']);
    const calls: Call[] = [];
    const logs: string[] = [];
    const failed = await postRelease({ tag: 'v1.2.3', root, token: TOKEN, chat: '@c', fetch: fakeFetch(calls) as any, log: (s: string) => logs.push(s) });
    expect(failed).toBe(0);
    expect(names(calls)).toEqual(['sendMediaGroup', 'pinChatMessage', 'sendMessage']);
    const album = calls[0].form;
    const items = media(calls[0]);
    expect(items.map((m: { type: string; media: string }) => [m.type, m.media])).toEqual([0, 1, 2, 3].map((i) => ['photo', `attach://photo${i}`]));
    expect([0, 1, 2, 3].map((i) => (album.get(`photo${i}`) as File).name)).toEqual(['release-1.2.3.png', '01-discover.png', '02-search.jpg', '03-player.png']);
    expect((album.get('photo2') as File).type).toBe('image/jpeg');
    expect(items[0].caption).toContain('• Первое');
    expect(items[0].parse_mode).toBe('HTML');
    expect(items.slice(1).every((m: { caption?: string }) => m.caption === undefined)).toBe(true);
    expect(album.get('reply_markup')).toBeNull();
    // the first photo of the album is the post: pinned silently, the buttons reply to it
    expect(calls[1].form.get('message_id')).toBe('50');
    expect(calls[1].form.get('disable_notification')).toBe('true');
    const buttons = calls[2].form;
    expect(buttons.get('text')).toBe(BUTTONS_TEXT);
    expect(BUTTONS_TEXT).toBe('Скачать и подробности:');
    expect(JSON.parse(String(buttons.get('reply_parameters')))).toEqual({ message_id: 50 });
    expect(String(buttons.get('reply_markup'))).toContain('OMP-1.2.3-armv7.apk');
    expect(logs).toContain('Telegram: posted 1.2.3 as an album of 4 photos');
  });

  it('retries the buttons of an album once, then counts them as failed (they are the only download links)', async () => {
    for (const refusals of [1, 2]) {
      const root = setup({ 'OMP-1.2.3-webOS.ipk': 20 });
      withShots(root, '1.2.3', ['01-discover.png']);
      const calls: Call[] = [];
      const logs: string[] = [];
      let left = refusals;
      const refuse = (m: string) => (m === 'sendMessage' && left-- > 0 ? new Response(JSON.stringify({ ok: false, description: 'Too Many Requests' }), { status: 429 }) : null);
      const pauses: number[] = [];
      const failed = await postRelease({ tag: 'v1.2.3', root, token: TOKEN, chat: '@c', fetch: fakeFetch(calls, refuse) as any, log: (s: string) => logs.push(s), pause: async (ms: number) => { pauses.push(ms); } });
      expect(names(calls).filter((n) => n === 'sendMessage')).toHaveLength(2);
      expect(pauses).toEqual([3000]);
      expect(failed).toBe(refusals === 1 ? 0 : 1);
      expect(logs.some((l) => l.includes('retrying the buttons'))).toBe(true);
      expect(logs.some((l) => l.includes('the buttons were not posted'))).toBe(refusals === 2);
      expect(logs.join('\n')).not.toContain(TOKEN);
    }
  });

  it('takes at most 10 photos: the cover and the first 9 screenshots', async () => {
    const root = setup({});
    withShots(root, '1.2.3', Array.from({ length: 12 }, (_, i) => `${String(12 - i).padStart(2, '0')}-shot.png`));
    const calls: Call[] = [];
    await postRelease({ tag: 'v1.2.3', root, token: TOKEN, chat: '@c', fetch: fakeFetch(calls) as any, log: () => {} });
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
    const failed = await postRelease({ tag: 'v1.2.3', root, token: TOKEN, chat: '@c', fetch: fakeFetch(calls, refuse) as any, log: (s: string) => logs.push(s) });
    expect(failed).toBe(0);
    expect(names(calls)).toEqual(['sendMediaGroup', 'sendPhoto', 'pinChatMessage']);
    expect((calls[1].form.get('photo') as File).name).toBe('release-1.2.3.png');
    expect(String(calls[1].form.get('reply_markup'))).toContain('inline_keyboard');
    expect(calls[2].form.get('message_id')).toBe('7');
    expect(logs.some((l) => l.includes('sendMediaGroup') && l.includes('posting a single photo instead'))).toBe(true);
    expect(logs.join('\n')).not.toContain(TOKEN);
  });

  it('a pre-release stays a single photo even with screenshots', async () => {
    const root = setup({});
    writeFileSync(join(root, 'CHANGELOG.md'), '# Изменения\n\n## 1.2.3-rc.1\n\n- Первое\n');
    withShots(root, '1.2.3-rc.1', ['01-discover.png']);
    const calls: Call[] = [];
    await postRelease({ tag: 'v1.2.3-rc.1', root, token: TOKEN, chat: '@c', fetch: fakeFetch(calls) as any, log: () => {} });
    expect(names(calls)).toEqual(['sendPhoto', 'pinChatMessage']);
    expect((calls[0].form.get('photo') as File).name).toBe('release-1.2.3-rc.1.png');
    expect(calls[0].form.get('reply_markup')).not.toBeNull();
  });

  it('a stable release without screenshots (missing or empty folder) stays a single photo', async () => {
    for (const shots of [null, [] as string[], ['readme.txt']]) {
      const root = setup({ 'OMP-1.2.3-webOS.ipk': 20 });
      if (shots) withShots(root, '1.2.3', shots);
      const calls: Call[] = [];
      await postRelease({ tag: 'v1.2.3', root, token: TOKEN, chat: '@c', fetch: fakeFetch(calls) as any, log: () => {} });
      expect(names(calls)).toEqual(['sendPhoto', 'pinChatMessage']);
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

describe('pin and bot updates', () => {
  it('pins the post and never polls the bot (the billing bot owns getUpdates and deletes the pin notice)', async () => {
    const root = setup({});
    const calls: Call[] = [];
    const side: Call[] = [];
    const failed = await postRelease({ tag: 'v1.2.3', root, token: TOKEN, chat: '@c', fetch: fakeFetch(calls, () => null, side) as any, log: () => undefined });
    expect(failed).toBe(0);
    expect(names(calls)).toEqual(['sendPhoto', 'pinChatMessage']);
    expect(side).toEqual([]);
  });

  it('a failed pin is only logged', async () => {
    const root = setup({});
    const calls: Call[] = [];
    const logs: string[] = [];
    const noPin = (m: string) => (m === 'pinChatMessage' ? new Response(JSON.stringify({ ok: false, description: 'not enough rights' }), { status: 400 }) : null);
    const failed = await postRelease({ tag: 'v1.2.3', root, token: TOKEN, chat: '@c', fetch: fakeFetch(calls, noPin) as any, log: (s: string) => logs.push(s) });
    expect(failed).toBe(0);
    expect(logs.some((l) => l.includes('pin messages'))).toBe(true);
  });
});

describe('no polling or webhook calls anywhere in the release scripts and workflows', () => {
  it('scripts/*.mjs and .github/workflows never call getUpdates, setWebhook or deleteWebhook', () => {
    const files = [
      ...readdirSync('scripts').filter((f: string) => /\.(mjs|js|ts)$/.test(f)).map((f: string) => 'scripts/' + f),
      ...readdirSync('.github/workflows').map((f: string) => '.github/workflows/' + f),
    ];
    const bad = files.filter((f: string) => /getUpdates|setWebhook|deleteWebhook|getWebhookInfo/.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
});
