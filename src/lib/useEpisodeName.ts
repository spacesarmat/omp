import { useEffect, useState } from 'preact/hooks';
import type { Torrent } from '../api/types';
import type { EpisodeInfo } from './episodes';
import { episodeNameOf } from './cleanNames';
import { lang } from '../i18n';

/** The real TMDB name of the episode; '' until it arrives, and for good without TMDB or a match. */
export function useEpisodeName(tor: Torrent | undefined, e: EpisodeInfo): string {
  const l = lang.value;
  const key = (tor ? tor.hash : '') + ':' + e.season + ':' + e.episode + ':' + l;
  const [got, setGot] = useState<{ key: string; name: string }>({ key: '', name: '' });
  useEffect(() => {
    if (!tor || e.season === null || e.episode === null) return;
    let alive = true;
    episodeNameOf(tor, e).then((name) => {
      if (alive) setGot({ key: key, name: name });
    });
    return () => {
      alive = false;
    };
  }, [key]);
  return got.key === key ? got.name : '';
}
