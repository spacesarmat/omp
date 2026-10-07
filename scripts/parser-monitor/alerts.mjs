// Parser monitor: sends the alerts the live run decided (monitor-out/actions.json, see logic.ts decide):
//   open    — an issue «Парсер X сломан» with the parser-monitor label (a comment if one is already open) + Telegram
//   comment — a comment on the open issue (the failure changed)
//   close   — a comment and the issue closed + Telegram
//   telegram — the weekly summary
// Usage: node scripts/parser-monitor/alerts.mjs monitor-out/actions.json
// Env: GITHUB_TOKEN, GITHUB_REPOSITORY (owner/repo), TELEGRAM_BOT_TOKEN, MONITOR_TG_CHAT. Without the GitHub token or
// the repository the issues are skipped; without the bot token or the chat the Telegram messages are skipped. Never
// prints a token.
import { readFileSync } from 'node:fs';

export const LABEL = 'parser-monitor';
const ISSUE_LINK = '{issue}';

const env = process.env;
const api = (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
const repo = env.GITHUB_REPOSITORY || '';
const ghToken = env.GITHUB_TOKEN || '';
const tgToken = env.TELEGRAM_BOT_TOKEN || '';
const tgChat = env.MONITOR_TG_CHAT || '';

async function gh(method, path, body) {
  const res = await fetch(api + '/repos/' + repo + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + ghToken,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error('GitHub ' + method + ' ' + path + ': HTTP ' + res.status + ' ' + (await res.text()).slice(0, 300));
  return res.status === 204 ? null : res.json();
}

/** The open monitor issue with this title, or null. */
async function findIssue(title) {
  const list = await gh('GET', '/issues?state=open&labels=' + LABEL + '&per_page=100');
  return list.filter((i) => !i.pull_request && i.title === title)[0] || null;
}

async function telegram(text) {
  if (!tgToken || !tgChat) {
    console.log('Telegram: skipped (no bot token or chat)');
    return;
  }
  const res = await fetch('https://api.telegram.org/bot' + tgToken + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: tgChat, text, disable_web_page_preview: true }),
  });
  // the answer may echo the request but never the token; print only the status and Telegram's description
  if (!res.ok) {
    let desc = '';
    try {
      desc = (await res.json()).description || '';
    } catch (e) {
      /* no body */
    }
    throw new Error('Telegram: HTTP ' + res.status + ' ' + desc);
  }
  console.log('Telegram: sent');
}

const withLink = (text, url) => text.split(ISSUE_LINK).join(url || '').trim();

async function run(file) {
  const actions = JSON.parse(readFileSync(file, 'utf8'));
  const issues = !!(ghToken && repo);
  if (!issues) console.log('GitHub issues: skipped (no GITHUB_TOKEN / GITHUB_REPOSITORY)');
  let failed = 0;
  for (const a of actions) {
    try {
      if (a.kind === 'telegram') {
        await telegram(a.text);
        continue;
      }
      let url = '';
      if (issues) {
        const open = await findIssue(a.title);
        if (a.kind === 'open') {
          if (open) {
            await gh('POST', '/issues/' + open.number + '/comments', { body: a.body });
            url = open.html_url;
          } else {
            const created = await gh('POST', '/issues', { title: a.title, body: a.body, labels: [LABEL] });
            url = created.html_url;
          }
        } else if (open) {
          await gh('POST', '/issues/' + open.number + '/comments', { body: a.body });
          if (a.kind === 'close') await gh('PATCH', '/issues/' + open.number, { state: 'closed', state_reason: 'completed' });
          url = open.html_url;
        }
        console.log(a.kind + ' ' + a.source + ': ' + (url || 'no open issue'));
      }
      if (a.telegram) await telegram(withLink(a.telegram, url));
    } catch (e) {
      failed++;
      console.error(a.kind + ' ' + (a.source || '') + ': ' + (e instanceof Error ? e.message : String(e)));
    }
  }
  if (failed) process.exitCode = 1;
}

run(process.argv[2] || 'monitor-out/actions.json');
