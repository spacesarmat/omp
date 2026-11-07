// TMDB.org-style homepage: horizontal rails from trending / popular / now playing / …
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { t } from '../../../../src/i18n';
import { navigate } from '../../nav';
import { torrents } from '../../../../src/store/library';
import { catalogErrorCode, type CatalogErrorCode } from '../../../../src/catalog/client';
import { libraryIndex, inLibrary } from '../../../../src/catalog/library';
import { phoneCatalog } from '../../catalog/phoneCatalog';
import { CatalogError } from './CatalogError';
import type { CatalogTitle, HomeSection, HomeSectionId, Kind, TrendingWindow } from '../../../../src/catalog/tmdb';
import { DiscPoster, TileMeta, TileTitle, TileWhen } from './DiscoverTiles';
import { ratingText } from './CatalogSearch';
import { PosterButton } from '../../share/PosterButton';
import { withAds } from '../../../../src/ads/ads';
import { AdCell } from '../../ads/AdCell';
import { useAdSlots } from '../../ads/useAdSlots';
import { isGridDiscoverView, railTilePx, type DiscoverView } from './discoverCols';

function sectionTitle(id: HomeSectionId): string {
  switch (id) {
    case 'trending':
      return t('discover.homeTrending');
    case 'popularMovies':
      return t('discover.homePopularMovies');
    case 'popularTv':
      return t('discover.homePopularTv');
    case 'nowPlaying':
      return t('discover.homeNowPlaying');
    case 'upcoming':
      return t('discover.homeUpcoming');
    case 'onTheAir':
      return t('discover.homeOnTheAir');
    case 'airingToday':
      return t('discover.homeAiringToday');
    case 'topRatedMovies':
      return t('discover.homeTopRatedMovies');
    case 'topRatedTv':
      return t('discover.homeTopRatedTv');
  }
}

function itemLabel(x: CatalogTitle): string {
  return x.year ? x.title + ' ' + x.year : x.title;
}

/** One homepage section: poster rail for the card modes, rows for the two lists. */
function Rail({
  section,
  view,
  owned,
}: {
  section: HomeSection;
  view: DiscoverView;
  owned: (x: CatalogTitle) => boolean;
}) {
  return (
    <section class="m-disc-rail" data-rail={section.id} data-view={view}>
      <h3 class="m-disc-rail-title">{sectionTitle(section.id)}</h3>
      {isGridDiscoverView(view) ? (
        <div class="m-disc-rail-row">
          {section.items.map((x) => (
            <PosterButton
              key={x.kind + ':' + x.id}
              item={x}
              className="m-disc-tile m-disc-rail-tile"
              label={itemLabel(x)}
              onOpen={() => navigate({ name: 'title', kind: x.kind, id: x.id })}
            >
              <DiscPoster x={x} owned={owned(x)} />
              <span class="m-card-title m-disc-title">
                <TileTitle x={x} />
              </span>
              <TileMeta x={x} />
              <TileWhen kind={x.kind} id={x.id} digital={x.digital} />
            </PosterButton>
          ))}
        </div>
      ) : (
        <div class={view === 'compact' ? 'm-vlist m-clist m-disc-rows' : 'm-vlist m-disc-rows'}>
          {section.items.map((x) => {
            const has = owned(x);
            const open = () => navigate({ name: 'title', kind: x.kind, id: x.id });
            if (view === 'compact') {
              return (
                <PosterButton key={x.kind + ':' + x.id} item={x} className="m-crow" label={itemLabel(x)} onOpen={open}>
                  <span class="m-crow-main">
                    <span class="m-card-title m-crow-title m-disc-title"><TileTitle x={x} /></span>
                    <span class="m-crow-sub">
                      <TileMeta x={x} />
                      {x.rating > 0 && <span class="m-muted m-small">{ratingText(x.rating)}</span>}
                      {has && <span class="m-muted m-small">{t('discover.inLibrary')}</span>}
                    </span>
                  </span>
                </PosterButton>
              );
            }
            return (
              <PosterButton key={x.kind + ':' + x.id} item={x} className="m-vrow" label={itemLabel(x)} onOpen={open}>
                <DiscPoster x={x} owned={has} />
                <span class="m-vrow-text">
                  <span class="m-card-title m-disc-title"><TileTitle x={x} /></span>
                  <span class="m-vrow-meta">
                    <TileMeta x={x} />
                    {has && <span class="m-muted m-small">{t('discover.inLibrary')}</span>}
                  </span>
                  <TileWhen kind={x.kind} id={x.id} digital={x.digital} />
                </span>
              </PosterButton>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** Homepage body: trending window toggle + rails. Parent keeps chips / search / sort entry. */
export function DiscoverHome({
  kind,
  view,
  window,
  onWindow,
  reload,
  reread,
  onRereadConsumed,
  onRetryFresh,
}: {
  kind: Kind | 'all';
  view: DiscoverView;
  window: TrendingWindow;
  onWindow: (w: TrendingWindow) => void;
  reload: number;
  reread: boolean;
  onRereadConsumed: () => void;
  onRetryFresh: () => void;
}) {
  const [sections, setSections] = useState<HomeSection[] | null>(null);
  const [error, setError] = useState<CatalogErrorCode | null>(null);
  const list = torrents.value;
  const lib = useMemo(() => libraryIndex(list), [list]);
  const homeRef = useRef<HTMLDivElement>(null);
  const cards = isGridDiscoverView(view);
  // card modes: a horizontal rail, wider for large cards. Lists are rows in either orientation.
  const railW = cards ? railTilePx(view) : 0;
  // an ad block between the rails (a card-size cell with its text beside it), only below the screen when it appears
  const ads = useAdSlots({
    section: 'discoverRails',
    count: sections ? sections.length : 0,
    perScreen: 3,
    active: !error && !!sections && sections.length > 2,
    listKey: kind + '|' + window + '|' + view,
    itemEl: (i) => (homeRef.current ? homeRef.current.querySelectorAll('[data-rail]')[i] || null : null),
  });

  useEffect(() => {
    let alive = true;
    setSections(null);
    setError(null);
    const force = reread;
    if (force) onRereadConsumed();
    phoneCatalog(force)
      .then((c) => c.home(kind, window))
      .then(
        (rows) => {
          if (alive) setSections(rows);
        },
        (e) => {
          if (alive) setError(catalogErrorCode(e));
        },
      );
    return () => {
      alive = false;
    };
  }, [kind, window, reload]);

  if (error) {
    return <CatalogError code={error} onRetry={onRetryFresh} />;
  }
  if (!sections) {
    return (
      <div class="m-disc-home" aria-busy="true" data-view={view}>
        {[0, 1, 2].map((i) => (
          <section key={i} class="m-disc-rail">
            <div class="m-disc-skel-line m-disc-rail-skel-title" />
            {cards ? (
              <div class="m-disc-rail-row">
                {Array.from({ length: 4 }, (_, j) => (
                  <div key={j} class="m-disc-tile m-disc-rail-tile m-disc-skel" aria-hidden="true">
                    <span class="m-disc-poster" />
                    <span class="m-disc-skel-line" />
                  </div>
                ))}
              </div>
            ) : (
              <div class={view === 'compact' ? 'm-vlist m-clist m-disc-rows' : 'm-vlist m-disc-rows'}>
                {Array.from({ length: 3 }, (_, j) => (
                  <div key={j} class={view === 'compact' ? 'm-crow m-disc-skel' : 'm-vrow m-disc-skel'} aria-hidden="true">
                    {view === 'list' && <span class="m-disc-poster" />}
                    <span class="m-disc-skel-line" />
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    );
  }
  if (sections.length === 0) {
    return <p class="m-muted m-disc-empty">{t('discover.nothingFound')}</p>;
  }
  return (
    <div class="m-disc-home" ref={homeRef} data-view={view} style={railW ? '--m-rail-w:' + railW + 'px' : undefined}>
      <div class="m-disc-trend" role="group" aria-label={t('discover.homeTrending')}>
        <button
          type="button"
          class={'m-hfilter' + (window === 'day' ? ' on' : '')}
          aria-pressed={window === 'day'}
          onClick={() => onWindow('day')}
        >
          {t('discover.homeToday')}
        </button>
        <button
          type="button"
          class={'m-hfilter' + (window === 'week' ? ' on' : '')}
          aria-pressed={window === 'week'}
          onClick={() => onWindow('week')}
        >
          {t('discover.homeWeek')}
        </button>
      </div>
      {withAds(sections, ads.admitted).map((e) => {
        if (e.item === undefined) {
          const b = ads.banner(e.ad);
          const pos = e.ad;
          const kind = view === 'compact' ? 'compact' : view === 'list' ? 'list' : 'rail';
          return b ? <AdCell key={'ad:rails:' + pos} kind={kind} banner={b} onShown={() => ads.shown(pos)} onClick={() => ads.click(pos)} /> : null;
        }
        const s = e.item;
        return <Rail key={s.id} section={s} view={view} owned={(x) => inLibrary(lib, x)} />;
      })}
    </div>
  );
}
