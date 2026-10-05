// «Обзор» → «Новинки»: the TMDB novelties feed (movies and series), marked when already in the library.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { t } from '../../../../src/i18n';
import { Icon } from '../../ui/Icon';
import { CatalogSearch, ratingText } from './CatalogSearch';
import { navigate } from '../../nav';
import { torrents } from '../../../../src/store/library';
import { catalogErrorCode, type CatalogErrorCode } from '../../../../src/catalog/client';
import { libraryIndex, inLibrary } from '../../../../src/catalog/library';
import type { CatalogTitle, Kind } from '../../../../src/catalog/tmdb';
import { phoneCatalog, OFFLINE_TITLE, OFFLINE_TEXT, NOKEY_TEXT } from '../../catalog/phoneCatalog';

type Filter = Kind | 'all';

const SKELETONS = 6;

const SEARCH = 'M5 11a6 6 0 1 0 12 0a6 6 0 1 0 -12 0M20 20l-4.5-4.5';

function chips(): { id: Filter; label: string }[] {
  return [
    { id: 'all', label: t('common.all') },
    { id: 'movie', label: t('category.movie') },
    { id: 'tv', label: t('category.tv') },
  ];
}

interface Feed {
  items: CatalogTitle[];
  page: number;
  pages: number;
}

export function Discover() {
  const [filter, setFilter] = useState<Filter>('all');
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState<CatalogErrorCode | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [searching, setSearching] = useState(false);
  // the current request: answers of an older one (another chip, a retry) are dropped
  const gen = useRef(0);
  const sentinel = useRef<HTMLDivElement>(null);
  // the first load of a visit and «Повторить» read the server's TMDB settings again
  const fresh = useRef(true);
  const list = torrents.value;
  const index = useMemo(() => libraryIndex(list), [list]);

  useEffect(() => {
    const my = ++gen.current;
    setFeed(null);
    setError(null);
    setMoreFailed(false);
    setMoreBusy(false);
    const reread = fresh.current;
    fresh.current = false;
    phoneCatalog(reread)
      .then((c) => c.novelties(filter, 1))
      .then(
        (r) => {
          if (gen.current === my) setFeed({ items: r.items, page: 1, pages: r.pages });
        },
        (e) => {
          if (gen.current === my) setError(catalogErrorCode(e));
        },
      );
  }, [filter, reload]);

  const loadMore = () => {
    if (!feed || moreBusy || feed.page >= feed.pages) return;
    const my = gen.current;
    const next = feed.page + 1;
    setMoreBusy(true);
    setMoreFailed(false);
    phoneCatalog()
      .then((c) => c.novelties(filter, next))
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
  if (searching) return <CatalogSearch onClose={() => setSearching(false)} />;
  return (
    <div class="m-discover">
      <div class="m-disc-head">
        <h2>{t('discover.novelties')}</h2>
        <span class="m-muted m-small m-grow">{t('discover.fromTmdb')}</span>
        <button type="button" class="m-btn m-btn-secondary m-btn-sm" aria-label={t('add.search')} onClick={() => setSearching(true)}>
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
      </div>
      {error ? (
        <div class="m-disc-error" role="alert">
          <p class="m-disc-error-title">{t(OFFLINE_TITLE)}</p>
          <p class="m-muted">{t(error === 'nokey' ? NOKEY_TEXT : OFFLINE_TEXT)}</p>
          <div class="m-disc-error-actions">
            <button type="button" class="m-btn m-btn-primary" onClick={() => {
                fresh.current = true;
                setReload((n) => n + 1);
              }}>
              {t('common.retry')}
            </button>
            {error === 'nokey' && (
              <button type="button" class="m-btn m-btn-secondary" onClick={() => navigate({ name: 'faq', q: 'tmdb-key' })}>
                {t('discover.howToKey')}
              </button>
            )}
          </div>
        </div>
      ) : !feed ? (
        <div class="m-disc-grid" aria-busy="true">
          {Array.from({ length: SKELETONS }, (_, i) => (
            <div key={i} class="m-disc-tile m-disc-skel" aria-hidden="true">
              <span class="m-disc-poster" />
              <span class="m-disc-skel-line" />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div class="m-disc-grid">
            {feed.items.map((x) => (
              <button
                key={x.kind + ':' + x.id}
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
                <span class="m-card-title">{x.title}</span>
                <span class="m-muted m-small">{x.kind === 'tv' ? t('discover.series') : t('library.movie')}</span>
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
    </div>
  );
}
