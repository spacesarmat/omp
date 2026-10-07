export const ALLOWED_UPDATES: string[];
export function webhookBody(url: string, secret: string): { url: string; secret_token: string; allowed_updates: string[]; drop_pending_updates: boolean; max_connections: number };
export function commandsBody(adminChatId: string): { commands: { command: string; description: string }[]; scope: { type: 'chat'; chat_id: number } };
export function checkUrl(raw: string): string;
export function checkSecret(s: string): string;
