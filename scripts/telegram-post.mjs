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

/** Pins the release post silently (only the post with the description, never the files). A failure is only logged. */
async function pinPost(call, chat, messageId, log) {
  const form = new FormData();
  form.set('chat_id', chat);
  form.set('message_id', String(messageId));
  form.set('disable_notification', 'true');
  try {
    await call('pinChatMessage', form);
  } catch (e) {
    log(`${e.message} (the bot needs the «pin messages» right)`);
  }
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
  await pinPost(call, chat, msg.message_id, log);

  return sendFiles({ call, chat, replyTo: msg.message_id, tag, version, dir, log });
}

/**
 * Sends the build files as a reply to the release post: one album of documents (Telegram shows it as a single
 * block), with the links to the files over the bot limit as the album caption. If Telegram refuses the album the
 * files go one by one and the links follow in a message. Resolves to the number of files that could not be attached.
 */
async function sendFiles({ call, chat, replyTo, tag, version, dir, log }) {
  const files = [];
  for (const name of buildFiles(version)) {
    const path = join(dir, name);
    if (existsSync(path)) files.push({ name, path, size: statSync(path).size });
    else log(`Telegram: ${name} not found, skipped`);
  }
  const { upload, link } = routeFiles(files);
  link.forEach((f) => log(oversizeLogLine(f)));
  const blob = (f) => new Blob([readFileSync(f.path)], { type: type(f.name) });
  const base = () => {
    const form = new FormData();
    form.set('chat_id', chat);
    form.set('reply_parameters', JSON.stringify({ message_id: replyTo }));
    return form;
  };

  if (upload.length >= 2) {
    try {
      const form = base();
      const linksText = link.length ? buildLinksMessage(tag, link) : '';
      form.set('media', JSON.stringify(upload.map((f, i) => ({
        type: 'document',
        media: `attach://file${i}`,
        ...(linksText && i === upload.length - 1 ? { caption: linksText, parse_mode: 'HTML' } : {}),
      }))));
      upload.forEach((f, i) => form.set(`file${i}`, blob(f), f.name));
      await call('sendMediaGroup', form);
      log(`Telegram: attached ${upload.map((f) => f.name).join(', ')} as one block`);
      return 0;
    } catch (e) {
      log(`${e.message}, sending the files one by one`);
    }
  } else if (upload.length === 1) {
    try {
      const form = base();
      form.set('document', blob(upload[0]), upload[0].name);
      if (link.length) {
        form.set('caption', buildLinksMessage(tag, link));
        form.set('parse_mode', 'HTML');
      }
      await call('sendDocument', form);
      log(`Telegram: attached ${upload[0].name}`);
      return 0;
    } catch (e) {
      log(String(e.message));
      link.push(upload[0]);
      log(oversizeLogLine(upload[0]));
      await sendLinks(call, base(), tag, link);
      return 1;
    }
  }

  let failed = 0;
  for (const f of upload) {
    try {
      const doc = base();
      doc.set('document', blob(f), f.name);
      await call('sendDocument', doc);
      log(`Telegram: attached ${f.name}`);
    } catch (e) {
      failed++;
      link.push(f);
      log(String(e.message));
      log(oversizeLogLine(f));
    }
  }
  if (link.length) await sendLinks(call, base(), tag, link);
  return failed;
}

async function sendLinks(call, form, tag, link) {
  form.set('parse_mode', 'HTML');
  form.set('link_preview_options', JSON.stringify({ is_disabled: true }));
  form.set('text', buildLinksMessage(tag, link));
  await call('sendMessage', form);
}

/**
 * Sends the files of an already posted release again as one block (reply to the post) and then deletes the old
 * file messages. Resolves to the number of files that could not be attached.
 */
export async function repostFiles({ tag, messageId, deleteIds = [], dir = 'build', token, chat, fetch: doFetch = fetch, log = console.log }) {
  const call = caller(token, doFetch);
  const version = tag.replace(/^v/, '');
  const failed = await sendFiles({ call, chat, replyTo: messageId, tag, version, dir, log });
  if (deleteIds.length) {
    const form = new FormData();
    form.set('chat_id', chat);
    form.set('message_ids', JSON.stringify(deleteIds));
    await call('deleteMessages', form);
    log(`Telegram: deleted the old file messages ${deleteIds.join(', ')}`);
  }
  return failed;
}

/** Replaces the picture of an already posted release (caption and buttons are sent again: Telegram drops them otherwise) and pins it. */
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
  await pinPost(call, chat, messageId, log);
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
  if (dir === '--repost-files') {
    // <tag> --repost-files <post id> <build dir> [old message ids, comma separated or a-b]
    const [messageId, filesDir, ids = ''] = process.argv.slice(4);
    const deleteIds = ids.split(',').filter(Boolean).flatMap((p) => {
      const [a, b = a] = p.split('-').map(Number);
      return Array.from({ length: b - a + 1 }, (_, i) => a + i);
    });
    if (!(Number(messageId) > 0) || !filesDir || deleteIds.some((n) => !(n > 0))) throw new Error('--repost-files <post id> <dir> [ids]');
    const failed = await repostFiles({ tag, messageId: Number(messageId), deleteIds, dir: filesDir, token, chat }).catch((e) => {
      console.log(String(e.message));
      return -1;
    });
    process.exit(failed ? 1 : 0);
  }
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
