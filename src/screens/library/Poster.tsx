import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { Torrent } from '../../api/types';
import { posterColor, shortTitle } from '../../lib/libraryView';
import { posterUrlFor } from '../../catalog/tmdb';
import { displayTitle } from '../../lib/torrentName';
import { tvGlyphs } from '../../ui/tvText';

/** Two letters for a posterless tile. The name itself is the line under the poster, not painted on it again. */
export function posterInitials(title: string): string {
  const words = shortTitle(title).split(/\s+/).filter((w) => w && !/^(и|and|the|a|an|of|в|на)$/i.test(w));
  const use = words.length ? words : shortTitle(title).split(/\s+/).filter((w) => !!w);
  if (!use.length) return '?';
  const second = use.length > 1 ? use[1].charAt(0) : '';
  return (use[0].charAt(0) + second).toLocaleUpperCase();
}

/**
 * Torrent poster, or initials on a gradient when there is no image. `unload`: a tile far from the focus drops its
 * image (the box keeps its size) until it comes near again. `box`: the art width in CSS px, so the image asked for
 * is the size of this box and not a 780 px poster shrunk into it.
 */
export function Poster(p: { t: Torrent; showTitle?: boolean; unload?: boolean; box?: number; children?: ComponentChildren }) {
  const t = p.t;
  const [broken, setBroken] = useState(false);
  const poster = t.poster;
  const img = !!poster && !broken;
  return (
    <div class="art" style={{ background: 'linear-gradient(160deg, ' + posterColor(t.hash) + ', #14161c)' }}>
      {img && !p.unload && <img src={posterUrlFor(poster, p.box || 230)} alt="" onError={() => setBroken(true)} />}
      {!img && <div class="art-initials">{tvGlyphs(posterInitials(displayTitle(t)))}</div>}
      {p.children}
    </div>
  );
}
