// «Watch» actions shared by the library and torrent screens: TV launch params, stream URLs,
// and replaceable side effects (TV launch, external player, clipboard).
import { Clipboard } from '@capacitor/clipboard';
import { launchOnTv, TV_NO_OMP } from './tv/tvClient';
import { native } from './platform/native';
import { currentRoute, navigate, type MRoute } from './nav';
import { parseTorrentData, type TorrServerClient } from '../../src/api/torrserver';
import type { Torrent } from '../../src/api/types';
import { baseName, type TorrentFile } from '../../src/lib/episodes';

export interface WatchOnTvParams {
  server: string;
  torrent: string;
  file?: number;
  t?: number;
}

export function watchOnTvParams(serverUrl: string, hash: string, file?: number, t?: number): WatchOnTvParams {
  const p: WatchOnTvParams = { server: serverUrl, torrent: hash };
  if (file !== undefined) p.file = file;
  if (file !== undefined && t !== undefined && t >= 1) p.t = Math.floor(t);
  return p;
}

/** Stream URL with credentials embedded: an external player cannot send headers. */
export function streamUrlFor(c: TorrServerClient, t: Pick<Torrent, 'hash'>, file: TorrentFile, withAuth = true): string {
  const url = c.streamUrl(t.hash, file.id, baseName(file.path));
  return withAuth ? c.videoSrc(url) : url;
}

export interface WatchActions {
  launchOnTv: (params: object) => Promise<void>;
  openExternal: (url: string, mime: string) => Promise<void>;
  copyText: (text: string) => Promise<void>;
  /** Pause between «launched» and the jump to the remote. */
  remoteDelayMs: number;
}

const defaults: WatchActions = {
  launchOnTv: (p) => launchOnTv(p),
  openExternal: (url, mime) => native.openExternal(url, mime),
  copyText: (text) => Clipboard.write({ string: text }),
  remoteDelayMs: 1000,
};

export let actions: WatchActions = defaults;

/** Replaces side effects (tests); null restores the real ones. */
export function setWatchActions(a: Partial<WatchActions> | null): void {
  actions = a ? { ...defaults, ...a } : defaults;
}

export function filesOf(t: Torrent): TorrentFile[] {
  return t.file_stats && t.file_stats.length ? t.file_stats : parseTorrentData(t.data);
}

const sameRoute = (a: MRoute, b: MRoute) =>
  a.name === b.name && (a.name !== 'torrent' || (b.name === 'torrent' && a.hash === b.hash));

/**
 * Jumps to the remote after a short pause, unless the user has left `from` meanwhile.
 * Returns a cancel function (call it on unmount); `onDone` fires when the timer ends or is cancelled.
 */
export function openRemoteSoon(from: MRoute | MRoute['name'], onDone?: () => void): () => void {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    onDone?.();
  };
  const timer = setTimeout(() => {
    const here = currentRoute.value;
    if (typeof from === 'string' ? here.name === from : sameRoute(here, from)) navigate({ name: 'remote' });
    finish();
  }, actions.remoteDelayMs);
  return finish;
}

export const OMP_INSTALL_URL = 'https://github.com/spacesarmat/omp#readme';

/** True when a TV launch failed because OMP is not installed on the TV. */
export function isNoOmp(message: string): boolean {
  return message === TV_NO_OMP;
}

/** Opens the TV install guide in the external browser. */
export function openInstallGuide(): void {
  window.open(OMP_INSTALL_URL, '_system');
}
