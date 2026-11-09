import { createBridge, DesktopBridge } from './bridge';

export interface UpdateInfo {
  version: string;
  url: string;
  sha256: string;
  notes: string[];
  releaseUrl?: string;
}

export interface UpdateApi {
  updateCheck(info: UpdateInfo): Promise<UpdateInfo | null>;
  updateDownload(info: UpdateInfo): Promise<UpdateInfo>;
  updateApply(info: UpdateInfo): Promise<void>;
}

export function updateInfoFromPackage(url: string, sha256: string): UpdateInfo {
  const name = new URL(url).pathname.split('/').pop() || '';
  const match = /^OMP-(.+)\.msix$/i.exec(name);
  if (!match) throw new Error('invalid update package version');
  return {
    version: decodeURIComponent(match[1]),
    url,
    sha256,
    notes: [],
  };
}

export function createUpdateApi(bridge: DesktopBridge = createBridge()): UpdateApi {
  return {
    updateCheck: (info) => bridge.invoke<UpdateInfo | null>('update_check', { info }),
    updateDownload: (info) => bridge.invoke<UpdateInfo>('update_download', { info }),
    updateApply: (info) => bridge.invoke<void>('update_apply', { info }),
  };
}
