// Telegram Bot API calls of the admin bot. Errors never contain the token (it is part of the URL).
import type { Fetch } from './github';

export class Telegram {
  constructor(
    private token: string,
    private doFetch: Fetch,
  ) {}

  async call<T = unknown>(method: string, body: { [k: string]: unknown }): Promise<T> {
    let res: Response;
    try {
      res = await this.doFetch('https://api.telegram.org/bot' + this.token + '/' + method, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new Error('Telegram ' + method + ': нет связи');
    }
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
    if (!j.ok) throw new Error('Telegram ' + method + ': ' + res.status + ' ' + (j.description || ''));
    return j.result as T;
  }

  /** An HTML message without link previews. Resolves to its message id. */
  async send(chatId: number, html: string): Promise<number> {
    const m = await this.call<{ message_id: number }>('sendMessage', {
      chat_id: chatId,
      text: html,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
    return m.message_id;
  }

  async edit(chatId: number, messageId: number, html: string): Promise<void> {
    await this.call('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: html,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  }

  async typing(chatId: number): Promise<void> {
    await this.call('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => undefined);
  }

  async deleteMessage(chatId: number, messageId: number): Promise<void> {
    await this.call('deleteMessage', { chat_id: chatId, message_id: messageId });
  }
}
