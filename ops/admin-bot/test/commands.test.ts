import { describe, expect, it } from 'vitest';
import { adminId, adminMessage, isChannel, parseCommand, parseSources, pinNotice, type TgUpdate } from '../src/commands';
import { checkSecret, checkUrl, commandsBody, webhookBody } from '../scripts/webhook.mjs';
import { COMMANDS } from '../src/commandList.mjs';

const KNOWN = ['rutor', 'nnmclub', 'anidub', 'bigfangroup', 'torrentby', 'rutracker', 'kinozal', 'rustorka'];
const msg = (chatId: number, text: string, extra: object = {}): TgUpdate => ({
  update_id: 1,
  message: { message_id: 10, chat: { id: chatId, type: 'private' }, from: { id: chatId }, text, ...extra },
});

describe('parseCommand', () => {
  it('reads the command and its arguments', () => {
    expect(parseCommand('/status')).toEqual({ name: 'status', args: '' });
    expect(parseCommand('  /check   rutor, anidub ')).toEqual({ name: 'check', args: 'rutor, anidub' });
    expect(parseCommand('/CI')).toEqual({ name: 'ci', args: '' });
  });

  it('takes /cmd@this_bot and drops commands to other bots', () => {
    expect(parseCommand('/status@omp_bot', 'omp_bot')).toEqual({ name: 'status', args: '' });
    expect(parseCommand('/status@OMP_Bot rutor', '@omp_bot')).toEqual({ name: 'status', args: 'rutor' });
    expect(parseCommand('/status@other_bot', 'omp_bot')).toBeNull();
  });

  it('is null for a text that is not a command', () => {
    expect(parseCommand('привет')).toBeNull();
    expect(parseCommand('')).toBeNull();
    expect(parseCommand(undefined)).toBeNull();
    expect(parseCommand('/')).toBeNull();
  });
});

describe('admin filter', () => {
  it('answers only the admin chat', () => {
    expect(adminMessage(msg(536445442, '/help'), '536445442')).not.toBeNull();
    expect(adminMessage(msg(111, '/help'), '536445442')).toBeNull();
  });

  it('ignores bots, channel posts, edits and a missing / broken ADMIN_CHAT_ID', () => {
    expect(adminMessage(msg(536445442, '/help', { from: { id: 536445442, is_bot: true } }), '536445442')).toBeNull();
    expect(adminMessage({ update_id: 1, channel_post: { message_id: 1, chat: { id: 536445442 }, text: '/help' } }, '536445442')).toBeNull();
    expect(adminMessage({ update_id: 1 } as TgUpdate, '536445442')).toBeNull();
    expect(adminMessage(msg(536445442, '/help'), '')).toBeNull();
    expect(adminMessage(msg(536445442, '/help'), 'abc')).toBeNull();
    expect(adminId(' -100123 ')).toBe(-100123);
  });
});

describe('pin notice', () => {
  const post = (chat: object, pinned = true): TgUpdate => ({
    update_id: 2,
    channel_post: { message_id: 77, chat: { id: -1001, type: 'channel', ...chat }, ...(pinned ? { pinned_message: { message_id: 76 } } : {}) },
  });

  it('is the «pinned a message» service post of the configured channel', () => {
    expect(pinNotice(post({ username: 'OmpPlyaer' }), '@ompplyaer')).toEqual({ chatId: -1001, messageId: 77 });
    expect(pinNotice(post({}), '-1001')).toEqual({ chatId: -1001, messageId: 77 });
  });

  it('leaves other channels, ordinary posts and an unset CHANNEL_ID alone', () => {
    expect(pinNotice(post({ username: 'other' }), '@ompplyaer')).toBeNull();
    expect(pinNotice(post({ username: 'ompplyaer' }, false), '@ompplyaer')).toBeNull();
    expect(pinNotice(post({ username: 'ompplyaer' }), '')).toBeNull();
    expect(isChannel(undefined, '@x')).toBe(false);
  });
});

describe('parseSources', () => {
  it('takes ids and display-like spellings, comma or space separated, without repeats', () => {
    expect(parseSources('', KNOWN)).toEqual({ ids: [], unknown: [] });
    expect(parseSources('rutor', KNOWN)).toEqual({ ids: ['rutor'], unknown: [] });
    expect(parseSources('Rutor, torrent.by  NNM-Club rutor', KNOWN)).toEqual({ ids: ['rutor', 'torrentby', 'nnmclub'], unknown: [] });
  });

  it('names the unknown ones', () => {
    expect(parseSources('rutor, piratebay', KNOWN)).toEqual({ ids: ['rutor'], unknown: ['piratebay'] });
  });
});

describe('webhook setup script', () => {
  it('asks Telegram only for messages and channel posts, with the secret', () => {
    const body = webhookBody('https://omp-admin-bot.x.workers.dev/', 's'.repeat(32));
    expect(body.allowed_updates).toEqual(['message', 'channel_post']);
    expect(body.secret_token).toBe('s'.repeat(32));
  });

  it('registers the command menu for the admin chat only', () => {
    const body = commandsBody('536445442');
    expect(body.scope).toEqual({ type: 'chat', chat_id: 536445442 });
    expect(body.commands.map((c) => c.command)).toEqual(['status', 'check', 'versions', 'stats', 'ci', 'help']);
    // Telegram: 1–32 chars a-z0-9_, description 1–256
    COMMANDS.forEach((c) => {
      expect(c.command).toMatch(/^[a-z0-9_]{1,32}$/);
      expect(c.description.length).toBeGreaterThan(0);
      expect(c.description.length).toBeLessThanOrEqual(256);
    });
  });

  it('accepts only an https URL and a Telegram-valid secret', () => {
    expect(checkUrl('https://omp-admin-bot.x.workers.dev')).toBe('https://omp-admin-bot.x.workers.dev/');
    expect(() => checkUrl('http://x.dev')).toThrow();
    expect(() => checkUrl('')).toThrow();
    expect(() => checkSecret('short')).toThrow();
    expect(() => checkSecret('has space in it, sixteen+')).toThrow();
    expect(checkSecret('abcDEF_123-abcDEF_123')).toBe('abcDEF_123-abcDEF_123');
  });
});
