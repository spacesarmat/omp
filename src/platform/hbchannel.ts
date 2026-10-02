import { lunaCall, lunaSubscribe } from './luna';

export const HB_APP_ID = 'org.webosbrew.hbchannel';
const HB_SERVICE = 'luna://org.webosbrew.hbchannel.service/';
const APP_MANAGER = 'luna://com.webos.applicationManager/';

export type HbPresence = 'installed' | 'missing' | 'unknown';

/** 'unknown' when Luna is unavailable or the call is denied: the UI then shows the Homebrew option with a caveat. */
export function hbPresence(): Promise<HbPresence> {
  return lunaCall<{ appInfo?: unknown }>(APP_MANAGER + 'getAppInfo', { id: HB_APP_ID }).then(
    (r): HbPresence => (r && r.appInfo ? 'installed' : 'missing'),
    (e: Error): HbPresence => (/not exist|not found|cannot find|no such/i.test(e.message) ? 'missing' : 'unknown'),
  );
}

/** checkRoot answers { returnValue: runningAsRoot }, so non-root arrives as a Luna error. */
export function hbHasRoot(): Promise<boolean> {
  return lunaCall(HB_SERVICE + 'checkRoot', {}, 3000).then(() => true, () => false);
}

export function openHbChannel(addRepositoryUrl?: string): Promise<void> {
  const params = addRepositoryUrl ? { launchMode: 'addRepository', url: addRepositoryUrl } : {};
  return lunaCall(APP_MANAGER + 'launch', { id: HB_APP_ID, params }).then(() => undefined);
}

export interface InstallStatus {
  stage: 'download' | 'verify' | 'install' | 'done';
  progress?: number;
  text: string;
}

export function installStatus(m: { statusText?: string; progress?: number; finished?: boolean }): InstallStatus {
  if (m.finished) return { stage: 'done', text: 'Готово. OMP перезапустится' };
  const t = m.statusText || '';
  if (/verif/i.test(t)) return { stage: 'verify', text: 'Проверка…' };
  if (/install|self-update/i.test(t)) return { stage: 'install', text: 'Установка…' };
  if (typeof m.progress === 'number' && isFinite(m.progress)) {
    const p = Math.max(0, Math.min(100, Math.round(m.progress)));
    return { stage: 'download', progress: p, text: 'Скачивание… ' + p + '%' };
  }
  return { stage: 'download', text: 'Скачивание…' };
}

/** One-click install via Homebrew Channel; only works on rooted TVs. Returns a cancel function. */
export function hbInstall(ipkUrl: string, ipkHash: string, onStatus: (s: InstallStatus) => void, onError: (e: Error) => void): () => void {
  return lunaSubscribe(HB_SERVICE + 'install', { ipkUrl, ipkHash }, (m) => onStatus(installStatus(m)), onError);
}
