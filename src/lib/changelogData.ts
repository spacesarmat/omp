import raw from '../../CHANGELOG.md?raw';
import rawEn from '../../CHANGELOG.en.md?raw';
import { lang } from '../i18n';
import { parseChangelog } from './changelog';
import type { ChangelogEntry } from './changelog';

/** The latest versions only: the full history is on GitHub. */
export const CHANGELOG = parseChangelog(raw).slice(0, 8);
export const CHANGELOG_EN = parseChangelog(rawEn);
export const CHANGELOG_URL = 'https://github.com/spacesarmat/omp/blob/main/CHANGELOG.md';

/** The entries in English where CHANGELOG.en.md has the version, otherwise the Russian entry. */
export function mergeChangelog(ru: ChangelogEntry[], en: ChangelogEntry[]): ChangelogEntry[] {
  return ru.map((e) => {
    for (let i = 0; i < en.length; i++) if (en[i].version === e.version) return en[i];
    return e;
  });
}

const CHANGELOG_LOCALIZED = mergeChangelog(CHANGELOG, CHANGELOG_EN);

/** The changelog in the current UI language (read outside render: call it from handlers and effects). */
export function getChangelog(): ChangelogEntry[] {
  return lang.peek() === 'en' ? CHANGELOG_LOCALIZED : CHANGELOG;
}
