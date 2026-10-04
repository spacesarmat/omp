import { signal } from '@preact/signals';
import { loadJson, saveJson } from '../../src/store/storage';

// «Поддержать OMP»: where the donation methods live. Fill a method in to show it; an empty one is hidden.
// Nothing here is sent anywhere: the buttons only open the link (or copy an address) on the user's tap.

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

export const DONATE_METHODS: DonateMethod[] = [
  { id: 'boosty', title: 'Boosty', url: 'https://boosty.to/djmaker/donate' },
  { id: 'yoomoney', title: 'ЮMoney / СБП', url: '' },
  { id: 'crypto', title: 'Криптовалюта', wallets: [] },
];

export const DONATE_URL = 'https://boosty.to/djmaker/donate';

const isHttps = (u: unknown): u is string => typeof u === 'string' && /^https:\/\/\S+$/.test(u);
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

/** The donate sheet; opened from Settings, «Что нового» and the card. */
export const donateOpen = signal(false);
export const openDonate = () => (donateOpen.value = true);
export const closeDonate = () => (donateOpen.value = false);

// one gentle card after 30 days of use
export const FIRST_RUN_KEY = 'tsp.firstRun';
export const DONATE_CARD_KEY = 'tsp.donateCard';
export const CARD_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

const isTime = (v: unknown): v is number => typeof v === 'number' && isFinite(v) && v > 0;

/** First-run time; an install from before this feature gets it now, so the card comes 30 days after the update. */
export function ensureFirstRun(now: number = Date.now()): number {
  const t = loadJson<unknown>(FIRST_RUN_KEY, null, isTime);
  if (isTime(t)) return t;
  saveJson(FIRST_RUN_KEY, now);
  return now;
}

export function donateCardDue(methods: DonateMethod[] = DONATE_METHODS, now: number = Date.now()): boolean {
  const first = ensureFirstRun(now);
  if (!activeMethods(methods).length) return false;
  if (loadJson<unknown>(DONATE_CARD_KEY, false, (v) => typeof v === 'boolean') === true) return false;
  return now - first >= CARD_AFTER_MS;
}

/** Any way of closing the card hides it for good. */
export function dismissDonateCard(): void {
  saveJson(DONATE_CARD_KEY, true);
}
