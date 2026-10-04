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

/** Build files in the order they are posted as replies: arm64 APK, armv7 APK, ipk, universal APK. */
export function buildFiles(version) {
  return [
    `OMP-${version}-arm64.apk`,
    `OMP-${version}-armv7.apk`,
    `OMP-${version}-webOS.ipk`,
    `OMP-${version}.apk`,
  ];
}

/** Splits [{name, size}] (post order kept): up to the bot limit are uploaded, the rest are only linked. */
export function routeFiles(files) {
  const upload = [];
  const link = [];
  for (const f of files) (f.size <= UPLOAD_MAX ? upload : link).push(f);
  return { upload, link };
}

export function downloadUrl(tag, name) {
  return `${REPO_URL}/releases/download/${tag}/${name}`;
}

/** Closing reply for the builds that do not fit into the bot limit: one line per file with a GitHub link. */
export function buildLinksMessage(tag, files) {
  return files
    .map((f) => `Файл ${escapeHtml(f.name)} больше 50 МБ — скачать: ${downloadUrl(tag, f.name)}`)
    .join('\n');
}

/** Log line for the owner, who forwards an oversize build by hand. */
export function oversizeLogLine(file) {
  return `Telegram: ${file.name} is ${Math.ceil(file.size / (1024 * 1024))} MB — forward it manually from GitHub`;
}

/** Buttons under the post: downloads per ABI and for LG, release page, support. */
export function buildKeyboard({ tag, version, donateUrl }) {
  const [arm64, armv7, ipk] = buildFiles(version);
  const rows = [
    [
      { text: 'arm64', url: downloadUrl(tag, arm64) },
      { text: 'armv7', url: downloadUrl(tag, armv7) },
    ],
    [{ text: 'Для LG (ipk)', url: downloadUrl(tag, ipk) }],
    [{ text: 'Что нового', url: `${REPO_URL}/releases/tag/${tag}` }],
  ];
  if (donateUrl) rows[2].push({ text: 'Поддержать', url: donateUrl });
  return { inline_keyboard: rows };
}
