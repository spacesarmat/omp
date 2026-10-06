import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { Torrent } from '../../api/types';
import { posterColor, shortTitle } from '../../lib/libraryView';
import { displayTitle } from '../../lib/torrentName';
import { tvGlyphs } from '../../ui/tvText';

/**
 * Torrent poster, or a colored placeholder with the short title when there is no image. `unload`: a tile far from the
 * focus drops its image (the box keeps its size) until it comes near again.
 */
export function Poster(p: { t: Torrent; showTitle?: boolean; unload?: boolean; children?: ComponentChildren }) {
  const t = p.t;
  const [broken, setBroken] = useState(false);
  const img = !!t.poster && !broken;
  return (
    <div class="art" style={{ background: 'linear-gradient(160deg, ' + posterColor(t.hash) + ', #14161c)' }}>
      {img && !p.unload && <img src={t.poster} alt="" onError={() => setBroken(true)} />}
      {!img && p.showTitle && <div class="art-title">{tvGlyphs(shortTitle(displayTitle(t)))}</div>}
      {p.children}
    </div>
  );
}
