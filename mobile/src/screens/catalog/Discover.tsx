// «Обзор»: the TMDB feed (movies and series) with its sort and filters, marked when already in the library.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { t } from '../../../../src/i18n';
import { Icon, ICONS } from '../../ui/Icon';
import { navigate, scrollToTop, switchTab } from '../../nav';
import { torrents } from '../../../../src/store/library';
import { catalogErrorCode, type CatalogErrorCode } from '../../../../src/catalog/client';
import { libraryIndex, inLibrary } from '../../../../src/catalog/library';
import { phoneCatalog } from '../../catalog/phoneCatalog';
import { CatalogError } from './CatalogError';
import { readDiscover, saveDiscover, type Feed, type Filter } from './discoverCache';
import { readDiscoverCols, saveDiscoverCols, COLS_BY_SIZE, discoverGridClass, discoverLandscapeCols, type DiscoverCols } from './discoverCols';
import { colsStyle, useLandscapeBox } from '../../ui/landscapeCols';
import { usePinchStep } from '../../ui/usePinchStep';
import {
  discoverQueryKey,
  discoverFilterCount,
  isHomeDiscoverQuery,
  sanitizeDiscoverQuery,
  type DiscoverQuery,
} from '../../../../src/catalog/discoverQuery';
import { loadDiscoverQuery, saveDiscoverQuery } from './discoverQueryStore';
import { DiscoverSortSheet, DiscoverFiltersSheet, sortName } from './DiscoverSheets';
import { DiscoverHome } from './DiscoverHome';
import { DiscPoster, TileMeta, TileTitle, TileWhen } from './DiscoverTiles';
import { PosterButton } from '../../share/PosterButton';
import { cancelTileCards } from '../../catalog/tileCards';
import type { TrendingWindow } from '../../../../src/catalog/tmdb';
import { withAds } from '../../../../src/ads/ads';
import { AdCell } from '../../ads/AdCell';
import { PER_SCREEN, useAdSlots } from '../../ads/useAdSlots';

export { DiscPoster, TileMeta, TileTitle, TileWhen } from './DiscoverTiles';

const SKELETONS = 6;

const SEARCH = 'M5 11a6 6 0 1 0 12 0a6 6 0 1 0 -12 0M20 20l-4.5-4.5';

function chips(): { id: Filter; label: string }[] {
  return [
    { id: 'all', label: t('common.all') },
    { id: 'movie', label: t('category.movie') },
    { id: 'tv', label: t('category.tv') },
  ];
}

export function Discover() {
  // leaving «Обзор»: the queued tile cards are not fetched any more
  useEffect(() => () => cancelTileCards(), []);
  // the sort and the filters, kept across launches; the feed is keyed on them
  const [query, setQuery] = useState<DiscoverQuery>(loadDiscoverQuery);
  const qkey = discoverQueryKey(query);
  const home = isHomeDiscoverQuery(query);
  const [sheet, setSheet] = useState<'sort' | 'filters' | null>(null);
  const [trendWindow, setTrendWindow] = useState<TrendingWindow>('day');
  // back from a title card (or another tab): the chip, the loaded pages and the open search come back as they were
  const kept = useMemo(() => readDiscover(qkey), []);
  const [filter, setFilter] = useState<Filter>(kept ? kept.filter : 'all');
  const [feed, setFeed] = useState<Feed | null>(kept && !home ? kept.feed : null);
  const [error, setError] = useState<CatalogErrorCode | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [reload, setReload] = useState(0);
  // a kept feed is shown as is: the first run of the load effect skips the fetch
  const restored = useRef(!!(kept && kept.feed && !home));
  // the current request: answers of an older one (another chip, a retry) are dropped
  const gen = useRef(0);
  const sentinel = useRef<HTMLDivElement>(null);
  // the first load of a visit and «Повторить» read the server's TMDB settings again
  const fresh = useRef(true);
  const homeFresh = useRef(true);
  const list = torrents.value;
  const index = useMemo(() => libraryIndex(list), [list]);
  // posters per row: one two-finger pinch steps between 2, 3 and 4 (apart = fewer, bigger posters)
  const [cols, setCols] = useState<DiscoverCols>(readDiscoverCols);
  const colsRef = useRef(cols);
  colsRef.current = cols;
  const rootRef = useRef<HTMLDivElement>(null);
  usePinchStep(rootRef, {
    enabled: !home,
    levels: COLS_BY_SIZE.length,
    level: () => Math.max(0, COLS_BY_SIZE.indexOf(colsRef.current)),
    apply: (i) => {
      const next = COLS_BY_SIZE[i];
      colsRef.current = next;
      setCols(next);
      saveDiscoverCols(next);
    },
    anchorAttr: 'data-anchor',
  });
  const gridClass = discoverGridClass(cols);
  // landscape: as many posters per row as it takes for a whole tile to fit the screen height
  const box = useLandscapeBox(rootRef);
  const landCols = box ? discoverLandscapeCols(cols, box.width, box.height) : 0;
  const gridStyle = colsStyle(landCols || null);
  // ads in the feed grid: a cell of the posters' size, every N posters, only below the screen when it appears.
  // Search lives on its own tab now, so this grid is never a search result.
  const ads = useAdSlots({
    section: 'discoverGrid',
    count: feed ? feed.items.length : 0,
    perScreen: landCols || (cols === 4 ? PER_SCREEN.cols4 : cols === 3 ? PER_SCREEN.cols3 : PER_SCREEN.cols2),
    active: !home && !error && !!feed && feed.items.length > 0,
    listKey: filter + '|' + qkey,
    itemEl: (i) => (rootRef.current ? rootRef.current.querySelectorAll('.m-disc-grid [data-anchor]')[i] || null : null),
  });

  useEffect(() => {
    if (home) {
      setFeed(null);
      setError(null);
      return;
    }
    if (restored.current) {
      restored.current = false;
      return;
    }
    const my = ++gen.current;
    setFeed(null);
    setError(null);
    setMoreFailed(false);
    setMoreBusy(false);
    const reread = fresh.current;
    fresh.current = false;
    phoneCatalog(reread)
      .then((c) => c.discover(filter, query, 1))
      .then(
        (r) => {
          if (gen.current === my) setFeed({ items: r.items, page: 1, pages: r.pages });
        },
        (e) => {
          if (gen.current === my) setError(catalogErrorCode(e));
        },
      );
  }, [filter, reload, qkey, home]);

  const loadMore = () => {
    if (!feed || moreBusy || feed.page >= feed.pages) return;
    const my = gen.current;
    const next = feed.page + 1;
    setMoreBusy(true);
    setMoreFailed(false);
    phoneCatalog()
      .then((c) => c.discover(filter, query, next))
      .then(
        (r) => {
          if (gen.current !== my) return;
          setMoreBusy(false);
          setFeed((f) => {
            if (!f || f.page !== next - 1) return f;
            // a title already shown (the feed shifts between pages) is not repeated
            const seen = new Set(f.items.map((x) => x.kind + ':' + x.id));
            return { items: f.items.concat(r.items.filter((x) => !seen.has(x.kind + ':' + x.id))), page: next, pages: r.pages };
          });
        },
        () => {
          if (gen.current !== my) return;
          setMoreBusy(false);
          setMoreFailed(true);
        },
      );
  };
  useEffect(() => saveDiscover({ filter, feed, query: qkey }), [filter, feed, qkey]);

  /** New sort or filters: kept for the next launch, page 1 fetched again from the top. */
  const applyQuery = (next: DiscoverQuery) => {
    const q = sanitizeDiscoverQuery(next);
    if (discoverQueryKey(q) === qkey) return;
    saveDiscoverQuery(q);
    setQuery(q);
    scrollToTop();
  };
  const nFilters = discoverFilterCount(query);

  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;

  const hasMore = !!feed && feed.page < feed.pages;
  // infinite scroll: the sentinel under the grid asks for the next page when it comes into view
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasMore || moreFailed || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMoreRef.current();
      },
      { rootMargin: '400px 0px' },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [hasMore, moreFailed, feed]);

  const current = filter;
  return (
    <div class="m-discover" ref={rootRef}>
      <div class="m-disc-head">
        <h2>{home ? t('discover.browse') : t('discover.novelties')}</h2>
        <span class="m-muted m-small m-grow">{t('discover.fromTmdb')}</span>
        <button
          type="button"
          class="m-icon-btn m-sort tm"
          data-code="P34.3"
          aria-label={home ? t('discover.homeBrowseLists') : t('discover.sortAria', { name: sortName(query.sort) })}
          aria-haspopup="dialog"
          onClick={() => setSheet('sort')}
        >
          <Icon d={ICONS.sort} size={20} />
        </button>
        <button type="button" class="m-btn m-btn-secondary m-btn-sm tm" data-code="P34.4" aria-label={t('add.search')} onClick={() => switchTab({ name: 'add', scope: 'catalog' })}>
          <Icon d={SEARCH} size={18} />
        </button>
      </div>
      <div class="m-disc-chips" role="group" aria-label={home ? t('discover.browse') : t('discover.novelties')}>
        {chips().map((c) => (
          <button
            key={c.id}
            type="button"
            class={'m-hfilter tm' + (current === c.id ? ' on' : '')}
            data-code={c.id === 'all' ? 'P34.5' : c.id === 'movie' ? 'P34.6' : 'P34.7'}
            aria-pressed={current === c.id}
            onClick={() => setFilter(c.id)}
          >
            {c.label}
          </button>
        ))}
        <button type="button" class={'m-hfilter m-disc-filters tm' + (nFilters ? ' on' : '')} data-code="P34.8" aria-haspopup="dialog" onClick={() => setSheet('filters')}>
          {nFilters ? t('filters.title') + ' · ' + nFilters : t('filters.title')}
        </button>
      </div>
      {home ? (
        <DiscoverHome
          kind={filter}
          window={trendWindow}
          onWindow={setTrendWindow}
          reload={reload}
          reread={homeFresh.current}
          onRereadConsumed={() => {
            homeFresh.current = false;
          }}
          onRetryFresh={() => {
            homeFresh.current = true;
            setReload((n) => n + 1);
          }}
        />
      ) : error ? (
        <CatalogError
          code={error}
          onRetry={() => {
            fresh.current = true;
            setReload((n) => n + 1);
          }}
        />
      ) : !feed ? (
        <div class={gridClass} style={gridStyle} aria-busy="true">
          {Array.from({ length: SKELETONS }, (_, i) => (
            <div key={i} class="m-disc-tile m-disc-skel" aria-hidden="true">
              <span class="m-disc-poster" />
              <span class="m-disc-skel-line" />
            </div>
          ))}
        </div>
      ) : feed.items.length === 0 ? (
        <p class="m-muted m-disc-empty">{t('discover.nothingFound')}</p>
      ) : (
        <>
          <div class={gridClass} style={gridStyle}>
            {withAds(feed.items, ads.admitted).map((e) => {
              if (e.item === undefined) {
                const b = ads.banner(e.ad);
                const pos = e.ad;
                return b ? <AdCell key={'ad:grid:' + pos} kind="disc" banner={b} onShown={() => ads.shown(pos)} onClick={() => ads.click(pos)} /> : null;
              }
              const x = e.item;
              return (
              <PosterButton
                key={x.kind + ':' + x.id}
                item={x}
                anchor={x.kind + ':' + x.id}
                className="m-disc-tile"
                label={x.year ? x.title + ' ' + x.year : x.title}
                onOpen={() => navigate({ name: 'title', kind: x.kind, id: x.id })}
              >
                <DiscPoster x={x} owned={inLibrary(index, x)} />
                <span class="m-card-title m-disc-title">
                  <TileTitle x={x} />
                </span>
                <TileMeta x={x} />
                <TileWhen kind={x.kind} id={x.id} digital={x.digital} />
              </PosterButton>
              );
            })}
          </div>
          {moreFailed && (
            <div class="m-disc-more m-warn-row">
              <span>{t('discover.pageFailed')}</span>
              <button type="button" class="m-btn m-btn-secondary" onClick={loadMore}>
                {t('common.retry')}
              </button>
            </div>
          )}
          {hasMore && !moreFailed && <div class="m-disc-sentinel" ref={sentinel} />}
        </>
      )}
      <p class="m-muted m-small m-disc-foot">{t('discover.attribution')}</p>
      {sheet === 'sort' && (
        <DiscoverSortSheet
          value={query.sort}
          onPick={(s) => {
            setSheet(null);
            applyQuery({ ...query, sort: s });
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'filters' && (
        <DiscoverFiltersSheet
          value={query}
          kind={filter}
          onClose={(q) => {
            setSheet(null);
            applyQuery({ ...q, sort: query.sort });
          }}
        />
      )}
    </div>
  );
}
