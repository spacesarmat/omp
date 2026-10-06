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

/** Where the app runs: a bullet marked «- [tv] …» shows on the TV only, «- [phone] …» on the phone only. */
export type ChangelogPlatform = 'tv' | 'phone';

const PLATFORM_MARK = /^\[(tv|phone)\]\s*/i;

/** The platform a bullet is marked for; '' for an unmarked one (both). */
export function itemPlatform(item: string): '' | ChangelogPlatform {
  const m = PLATFORM_MARK.exec(item);
  return m ? (m[1].toLowerCase() as ChangelogPlatform) : '';
}

/** The bullet without its platform marker. */
export function stripPlatform(item: string): string {
  return item.replace(PLATFORM_MARK, '');
}

/**
 * The entries as one platform shows them: the unmarked bullets and its own, without the markers; a version left with
 * nothing is dropped.
 */
export function forPlatform(list: ChangelogEntry[], platform: ChangelogPlatform): ChangelogEntry[] {
  const out: ChangelogEntry[] = [];
  list.forEach((e) => {
    const items = e.items.filter((i) => {
      const p = itemPlatform(i);
      return !p || p === platform;
    }).map(stripPlatform);
    if (items.length) out.push({ version: e.version, items: items });
  });
  return out;
}

/** Up to `max` newest entries that are not newer than `version` (the running build). */
export function releasesUpTo(list: ChangelogEntry[], version: string, max = 6): ChangelogEntry[] {
  return list.filter((e) => compareVersions(e.version, version) <= 0).slice(0, max);
}
