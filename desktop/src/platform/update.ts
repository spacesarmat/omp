import { createBridge, DesktopBridge } from './bridge';

export interface UpdateInfo {
  version: string;
  url: string;
  sha256: string;
  notes: string[];
  releaseUrl?: string;
}

export interface UpdateResult {
  status: 'success' | 'error';
  message?: string;
}

export interface UpdateApi {
  updateCheck(info: UpdateInfo): Promise<UpdateInfo | null>;
  updateDownload(info: UpdateInfo): Promise<UpdateInfo>;
  updateApply(info: UpdateInfo): Promise<void>;
  takePendingUpdateResult(): Promise<UpdateResult | null>;
}

const PACKAGE_SUFFIXES = ['-setup.exe', '-portable.exe', '-macos-arm64.dmg', '-macos-x64.dmg', '-linux-x64.AppImage', '-linux-x64.deb'];

export function updateInfoFromPackage(url: string, sha256: string): UpdateInfo {
  const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
  const lower = name.toLowerCase();
  const suffix = PACKAGE_SUFFIXES.find((item) => lower.endsWith(item.toLowerCase()));
  if (!suffix || !lower.startsWith('omp-')) throw new Error('invalid update package version');
  const version = name.slice(4, name.length - suffix.length);
  if (!/^[0-9]+(\.[0-9]+){1,3}(-beta\.[0-9]+)?$/.test(version)) throw new Error('invalid update package version');
  return { version, url, sha256, notes: [] };
}

export function createUpdateApi(bridge: DesktopBridge = createBridge()): UpdateApi {
  return {
    updateCheck: (info) => bridge.invoke<UpdateInfo | null>('update_check', { info }),
    updateDownload: (info) => bridge.invoke<UpdateInfo>('update_download', { info }),
    updateApply: (info) => bridge.invoke<void>('update_apply', { info }),
    takePendingUpdateResult: () => bridge.invoke<UpdateResult | null>('update_pending_result'),
  };
}
