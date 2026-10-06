import raw from '../../CHANGELOG.md?raw';
import rawEn from '../../CHANGELOG.en.md?raw';
import { lang } from '../i18n';
import { forPlatform, parseChangelog } from './changelog';
import type { ChangelogEntry, ChangelogPlatform } from './changelog';

/** The latest versions only: the full history is on GitHub. Bullets keep their «[tv]» / «[phone]» markers here. */
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

// the TV build shows the TV's bullets; the phone app switches to its own when it starts
let platform: ChangelogPlatform = 'tv';
let cache: { [k: string]: ChangelogEntry[] } = {};

/** Which bullets «Что нового» shows: the unmarked ones and this platform's. */
export function setChangelogPlatform(p: ChangelogPlatform): void {
  if (p === platform) return;
  platform = p;
  cache = {};
}

/** The changelog in the current UI language for this platform (read outside render: from handlers and effects). */
export function getChangelog(): ChangelogEntry[] {
  const l = lang.peek() === 'en' ? 'en' : 'ru';
  const key = l + '|' + platform;
  if (!cache[key]) cache[key] = forPlatform(l === 'en' ? CHANGELOG_LOCALIZED : CHANGELOG, platform);
  return cache[key];
}
