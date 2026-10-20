import { compareVersions } from './version';

export interface ChangelogEntry {
  version: string;
  items: string[];
}

/** Parses CHANGELOG.md ("## x.y.z" sections with "- " bullets), newest first; anything malformed is skipped. */
export function parseChangelog(text: string): ChangelogEntry[] {
  const out: ChangelogEntry[] = [];
  let cur: ChangelogEntry | null = null;
  const lines = String(text || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+$/, '');
    const h = /^##\s+v?(\d+(?:\.\d+)*(?:-beta\.\d+)?)(?:\s*[(\[—–-].*)?$/.exec(line);
    if (h) {
      cur = { version: h[1], items: [] };
      out.push(cur);
      continue;
    }
    if (/^###+\s/.test(line)) continue; // subheadings inside a version are flattened
    if (/^#{1,2}\s/.test(line)) {
      cur = null;
      continue;
    }
    const b = /^\s*[-*]\s+(.+)$/.exec(line);
    if (b && cur) cur.items.push(b[1].replace(/\*\*(.+?)\*\*/g, '$1').trim());
  }
  const res = out.filter((e) => e.items.length > 0);
  res.sort((a, b) => compareVersions(b.version, a.version));
  return res;
}

/**
 * A bullet's marker: «- [tv] …» shows on both TVs, «- [lg] …» on LG webOS only, «- [atv] …» on Android TV only,
 * «- [phone] …» on the phone only; an unmarked bullet shows everywhere.
 */
export type ChangelogMark = 'tv' | 'lg' | 'atv' | 'phone';

/** Where «Что нового» runs: the LG TV (webOS), Android TV or the phone. */
export type ChangelogPlatform = 'lg' | 'atv' | 'phone';

const PLATFORM_MARK = /^\[(tv|lg|atv|phone)\]\s*/i;

/** The marker of a bullet; '' for an unmarked one (every platform). */
export function itemPlatform(item: string): '' | ChangelogMark {
  const m = PLATFORM_MARK.exec(item);
  return m ? (m[1].toLowerCase() as ChangelogMark) : '';
}

/** Whether a bullet with this marker shows on the platform: unmarked everywhere, «[tv]» on both TVs. */
export function markShownOn(mark: '' | ChangelogMark, platform: ChangelogPlatform): boolean {
  if (!mark) return true;
  if (mark === 'tv') return platform !== 'phone';
  return mark === platform;
}

/** «- [tech] …»: a technical or admin-only bullet. No app shows it; only the admin reads the full changelog. */
const TECH_MARK = /^\[tech\]\s*/i;

/** Whether a bullet is a «[tech]» one (hidden from users everywhere). */
export function isTech(item: string): boolean {
  return TECH_MARK.test(item);
}

/** The bullet without its platform marker. */
export function stripPlatform(item: string): string {
  return item.replace(PLATFORM_MARK, '');
}

/**
 * The entries as one platform shows them: the unmarked bullets and those marked for it, without the markers and
 * never a «[tech]» one; a version left with nothing is dropped.
 */
export function forPlatform(list: ChangelogEntry[], platform: ChangelogPlatform): ChangelogEntry[] {
  const out: ChangelogEntry[] = [];
  list.forEach((e) => {
    const items = e.items.filter((i) => !isTech(i) && markShownOn(itemPlatform(i), platform)).map(stripPlatform);
    if (items.length) out.push({ version: e.version, items: items });
  });
  return out;
}

/** Up to `max` newest entries that are not newer than `version` (the running build). */
export function releasesUpTo(list: ChangelogEntry[], version: string, max = 6): ChangelogEntry[] {
  return list.filter((e) => compareVersions(e.version, version) <= 0).slice(0, max);
}

/**
 * Newest-first entries through `floor`, inclusive. Prepending a newer release does not drop the floor,
 * so the in-app window needs no manual widening. A floor that is not in the list keeps every newer entry,
 * or the whole list when nothing is newer.
 */
export function changelogWindow(list: ChangelogEntry[], floor: string): ChangelogEntry[] {
  const at = list.findIndex((e) => e.version === floor);
  if (at >= 0) return list.slice(0, at + 1);
  const newer = list.filter((e) => compareVersions(e.version, floor) > 0);
  return newer.length ? newer : list.slice();
}
