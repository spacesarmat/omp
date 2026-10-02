import { useEffect, useRef, useState } from 'preact/hooks';
import { chapterList } from '../player/chapters';
import { loadSkip, saveSkip, type SkipPatch, type JournalClient } from '../store/journal';
import type { Torrent, FfprobeResult } from '../api/types';
import type { SkipPrefs } from './journal';

const OFF: SkipPrefs = { i: false, c: false };

export interface SkipClient extends JournalClient {
  probe(hash: string, fileIndex: number): Promise<FfprobeResult | null>;
}

/**
 * Skip settings of a torrent for its card: the saved prefs, and whether the first playable file has intro / credits
 * chapters (one ffprobe per card, started after the prefs are loaded; no ffprobe — no chapters).
 * `save` applies the switches at once and puts them back when the write fails (then rejects, so the caller shows the error).
 */
export function useSkip(c: SkipClient, hash: string, fileIndex: number | null) {
  const [prefs, setPrefs] = useState<SkipPrefs>(OFF);
  const [hasChapters, setHasChapters] = useState(false);
  const alive = useRef(true);
  const cur = useRef(prefs);
  cur.current = prefs;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let dead = false;
    loadSkip(c, hash).then(
      (p) => !dead && setPrefs(p),
      () => undefined,
    );
    return () => {
      dead = true;
    };
  }, [hash]);

  useEffect(() => {
    if (fileIndex === null) return;
    let dead = false;
    c.probe(hash, fileIndex).then(
      (r) => !dead && setHasChapters(chapterList(r).some((x) => x.kind !== null)),
      () => undefined,
    );
    return () => {
      dead = true;
    };
  }, [hash, fileIndex]);

  const save = (patch: SkipPatch, optimistic: boolean): Promise<SkipPrefs> => {
    const before = cur.current;
    if (optimistic) setPrefs({ ...before, ...(patch.i === undefined ? {} : { i: patch.i }), ...(patch.c === undefined ? {} : { c: patch.c }) });
    return saveSkip(c, { hash } as Pick<Torrent, 'hash'>, patch).then(
      (next) => {
        if (alive.current) setPrefs(next);
        return next;
      },
      (e) => {
        if (alive.current && optimistic) setPrefs(before);
        throw e;
      },
    );
  };

  return { prefs, hasChapters, save };
}
