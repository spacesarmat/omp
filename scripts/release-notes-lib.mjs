// GitHub release body (pure helpers; scripts/release-notes.mjs reads the files and prints it).
// Short and bilingual: a Russian block and an English block, both visible, at most RELEASE_NOTES_MAX bullets each
// (the first bullets of the version in CHANGELOG.md / CHANGELOG.en.md, so the changelog lists the main ones first),
// two screenshots, and only the checksums, the Homebrew repository and the compare link folded under «Подробнее».

export const REPO = 'spacesarmat/omp';
export const REPO_URL = `https://github.com/${REPO}`;
export const HOMEBREW_REPO_URL = `https://raw.githubusercontent.com/${REPO}/gh-pages/apps.json`;
/** Bullets per language in the release body. */
export const RELEASE_NOTES_MAX = 8;

/**
 * The version released before `version`: the next `## X.Y.Z` heading below it in the changelog. For a stable
 * version the betas are skipped (0.20.4 → 0.20.3, not 0.20.4-beta.4). Null when there is none.
 */
export function previousVersion(md, version) {
  const heads = [];
  for (const line of md.split(/\r?\n/)) {
    const h = /^##\s+(\d+\.\d+\.\d+(?:-[\w.]+)?)\s*$/.exec(line);
    if (h) heads.push(h[1]);
  }
  const at = heads.indexOf(version);
  if (at < 0) return null;
  const stable = !version.includes('-');
  return heads.slice(at + 1).find((v) => !stable || !v.includes('-')) || null;
}

/** First `max` notes as "- " lines, plus a «more in the changelog» line when some were left out. */
function bullets(notes, max, more) {
  const lines = notes.slice(0, max).map((n) => `- ${n}`);
  if (notes.length > max) lines.push(more(notes.length - max));
  return lines.join('\n');
}

/**
 * Markdown body of the release.
 * @param {{ tag: string, version: string, ru: string[], en: string[], prevTag?: string | null,
 *   sha256?: { name: string, sha: string }[] }} p
 */
export function buildReleaseNotes({ tag, version, ru, en, prevTag, sha256 = [] }) {
  const raw = `https://raw.githubusercontent.com/${REPO}/${tag}/docs/screenshots`;
  const ruMore = (n) => `- …и ещё ${n} - в [CHANGELOG](${REPO_URL}/blob/${tag}/CHANGELOG.md)`;
  const enMore = (n) => `- …and ${n} more in the [changelog](${REPO_URL}/blob/${tag}/CHANGELOG.en.md)`;
  const out = [
    `## OMP ${tag}`,
    '',
    'Плеер торрентов с вашего TorrServer для телевизоров LG, Android TV и телефонов.',
    '',
    '### Что нового',
    '',
    ru.length ? bullets(ru, RELEASE_NOTES_MAX, ruMore) : '- Исправления и улучшения',
    '',
    '### Скачать',
    '',
    `- Телефон: \`OMP-${version}-arm64.apk\``,
    `- Приставка Android TV: \`OMP-${version}-armv7.apk\` (если не уверены - \`OMP-${version}.apk\`)`,
    `- LG webOS: \`OMP-${version}-webOS.ipk\``,
    '',
    `Как установить - в [README](${REPO_URL}#установка). Уже установленный OMP сам предложит обновление.`,
    '',
    '---',
    '',
    "### What's new",
    '',
    en.length ? bullets(en, RELEASE_NOTES_MAX, enMore) : '- Fixes and improvements',
    '',
    '### Download',
    '',
    `- Phone: \`OMP-${version}-arm64.apk\``,
    `- Android TV box: \`OMP-${version}-armv7.apk\` (not sure? \`OMP-${version}.apk\`)`,
    `- LG webOS: \`OMP-${version}-webOS.ipk\``,
    '',
    `Install steps are in the [English README](${REPO_URL}/blob/main/README.en.md#install). An installed OMP offers the update itself.`,
    '',
    '| | |',
    '|---|---|',
    `| ![LG webOS](${raw}/library-large.png) | ![Android](${raw}/android-library.png) |`,
    '',
    '<details><summary>Подробнее / Details</summary>',
    '',
  ];
  if (sha256.length) {
    out.push('SHA-256:', '');
    sha256.forEach((f) => out.push(`- \`${f.name}\`: \`${f.sha}\``));
    out.push('');
  }
  // a beta never goes to the Homebrew repository
  if (!version.includes('-')) out.push(`Homebrew Channel: \`${HOMEBREW_REPO_URL}\``, '');
  if (prevTag) out.push(`**Full Changelog**: ${REPO_URL}/compare/${prevTag}...${tag}`, '');
  out.push('</details>');
  return out.join('\n') + '\n';
}
