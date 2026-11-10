import { useEffect, useState } from 'preact/hooks';
import { fetchProgress, pickContinue, progressIdentity, type RemoteProgress } from './progressSync';

export function useContinue(title: string, path: string, film: boolean, localSec: number): { sec: number; other: boolean } {
  const id = progressIdentity(title, path, film);
  const [remote, setRemote] = useState<RemoteProgress | null>(null);
  useEffect(() => {
    let alive = true;
    setRemote(null);
    if (!id.titleKey) return undefined;
    fetchProgress(id.titleKey, id.episodeKey).then((row) => {
      if (alive) setRemote(row);
    });
    return () => {
      alive = false;
    };
  }, [id.titleKey, id.episodeKey]);
  const sec = pickContinue(localSec, remote);
  return { sec: sec, other: !!(remote && remote.otherDevice && sec === remote.positionSec && sec > localSec) };
}
