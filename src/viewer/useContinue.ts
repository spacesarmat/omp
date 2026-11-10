import { useEffect, useState } from 'preact/hooks';
import { fetchProgress, pickContinue, progressIdentity, type RemoteProgress } from './progressSync';

export function useContinue(title: string, path: string, film: boolean, localSec: number): { sec: number; other: boolean; episodeKey: string } {
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
  const remoteKey = remote && remote.episodeKey ? remote.episodeKey : '';
  const same = !remoteKey || remoteKey === id.episodeKey;
  const sec = same ? pickContinue(localSec, remote) : localSec > 0 ? localSec : remote ? remote.positionSec : 0;
  const other = !!(remote && remote.otherDevice && sec === remote.positionSec && (same ? sec > localSec : localSec <= 0));
  return { sec: sec, other: other, episodeKey: other && !same ? remoteKey : '' };
}
