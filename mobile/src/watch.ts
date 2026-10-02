// «Watch» actions shared by the library and torrent screens: TV launch params, stream URLs,
// and replaceable side effects (TV launch, external player, clipboard).
import { Clipboard } from '@capacitor/clipboard';
import { launchOnTv } from './tv/tvClient';
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
  if (t !== undefined && t >= 1) p.t = Math.floor(t);
  return p;
}

/** Stream URL with credentials embedded: an external player cannot send headers. */
export function streamUrlFor(c: TorrServerClient, t: Pick<Torrent, 'hash'>, file: TorrentFile): string {
  return c.videoSrc(c.streamUrl(t.hash, file.id, baseName(file.path)));
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

/** Jumps to the remote after a short pause, unless the user has already left the screen. */
export function openRemoteSoon(from: MRoute['name']): void {
  setTimeout(() => {
    if (currentRoute.value.name === from) navigate({ name: 'remote' });
  }, actions.remoteDelayMs);
}
