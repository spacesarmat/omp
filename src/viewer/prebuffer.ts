// Prebuffer policy: one file's start, and the MKV tail when the index lives there.
// Metered mobile data stays off unless the setting allows it. Chromium 53 safe.
import { baseName, fileKind, playableFiles, type TorrentFile } from '../lib/episodes';

/** Last bytes of an MKV. The cue index usually sits there. */
export const MKV_TAIL_BYTES = 2 * 1024 * 1024;

export function shouldPrebuffer(metered: boolean, allowMetered: boolean): boolean {
  if (!metered) return true;
  return !!allowMetered;
}

export function isMkvName(name: string): boolean {
  return /\.(mkv|mka|mk3d)$/i.test(name || '');
}

/** navigator.connection: cellular or data-saver. No API (TV, desktop) is unmetered. */
export function connectionMetered(): boolean {
  const nav = typeof navigator === 'undefined' ? null : (navigator as { connection?: { saveData?: boolean; type?: string } });
  const c = nav && nav.connection;
  if (!c) return false;
  if (c.saveData) return true;
  const type = String(c.type || '');
  return type === 'cellular' || type === 'slow-2g' || type === '2g';
}

/** The file Play would open when we only know the list: the largest main video. */
export function likelyVideo(files: TorrentFile[]): TorrentFile | null {
  const list = playableFiles(files);
  if (!list.length) return null;
  let best = list[0];
  for (let i = 1; i < list.length; i++) {
    if (fileKind(list[i].path) !== 'video' && fileKind(best.path) === 'video') continue;
    if (list[i].length > best.length) best = list[i];
  }
  return best;
}

export function tailRange(size: number): { start: number; end: number } | null {
  if (!(size > MKV_TAIL_BYTES)) return null;
  return { start: size - MKV_TAIL_BYTES, end: size - 1 };
}

export interface WarmTarget {
  hash?: string;
  link?: string;
  fileIndex?: number;
  fileName?: string;
  fileSize?: number;
}

export interface WarmClient {
  get(hash: string): Promise<{ hash?: string }>;
  addTemporary(link: string): Promise<{ hash?: string }>;
  remove(hash: string): Promise<void>;
  loadInfo(hash: string): Promise<{ file_stats?: TorrentFile[]; hash?: string }>;
  files(t: { file_stats?: TorrentFile[]; hash?: string }): TorrentFile[];
  preload(hash: string, fileIndex: number, name: string, signal?: AbortSignal): Promise<void>;
  preloadTail(hash: string, fileIndex: number, name: string, start: number, end: number, signal?: AbortSignal): Promise<void>;
}

/**
 * Prebuffer a file that is already on TorrServer. Does not add or remove a torrent.
 * Abort stops the start request and the MKV tail request.
 */
export function startFileWarm(
  c: Pick<WarmClient, 'preload' | 'preloadTail'>,
  hash: string,
  file: { id: number; path: string; length: number } | null,
  allow: boolean,
): () => void {
  if (!allow || !hash || !file) return () => undefined;
  const ctrl = typeof AbortController === 'undefined' ? null : new AbortController();
  const signal = ctrl ? ctrl.signal : undefined;
  const name = baseName(file.path);
  c.preload(hash, file.id, name, signal).then(undefined, () => undefined);
  const range = isMkvName(name) ? tailRange(file.length) : null;
  if (range) c.preloadTail(hash, file.id, name, range.start, range.end, signal).then(undefined, () => undefined);
  return () => {
    if (ctrl) ctrl.abort();
  };
}

/**
 * Starts one prebuffer. The returned function aborts it.
 * A torrent this call added is removed on abort, unless `protectWarm` saw that hash.
 */
export function startWarm(c: WarmClient, target: WarmTarget, allow: boolean): () => void {
  let stopped = false;
  const ctrl = typeof AbortController === 'undefined' ? null : new AbortController();
  if (!allow || (!target.hash && !target.link && target.fileIndex === undefined)) {
    return () => {
      stopped = true;
    };
  }
  let owned = '';
  const linkUsed = target.link || target.hash || '';
  const drop = (hash: string) => {
    if (protectedLinks[linkUsed]) return;
    dropOwned(c, hash);
  };
  const run = () => {
    resolveHash(c, target).then(
      (found) => {
        if (stopped || !found.hash) {
          if (found.mine && found.hash) drop(found.hash);
          return;
        }
        if (found.mine) owned = found.hash;
        const known = target.fileIndex !== undefined && target.fileName;
        if (known) {
          pump(c, found.hash, target.fileIndex as number, target.fileName || 'file', target.fileSize || 0, ctrl ? ctrl.signal : undefined, stoppedNow);
          return;
        }
        c.loadInfo(found.hash).then(
          (info) => {
            if (stoppedNow()) {
              drop(owned);
              return;
            }
            const file = likelyVideo(c.files(info));
            if (!file) {
              drop(owned);
              return;
            }
            pump(c, found.hash, file.id, baseName(file.path), file.length, ctrl ? ctrl.signal : undefined, stoppedNow);
          },
          () => drop(owned),
        );
      },
      () => undefined,
    );
  };
  const stoppedNow = () => stopped;
  run();
  return () => {
    stopped = true;
    if (ctrl) ctrl.abort();
    if (owned) drop(owned);
  };
}

function dropOwned(c: WarmClient, hash: string): void {
  if (!hash || protectedWarm[hash.toLowerCase()]) return;
  c.remove(hash).then(undefined, () => undefined);
}

const protectedWarm: { [hash: string]: boolean } = {};
const protectedLinks: { [link: string]: boolean } = {};

/** The viewer is keeping this torrent (they pressed Play or Add). Abort must not delete it. */
export function protectWarm(hash: string | undefined): void {
  if (!hash) return;
  protectedWarm[hash.toLowerCase()] = true;
}

/** Same, by the magnet or page link, before TorrServer has returned the hash. */
export function protectWarmLink(link: string | undefined): void {
  if (!link) return;
  protectedLinks[link] = true;
}

/** Tests: forget the protect set. */
export function resetWarmProtect(): void {
  const keys = Object.keys(protectedWarm);
  for (let i = 0; i < keys.length; i++) delete protectedWarm[keys[i]];
  const links = Object.keys(protectedLinks);
  for (let i = 0; i < links.length; i++) delete protectedLinks[links[i]];
}

function resolveHash(c: WarmClient, target: WarmTarget): Promise<{ hash: string; mine: boolean }> {
  const hash = (target.hash || '').toLowerCase();
  if (hash) {
    return c.get(hash).then(
      (t) => (t && t.hash ? { hash: t.hash, mine: false } : addNew(c, target.link || hash)),
      () => addNew(c, target.link || hash),
    );
  }
  return addNew(c, target.link || '');
}

function addNew(c: WarmClient, link: string): Promise<{ hash: string; mine: boolean }> {
  if (!link) return Promise.resolve({ hash: '', mine: false });
  return c.addTemporary(link).then(
    (t) => ({ hash: t && t.hash ? t.hash : '', mine: !!(t && t.hash) }),
    () => ({ hash: '', mine: false }),
  );
}

function pump(
  c: WarmClient,
  hash: string,
  fileIndex: number,
  name: string,
  size: number,
  signal: AbortSignal | undefined,
  stopped: () => boolean,
): void {
  if (stopped()) return;
  c.preload(hash, fileIndex, name, signal).then(undefined, () => undefined);
  if (!isMkvName(name)) return;
  const range = tailRange(size);
  if (!range || stopped()) return;
  c.preloadTail(hash, fileIndex, name, range.start, range.end, signal).then(undefined, () => undefined);
}
