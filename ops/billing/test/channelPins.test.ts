import { describe, expect, it } from 'vitest';
import { ALLOWED_UPDATES, DEFAULT_CHANNEL, channelFromEnv, isChannel, pinNotice } from '../src/channelPins.mjs';

const post = (chat: object, pinned = true, id: unknown = 88) => ({
  update_id: 9,
  channel_post: { message_id: id, chat: { id: -1009, type: 'channel', ...chat }, ...(pinned ? { pinned_message: { message_id: 87 } } : { text: 'релиз' }) },
});

describe('allowed updates', () => {
  it('asks for messages, button presses and channel posts', () => {
    expect(ALLOWED_UPDATES).toEqual(['message', 'callback_query', 'channel_post']);
  });
});

describe('channel', () => {
  it('defaults to the OMP channel; BILLING_CHANNEL overrides it, empty turns cleanup off', () => {
    expect(DEFAULT_CHANNEL).toBe('@ompplyaer');
    expect(channelFromEnv({})).toBe('@ompplyaer');
    expect(channelFromEnv({ BILLING_CHANNEL: '-1001234' })).toBe('-1001234');
    expect(channelFromEnv({ BILLING_CHANNEL: ' ' })).toBe('');
  });

  it('matches @username case-insensitively or a numeric id', () => {
    expect(isChannel({ id: -1009, username: 'OmpPlyaer' }, '@ompplyaer')).toBe(true);
    expect(isChannel({ id: -1009, username: 'ompplyaer' }, 'ompplyaer')).toBe(true);
    expect(isChannel({ id: -1009 }, '-1009')).toBe(true);
    expect(isChannel({ id: -1009, username: 'other' }, '@ompplyaer')).toBe(false);
    expect(isChannel({ id: -1009 }, '@ompplyaer')).toBe(false);
    expect(isChannel(undefined, '@ompplyaer')).toBe(false);
    expect(isChannel({ id: -1009, username: 'ompplyaer' }, '')).toBe(false);
  });
});

describe('pin notice', () => {
  it('finds the «pinned a message» post of the OMP channel', () => {
    expect(pinNotice(post({ username: 'ompplyaer' }), '@ompplyaer')).toEqual({ chatId: -1009, messageId: 88 });
  });

  it('leaves other channels, ordinary posts, messages and an unset channel alone', () => {
    expect(pinNotice(post({ username: 'other' }), '@ompplyaer')).toBeNull();
    expect(pinNotice(post({ username: 'ompplyaer' }, false), '@ompplyaer')).toBeNull();
    expect(pinNotice(post({ username: 'ompplyaer' }), '')).toBeNull();
    expect(pinNotice(post({ username: 'ompplyaer' }, true, 'x'), '@ompplyaer')).toBeNull();
    expect(pinNotice({ update_id: 1, message: { message_id: 1, chat: { id: 5, type: 'private' }, pinned_message: {} } } as any, '@ompplyaer')).toBeNull();
    expect(pinNotice({ update_id: 1 } as any, '@ompplyaer')).toBeNull();
  });
});
