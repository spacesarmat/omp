// «Поиск» → «Мои»: the library cards matching the field (series and the releases of one film as one card, as in
// «Мои»), each opening its screen; nothing found offers the catalog and the sources with the same words.
import { useMemo } from 'preact/hooks';
import { fmtSize, t, tp } from '../../../src/i18n';
import { torrents } from '../../../src/store/library';
import { settings } from '../../../src/store/settings';
import { sortTorrents } from '../../../src/lib/librarySearch';
import { groupLabel, groupSize } from '../../../src/lib/seriesGroups';
import { libraryTitle } from '../../../src/lib/libraryView';
import { cachedSeriesMatch, seriesMatchVersion } from '../../../src/lib/seriesMatch';
import { navigate } from '../nav';
import { routeForTorrent } from '../audiobooks/route';
import { Poster } from '../ui/Poster';
import { groupPhoneLibrary, type PhoneItem } from '../lib/filmGroups';
import { releaseLine } from '../lib/duplicates';

function open(it: PhoneItem): void {
  if (it.kind === 'torrent') navigate(routeForTorrent(it.tor));
  else if (it.kind === 'series') navigate({ name: 'series', key: it.key });
  else navigate({ name: 'torrent', hash: it.lead.hash });
}

function nameOf(it: PhoneItem): string {
  if (it.kind === 'series') {
    const card = cachedSeriesMatch(it.key);
    return card && card.title ? card.title : libraryTitle(it.named).title;
  }
  return libraryTitle(it.kind === 'torrent' ? it.tor : it.lead).title;
}

function metaOf(it: PhoneItem): string {
  if (it.kind === 'series') return [groupLabel(it), fmtSize(groupSize(it))].join(' · ');
  if (it.kind === 'film') return [libraryTitle(it.lead).meta, tp('series.releases', it.members.length)].filter(Boolean).join(' · ');
  return [libraryTitle(it.tor).meta, releaseLine(it.tor, false, false)].filter(Boolean).join(' · ');
}

export function SearchMine({ query, onCatalog, onSources }: { query: string; onCatalog: () => void; onSources: () => void }) {
  void seriesMatchVersion.value;
  const list = torrents.value;
  const sort = settings.value.librarySort;
  const q = query.trim();
  const items = useMemo(() => (q ? groupPhoneLibrary(sortTorrents(list, sort), q) : []), [list, sort, q]);
  if (!q) return <p class="m-muted m-small" data-search-mine="empty-query">{t('nav.searchTypeMore')}</p>;
  if (!items.length) {
    return (
      <div class="m-search-none" data-search-mine="none">
        <p class="m-muted">{t('nav.searchMineEmpty')}</p>
        <button type="button" class="m-btn m-btn-secondary" data-search-to="catalog" onClick={onCatalog}>
          {t('nav.searchInCatalog')}
        </button>
        <button type="button" class="m-btn m-btn-secondary" data-search-to="sources" onClick={onSources}>
          {t('nav.searchInSources')}
        </button>
      </div>
    );
  }
  return (
    <div class="m-srch-list" data-search-mine="list">
      {items.map((it) => {
        const tor = it.kind === 'torrent' ? it.tor : it.lead;
        const key = it.kind === 'torrent' ? it.tor.hash : it.kind + ':' + it.key;
        return (
          <button key={key} type="button" class="m-srch-row" data-mine-item={it.kind} onClick={() => open(it)}>
            <Poster torrent={tor} class="m-poster-mini" />
            <span class="m-srch-info">
              <span class="m-card-title">{nameOf(it)}</span>
              <span class="m-muted m-small">{metaOf(it)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
