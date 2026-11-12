/** What to show for a subscription price. A zero total is not a sum. */

export type BillShow = { mode: 'hide' | 'price' | 'full'; price: number; fee: number; total: number };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Full line only when the fee is known. A missing or zero total becomes price + fee, never "= 0". */
export function billShown(price: number, fee: number, total: number): BillShow {
  const p = round2(price > 0 ? price : 0);
  const f = round2(fee > 0 ? fee : 0);
  const given = round2(total > 0 ? total : 0);
  if (!(p > 0)) return { mode: 'hide', price: p, fee: f, total: given };
  const sum = round2(p + f);
  if (f > 0) return { mode: 'full', price: p, fee: f, total: given > 0 && Math.abs(given - sum) < 0.02 ? given : sum };
  if (given > p + 0.02) return { mode: 'full', price: p, fee: round2(given - p), total: given };
  return { mode: 'price', price: p, fee: 0, total: p };
}

export type PayKind = 'card' | 'stars' | 'crypto' | 'promo' | 'named';

/** A raw purchase id (buy:hex) is a card renewal, not a label. */
export function paymentKind(title: string): PayKind {
  const s = (title || '').trim();
  const low = s.toLowerCase();
  if (/star/.test(low)) return 'stars';
  if (/crypto|usdt|\bton\b/.test(low)) return 'crypto';
  if (low.indexOf('promo') >= 0) return 'promo';
  if (!s || /^buy:[0-9a-f]+$/i.test(s) || /^[0-9a-f]{12,}$/i.test(s)) return 'card';
  return 'named';
}

/** "10.31" RUB -> "10,31 ₽". Whole amounts stay without kopecks. */
export function formatPayAmount(amount: string, currency: string): string {
  const n = Number(String(amount || '').replace(/\s/g, '').replace(',', '.'));
  if (!isFinite(n)) return amount || '';
  const whole = Math.abs(Math.round(n * 100) - Math.round(n) * 100) < 1;
  const text = whole ? String(Math.round(n)) : n.toFixed(2).replace('.', ',');
  const cur = (currency || '').trim().toUpperCase();
  if (!cur || cur === 'RUB' || cur === '₽') return text + ' ₽';
  return text + ' ' + currency.trim();
}

export function paymentDate(at: number): string {
  if (!at) return '';
  const ms = at < 1e12 ? at * 1000 : at;
  const d = new Date(ms);
  const p = (n: number) => (n < 10 ? '0' : '') + n;
  return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear();
}
