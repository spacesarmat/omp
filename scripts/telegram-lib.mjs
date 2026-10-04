// Release post for the Telegram channel (pure helpers; scripts/telegram-post.mjs does the network part).

export const REPO_URL = 'https://github.com/spacesarmat/omp';
/** Telegram limits: photo caption 1024 characters, bot uploads 50 MB. */
export const CAPTION_MAX = 1024;
export const UPLOAD_MAX = 50 * 1024 * 1024;

export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Caption: title, the changelog lines as bullets, cut on a whole line so it fits CAPTION_MAX. */
export function buildCaption(version, notes) {
  const head = `<b>OMP ${escapeHtml(version)}</b>\n`;
  const more = `\n…и другое — «Что нового» ниже`;
  let body = '';
  for (let i = 0; i < notes.length; i++) {
    const line = `\n• ${escapeHtml(notes[i])}`;
    const rest = i < notes.length - 1 ? more : '';
    if ((head + body + line + rest).length > CAPTION_MAX) {
      // even the first line does not fit: cut it on a word
      if (!body) {
        const room = CAPTION_MAX - head.length - more.length - 3;
        body = '\n• ' + escapeHtml(notes[i]).slice(0, Math.max(0, room - 1)).replace(/\s+\S*$/, '') + '…';
      }
      return head + body + more;
    }
    body += line;
  }
  return head + body;
}

/** Buttons under the post: downloads, release page, support. */
export function buildKeyboard({ tag, version, donateUrl }) {
  const dl = `${REPO_URL}/releases/download/${tag}`;
  const rows = [
    [
      { text: 'Скачать APK', url: `${dl}/OMP-${version}.apk` },
      { text: 'Для LG (ipk)', url: `${dl}/OMP-${version}-webOS.ipk` },
    ],
    [{ text: 'Что нового', url: `${REPO_URL}/releases/tag/${tag}` }],
  ];
  if (donateUrl) rows[1].push({ text: 'Поддержать', url: donateUrl });
  return { inline_keyboard: rows };
}
