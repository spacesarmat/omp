import type { Torrent } from '../../../src/api/types';
import { posterColor, shortTitle } from '../../../src/lib/libraryView';
import { parseReleaseInfo, releaseBadges, displayBadge } from '../../../src/lib/releaseInfo';
import { displayTitle } from '../../../src/lib/torrentName';

/** Quality badge: the first release tag that is not just a year. */
export function qualityBadge(title: string): string {
  const b = releaseBadges(parseReleaseInfo(title)).filter((x) => !/^\d{4}$/.test(x))[0];
  return b ? displayBadge(b) : '';
}

const cssUrl = (u: string) => u.replace(/["()\\\s]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

export function posterStyle(t: Torrent): string {
  const gradient = `linear-gradient(160deg, ${posterColor(t.hash)}, #14161C)`;
  return /^https?:\/\//i.test(t.poster || '')
    ? `background: linear-gradient(0deg, rgba(15,17,21,0.55), rgba(15,17,21,0) 55%), url("${cssUrl(t.poster || '')}") center / cover, ${gradient}`
    : `background: ${gradient}`;
}

export function Poster({ torrent, class: cls = '' }: { torrent: Torrent; class?: string }) {
  const hasImage = /^https?:\/\//i.test(torrent.poster || '');
  const badge = qualityBadge(displayTitle(torrent));
  return (
    <div class={'m-poster ' + cls} style={posterStyle(torrent)}>
      {!hasImage && <div class="m-poster-title">{shortTitle(displayTitle(torrent))}</div>}
      {badge && <span class="m-badge">{badge}</span>}
    </div>
  );
}
