import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { Torrent } from '../../api/types';
import { posterColor, shortTitle } from '../../lib/libraryView';

/** Torrent poster, or a colored placeholder with the short title when there is no image. */
export function Poster(p: { t: Torrent; showTitle?: boolean; children?: ComponentChildren }) {
  const t = p.t;
  const [broken, setBroken] = useState(false);
  const img = !!t.poster && !broken;
  return (
    <div class="art" style={{ background: 'linear-gradient(160deg, ' + posterColor(t.hash) + ', #14161c)' }}>
      {img && <img src={t.poster} alt="" onError={() => setBroken(true)} />}
      {!img && p.showTitle && <div class="art-title">{shortTitle(t.title || t.name || '')}</div>}
      {p.children}
    </div>
  );
}
