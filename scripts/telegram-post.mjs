// Posts a release to the Telegram channel: photo + changelog + buttons, then every build file as a reply
// (files over the bot limit, or that Telegram refuses, are only logged: the post's buttons link every build).
// A stable release with docs/screenshots/release-<version>/ goes as a photo album (cover + screenshots, changelog on
// the first photo), then the files and a short message with the buttons, both as replies to the first photo.
// Usage (release workflow): node scripts/telegram-post.mjs <tag> [build dir, default build]
// Env: TELEGRAM_BOT_TOKEN (secret), TELEGRAM_CHAT_ID (@channel or id). Without them it does nothing.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { changelogNotes } from './hb-lib.mjs';
import { readChangelogUtf8 } from './changelog-encoding.mjs';
import { buildCaption, buildKeyboard, buildFiles, routeFiles, oversizeLogLine } from './telegram-lib.mjs';

const type = (name) => (name.endsWith('.apk') ? 'application/vnd.android.package-archive' : 'application/octet-stream');

/**
 * Posts the release. `root` is the repo root (CHANGELOG.md, src/lib/donate.ts, screenshots), `dir` the build dir.
 * Resolves to the number of files that could not be attached (the buttons still link them).
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

/**
 * Pins the release post silently (only the post with the description, never the files). A failure is only logged.
 * Telegram then adds a «… pinned a message» line to the channel; the billing bot (@OMPBILLINGBOT, ops/billing) polls
 * this bot's updates and deletes that line. This script never polls the bot's updates and never sets a webhook: the
 * token is the billing bot's, and a second poller would take its updates away (409) or change its allowed update types.
 */
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Caption, buttons and picture of the release post. */
function releasePost(tag, root, log) {
  const version = tag.replace(/^v/, '');
  const notes = changelogNotes(readChangelogUtf8(join(root, 'CHANGELOG.md'), { russian: true }), version);
  const donate = /DONATE_URL = '([^']+)'/.exec(readFileSync(join(root, 'src/lib/donate.ts'), 'utf8'));
  const keyboard = buildKeyboard({ tag, version, donateUrl: donate ? donate[1] : undefined });
  // the release cover with the logo (scripts/release-cover.mjs), else the catalog screenshot from the README
  const cover = join(root, `docs/screenshots/release-${version}.png`);
  if (!existsSync(cover)) log(`Telegram: no release cover ${basename(cover)} (scripts/release-cover.mjs), using a screenshot`);
  const photo = [cover, join(root, 'docs/screenshots/library-large.png'), join(root, 'assets/telegram/omp-telegram.png')].find((p) => existsSync(p));
  return { version, caption: buildCaption(version, notes), keyboard, photo, album: albumPhotos(root, version, photo) };
}

/** Telegram takes at most 10 items in one album. */
export const ALBUM_MAX = 10;
/** Text of the reply that carries the buttons under an album (an album cannot have an inline keyboard). */
export const BUTTONS_TEXT = 'Скачать и подробности:';

const imageType = (name) => (/\.jpe?g$/i.test(name) ? 'image/jpeg' : 'image/png');

/**
 * Pictures of the album of a stable release: the cover, then the live screenshots of
 * docs/screenshots/release-<version>/ by file name, at most ALBUM_MAX. Null for a pre-release (version with «-»)
 * or when the folder is missing or holds no pictures: the release is then posted as a single photo.
 */
function albumPhotos(root, version, cover) {
  if (version.includes('-')) return null;
  const folder = join(root, `docs/screenshots/release-${version}`);
  if (!existsSync(folder) || !statSync(folder).isDirectory()) return null;
  const shots = readdirSync(folder).filter((n) => /\.(png|jpe?g)$/i.test(n)).sort().map((n) => join(folder, n));
  if (!shots.length) return null;
  return [cover, ...shots].slice(0, ALBUM_MAX);
}

/** Posts the release as one photo with the caption and the buttons. Resolves to the message id. */
async function sendSinglePhoto(call, chat, { caption, keyboard, photo }) {
  const post = new FormData();
  post.set('chat_id', chat);
  post.set('caption', caption);
  post.set('parse_mode', 'HTML');
  post.set('reply_markup', JSON.stringify(keyboard));
  post.set('photo', new Blob([readFileSync(photo)], { type: 'image/png' }), basename(photo));
  const msg = await call('sendPhoto', post);
  return msg.message_id;
}

/** Posts the release as a photo album with the caption on the first photo. Resolves to the first message id. */
async function sendAlbum(call, chat, { caption, album }) {
  const form = new FormData();
  form.set('chat_id', chat);
  form.set('media', JSON.stringify(album.map((p, i) => ({
    type: 'photo',
    media: `attach://photo${i}`,
    ...(i === 0 ? { caption, parse_mode: 'HTML' } : {}),
  }))));
  album.forEach((p, i) => form.set(`photo${i}`, new Blob([readFileSync(p)], { type: imageType(p) }), basename(p)));
  const msgs = await call('sendMediaGroup', form);
  return msgs[0].message_id;
}

export async function postRelease({ tag, dir = 'build', root = '.', token, chat, fetch: doFetch = fetch, log = console.log, pause = sleep }) {
  const call = caller(token, doFetch);
  const post = releasePost(tag, root, log);
  const { version, keyboard, album } = post;

  // a stable release with live screenshots goes as an album, the buttons then follow in a reply of their own
  let postId;
  let buttons = false;
  if (album) {
    try {
      postId = await sendAlbum(call, chat, post);
      buttons = true;
      log(`Telegram: posted ${version} as an album of ${album.length} photos`);
    } catch (e) {
      log(`${e.message}, posting a single photo instead`);
    }
  }
  if (postId === undefined) {
    postId = await sendSinglePhoto(call, chat, post);
    log(`Telegram: posted ${version}`);
  }
  await pinPost(call, chat, postId, log);

  const failed = await sendFiles({ call, chat, replyTo: postId, version, dir, log });
  if (buttons) {
    const form = new FormData();
    form.set('chat_id', chat);
    form.set('text', BUTTONS_TEXT);
    form.set('reply_parameters', JSON.stringify({ message_id: postId }));
    form.set('reply_markup', JSON.stringify(keyboard));
    try {
      await call('sendMessage', form);
      log('Telegram: posted the buttons');
    } catch (e) {
      log(`${e.message} (the buttons were not posted)`);
    }
  }
  return failed;
}

/**
 * Sends the build files as a reply to the release post: one album of documents (Telegram shows it as a single
 * block). If Telegram refuses the album the files go one by one. Files over the bot limit or refused are only logged
 * (no text links: the post's buttons carry every build). Resolves to the number of files that could not be attached.
 */
async function sendFiles({ call, chat, replyTo, version, dir, log }) {
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
    // a request holds at most 50 MB, so each file is uploaded on its own (silently) and the album is built from
    // the uploaded file ids; the temporary messages are deleted right after
    const temp = [];
    try {
      const ids = [];
      for (const f of upload) {
        const form = new FormData();
        form.set('chat_id', chat);
        form.set('disable_notification', 'true');
        form.set('document', blob(f), f.name);
        const m = await call('sendDocument', form);
        temp.push(m.message_id);
        ids.push(m.document.file_id);
      }
      const form = base();
      form.set('media', JSON.stringify(ids.map((id) => ({ type: 'document', media: id }))));
      await call('sendMediaGroup', form);
      log(`Telegram: attached ${upload.map((f) => f.name).join(', ')} as one block`);
      await deleteMessages(call, chat, temp, log);
      return 0;
    } catch (e) {
      log(`${e.message}, sending the files one by one`);
      await deleteMessages(call, chat, temp, log);
    }
  } else if (upload.length === 1) {
    try {
      const form = base();
      form.set('document', blob(upload[0]), upload[0].name);
      await call('sendDocument', form);
      log(`Telegram: attached ${upload[0].name}`);
      return 0;
    } catch (e) {
      log(String(e.message));
      log(oversizeLogLine(upload[0]));
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
      log(String(e.message));
      log(oversizeLogLine(f));
    }
  }
  return failed;
}

async function deleteMessages(call, chat, ids, log) {
  if (!ids.length) return;
  const form = new FormData();
  form.set('chat_id', chat);
  form.set('message_ids', JSON.stringify(ids));
  try {
    await call('deleteMessages', form);
  } catch (e) {
    log(`${e.message} (the bot needs the «delete messages» right)`);
  }
}

/**
 * Sends the files of an already posted release again as one block (reply to the post) and then deletes the old
 * file messages, only when every file went through (otherwise the old messages stay). Resolves to the number of
 * files that could not be attached.
 */
export async function repostFiles({ tag, messageId, deleteIds = [], dir = 'build', token, chat, fetch: doFetch = fetch, log = console.log }) {
  const call = caller(token, doFetch);
  const version = tag.replace(/^v/, '');
  const failed = await sendFiles({ call, chat, replyTo: messageId, version, dir, log });
  if (deleteIds.length && failed) {
    log(`Telegram: ${failed} file(s) not attached, kept the old file messages ${deleteIds.join(', ')}`);
  } else if (deleteIds.length) {
    await deleteMessages(call, chat, deleteIds, log);
    log(`Telegram: deleted the old file messages ${deleteIds.join(', ')}`);
  }
  return failed;
}

/**
 * Replaces the picture of an already posted release (caption and buttons are sent again: Telegram drops them
 * otherwise) and pins it. For an album release `messageId` is the first photo (the cover): only it is replaced, and
 * no buttons are sent (an album message cannot carry them; they live in the separate reply).
 */
export async function replacePhoto({ tag, messageId, root = '.', token, chat, fetch: doFetch = fetch, log = console.log, pause = sleep }) {
  const call = caller(token, doFetch);
  const { version, caption, keyboard, photo, album } = releasePost(tag, root, log);
  const form = new FormData();
  form.set('chat_id', chat);
  form.set('message_id', String(messageId));
  form.set('media', JSON.stringify({ type: 'photo', media: 'attach://photo', caption, parse_mode: 'HTML' }));
  if (!album) form.set('reply_markup', JSON.stringify(keyboard));
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
  if (!tag) throw new Error('usage: telegram-post.mjs <tag> [build dir] | <tag> --edit-photo <id> | <tag> --repost-files <id> <dir> [ids] | <tag> --delete <ids>');
  const parseIds = (ids = '') => ids.split(',').map((p) => p.trim()).filter(Boolean).flatMap((p) => {
    const [a, b = a] = p.split('-').map(Number);
    return Array.from({ length: b - a + 1 }, (_, i) => a + i);
  });
  if (dir === '--delete') {
    // <tag> --delete <message ids, comma separated or a-b>
    const ids = parseIds(process.argv[4]);
    if (!ids.length || ids.some((n) => !(n > 0))) throw new Error('--delete <ids>');
    const form = new FormData();
    form.set('chat_id', chat);
    form.set('message_ids', JSON.stringify(ids));
    await caller(token, fetch)('deleteMessages', form).catch((e) => {
      console.log(String(e.message));
      process.exit(1);
    });
    console.log(`Telegram: deleted ${ids.join(', ')}`);
    process.exit(0);
  }
  if (dir === '--repost-files') {
    // <tag> --repost-files <post id> <build dir> [old message ids, comma separated or a-b]
    const [messageId, filesDir, ids = ''] = process.argv.slice(4);
    const deleteIds = parseIds(ids);
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
