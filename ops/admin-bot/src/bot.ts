// What the bot does with one Telegram update. The Worker entry (index.ts) checks the webhook secret first.
import { BUILTIN_SOURCE_NAMES } from '../../../src/sources/sourceNames';
import { adminMessage, parseCommand, parseSources, pinNotice, type TgUpdate } from './commands';
import {
  FEEDS,
  checkStarted,
  errorText,
  formatCi,
  formatStats,
  formatStatus,
  formatVersions,
  helpText,
  link,
  unknownSources,
  type MonitorStateFile,
  type RunInfo,
} from './format';
import { GitHub, type Fetch } from './github';
import { Telegram } from './telegram';

export interface Env {
  /** Secret: the OMP bot's token (the same as the repository secret TELEGRAM_BOT_TOKEN). */
  TELEGRAM_BOT_TOKEN: string;
  /** Secret: fine-grained GitHub token (see README). */
  GH_TOKEN: string;
  /** Secret: Telegram sends it in X-Telegram-Bot-Api-Secret-Token (setWebhook secret_token). */
  WEBHOOK_SECRET: string;
  /** Var: the only chat the bot answers. */
  ADMIN_CHAT_ID: string;
  /** Var: owner/repo. */
  GITHUB_REPO?: string;
  /** Var: the OMP channel (@name or id) whose «pinned a message» notices the bot deletes; empty = none. */
  CHANNEL_ID?: string;
  /** Var: the bot's @username, to tell «/status@this_bot» from commands to other bots in a group; optional. */
  BOT_USERNAME?: string;
}

export interface Deps {
  fetch: Fetch;
  /** ctx.waitUntil: work after the webhook answered (Cloudflare allows ~30 s of it). */
  waitUntil: (p: Promise<unknown>) => void;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
}

export const MONITOR_WORKFLOW = 'parser-monitor.yml';
export const MONITOR_STATE_BRANCH = 'monitor-state';
const WORKFLOWS: { title: string; file: string; branch?: string }[] = [
  { title: 'CI (main)', file: 'ci.yml', branch: 'main' },
  { title: 'Release', file: 'release.yml' },
  { title: 'Parser monitor', file: MONITOR_WORKFLOW },
];

export async function handleUpdate(update: TgUpdate, env: Env, deps: Deps): Promise<void> {
  const tg = new Telegram(env.TELEGRAM_BOT_TOKEN, deps.fetch);

  // the release workflow pins its post: Telegram adds a «… pinned a message» line, deleted here (see README)
  const notice = pinNotice(update, env.CHANNEL_ID);
  if (notice) {
    await tg.deleteMessage(notice.chatId, notice.messageId).catch((e) => deps.log(e instanceof Error ? e.message : String(e)));
    return;
  }

  const msg = adminMessage(update, env.ADMIN_CHAT_ID);
  // everyone else: silence
  if (!msg) return;
  const chatId = msg.chat.id;
  const cmd = parseCommand(msg.text, env.BOT_USERNAME);
  if (!cmd) {
    await tg.send(chatId, 'Не понял. /help — список команд.');
    return;
  }
  const gh = new GitHub(env.GH_TOKEN, env.GITHUB_REPO || 'spacesarmat/omp', deps.fetch);
  try {
    switch (cmd.name) {
      case 'start':
      case 'help':
        await tg.send(chatId, helpText());
        return;
      case 'status':
        await tg.typing(chatId);
        await tg.send(chatId, await statusText(gh, deps.now()));
        return;
      case 'check':
        await check(tg, gh, chatId, cmd.args, deps);
        return;
      case 'versions':
        await tg.typing(chatId);
        await tg.send(chatId, await versionsText(gh));
        return;
      case 'stats':
        await tg.typing(chatId);
        await tg.send(chatId, await statsText(gh));
        return;
      case 'ci':
        await tg.typing(chatId);
        await tg.send(chatId, await ciText(gh, deps.now()));
        return;
      default:
        await tg.send(chatId, 'Нет такой команды. /help — список.');
    }
  } catch (e) {
    deps.log('command /' + cmd.name + ': ' + (e instanceof Error ? e.message : String(e)));
    await tg.send(chatId, errorText(e)).catch(() => undefined);
  }
}

async function lastMonitorRun(gh: GitHub): Promise<RunInfo | null> {
  try {
    return (await gh.runs(MONITOR_WORKFLOW))[0] || null;
  } catch (e) {
    return null;
  }
}

export async function statusText(gh: GitHub, now: number): Promise<string> {
  const [raw, run] = await Promise.all([gh.file('parser-monitor.json', MONITOR_STATE_BRANCH), lastMonitorRun(gh)]);
  let state: MonitorStateFile | null = null;
  if (raw) {
    try {
      state = JSON.parse(raw) as MonitorStateFile;
    } catch (e) {
      throw new Error('parser-monitor.json не читается');
    }
  }
  return formatStatus(state, BUILTIN_SOURCE_NAMES, run, now);
}

/**
 * /check: starts the monitor workflow with notify=true. A run takes 3–40 minutes and a Worker may keep working only
 * ~30 s after answering, so the workflow itself sends the table when it finishes (scripts/parser-monitor/notify.mjs).
 * Here, after the answer, the bot only looks for the new run for a few seconds and adds its link to the message.
 */
async function check(tg: Telegram, gh: GitHub, chatId: number, args: string, deps: Deps): Promise<void> {
  const known = Object.keys(BUILTIN_SOURCE_NAMES);
  const { ids, unknown } = parseSources(args, known);
  if (unknown.length) {
    await tg.send(chatId, unknownSources(unknown, known));
    return;
  }
  const started = deps.now();
  await gh.dispatch(MONITOR_WORKFLOW, 'main', { sources: ids.join(','), summary: 'false', dry_run: 'false', notify: 'true' });
  const text = checkStarted(ids.map((id) => BUILTIN_SOURCE_NAMES[id]));
  const messageId = await tg.send(chatId, text);
  deps.waitUntil(addRunLink(tg, gh, chatId, messageId, text, started, deps));
}

/** Finds the run the dispatch created (GitHub shows it after a few seconds) and adds its link to the message. */
export async function addRunLink(tg: Telegram, gh: GitHub, chatId: number, messageId: number, text: string, started: number, deps: Deps): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await deps.sleep(4000);
    let runs: RunInfo[] = [];
    try {
      runs = await gh.runs(MONITOR_WORKFLOW, { event: 'workflow_dispatch', perPage: 3 });
    } catch (e) {
      continue;
    }
    // GitHub's clock and ours may differ a little
    const run = runs.filter((r) => Date.parse(r.created_at) >= started - 15000)[0];
    if (run) {
      await tg.edit(chatId, messageId, text + '\n' + link(run.html_url, 'Запуск #' + (run.run_number || ''))).catch(() => undefined);
      return;
    }
  }
}

export async function versionsText(gh: GitHub): Promise<string> {
  const feeds = await Promise.all(
    FEEDS.map(async (f) => {
      try {
        const raw = await gh.file(f.file, 'gh-pages');
        if (raw === null) return { ...f, version: null, error: 'файла нет' };
        const v = (JSON.parse(raw) as { version?: unknown }).version;
        return { ...f, version: typeof v === 'string' ? v : null };
      } catch (e) {
        return { ...f, version: null, error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
  return formatVersions(feeds, await gh.releases(1));
}

export async function statsText(gh: GitHub): Promise<string> {
  const [releases, repo, openIssues, monitorIssues] = await Promise.all([gh.releases(5), gh.repoInfo(), gh.openIssueCount(), gh.openIssues('parser-monitor')]);
  return formatStats({ releases, stars: repo.stargazers_count, openIssues, monitorIssues });
}

export async function ciText(gh: GitHub, now: number): Promise<string> {
  const items = await Promise.all(
    WORKFLOWS.map(async (w) => {
      try {
        return { title: w.title, run: (await gh.runs(w.file, { branch: w.branch }))[0] || null };
      } catch (e) {
        return { title: w.title, run: null, error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
  return formatCi(items, now);
}
