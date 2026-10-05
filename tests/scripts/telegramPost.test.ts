import { describe, it, expect } from 'vitest';
// @ts-ignore node builtins, no @types/node in this project
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
// @ts-ignore
import { tmpdir } from 'node:os';
// @ts-ignore
import { join } from 'node:path';
import { postRelease, replacePhoto, repostFiles } from '../../scripts/telegram-post.mjs';
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
function fakeFetch(calls: Call[], fail: (method: string, form: FormData) => Response | Error | null = () => null) {
  return async (url: string, init: { body: FormData }) => {
    const method = url.split('/').pop() as string;
    calls.push({ method, form: init.body });
    const f = fail(method, init.body);
    if (f instanceof Error) throw f;
    if (f) return f;
    return new Response(JSON.stringify({ ok: true, result: { message_id: 7 } }), { status: 200 });
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
    expect(names(calls)).toEqual(['sendPhoto', 'pinChatMessage', 'sendMediaGroup']);
    expect(calls[1].form.get('message_id')).toBe('7');
    expect(calls[1].form.get('disable_notification')).toBe('true');
    expect(String(calls[0].form.get('caption'))).toContain('• Первое');
    expect(String(calls[0].form.get('reply_markup'))).toContain('OMP-1.2.3-arm64.apk');
    const album = calls[2].form;
    expect(JSON.parse(String(album.get('reply_parameters')))).toEqual({ message_id: 7 });
    const media = JSON.parse(String(album.get('media')));
    expect(media.map((m: { type: string; media: string }) => [m.type, m.media])).toEqual([['document', 'attach://file0'], ['document', 'attach://file1']]);
    expect((album.get('file0') as File).name).toBe('OMP-1.2.3-armv7.apk');
    expect((album.get('file1') as File).name).toBe('OMP-1.2.3-webOS.ipk');
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
    expect(names(calls)).toEqual(['sendPhoto', 'pinChatMessage', 'sendMediaGroup', 'sendDocument:OMP-1.2.3-armv7.apk', 'sendDocument:OMP-1.2.3-webOS.ipk', 'sendMessage']);
    expect(String(calls[5].form.get('text'))).toContain('OMP-1.2.3.apk');
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
    expect(names(calls)).toEqual(['sendMediaGroup', 'deleteMessages']);
    expect(JSON.parse(String(calls[0].form.get('reply_parameters')))).toEqual({ message_id: 8 });
    expect(JSON.parse(String(calls[1].form.get('message_ids')))).toEqual([9, 10, 11]);
  });

  it('keeps the old file messages when the repost fails', async () => {
    const root = setup({ 'OMP-1.2.3-armv7.apk': 10, 'OMP-1.2.3-webOS.ipk': 20 });
    const calls: Call[] = [];
    const down = () => new Error('offline');
    await expect(repostFiles({ tag: 'v1.2.3', messageId: 8, deleteIds: [9], dir: join(root, 'build'), token: TOKEN, chat: '@c', fetch: fakeFetch(calls, down) as any, log: () => {} })).rejects.toThrow('network error');
    expect(names(calls)).not.toContain('deleteMessages');
  });
});
