// «Новое» → «Подписки» tools: the search over the subscriptions and their findings, the sort of the list (tsp.subsSort)
// and «Проверить сейчас» for one subscription (in the app, through checkSubscription).
import { signal } from '@preact/signals';
import { t, type Key } from '../../../src/i18n';
import { loadJson, saveJson } from '../../../src/store/storage';
import { checkSubscription } from '../../../src/monitor/check';
import { getSubscription, loadFound } from '../../../src/monitor/subs';
import { FREE_SUBS_MAX, isSubPaused } from '../../../src/monitor/limit';
import { BETTER_ID, EPISODES_ID, type Finding, type Subscription } from '../../../src/monitor/types';
import { qualityOf } from '../../../src/sources/view';
import { phoneSourceContext } from '../searchContext';
import { showToast } from '../ui/toast';
import { reloadMonitor } from './ui';

// ye as a char code: the guard strips regex literals but not string literals
const YE = String.fromCharCode(0x435);

/** A query or title for matching: lower case, yo as ye, single spaces (as sameQuery in src/monitor/subs.ts). */
export function searchKey(s: string): string {
  return (s || '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/ё/g, YE);
}

/** The subscriptions whose query contains `q` (all of them for an empty one). */
export function filterSubs(list: Subscription[], q: string): Subscription[] {
  const k = searchKey(q);
  return k ? list.filter((s) => searchKey(s.query).indexOf(k) >= 0) : list;
}

/** «Найденные раздачи» shown at most. */
export const FINDINGS_CAP = 50;

// --- sort (declared above matchFindings: its default parameter reads these)

/** Chip order. «по дате добавления» is the default. */
export type SubsSort = 'added' | 'fresh' | 'name' | 'quality' | 'stale';
export const SUBS_SORTS: SubsSort[] = ['added', 'fresh', 'name', 'quality', 'stale'];
export const DEFAULT_SUBS_SORT: SubsSort = 'added';
export const SUBS_SORT_KEY = 'tsp.subsSort';

/**
 * Findings of the subscriptions (not new episodes / better quality) whose release title contains `q`.
 * Order follows `mode` (the same choice as the subscription list); `shown` is capped at FINDINGS_CAP, `more` is the rest.
 */
export function matchFindings(
  q: string,
  all: Finding[] = loadFound(),
  cap = FINDINGS_CAP,
  mode: SubsSort = DEFAULT_SUBS_SORT,
  subs: Subscription[] = [],
): { shown: Finding[]; more: number } {
  const k = searchKey(q);
  if (!k) return { shown: [], more: 0 };
  const hit = all.filter((f) => f.subId !== EPISODES_ID && f.subId !== BETTER_ID && searchKey(f.result.Title).indexOf(k) >= 0);
  const sorted = sortFindings(hit, mode, subs);
  return { shown: sorted.slice(0, cap), more: Math.max(0, sorted.length - cap) };
}

const isSort = (v: unknown): boolean => SUBS_SORTS.indexOf(v as SubsSort) >= 0;

/**
 * The saved sort. A missing or malformed value is «по дате добавления».
 * The previous default («новые находки») was not written until a chip was tapped, so an install that never
 * chose a sort picks up the new default instead of staying on the old one.
 */
export function loadSubsSort(): SubsSort {
  return loadJson<SubsSort>(SUBS_SORT_KEY, DEFAULT_SUBS_SORT, isSort);
}

export function saveSubsSort(s: SubsSort): void {
  if (isSort(s)) saveJson(SUBS_SORT_KEY, s);
}

const SORT_LABEL: { [s in SubsSort]: Key } = {
  added: 'news.sortAdded',
  fresh: 'news.sortFresh',
  name: 'news.sortName',
  quality: 'news.sortQuality',
  stale: 'news.sortStale',
};

export function sortLabel(s: SubsSort): string {
  return t(SORT_LABEL[s] || 'news.sortAdded');
}

/** A-Я, Russian then English, case-insensitive, ё = е, «2» before «10». */
const nameCollator = new Intl.Collator(['ru', 'en'], { sensitivity: 'base', numeric: true });

export function compareName(a: string, b: string): number {
  return nameCollator.compare(a || '', b || '');
}

/** Requested minimum quality: 2160 first, then 1080, 720, «любое качество» ('' ) last. */
const REQUESTED_QUALITY: { [q: string]: number } = { '2160': 3, '1080': 2, '720': 1 };

export function requestedQualityRank(q: string): number {
  return REQUESTED_QUALITY[q] || 0;
}

function findAt(s: Subscription): number {
  return s.lastFindAt && s.lastFindAt > 0 ? s.lastFindAt : 0;
}

/**
 * Subscription order for `mode`. Equal keys fall through to the name (stable: a 0 from the collator keeps input order).
 * «по дате добавления» newest first; «новые находки» most recent find first, never-found last;
 * «по давности находок» never-found first, then the oldest find; «по качеству» 2160 → «любое качество».
 */
export function compareSubs(a: Subscription, b: Subscription, mode: SubsSort): number {
  const name = compareName(a.query, b.query);
  if (mode === 'name') return name;
  let primary = 0;
  if (mode === 'quality') primary = requestedQualityRank(b.quality) - requestedQualityRank(a.quality);
  else if (mode === 'fresh') primary = findAt(b) - findAt(a);
  else if (mode === 'stale') primary = findAt(a) - findAt(b);
  else primary = (b.createdAt || 0) - (a.createdAt || 0);
  return primary || name;
}

export function sortSubs(list: Subscription[], mode: SubsSort): Subscription[] {
  return list.slice().sort((a, b) => compareSubs(a, b, mode));
}

function findingTitle(f: Finding): string {
  return f.result && f.result.Title ? f.result.Title : '';
}

/**
 * The same `mode` applied to findings. Different subscriptions follow `compareSubs` (so the found-releases
 * section stays in the subscription order). Within one subscription: name by title, quality by the release
 * (2160 first, unknown last), staleness oldest first, date-added and new-findings newest first.
 */
export function sortFindings(list: Finding[], mode: SubsSort, subs: Subscription[] = []): Finding[] {
  const byId: { [id: string]: Subscription } = {};
  subs.forEach((s) => {
    byId[s.id] = s;
  });
  const tie = (a: Finding, b: Finding): number => {
    const title = compareName(findingTitle(a), findingTitle(b));
    if (mode === 'name') return title;
    if (mode === 'quality') return qualityOf(findingTitle(b)) - qualityOf(findingTitle(a)) || title;
    if (mode === 'stale') return (a.at || 0) - (b.at || 0) || title;
    return (b.at || 0) - (a.at || 0) || title;
  };
  return list.slice().sort((a, b) => {
    const sa = byId[a.subId];
    const sb = byId[b.subId];
    if (sa && sb && sa.id !== sb.id) {
      const c = compareSubs(sa, sb, mode);
      if (c) return c;
    }
    return tie(a, b);
  });
}

// --- «Проверить сейчас» for one subscription

/** Ids of the subscriptions being checked from the app now (outlives the screen). */
export const checkingSubs = signal<string[]>([]);

export function isCheckingSub(id: string): boolean {
  return checkingSubs.value.indexOf(id) >= 0;
}

/**
 * Checks one subscription now, in the app, through checkSubscription (its filters and «Только лучшее качество» there):
 * a search the person starts, so a site whose background requests are paused (ipBan.ts) is still asked, like any search
 * of theirs. Toast: «Найдено новых: N» / «Новых раздач нет»; the first check only remembers what is there. Never rejects.
 */
export function checkSubNow(id: string): Promise<void> {
  const sub = getSubscription(id);
  if (!sub || isCheckingSub(id)) return Promise.resolve();
  // over the cap without the OMP subscription: paused, not checked (limit.ts)
  if (isSubPaused(id)) {
    showToast(t('monitor.limit.pausedCheck', { n: FREE_SUBS_MAX }));
    return Promise.resolve();
  }
  checkingSubs.value = checkingSubs.value.concat([id]);
  const end = () => {
    checkingSubs.value = checkingSubs.value.filter((x) => x !== id);
  };
  let run: Promise<void>;
  try {
    run = checkSubscription(phoneSourceContext(), sub).then((r) => {
      end();
      reloadMonitor();
      if (!r.answered.length) showToast(t('news.noAnswerLater'));
      else if (r.first) showToast(t('news.subFirstCheck'));
      else showToast(r.findings.length ? t('monitor.foundNew', { n: r.findings.length }) : t('monitor.noNew'));
    });
  } catch (e) {
    run = Promise.reject(e);
  }
  return run.catch(() => {
    end();
    showToast(t('news.noAnswerLater'));
  });
}
