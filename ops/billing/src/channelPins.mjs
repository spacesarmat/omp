// The OMP channel's «… pinned a message» service posts. The release workflow (scripts/telegram-post.mjs) pins its
// post; Telegram then adds a service line to the channel, and the Bot API does not return its id. The billing bot
// polls the same bot's updates, so it sees that service post (channel_post with pinned_message) and deletes it.
// Only the configured channel is touched; other channels and ordinary posts are left alone.

/** Update types the bot polls. Telegram remembers the last list, so it is always sent explicitly. */
export const ALLOWED_UPDATES = ['message', 'callback_query', 'channel_post'];

/** The OMP channel; BILLING_CHANNEL overrides it (@name or numeric id), an empty value turns pin cleanup off. */
export const DEFAULT_CHANNEL = '@ompplyaer';

export function channelFromEnv(env) {
  const e = env || {};
  if (e.BILLING_CHANNEL === undefined) return DEFAULT_CHANNEL;
  return String(e.BILLING_CHANNEL).trim();
}

/** True when `chat` is the configured channel: a numeric id, or @username (case-insensitive). */
export function isChannel(chat, want) {
  if (!chat || !want) return false;
  const w = String(want).trim();
  if (!w) return false;
  if (/^-?\d+$/.test(w)) return Number(chat.id) === Number(w);
  const name = w.replace(/^@/, '').toLowerCase();
  return !!chat.username && String(chat.username).toLowerCase() === name;
}

/** The pin service post of the configured channel in this update, or null. */
export function pinNotice(update, channel) {
  const post = update && update.channel_post;
  if (!post || !post.pinned_message || !post.chat || !isChannel(post.chat, channel)) return null;
  if (typeof post.message_id !== 'number') return null;
  return { chatId: post.chat.id, messageId: post.message_id };
}
