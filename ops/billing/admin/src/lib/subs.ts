type FilterRow = {
  status?: string;
  active?: boolean;
  bound?: number;
  accountId?: string;
  paidUntil?: number;
  telegramId?: string;
  paidUntilText?: string;
};

/** Device count is separate from expiry: a soon/expiring row with no device still matches «Без устройства». */
export function matchesSubscriptionFilter(row: FilterRow, filter: string) {
  if (!filter || filter === 'all') return true;
  if (filter === 'week') return row.status === 'soon' || row.status === 'expiring';
  if (filter === 'active') return !!row.active;
  if (filter === 'unbound') return !!row.active && !(Number(row.bound) > 0);
  return row.status === filter;
}

/** One reminder per account, using the subscription with the latest paidUntil. */
export function reminderTargets<T extends FilterRow>(rows: T[]) {
  const latest = new Map<string, T>();
  for (const row of rows || []) {
    const id = row && row.accountId;
    if (!id) continue;
    const prev = latest.get(id);
    if (!prev || (row.paidUntil || 0) > (prev.paidUntil || 0)) latest.set(id, row);
  }
  const out: T[] = [];
  for (const row of latest.values()) {
    if ((row.status === 'soon' || row.status === 'expiring') && row.telegramId) out.push(row);
  }
  return out;
}
