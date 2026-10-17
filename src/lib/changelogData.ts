import raw from '../../CHANGELOG.md?raw';
import rawEn from '../../CHANGELOG.en.md?raw';
import { lang } from '../i18n';
import { platformKind } from '../platform/env';
import { changelogWindow, forPlatform, parseChangelog } from './changelog';
import type { ChangelogEntry, ChangelogPlatform } from './changelog';

/** Oldest release still shown in «What's new». 0.17.0 carries the phone calendar bullet; 0.18.0 is newer, so it stays too.
 *  A TorrServer bump prepends a section and this floor keeps both without a manual slice change. */
export const CHANGELOG_FLOOR = '0.17.0';
/** The latest versions only: the full history is on GitHub. Bullets keep their «[tv]» / «[lg]» / «[atv]» / «[phone]» markers here. */
export const CHANGELOG = changelogWindow(parseChangelog(raw), CHANGELOG_FLOOR);
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

/** The TV this build runs on: Android TV inside the APK's WebView, else the LG (webOS). */
export function tvChangelogPlatform(): ChangelogPlatform {
  return platformKind() === 'androidtv' ? 'atv' : 'lg';
}

// 'tv': the TV build shows its own TV's bullets (LG or Android TV); the phone app switches to its own when it starts
let platform: ChangelogPlatform | 'tv' = 'tv';
let cache: { [k: string]: ChangelogEntry[] } = {};

/** Which bullets «Что нового» shows: the unmarked ones and this platform's; 'tv' is the TV this build runs on. */
export function setChangelogPlatform(p: ChangelogPlatform | 'tv'): void {
  if (p === platform) return;
  platform = p;
  cache = {};
}

/** The changelog in the current UI language for this platform (read outside render: from handlers and effects). */
export function getChangelog(): ChangelogEntry[] {
  const l = lang.peek() === 'en' ? 'en' : 'ru';
  const p = platform === 'tv' ? tvChangelogPlatform() : platform;
  const key = l + '|' + p;
  if (!cache[key]) cache[key] = forPlatform(l === 'en' ? CHANGELOG_LOCALIZED : CHANGELOG, p);
  return cache[key];
}
