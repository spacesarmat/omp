// «Обзор»: the TMDB feed (movies and series) with its sort and filters, marked when already in the library.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { t } from '../../../../src/i18n';
import { Icon, ICONS } from '../../ui/Icon';
import { CatalogSearch, ratingText } from './CatalogSearch';
import { navigate, scrollToTop } from '../../nav';
import { torrents } from '../../../../src/store/library';
import { catalogErrorCode, type CatalogErrorCode } from '../../../../src/catalog/client';
import { libraryIndex, inLibrary } from '../../../../src/catalog/library';
import { phoneCatalog } from '../../catalog/phoneCatalog';
import { CatalogError } from './CatalogError';
import { readDiscover, saveDiscover, type Feed, type Filter } from './discoverCache';
import { readDiscoverCols, saveDiscoverCols, type DiscoverCols } from './discoverCols';
import { usePinchStep } from '../../ui/usePinchStep';
import { discoverQueryKey, discoverFilterCount, sanitizeDiscoverQuery, type DiscoverQuery } from '../../../../src/catalog/discoverQuery';
import { loadDiscoverQuery, saveDiscoverQuery } from './discoverQueryStore';
import { DiscoverSortSheet, DiscoverFiltersSheet, sortName } from './DiscoverSheets';

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
  // the sort and the filters, kept across launches; the feed is keyed on them
  const [query, setQuery] = useState<DiscoverQuery>(loadDiscoverQuery);
  const qkey = discoverQueryKey(query);
  const [sheet, setSheet] = useState<'sort' | 'filters' | null>(null);
  // back from a title card (or another tab): the chip, the loaded pages and the open search come back as they were
  const kept = useMemo(() => readDiscover(qkey), []);
  const [filter, setFilter] = useState<Filter>(kept ? kept.filter : 'all');
  const [feed, setFeed] = useState<Feed | null>(kept ? kept.feed : null);
  const [error, setError] = useState<CatalogErrorCode | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [searching, setSearching] = useState(!!(kept && kept.search));
  // a kept feed is shown as is: the first run of the load effect skips the fetch
  const restored = useRef(!!(kept && kept.feed));
  // the current request: answers of an older one (another chip, a retry) are dropped
  const gen = useRef(0);
  const sentinel = useRef<HTMLDivElement>(null);
  // the first load of a visit and «Повторить» read the server's TMDB settings again
  const fresh = useRef(true);
  const list = torrents.value;
  const index = useMemo(() => libraryIndex(list), [list]);
  // posters per row: two fingers apart = bigger posters (2), together = smaller (3)
  const [cols, setCols] = useState<DiscoverCols>(readDiscoverCols);
  const colsRef = useRef(cols);
  colsRef.current = cols;
  const rootRef = useRef<HTMLDivElement>(null);
  usePinchStep(rootRef, {
    enabled: !searching,
    onStep: (dir) => {
      const next: DiscoverCols = dir > 0 ? 2 : 3;
      if (next === colsRef.current) return false;
      colsRef.current = next;
      setCols(next);
      saveDiscoverCols(next);
      return true;
    },
    anchorAttr: 'data-anchor',
  });
  const gridClass = 'm-disc-grid' + (cols === 3 ? ' m-cols-3' : '');

  useEffect(() => {
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
  }, [filter, reload, qkey]);

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
  if (searching)
    return (
      <CatalogSearch
        onClose={() => {
          saveDiscover({ search: null });
          setSearching(false);
        }}
      />
    );
  return (
    <div class="m-discover" ref={rootRef}>
      <div class="m-disc-head">
        <h2>{t('discover.novelties')}</h2>
        <span class="m-muted m-small m-grow">{t('discover.fromTmdb')}</span>
        <button
          type="button"
          class="m-icon-btn m-sort"
          aria-label={t('discover.sortAria', { name: sortName(query.sort) })}
          aria-haspopup="dialog"
          onClick={() => setSheet('sort')}
        >
          <Icon d={ICONS.sort} size={20} />
        </button>
        <button type="button" class="m-btn m-btn-secondary m-btn-sm" aria-label={t('add.search')} onClick={() => {
            saveDiscover({ search: { text: '', items: null } });
            setSearching(true);
          }}>
          <Icon d={SEARCH} size={18} />
        </button>
      </div>
      <div class="m-disc-chips" role="group" aria-label={t('discover.novelties')}>
        {chips().map((c) => (
          <button
            key={c.id}
            type="button"
            class={'m-hfilter' + (current === c.id ? ' on' : '')}
            aria-pressed={current === c.id}
            onClick={() => setFilter(c.id)}
          >
            {c.label}
          </button>
        ))}
        <button type="button" class={'m-hfilter m-disc-filters' + (nFilters ? ' on' : '')} aria-haspopup="dialog" onClick={() => setSheet('filters')}>
          {nFilters ? t('filters.title') + ' · ' + nFilters : t('filters.title')}
        </button>
      </div>
      {error ? (
        <CatalogError
          code={error}
          onRetry={() => {
            fresh.current = true;
            setReload((n) => n + 1);
          }}
        />
      ) : !feed ? (
        <div class={gridClass} aria-busy="true">
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
          <div class={gridClass}>
            {feed.items.map((x) => (
              <button
                key={x.kind + ':' + x.id}
                data-anchor={x.kind + ':' + x.id}
                type="button"
                class="m-disc-tile"
                aria-label={x.year ? x.title + ' ' + x.year : x.title}
                onClick={() => navigate({ name: 'title', kind: x.kind, id: x.id })}
              >
                <span class="m-disc-poster">
                  {x.poster ? (
                    <img src={x.poster} alt="" loading="lazy" />
                  ) : (
                    <span class={'m-disc-ph m-disc-ph-' + (x.id % 4)}>{x.title}</span>
                  )}
                  {x.rating > 0 && <span class="m-disc-rating">{ratingText(x.rating)}</span>}
                  {inLibrary(index, x) && <span class="m-disc-badge">{t('discover.inLibrary')}</span>}
                </span>
                <span class="m-card-title m-disc-title">{x.title}</span>
                <span class="m-muted m-small m-disc-meta">
                  {(x.kind === 'tv' ? t('discover.series') : t('library.movie')) + (x.year ? ' · ' + x.year : '')}
                </span>
              </button>
            ))}
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
