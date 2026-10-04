// Posts a release to the Telegram channel: photo + changelog + buttons, then the APK when it fits the bot limit.
// Usage (release workflow): node scripts/telegram-post.mjs <tag> <apk path>
// Env: TELEGRAM_BOT_TOKEN (secret), TELEGRAM_CHAT_ID (@channel or id). Without them it does nothing.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { changelogNotes } from './hb-lib.mjs';
import { buildCaption, buildKeyboard, UPLOAD_MAX } from './telegram-lib.mjs';

const [tag, apk] = process.argv.slice(2);
const token = process.env.TELEGRAM_BOT_TOKEN;
const chat = process.env.TELEGRAM_CHAT_ID;
if (!token || !chat) {
  console.log('Telegram: no TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID, skipping');
  process.exit(0);
}
if (!tag) throw new Error('usage: telegram-post.mjs <tag> <apk>');

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

if (apk && existsSync(apk) && statSync(apk).size <= UPLOAD_MAX) {
  const doc = new FormData();
  doc.set('chat_id', chat);
  doc.set('reply_to_message_id', String(msg.message_id));
  doc.set('caption', `OMP ${version} для Android и Android TV`);
  doc.set('document', new Blob([readFileSync(apk)], { type: 'application/vnd.android.package-archive' }), basename(apk));
  await call('sendDocument', doc);
  console.log('Telegram: APK attached');
} else if (apk) {
  console.log('Telegram: APK over the bot limit, link only');
}
