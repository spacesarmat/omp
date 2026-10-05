// A site that blocks the person's IP with its own «введите проверочный код» page (torrent.by's /ban_free/ form): a typed
// error, and a pause of the background requests to it. The pause is a storage stamp (tsp.sourcePause { id: untilMs })
// so the phone screens and the long-lived background monitoring page agree; a search the person starts still tries the
// site. Shared by the phone and the TV bundles: Chromium 53 rules.
import { t } from '../i18n';
import { isObject, loadJson, saveJson } from '../store/storage';

export const IP_BAN = 'ipban';
export const PAUSE_KEY = 'tsp.sourcePause';
/** Background requests to a site that showed its code page wait this long. */
export const PAUSE_MS = 60 * 60 * 1000;

/** «torrent.by просит ввести проверочный код». */
export function ipBanText(name: string): string {
  return t('sources.site.ipBan', { name });
}

/** The error of a code page instead of the site's answer (health «просит ввести проверочный код»). */
export function ipBanError(name: string): Error {
  const e = new Error(ipBanText(name));
  (e as Error & { code?: string }).code = IP_BAN;
  return e;
}

export function isIpBan(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { code?: unknown }).code === IP_BAN;
}

/** The phone button that opens the site to enter the code. */
export const enterCodeText = (): string => t('sources.site.enterCode');
/** The TV has no browser: where to enter the code. */
export const ipBanTvHint = (): string => t('sources.site.ipBanTv');

function load(): { [id: string]: number } {
  const v = loadJson<unknown>(PAUSE_KEY, {}, isObject);
  const out: { [id: string]: number } = {};
  if (!isObject(v)) return out;
  Object.keys(v).forEach((id) => {
    const until = v[id];
    if (typeof until === 'number' && isFinite(until)) out[id] = until;
  });
  return out;
}

/** Pauses the background requests to `id` for PAUSE_MS from `now`; expired stamps are pruned. */
export function pauseSource(id: string, now?: number): void {
  const at = typeof now === 'number' ? now : Date.now();
  const all = load();
  const out: { [id: string]: number } = {};
  Object.keys(all).forEach((k) => {
    if (all[k] > at) out[k] = all[k];
  });
  out[id] = at + PAUSE_MS;
  saveJson(PAUSE_KEY, out);
}

/** The background requests to `id` are paused (read from storage every time: another page may have set it). */
export function sourcePaused(id: string, now?: number): boolean {
  const at = typeof now === 'number' ? now : Date.now();
  const until = load()[id];
  return typeof until === 'number' && until > at;
}

/** The site answered (or the person entered the code): its pause ends. Expired stamps are pruned. */
export function clearSourcePause(id: string, now?: number): void {
  const at = typeof now === 'number' ? now : Date.now();
  const all = load();
  const out: { [id: string]: number } = {};
  let changed = false;
  Object.keys(all).forEach((k) => {
    if (k !== id && all[k] > at) out[k] = all[k];
    else changed = true;
  });
  if (changed) saveJson(PAUSE_KEY, out);
}
