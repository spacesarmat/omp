// Posts a release to the Telegram channel: photo + changelog + buttons, then every build file as a reply
// (files over the bot limit, or that Telegram refuses, are linked in a closing reply instead).
// Usage (release workflow): node scripts/telegram-post.mjs <tag> [build dir, default build]
// Env: TELEGRAM_BOT_TOKEN (secret), TELEGRAM_CHAT_ID (@channel or id). Without them it does nothing.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { changelogNotes } from './hb-lib.mjs';
import { buildCaption, buildKeyboard, buildFiles, routeFiles, buildLinksMessage, oversizeLogLine } from './telegram-lib.mjs';

const type = (name) => (name.endsWith('.apk') ? 'application/vnd.android.package-archive' : 'application/octet-stream');

/**
 * Posts the release. `root` is the repo root (CHANGELOG.md, src/lib/donate.ts, screenshots), `dir` the build dir.
 * Resolves to the number of files that could not be attached (they are linked instead).
 */
function caller(token, doFetch) {
  return async function call(method, form) {
    let r;
    try {
      r = await doFetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', body: form });
    } catch {
      // the URL holds the token: never rethrow the original error
      throw new Error(`Telegram ${method}: network error`);
    }
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw new Error(`Telegram ${method}: ${r.status} ${j.description || ''}`);
    return j.result;
  };
}

/** Caption, buttons and picture of the release post. */
function releasePost(tag, root, log) {
  const version = tag.replace(/^v/, '');
  const notes = changelogNotes(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), version);
  const donate = /DONATE_URL = '([^']+)'/.exec(readFileSync(join(root, 'src/lib/donate.ts'), 'utf8'));
  const keyboard = buildKeyboard({ tag, version, donateUrl: donate ? donate[1] : undefined });
  // the release cover with the logo (scripts/release-cover.mjs), else the catalog screenshot from the README
  const cover = join(root, `docs/screenshots/release-${version}.png`);
  if (!existsSync(cover)) log(`Telegram: no release cover ${basename(cover)} (scripts/release-cover.mjs), using a screenshot`);
  const photo = [cover, join(root, 'docs/screenshots/library-large.png'), join(root, 'assets/telegram/omp-telegram.png')].find((p) => existsSync(p));
  return { version, caption: buildCaption(version, notes), keyboard, photo };
}

export async function postRelease({ tag, dir = 'build', root = '.', token, chat, fetch: doFetch = fetch, log = console.log }) {
  const call = caller(token, doFetch);
  const { version, caption, keyboard, photo } = releasePost(tag, root, log);

  const post = new FormData();
  post.set('chat_id', chat);
  post.set('caption', caption);
  post.set('parse_mode', 'HTML');
  post.set('reply_markup', JSON.stringify(keyboard));
  post.set('photo', new Blob([readFileSync(photo)], { type: 'image/png' }), basename(photo));
  const msg = await call('sendPhoto', post);
  log(`Telegram: posted ${version}`);

  const files = [];
  for (const name of buildFiles(version)) {
    const path = join(dir, name);
    if (existsSync(path)) files.push({ name, path, size: statSync(path).size });
    else log(`Telegram: ${name} not found, skipped`);
  }
  const { upload, link } = routeFiles(files);
  let failed = 0;
  for (const f of upload) {
    try {
      const doc = new FormData();
      doc.set('chat_id', chat);
      doc.set('reply_parameters', JSON.stringify({ message_id: msg.message_id }));
      doc.set('document', new Blob([readFileSync(f.path)], { type: type(f.name) }), f.name);
      await call('sendDocument', doc);
      log(`Telegram: attached ${f.name}`);
    } catch (e) {
      failed++;
      link.push(f);
      log(String(e.message));
    }
  }
  if (link.length) {
    link.forEach((f) => log(oversizeLogLine(f)));
    const m = new FormData();
    m.set('chat_id', chat);
    m.set('reply_parameters', JSON.stringify({ message_id: msg.message_id }));
    m.set('parse_mode', 'HTML');
    m.set('link_preview_options', JSON.stringify({ is_disabled: true }));
    m.set('text', buildLinksMessage(tag, link));
    await call('sendMessage', m);
  }
  return failed;
}

/** Replaces the picture of an already posted release (caption and buttons are sent again: Telegram drops them otherwise). */
export async function replacePhoto({ tag, messageId, root = '.', token, chat, fetch: doFetch = fetch, log = console.log }) {
  const call = caller(token, doFetch);
  const { version, caption, keyboard, photo } = releasePost(tag, root, log);
  const form = new FormData();
  form.set('chat_id', chat);
  form.set('message_id', String(messageId));
  form.set('media', JSON.stringify({ type: 'photo', media: 'attach://photo', caption, parse_mode: 'HTML' }));
  form.set('reply_markup', JSON.stringify(keyboard));
  form.set('photo', new Blob([readFileSync(photo)], { type: 'image/png' }), basename(photo));
  await call('editMessageMedia', form);
  log(`Telegram: replaced the picture of ${version} (message ${messageId})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [tag, dir = 'build'] = process.argv.slice(2);
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) {
    console.log('Telegram: no TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID, skipping');
    process.exit(0);
  }
  if (!tag) throw new Error('usage: telegram-post.mjs <tag> [build dir] | <tag> --edit-photo <message id>');
  if (dir === '--edit-photo') {
    const messageId = Number(process.argv[4]);
    if (!Number.isInteger(messageId) || messageId <= 0) throw new Error('--edit-photo needs a message id');
    await replacePhoto({ tag, messageId, token, chat }).catch((e) => {
      console.log(String(e.message));
      process.exit(1);
    });
    process.exit(0);
  }
  const failed = await postRelease({ tag, dir, token, chat }).catch((e) => {
    console.log(String(e.message));
    return -1;
  });
  if (failed) process.exit(1);
}
