// Release post for the Telegram channel (pure helpers; scripts/telegram-post.mjs does the network part).

export const REPO_URL = 'https://github.com/spacesarmat/omp';
/** Telegram limits: photo caption 1024 characters, bot uploads 50 MB (kept at 50,000,000 bytes, the conservative reading). */
export const CAPTION_MAX = 1024;
export const UPLOAD_MAX = 50_000_000;

export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Bullets in the channel post: the first ones of the version in CHANGELOG.md, the rest is on the release page. */
export const CAPTION_NOTES_MAX = 5;

/**
 * Caption: title, the first CAPTION_NOTES_MAX changelog lines as bullets (cut on a whole line so it fits
 * CAPTION_MAX) and a link to the GitHub release. No install steps: the buttons and the release page carry them.
 */
export function buildCaption(version, notes, tag = `v${version}`) {
  const head = `<b>OMP ${escapeHtml(version)}</b>\n`;
  const link = `\n\n<a href="${REPO_URL}/releases/tag/${escapeHtml(tag)}">Все изменения и файлы — на GitHub</a>`;
  const shown = notes.slice(0, CAPTION_NOTES_MAX);
  let body = '';
  for (const note of shown) {
    const line = `\n• ${escapeHtml(note)}`;
    if ((head + body + line + link).length > CAPTION_MAX) {
      // even the first line does not fit: cut it on a word
      if (!body) {
        const room = CAPTION_MAX - head.length - link.length - 3;
        body = '\n• ' + escapeHtml(note).slice(0, Math.max(0, room - 1)).replace(/\s+\S*$/, '') + '…';
      }
      break;
    }
    body += line;
  }
  return head + body + link;
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
  return `Telegram: ${file.name} is ${Math.ceil(file.size / 1_000_000)} MB — forward it manually from GitHub`;
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
