// Long press on a catalog poster: the actions the title already has, plus share.
import { useState } from 'preact/hooks';
import { t } from '../../../src/i18n';
import type { CatalogTitle } from '../../../src/catalog/tmdb';
import { torrentQuery } from '../../../src/catalog/tmdb';
import { libraryTargetOf, type LibraryTarget } from '../../../src/catalog/libraryTarget';
import { loadSubs } from '../../../src/monitor/subs';
import { playableFiles } from '../../../src/lib/episodes';
import { findGroup, seasonMembers } from '../../../src/lib/seriesGroups';
import { markWatched } from '../../../src/store/progress';
import { torrents } from '../../../src/store/library';
import type { Torrent } from '../../../src/api/types';
import { navigate, type MRoute } from '../nav';
import { routeForHash } from '../audiobooks/route';
import { filesOf } from '../watch';
import { watchTarget } from '../lib/torrentActions';
import { Sheet } from '../ui/Sheet';
import { Icon, ICONS } from '../ui/Icon';
import { WantSheet } from '../screens/catalog/WantSheet';
import { WrongShowSheet } from '../ui/WrongShowSheet';
import { displayTitle } from '../../../src/lib/torrentName';
import { posterShare } from './text';
import { sendShare } from './send';

const OPEN = 'M9 6l6 6-6 6';

function libraryRoute(target: LibraryTarget): MRoute {
  return target.kind === 'series' ? { name: 'series', key: target.key, season: target.season } : routeForHash(target.hash);
}

/** The torrent «Просмотрено» can mark: the film, or one release of the series season the library holds. */
function ownedTorrent(list: Torrent[], target: LibraryTarget): Torrent | undefined {
  if (target.kind === 'torrent') return list.find((x) => x.hash === target.hash);
  const group = findGroup(list, target.key);
  if (!group) return undefined;
  const members = target.season ? seasonMembers(group, target.season) : [];
  return members[0] || group.lead;
}

export function CatalogMenu(p: { item: CatalogTitle; onClose: () => void }) {
  const [want, setWant] = useState(false);
  const [wrong, setWrong] = useState(false);
  const item = p.item;
  const list = torrents.value;
  const target = libraryTargetOf(list, item);
  const tor = target ? ownedTorrent(list, target) : undefined;
  // the series group the mark points at: this is where «Не тот сериал?» fixes the show
  const group = target && target.kind === 'series' ? findGroup(list, target.key) : null;
  const file = tor ? watchTarget(tor.hash, playableFiles(filesOf(tor))) : undefined;
  const following = loadSubs().some((s) => s.catalog && s.catalog.kind === item.kind && s.catalog.id === item.id);
  const go = (run: () => void) => {
    p.onClose();
    run();
  };
  if (want) {
    return (
      <WantSheet
        card={{ ...item, backdrop: '', genres: [], runtime: 0, overview: '', cast: [], seasons: [], airing: false }}
        poster={item.poster}
        onClose={() => {
          setWant(false);
          p.onClose();
        }}
      />
    );
  }
  if (wrong && group) {
    return <WrongShowSheet group={group} onClose={() => setWrong(false)} />;
  }
  return (
    <Sheet label={item.title} testId="PD58" onClose={p.onClose}>
      <div class="m-sheet-title">{item.title}</div>
      <button type="button" class="m-opt" data-catalog-action="open" onClick={() => go(() => navigate({ name: 'title', kind: item.kind, id: item.id }))}>
        <Icon d={OPEN} size={22} />
        <span class="m-opt-name">{t('common.open')}</span>
      </button>
      {target ? (
        <button type="button" class="m-opt" data-catalog-action="library" onClick={() => go(() => navigate(libraryRoute(target)))}>
          <Icon d={ICONS.play} size={22} />
          <span class="m-opt-text">
            <span class="m-opt-name">{t('discover.inLibrary')}</span>
            {tor ? <span class="m-opt-sub" data-library-release={tor.hash}>{displayTitle(tor)}</span> : null}
          </span>
        </button>
      ) : null}
      {group ? (
        <button type="button" class="m-opt" data-catalog-wrong onClick={() => setWrong(true)}>
          <Icon d="M20 20l-3.5-3.5M18 11a7 7 0 11-14 0 7 7 0 0114 0z" size={22} />
          <span class="m-opt-name">{t('titleCard.wrongShow')}</span>
        </button>
      ) : null}
      {tor && file ? (
        <button
          type="button"
          class="m-opt"
          data-catalog-action="watched"
          onClick={() => go(() => markWatched(tor.hash, file.id))}
        >
          <Icon d="M5 12.5l4.5 4.5L19 7" size={22} />
          <span class="m-opt-name">{t('history.markWatched')}</span>
        </button>
      ) : null}
      {following ? (
        <button type="button" class="m-opt" data-catalog-action="want" onClick={() => go(() => navigate({ name: 'news', seg: 'subs' }))}>
          <Icon d={ICONS.monitor} size={22} />
          <span class="m-opt-name">{t(item.kind === 'tv' ? 'titleCard.followingSeries' : 'titleCard.followingMovie')}</span>
        </button>
      ) : (
        <button type="button" class="m-opt" data-catalog-action="want" onClick={() => setWant(true)}>
          <Icon d={ICONS.monitor} size={22} />
          <span class="m-opt-name">{t('titleCard.want')}</span>
        </button>
      )}
      <button
        type="button"
        class="m-opt"
        data-catalog-action="search"
        onClick={() => go(() => navigate({ name: 'add', query: torrentQuery(item), run: true }))}
      >
        <Icon d="M20 20l-3.5-3.5M18 11a7 7 0 11-14 0 7 7 0 0114 0z" size={22} />
        <span class="m-opt-name">{t('titleCard.findTorrents')}</span>
      </button>
      <button
        type="button"
        class="m-opt tm"
        data-code="PD58.1"
        data-share="title"
        onClick={() => go(() => void sendShare(posterShare(item)))}
      >
        <Icon d={ICONS.share} size={22} />
        <span class="m-opt-name">{t('share.action')}</span>
      </button>
    </Sheet>
  );
}
