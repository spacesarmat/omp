// «Новое» → «Подписки» tools: the search over the subscriptions and their findings, the sort of the list (tsp.subsSort)
// and «Проверить сейчас» for one subscription (in the app, through checkSubscription).
import { signal } from '@preact/signals';
import { t } from '../../../src/i18n';
import { loadJson, saveJson } from '../../../src/store/storage';
import { checkSubscription } from '../../../src/monitor/check';
import { getSubscription, loadFound, unseenCount } from '../../../src/monitor/subs';
import { BETTER_ID, EPISODES_ID, type Finding, type Subscription } from '../../../src/monitor/types';
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

/**
 * Findings of the subscriptions (not new episodes / better quality) whose release title contains `q`, newest first;
 * `shown` is capped at FINDINGS_CAP, `more` is the rest.
 */
export function matchFindings(q: string, all: Finding[] = loadFound(), cap = FINDINGS_CAP): { shown: Finding[]; more: number } {
  const k = searchKey(q);
  if (!k) return { shown: [], more: 0 };
  const hit = all.filter((f) => f.subId !== EPISODES_ID && f.subId !== BETTER_ID && searchKey(f.result.Title).indexOf(k) >= 0);
  return { shown: hit.slice(0, cap), more: Math.max(0, hit.length - cap) };
}

// --- sort

export type SubsSort = 'fresh' | 'name' | 'added';
export const SUBS_SORTS: SubsSort[] = ['fresh', 'name', 'added'];
export const SUBS_SORT_KEY = 'tsp.subsSort';

const isSort = (v: unknown): boolean => SUBS_SORTS.indexOf(v as SubsSort) >= 0;

/** The saved sort; «новые находки» by default (and for anything malformed). */
export function loadSubsSort(): SubsSort {
  return loadJson<SubsSort>(SUBS_SORT_KEY, 'fresh', isSort);
}

export function saveSubsSort(s: SubsSort): void {
  if (isSort(s)) saveJson(SUBS_SORT_KEY, s);
}

export function sortLabel(s: SubsSort): string {
  return s === 'name' ? t('news.sortName') : s === 'added' ? t('news.sortAdded') : t('news.sortFresh');
}

const byName = (a: Subscription, b: Subscription): number => {
  const x = searchKey(a.query);
  const y = searchKey(b.query);
  return x < y ? -1 : x > y ? 1 : 0;
};

/**
 * «новые находки»: unseen findings first (more first), then by name; «по имени»: A–Я; «по дате добавления»: the newest
 * subscription first. `unseen` is a test seam.
 */
export function sortSubs(list: Subscription[], mode: SubsSort, unseen: (id: string) => number = unseenCount): Subscription[] {
  const out = list.slice();
  if (mode === 'name') return out.sort(byName);
  if (mode === 'added') return out.sort((a, b) => b.createdAt - a.createdAt || byName(a, b));
  const n: { [id: string]: number } = {};
  out.forEach((s) => (n[s.id] = unseen(s.id)));
  return out.sort((a, b) => n[b.id] - n[a.id] || byName(a, b));
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
