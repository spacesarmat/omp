import { useEffect, useState } from 'preact/hooks';
import { fetchProgress, pickContinue, progressIdentity, type RemoteProgress } from './progressSync';

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
  const remoteKey = remote && remote.episodeKey ? remote.episodeKey : '';
  const same = !remoteKey || remoteKey === id.episodeKey;
  // A different episode's seconds stay off this file until the screen finds that episode in this release.
  const sec = same ? pickContinue(localSec, remote) : localSec;
  const other = !!(same && remote && remote.otherDevice && sec === remote.positionSec && sec > localSec);
  const offerEpisode = !!(!same && remote && remote.otherDevice && remote.positionSec >= 15);
  return { sec: sec, other: other, episodeKey: offerEpisode ? remoteKey : '', remoteSec: offerEpisode ? remote.positionSec : 0 };
}
