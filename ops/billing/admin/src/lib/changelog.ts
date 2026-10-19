// The «Изменения» tab: the changelog as /admin/api/changelog sends it (ops/billing/src/changelog.mjs).

export type ChangelogItem = { text: string; tech: boolean; platform: '' | 'tv' | 'lg' | 'atv' | 'phone' };
export type ChangelogSection = { version: string; unreleased: boolean; beta: boolean; items: ChangelogItem[] };
export type ChangelogPayload = {
  ok?: boolean;
  stale?: boolean;
  fetchedAt?: number;
  checkedAt?: number;
  error?: string;
  source?: string;
  ru?: ChangelogSection[];
  en?: ChangelogSection[];
  auth?: boolean;
};

/** all: every bullet; tech: only «[tech]»; user: what users see (no «[tech]»). */
export type ChangelogFilter = 'all' | 'tech' | 'user';

export const CHANGELOG_FILTERS: [ChangelogFilter, string][] = [
  ['all', 'Все пункты'],
  ['tech', 'Только техническое'],
  ['user', 'Только для пользователей'],
];

export const PLATFORM_LABEL: Record<string, string> = { phone: 'Телефон', tv: 'ТВ', lg: 'LG', atv: 'Android TV' };

/** Sections with the bullets the filter keeps, betas optional; a section left empty is dropped. */
export function filterChangelog(list: ChangelogSection[], filter: ChangelogFilter, betas: boolean): ChangelogSection[] {
  const out: ChangelogSection[] = [];
  list.forEach((s) => {
    if (!betas && s.beta) return;
    const items = s.items.filter((i) => (filter === 'all' ? true : filter === 'tech' ? i.tech : !i.tech));
    if (items.length) out.push({ ...s, items });
  });
  return out;
}

/** «Не выпущено» for the unreleased section, else the version. */
export function sectionTitle(s: ChangelogSection): string {
  return s.unreleased ? 'Не выпущено' : s.version;
}
