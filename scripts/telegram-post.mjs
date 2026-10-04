// Posts a release to the Telegram channel: photo + changelog + buttons, then every build file as a reply
// (files over the bot limit are linked in a closing reply instead).
// Usage (release workflow): node scripts/telegram-post.mjs <tag> [build dir, default build]
// Env: TELEGRAM_BOT_TOKEN (secret), TELEGRAM_CHAT_ID (@channel or id). Without them it does nothing.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { changelogNotes } from './hb-lib.mjs';
import { buildCaption, buildKeyboard, buildFiles, routeFiles, buildLinksMessage, oversizeLogLine } from './telegram-lib.mjs';

const [tag, dir = 'build'] = process.argv.slice(2);
const token = process.env.TELEGRAM_BOT_TOKEN;
const chat = process.env.TELEGRAM_CHAT_ID;
if (!token || !chat) {
  console.log('Telegram: no TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID, skipping');
  process.exit(0);
}
if (!tag) throw new Error('usage: telegram-post.mjs <tag> [build dir]');

const version = tag.replace(/^v/, '');
const notes = changelogNotes(readFileSync('CHANGELOG.md', 'utf8'), version);
const donate = /DONATE_URL = '([^']+)'/.exec(readFileSync('src/lib/donate.ts', 'utf8'));
const keyboard = buildKeyboard({ tag, version, donateUrl: donate ? donate[1] : undefined });
// a release-specific picture when there is one, else the catalog screenshot from the README
const photo = [`docs/screenshots/release-${version}.png`, 'docs/screenshots/library-large.png', 'assets/telegram/omp-telegram.png'].find((p) => existsSync(p));

async function call(method, form) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', body: form });
  const j = await r.json().catch(() => ({}));
  // never print the URL: it holds the token
  if (!j.ok) throw new Error(`Telegram ${method}: ${r.status} ${j.description || ''}`);
  return j.result;
}

const post = new FormData();
post.set('chat_id', chat);
post.set('caption', buildCaption(version, notes));
post.set('parse_mode', 'HTML');
post.set('reply_markup', JSON.stringify(keyboard));
post.set('photo', new Blob([readFileSync(photo)], { type: 'image/png' }), basename(photo));
const msg = await call('sendPhoto', post);
console.log('Telegram: posted', version);

const files = buildFiles(version)
  .map((name) => ({ name, path: join(dir, name) }))
  .filter((f) => existsSync(f.path))
  .map((f) => ({ ...f, size: statSync(f.path).size }));
const { upload, link } = routeFiles(files);
const type = (name) => (name.endsWith('.apk') ? 'application/vnd.android.package-archive' : 'application/octet-stream');
let failed = 0;
for (const f of upload) {
  try {
    const doc = new FormData();
    doc.set('chat_id', chat);
    doc.set('reply_parameters', JSON.stringify({ message_id: msg.message_id }));
    doc.set('document', new Blob([readFileSync(f.path)], { type: type(f.name) }), f.name);
    await call('sendDocument', doc);
    console.log('Telegram: attached', f.name);
  } catch (e) {
    failed++;
    console.log(String(e.message));
  }
}
if (link.length) {
  link.forEach((f) => console.log(oversizeLogLine(f)));
  const m = new FormData();
  m.set('chat_id', chat);
  m.set('reply_parameters', JSON.stringify({ message_id: msg.message_id }));
  m.set('parse_mode', 'HTML');
  m.set('link_preview_options', JSON.stringify({ is_disabled: true }));
  m.set('text', buildLinksMessage(tag, link));
  await call('sendMessage', m);
}
if (failed) process.exit(1);
