// Reading Telegram updates: who wrote, which command, which sources. Pure functions (unit tested).

export interface TgChat {
  id: number;
  type?: string;
  username?: string;
}

export interface TgMessage {
  message_id: number;
  chat: TgChat;
  from?: { id: number; is_bot?: boolean };
  text?: string;
  pinned_message?: { message_id: number };
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  channel_post?: TgMessage;
}

export interface Command {
  /** Lower case, without the slash and the @botname suffix. */
  name: string;
  /** The rest of the text, trimmed. */
  args: string;
}

/**
 * «/check rutor» → { name: 'check', args: 'rutor' }; «/status@omp_bot» → { name: 'status', args: '' }. A command
 * addressed to another bot (@other_bot) and a text that is not a command → null.
 */
export function parseCommand(text: string | undefined, botUsername?: string): Command | null {
  const m = /^\/([A-Za-z0-9_]{1,32})(?:@([A-Za-z0-9_]{3,64}))?(?:\s+([\s\S]*))?$/.exec((text || '').trim());
  if (!m) return null;
  if (m[2] && botUsername && m[2].toLowerCase() !== botUsername.replace(/^@/, '').toLowerCase()) return null;
  return { name: m[1].toLowerCase(), args: (m[3] || '').trim() };
}

/** The admin's chat id from the ADMIN_CHAT_ID var; NaN when it is missing or not a number (then nobody is admin). */
export function adminId(raw: string | undefined): number {
  const s = (raw || '').trim();
  return /^-?\d+$/.test(s) ? Number(s) : NaN;
}

/** The message the bot answers: a message in the admin chat. Anything else (other people, groups, channels) → null. */
export function adminMessage(update: TgUpdate, adminChatId: string | undefined): TgMessage | null {
  const admin = adminId(adminChatId);
  const msg = update && update.message;
  if (!msg || !msg.chat || !isFinite(admin)) return null;
  if (msg.chat.id !== admin) return null;
  if (msg.from && msg.from.is_bot) return null;
  return msg;
}

/** Does the chat match the CHANNEL_ID var («@ompplyaer» or a numeric id like -1001234567890)? */
export function isChannel(chat: TgChat | undefined, channel: string | undefined): boolean {
  const want = (channel || '').trim();
  if (!chat || !want) return false;
  if (/^-?\d+$/.test(want)) return chat.id === Number(want);
  const name = want.replace(/^@/, '').toLowerCase();
  return !!chat.username && chat.username.toLowerCase() === name;
}

/**
 * The «… pinned a message» service post in the OMP channel (the release workflow pins its post): the Worker deletes it.
 * Before the webhook the release workflow found it with getUpdates; a webhook makes getUpdates unavailable.
 */
export function pinNotice(update: TgUpdate, channel: string | undefined): { chatId: number; messageId: number } | null {
  const post = update && update.channel_post;
  if (!post || !post.pinned_message || !isChannel(post.chat, channel)) return null;
  return { chatId: post.chat.id, messageId: post.message_id };
}

/**
 * /check arguments → source ids. «rutor», «rutor,anidub», «Rutor Anidub» → ['rutor', 'anidub']; empty → [] (all).
 * Unknown ids are returned apart, so the bot can name them.
 */
export function parseSources(args: string, known: string[]): { ids: string[]; unknown: string[] } {
  const words = args
    .toLowerCase()
    .split(/[\s,;]+/)
    .map((w) => w.trim())
    .filter(Boolean);
  const ids: string[] = [];
  const unknown: string[] = [];
  words.forEach((w) => {
    const id = known.indexOf(w) >= 0 ? w : known.filter((k) => k.replace(/[^a-z0-9]/g, '') === w.replace(/[^a-z0-9]/g, ''))[0];
    if (!id) unknown.push(w);
    else if (ids.indexOf(id) < 0) ids.push(id);
  });
  return { ids, unknown };
}
