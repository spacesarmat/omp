/** Sorting, filtering and folding of the «Мониторинг» tab. Pure functions, so they are tested without a browser. */

export type MonitorCheck = {
  id: string;
  group: string;
  name: string;
  path: string;
  target?: string;
  ok: boolean | null;
  /** 'code' on a passing tracker site that shows a captcha or anti-bot page: yellow «Просит код», no alert. */
  warn?: string;
  detail: string;
  context?: string;
  ms: number;
  at?: number;
  alert: boolean;
  alerted?: boolean;
  retried?: boolean;
  history: string;
  uptime: number | null;
};

export type MonitorFilter = 'all' | 'errors' | 'noalert' | 'code';
export type MonitorSort = 'status' | 'name' | 'ms' | 'time';

export type MonitorPrefs = {
  filter: MonitorFilter;
  sort: MonitorSort;
  desc: boolean;
  q: string;
  /** Group id -> true opened, false folded. A group without an entry: red open, all green folded. */
  open: Record<string, boolean>;
};

export const PREFS_KEY = 'omp-admin-monitor-view';
export const DEFAULT_PREFS: MonitorPrefs = { filter: 'all', sort: 'status', desc: false, q: '', open: {} };

export const FILTER_TEXT: Record<MonitorFilter, string> = { all: 'Все', errors: 'Только ошибки', noalert: 'Без алерта', code: 'Просит код' };
export const SORT_TEXT: Record<MonitorSort, string> = { status: 'Статус', name: 'Название', ms: 'Время ответа', time: 'Время проверки' };

type Storage = { getItem(k: string): string | null; setItem(k: string, v: string): void };

export function loadPrefs(storage?: Storage | null): MonitorPrefs {
  try {
    const raw = storage ? storage.getItem(PREFS_KEY) : null;
    if (!raw) return { ...DEFAULT_PREFS, open: {} };
    const p = JSON.parse(raw) as Partial<MonitorPrefs>;
    const open: Record<string, boolean> = {};
    if (p.open && typeof p.open === 'object') for (const [k, v] of Object.entries(p.open)) if (typeof v === 'boolean' && /^[a-z]{1,20}$/.test(k)) open[k] = v;
    return {
      filter: p.filter && p.filter in FILTER_TEXT ? p.filter : 'all',
      sort: p.sort && p.sort in SORT_TEXT ? p.sort : 'status',
      desc: p.desc === true,
      q: typeof p.q === 'string' ? p.q.slice(0, 100) : '',
      open,
    };
  } catch {
    return { ...DEFAULT_PREFS, open: {} };
  }
}

export function savePrefs(storage: Storage | null | undefined, prefs: MonitorPrefs) {
  try {
    if (storage) storage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* private mode or full storage: the choice just is not kept */
  }
}

/** One line of a table: a single check, or a tracker with its search, site-direct and site-WARP checks. */
export type MonitorItem = {
  key: string;
  kind: 'check' | 'tracker';
  name: string;
  target: string;
  checks: MonitorCheck[];
  check?: MonitorCheck;
  search?: MonitorCheck;
  direct?: MonitorCheck;
  warp?: MonitorCheck;
  site?: MonitorCheck;
};

/** Trackers (ids `<base>:direct|warp|site`, and the Jackett search row) become one item each. */
export function groupItems(rows: MonitorCheck[]): MonitorItem[] {
  const out: MonitorItem[] = [];
  const map = new Map<string, MonitorItem>();
  for (const r of rows) {
    const m = /^(.*):(direct|warp|site)$/.exec(r.id);
    const key = m ? m[1] : r.path === 'jackett' ? r.id : '';
    if (!key) {
      out.push({ key: r.id, kind: 'check', name: r.name, target: r.target || '', checks: [r], check: r });
      continue;
    }
    let it = map.get(key);
    if (!it) {
      it = { key, kind: 'tracker', name: r.name, target: '', checks: [] };
      map.set(key, it);
      out.push(it);
    }
    it.checks.push(r);
    // the site address (the search row's target is the Jackett indexer id)
    if (r.target && !it.target && r.path !== 'jackett') it.target = r.target;
    if (r.path === 'jackett') it.search = r;
    else if (m && m[2] === 'direct') it.direct = r;
    else if (m && m[2] === 'warp') it.warp = r;
    else it.site = r;
  }
  return out;
}

/** false: something red; true: something passed (green or yellow) and nothing red; null: nothing judged. */
export function itemOk(it: MonitorItem): boolean | null {
  if (it.checks.some((c) => c.ok === false)) return false;
  if (it.checks.some((c) => c.ok === true)) return true;
  return null;
}

/** A passing check that asks for a code (captcha or anti-bot page). */
export const isYellow = (c: MonitorCheck) => c.ok === true && !!c.warn;

export type ItemState = 'red' | 'yellow' | 'green' | 'none';

/** red: something failed; yellow: nothing failed, something asks for a code; green; none: nothing judged. */
export function itemState(it: MonitorItem): ItemState {
  const ok = itemOk(it);
  if (ok === false) return 'red';
  if (ok === null) return 'none';
  return it.checks.some(isYellow) ? 'yellow' : 'green';
}

/** «1 жёлтая», «2 жёлтые», «5 жёлтых». */
export function yellowText(n: number) {
  const m10 = n % 10;
  const m100 = n % 100;
  const word = m10 === 1 && m100 !== 11 ? 'жёлтая' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'жёлтые' : 'жёлтых';
  return n + ' ' + word;
}

const RANK: Record<ItemState, number> = { red: 0, yellow: 1, none: 2, green: 3 };
const rank = (it: MonitorItem) => RANK[itemState(it)];
const itemMs = (it: MonitorItem) => Math.max(0, ...it.checks.map((c) => Number(c.ms) || 0));
const itemAt = (it: MonitorItem) => Math.max(0, ...it.checks.map((c) => Number(c.at) || 0));

export function matchesFilter(it: MonitorItem, filter: MonitorFilter): boolean {
  const red = it.checks.filter((c) => c.ok === false);
  if (filter === 'errors') return red.length > 0;
  if (filter === 'code') return it.checks.some(isYellow);
  // red, but nothing of it goes to Telegram (one path of a tracker, a direct-only block)
  if (filter === 'noalert') return red.length > 0 && red.every((c) => !c.alert);
  return true;
}

export function matchesQuery(it: MonitorItem, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const hay = [it.name, it.target, it.key, ...it.checks.map((c) => c.detail)].join(' ').toLowerCase();
  return hay.includes(s);
}

export function sortItems(items: MonitorItem[], sort: MonitorSort, desc: boolean): MonitorItem[] {
  const byName = (a: MonitorItem, b: MonitorItem) => a.name.localeCompare(b.name, 'ru');
  const cmp = (a: MonitorItem, b: MonitorItem) => {
    if (sort === 'name') return byName(a, b);
    if (sort === 'ms') return itemMs(a) - itemMs(b) || byName(a, b);
    if (sort === 'time') return itemAt(a) - itemAt(b) || byName(a, b);
    return rank(a) - rank(b) || byName(a, b);
  };
  return items
    .map((it, i) => ({ it, i }))
    .sort((x, y) => (desc ? -cmp(x.it, y.it) : cmp(x.it, y.it)) || x.i - y.i)
    .map((x) => x.it);
}

export type GroupView = {
  id: string;
  title: string;
  total: number;
  /** Green and yellow items (a yellow site opens for a person). */
  okCount: number;
  /** Yellow items: «Просит код». */
  warned: number;
  /** Items with no result (a check that is not configured or was skipped): never counted as ok. */
  skipped: number;
  failed: number;
  /** Folded to the one-line summary («Контейнеры 12/12»). */
  folded: boolean;
  items: MonitorItem[];
};

/**
 * The groups to show: red groups first (then the usual order), each with its items filtered and sorted. With a
 * filter or a search a group without matches is hidden and the others are shown open.
 */
export function buildView(groups: { id: string; title: string }[], checks: MonitorCheck[], prefs: MonitorPrefs): GroupView[] {
  const narrowed = prefs.filter !== 'all' || !!prefs.q.trim();
  const out: GroupView[] = [];
  groups.forEach((g) => {
    const rows = checks.filter((c) => c.group === g.id);
    if (!rows.length) return;
    const all = groupItems(rows);
    const failed = rows.filter((c) => c.ok === false).length;
    const items = sortItems(
      all.filter((it) => matchesFilter(it, prefs.filter) && matchesQuery(it, prefs.q)),
      prefs.sort,
      prefs.desc,
    );
    if (narrowed && !items.length) return;
    const chosen = prefs.open[g.id];
    const okCount = all.filter((it) => itemOk(it) === true).length;
    const skipped = all.filter((it) => itemOk(it) === null).length;
    const warned = all.filter((it) => itemState(it) === 'yellow').length;
    // Folded by default only when every item is green; a skipped check stays visible.
    const folded = narrowed ? false : chosen === undefined ? okCount === all.length : !chosen;
    out.push({ id: g.id, title: g.title, total: all.length, okCount, warned, skipped, failed, folded, items });
  });
  const order = new Map(groups.map((g, i) => [g.id, i]));
  return out.sort((a, b) => (a.failed ? 0 : 1) - (b.failed ? 0 : 1) || (order.get(a.id) || 0) - (order.get(b.id) || 0));
}
