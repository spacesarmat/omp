import { signal } from '@preact/signals';
import { loadJson, saveJson } from '../../src/store/storage';
import { client } from '../../src/store/servers';
import { torrents } from '../../src/store/library';
import { saveSupport, type JournalClient } from '../../src/store/journal';
import { supportOfList } from '../../src/lib/journal';
import { journalSupportUntil, noteSupportUntil } from '../../src/store/support';
import { t } from '../../src/i18n';
import { verifySupportCode, type CodeCheck } from './supportCode';

// «Поддержать OMP» on the phone: the methods and the support code are shared with the TV (src/lib/donate.ts).
import { activeMethods, donateMethods, supportActive, supportEndText, SUPPORT_MAX_AHEAD_MS, type DonateMethod } from '../../src/lib/donate';

export { donateMethods, DONATE_URL, activeMethods, type DonateMethod, type Wallet } from '../../src/lib/donate';

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

export function donateCardDue(methods: DonateMethod[] = donateMethods(), now: number = Date.now()): boolean {
  const first = ensureFirstRun(now);
  if (!activeMethods(methods).length || supporterActive(now)) return false;
  if (loadJson<unknown>(DONATE_CARD_KEY, false, (v) => typeof v === 'boolean') === true) return false;
  return now - first >= CARD_AFTER_MS;
}

/** Any way of closing the card hides it for good. */
export function dismissDonateCard(): void {
  saveJson(DONATE_CARD_KEY, true);
}

// ---- support code («Уже поддержали?») ----
// The phone checks the code (supportCode.ts) and keeps only its end time: locally (works offline, in the backup)
// and in the TorrServer journal (omp.d.until) for the TVs. The code itself is stored nowhere.

export const SUPPORT_KEY = 'tsp.support';

/** The stored support state: { until } (Unix ms); null when absent or malformed. */
export function sanitizeSupportState(v: unknown): { until: number } | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const until = (v as { until?: unknown }).until;
  return typeof until === 'number' && isFinite(until) && until > 0 ? { until: Math.floor(until) } : null;
}

const loadSupport = (): number => {
  const s = sanitizeSupportState(loadJson<unknown>(SUPPORT_KEY, null, (v) => sanitizeSupportState(v) !== null));
  return s ? s.until : 0;
};

/** End time of the code applied on this phone (0: none). */
export const localSupportUntil = signal(loadSupport());

/** Re-reads the stored state (after a backup restore; tests). */
export function reloadSupport(): void {
  localSupportUntil.value = loadSupport();
}

/**
 * Until when the prompts are hidden (0: they are not): this phone's code or one applied elsewhere (the server's
 * journal). Each source is checked on its own, so a bogus value in one cannot cancel a valid other.
 */
export function activeSupportUntil(now: number = Date.now()): number {
  const local = localSupportUntil.value;
  const journal = journalSupportUntil.value;
  return Math.max(supportActive(local, now) ? local : 0, supportActive(journal, now) ? journal : 0);
}

export function supporterActive(now: number = Date.now()): boolean {
  return activeSupportUntil(now) > 0;
}

/** The TVs know: the server's journal has the mark as late as this phone's own (or the mark came from there). */
export function supportShared(now: number = Date.now()): boolean {
  const journal = journalSupportUntil.value;
  return supportActive(journal, now) && journal >= localSupportUntil.value;
}

export interface SupportIo {
  verify(text: string, now: number): Promise<CodeCheck>;
  /** The active server client (null: none). */
  client(): JournalClient | null;
}

const realIo: SupportIo = {
  verify: (text, now) => verifySupportCode(text, now),
  client: () => client.value,
};
let io: SupportIo = realIo;

/** Replaces the checker / server (tests); no argument restores the real ones. */
export function setSupportIo(next?: Partial<SupportIo>): void {
  io = { ...realIo, ...next };
}

let syncing: Promise<boolean> | null = null;

/** Puts the phone's end time on the server when its journal has none as late (one write; never rejects). */
export function syncSupport(c: JournalClient | null = io.client(), list: { data?: string }[] = torrents.value, now: number = Date.now()): Promise<boolean> {
  const until = localSupportUntil.value;
  if (!c || !supportActive(until, now) || supportOfList(list, now + SUPPORT_MAX_AHEAD_MS) >= until) return Promise.resolve(false);
  if (syncing) return syncing;
  const run = saveSupport(c, until, now).then(
    (ok) => {
      if (ok) noteSupportUntil(until);
      return ok;
    },
    () => false,
  );
  syncing = run;
  run.then(() => {
    if (syncing === run) syncing = null;
  });
  return run;
}

/** «Применить»: checks the code, keeps its end time and shares it with the TVs through the server (awaited). */
export async function applySupportCode(text: string, now: number = Date.now()): Promise<CodeCheck> {
  const r = await io.verify(text, now);
  if (!r.ok) return r;
  if (r.until > localSupportUntil.value) {
    saveJson(SUPPORT_KEY, { until: r.until });
    localSupportUntil.value = r.until;
  }
  await syncSupport(io.client(), torrents.value, now);
  return r;
}

/**
 * «Спасибо! Просьбы о поддержке скрыты до 30 ноября на телефоне и телевизорах.» — the TVs are promised only once the
 * server has the mark (`shared`).
 */
export function supportThanks(until: number, shared: boolean): string {
  return t(shared ? 'donate.thanksShared' : 'donate.thanksLocal', { until: supportEndText(until) });
}
