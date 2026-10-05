import { useEffect, useRef, useState } from 'preact/hooks';
import { chapterList } from '../player/chapters';
import { loadSkip, saveSkip, type SkipPatch, type JournalClient } from '../store/journal';
import type { Torrent, FfprobeResult } from '../api/types';
import type { SkipPrefs } from './journal';
import { playableFiles, type TorrentFile } from './episodes';
import { t } from '../i18n';

const OFF: SkipPrefs = { i: false, c: false };

export interface SkipClient extends JournalClient {
  probe(hash: string, fileIndex: number): Promise<FfprobeResult | null>;
}

/** File whose chapters tell about the whole torrent: the first playable one (same on every card). */
export function firstPlayableId(files: TorrentFile[]): number | null {
  const list = playableFiles(files);
  return list.length ? list[0].id : null;
}

/** A patch, or a function of the latest prefs (so quick taps build on each other). */
export type SkipUpdate = SkipPatch | ((prev: SkipPrefs) => SkipPatch);

/**
 * Skip settings of a torrent for its card: the saved prefs, and whether the first playable file has intro / credits
 * chapters (one ffprobe per card; no ffprobe — no chapters). A null client waits (the card is not ready yet).
 * `save` applies the switches at once and puts back only the switches of that write when it fails (then rejects,
 * so the caller shows the error).
 */
/** `known`: the torrent itself is loaded (the phone card may render before it is fetched); the settings load then. */
export function useSkip(c: SkipClient | null | undefined, hash: string, fileIndex: number | null, known = true) {
  const [prefs, setPrefs] = useState<SkipPrefs>(OFF);
  const [hasChapters, setHasChapters] = useState(false);
  const alive = useRef(true);
  const cur = useRef(prefs);
  const touched = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const apply = (p: SkipPrefs) => {
    cur.current = p;
    if (alive.current) setPrefs(p);
  };

  useEffect(() => {
    if (!c || !known) return;
    let dead = false;
    touched.current = false;
    loadSkip(c, hash).then(
      // a switch tapped before the load answered is newer than the saved value
      (p) => !dead && !touched.current && apply(p),
      () => undefined,
    );
    return () => {
      dead = true;
    };
  }, [!!c, hash, known]);

  useEffect(() => {
    if (!c || fileIndex === null) return;
    let dead = false;
    c.probe(hash, fileIndex).then(
      (r) => !dead && setHasChapters(chapterList(r).some((x) => x.kind !== null)),
      () => undefined,
    );
    return () => {
      dead = true;
    };
  }, [!!c, hash, fileIndex]);

  const save = (update: SkipUpdate, optimistic: boolean): Promise<SkipPrefs> => {
    if (!c) return Promise.reject(new Error(t('errors.noServerConnection')));
    const before = cur.current;
    const patch = typeof update === 'function' ? update(before) : update;
    touched.current = true;
    if (optimistic) apply({ ...before, ...(patch.i === undefined ? {} : { i: patch.i }), ...(patch.c === undefined ? {} : { c: patch.c }) });
    return saveSkip(c, { hash } as Pick<Torrent, 'hash'>, patch).then(
      (next) => {
        // the switches are already shown (a later tap may be newer than this answer); the marks come from the write
        const now = cur.current;
        const out: SkipPrefs = { i: now.i, c: now.c };
        if (next.mi) out.mi = next.mi;
        if (next.mc) out.mc = next.mc;
        apply(out);
        return next;
      },
      (e) => {
        if (optimistic) {
          const now = cur.current;
          apply({ ...now, ...(patch.i === undefined ? {} : { i: before.i }), ...(patch.c === undefined ? {} : { c: before.c }) });
        }
        throw e;
      },
    );
  };

  return { prefs, hasChapters, save };
}
