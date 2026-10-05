import type { Torrent } from '../../api/types';
import { formatBytes } from '../../lib/format';
import { parseReleaseInfo, releaseBadges, displayBadge } from '../../lib/releaseInfo';
import { categoryTabs, categoryOf } from '../../lib/category';
import type { LibraryView } from '../../lib/libraryView';
import { FocusGroup, Focusable } from '../../ui/components';
import { Poster } from './Poster';
import { displayTitle } from '../../lib/torrentName';

interface ItemProps {
  t: Torrent;
  onOpen: (t: Torrent) => void;
  onFocused: (t: Torrent) => void;
}

function badgesOf(t: Torrent, max: number): string[] {
  return releaseBadges(parseReleaseInfo(displayTitle(t))).map(displayBadge).slice(0, max);
}

function Badges(p: { list: string[]; className?: string }) {
  return p.list.length ? <div class={p.className || 'badges'}>{p.list.map((b) => <span key={b} class="badge">{b}</span>)}</div> : null;
}

function categoryLabel(t: Torrent): string {
  const id = categoryOf(t.category);
  const tabs = categoryTabs();
  for (let i = 0; i < tabs.length; i++) if (tabs[i].id === id) return tabs[i].label;
  return '';
}

const titleOf = (t: Torrent) => displayTitle(t);

function Tile(p: ItemProps & { size: 'large' | 'small' }) {
  const t = p.t;
  return (
    <Focusable focusKey={'torrent-' + t.hash} className={'tile tile-' + p.size} onPress={() => p.onOpen(t)} onFocused={() => p.onFocused(t)}>
      <Poster t={t} showTitle>
        <Badges list={badgesOf(t, p.size === 'large' ? 3 : 1)} className="art-badges" />
      </Poster>
      <div class="tile-title">{titleOf(t)}</div>
      {p.size === 'large' && <div class="tile-meta">{formatBytes(t.torrent_size || 0)}</div>}
    </Focusable>
  );
}

function Row(p: ItemProps) {
  const t = p.t;
  return (
    <Focusable focusKey={'torrent-' + t.hash} className="lrow" onPress={() => p.onOpen(t)} onFocused={() => p.onFocused(t)}>
      <Poster t={t} />
      <div class="lrow-main">
        <div class="lrow-title">{titleOf(t)}</div>
        <Badges list={badgesOf(t, 5)} />
      </div>
      <div class="lrow-cat">{categoryLabel(t)}</div>
      <div class="lrow-size">{formatBytes(t.torrent_size || 0)}</div>
    </Focusable>
  );
}

function CompactRow(p: ItemProps) {
  const t = p.t;
  return (
    <Focusable focusKey={'torrent-' + t.hash} className="crow" onPress={() => p.onOpen(t)} onFocused={() => p.onFocused(t)}>
      <div class="crow-title">{titleOf(t)}</div>
      <Badges list={badgesOf(t, 2)} className="crow-badges" />
      <div class="crow-size">{formatBytes(t.torrent_size || 0)}</div>
    </Focusable>
  );
}

export function TorrentViews(p: { view: LibraryView; list: Torrent[]; onOpen: (t: Torrent) => void; onFocused: (t: Torrent) => void }) {
  const tiles = p.view === 'large' || p.view === 'small';
  return (
    <FocusGroup focusKey="LIB-GRID" className={tiles ? 'views-tiles' : 'views-rows'}>
      {p.list.map((t) => {
        if (p.view === 'large' || p.view === 'small') return <Tile key={t.hash} t={t} size={p.view} onOpen={p.onOpen} onFocused={p.onFocused} />;
        if (p.view === 'list') return <Row key={t.hash} t={t} onOpen={p.onOpen} onFocused={p.onFocused} />;
        return <CompactRow key={t.hash} t={t} onOpen={p.onOpen} onFocused={p.onFocused} />;
      })}
    </FocusGroup>
  );
}
