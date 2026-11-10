import { useEffect, useState } from 'preact/hooks';
import { continueChoice, fetchProgress, progressIdentity, type RemoteProgress } from './progressSync';

export function useContinue(title: string, path: string, film: boolean, localSec: number): { sec: number; other: boolean; episodeKey: string; remoteSec: number } {
  const id = progressIdentity(title, path, film);
  const [remote, setRemote] = useState<RemoteProgress | null>(null);
  useEffect(() => {
    let alive = true;
    setRemote(null);
    if (!id.titleKey) return undefined;
    // Newest row of the title, so a device with no local history can land on the last episode.
    fetchProgress(id.titleKey, '').then((row) => {
      if (alive) setRemote(row);
    });
    return () => {
      alive = false;
    };
  }, [id.titleKey]);
  return continueChoice(id.episodeKey, localSec, remote);
}
