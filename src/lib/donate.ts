// «Поддержать OMP»: the donation methods and the support code, shared by the phone (mobile/src/donate.ts) and the
// TV player (the QR card on pause and during the credits). Fill a method in to show it; an empty one is hidden.
// Nothing here is sent anywhere: the phone buttons only open the link (or copy an address) on the user's tap, the TV
// only draws a QR code of the link.

export interface Wallet {
  network: string;
  address: string;
}

export interface DonateMethod {
  id: 'boosty' | 'yoomoney' | 'crypto';
  title: string;
  url?: string;
  wallets?: Wallet[];
}

export const DONATE_URL = 'https://boosty.to/djmaker/donate';

export const DONATE_METHODS: DonateMethod[] = [
  { id: 'boosty', title: 'Boosty', url: DONATE_URL },
  { id: 'yoomoney', title: 'ЮMoney / СБП', url: '' },
  { id: 'crypto', title: 'Криптовалюта', wallets: [] },
];

/** The link the TV card's QR code opens (src/ui/donateQr.ts is generated from it: npm run gen:donate-qr). */
export const DONATE_QR_URL = DONATE_URL;
/** The short form printed under the QR code. */
export const DONATE_QR_LABEL = 'boosty.to/djmaker';

export const isHttps = (u: unknown): u is string => typeof u === 'string' && /^https:\/\/\S+$/.test(u);
const validWallet = (w: Wallet) => !!w && typeof w.network === 'string' && w.network.trim() !== '' && typeof w.address === 'string' && w.address.trim() !== '';

/** Only the methods that are filled in, in the configured order. */
export function activeMethods(list: DonateMethod[] = DONATE_METHODS): DonateMethod[] {
  const out: DonateMethod[] = [];
  for (const m of list) {
    if (m.id === 'crypto') {
      const wallets = (m.wallets || []).filter(validWallet);
      if (wallets.length) out.push({ ...m, wallets });
    } else if (isHttps(m.url)) out.push(m);
  }
  return out;
}

/** The TV card has something to show: a configured method opens the QR code's link. */
export function qrMethodActive(qrUrl: string, list: DonateMethod[] = DONATE_METHODS): boolean {
  if (!isHttps(qrUrl)) return false;
  return activeMethods(list).some((m) => m.url === qrUrl);
}

// ---- support code ----
// «OMP-YYYY-MM-<signature>»: an Ed25519 signature (base64url) of the ASCII message «omp-support:YYYY-MM» made with
// the owner's key. Checked on the phone only (mobile/src/supportCode.ts); the TVs get just the end time through
// the watch journal (omp.d.until), never the code.

/** The public key that checks support codes (raw 32 bytes, base64url). */
export const SUPPORT_PUBLIC_KEY = '2fSBDBR7sRLp6EAc-OZBHj8-eqC3YcBu7xFVVKiLe7c';
/** A code keeps working this long after the end of its month. */
export const SUPPORT_GRACE_MS = 3 * 24 * 60 * 60 * 1000;
/** An end time further ahead than this is not believed (a code covers at most the next month + the grace). */
export const SUPPORT_MAX_AHEAD_MS = 70 * 24 * 60 * 60 * 1000;

export interface SupportCode {
  /** «2026-11» */
  month: string;
  year: number;
  /** 1–12 */
  mon: number;
  /** base64url, without padding */
  sig: string;
}

/** The signed message of a month. */
export function supportMessage(month: string): string {
  return 'omp-support:' + month;
}

/** The parts of a code; null when it is not shaped like one. Spaces around it and «=» padding are ignored. */
export function parseSupportCode(text: string): SupportCode | null {
  const t = String(text || '').replace(/^\s+|\s+$/g, '').replace(/=+$/, '');
  const m = /^OMP-(\d{4})-(\d{2})-([A-Za-z0-9_-]{86})$/i.exec(t);
  if (!m) return null;
  const year = +m[1];
  const mon = +m[2];
  if (mon < 1 || mon > 12 || year < 2000) return null;
  return { month: m[1] + '-' + m[2], year, mon, sig: m[3] };
}

/** When a code of the month stops working: the 1st of the next month, 00:00 local time, plus the grace. */
export function supportUntil(year: number, mon: number): number {
  return new Date(year, mon, 1).getTime() + SUPPORT_GRACE_MS;
}

/** True while `until` (from the phone's state or a journal) hides the donation prompts. */
export function supportActive(until: number, now: number = Date.now()): boolean {
  return typeof until === 'number' && isFinite(until) && until > now && until - now <= SUPPORT_MAX_AHEAD_MS;
}

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** «30 ноября»: the last day of the code's month (the grace days are not announced). */
export function supportEndText(until: number): string {
  const d = new Date(until - SUPPORT_GRACE_MS - 1);
  return d.getDate() + ' ' + MONTHS_GEN[d.getMonth()];
}
