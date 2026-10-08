// OMP admin bot: a Cloudflare Worker that receives the OMP Telegram bot's updates by webhook.
// Answers only ADMIN_CHAT_ID (/status /check /versions /stats /ci /help), deletes the «pinned a message» notices in the
// OMP channel, ignores everything else. Setup: ops/admin-bot/README.md.
import { handleUpdate, type Env } from './bot';
import type { TgUpdate } from './commands';

/** The part of Cloudflare's ExecutionContext the bot uses (no @cloudflare/workers-types in this repo). */
export interface WorkerContext {
  waitUntil(p: Promise<unknown>): void;
}

/** Constant-time string compare (the webhook secret). */
export function sameSecret(a: string | null, b: string | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function handleRequest(request: Request, env: Env, ctx: WorkerContext, doFetch: typeof fetch = fetch): Promise<Response> {
  if (request.method !== 'POST') return new Response('Not found', { status: 404 });
  // only Telegram knows the secret (setWebhook secret_token); without it configured nothing is accepted
  if (!sameSecret(request.headers.get('X-Telegram-Bot-Api-Secret-Token'), env.WEBHOOK_SECRET)) {
    return new Response('Forbidden', { status: 403 });
  }
  let update: TgUpdate;
  try {
    update = (await request.json()) as TgUpdate;
  } catch (e) {
    return new Response('Bad request', { status: 400 });
  }
  try {
    await handleUpdate(update, env, {
      fetch: (input, init) => doFetch(input, init),
      waitUntil: (p) => ctx.waitUntil(p.catch(() => undefined)),
      now: () => Date.now(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      log: (line) => console.log(line),
    });
  } catch (e) {
    // a failure is logged, never retried by Telegram (it would repeat the command)
    console.log('update ' + (update && update.update_id) + ': ' + (e instanceof Error ? e.message : String(e)));
  }
  return new Response('ok');
}

export default {
  fetch(request: Request, env: Env, ctx: WorkerContext): Promise<Response> {
    return handleRequest(request, env, ctx);
  },
};
