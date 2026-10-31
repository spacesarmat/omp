// TMDB.org-style homepage: horizontal rails from trending / popular / now playing / …
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { t } from '../../../../src/i18n';
import { navigate } from '../../nav';
import { torrents } from '../../../../src/store/library';
import { catalogErrorCode, type CatalogErrorCode } from '../../../../src/catalog/client';
import { libraryIndex, inLibrary } from '../../../../src/catalog/library';
import { phoneCatalog } from '../../catalog/phoneCatalog';
import { CatalogError } from './CatalogError';
import type { HomeSection, HomeSectionId, Kind, TrendingWindow } from '../../../../src/catalog/tmdb';
import { DiscPoster, TileMeta, TileTitle, TileWhen } from './DiscoverTiles';
import { PosterButton } from '../../share/PosterButton';
import { withAds } from '../../../../src/ads/ads';
import { AdCell } from '../../ads/AdCell';
import { useAdSlots } from '../../ads/useAdSlots';

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

function Rail({ section, owned }: { section: HomeSection; owned: (x: HomeSection['items'][0]) => boolean }) {
  return (
    <section class="m-disc-rail" data-rail={section.id}>
      <h3 class="m-disc-rail-title">{sectionTitle(section.id)}</h3>
      <div class="m-disc-rail-row">
        {section.items.map((x) => (
          <PosterButton
            key={x.kind + ':' + x.id}
            item={x}
            className="m-disc-tile m-disc-rail-tile"
            label={x.year ? x.title + ' ' + x.year : x.title}
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
    </section>
  );
}

/** Homepage body: trending window toggle + rails. Parent keeps chips / search / sort entry. */
export function DiscoverHome({
  kind,
  window,
  onWindow,
  reload,
  reread,
  onRereadConsumed,
  onRetryFresh,
}: {
  kind: Kind | 'all';
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
  // an ad block between the rails (a card-size cell with its text beside it), only below the screen when it appears
  const ads = useAdSlots({
    section: 'discoverRails',
    count: sections ? sections.length : 0,
    perScreen: 3,
    active: !error && !!sections && sections.length > 2,
    listKey: kind + '|' + window,
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
      <div class="m-disc-home" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <section key={i} class="m-disc-rail">
            <div class="m-disc-skel-line m-disc-rail-skel-title" />
            <div class="m-disc-rail-row">
              {Array.from({ length: 4 }, (_, j) => (
                <div key={j} class="m-disc-tile m-disc-rail-tile m-disc-skel" aria-hidden="true">
                  <span class="m-disc-poster" />
                  <span class="m-disc-skel-line" />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    );
  }
  if (sections.length === 0) {
    return <p class="m-muted m-disc-empty">{t('discover.nothingFound')}</p>;
  }
  return (
    <div class="m-disc-home" ref={homeRef}>
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
          return b ? <AdCell key={'ad:rails:' + pos} kind="rail" banner={b} onShown={() => ads.shown(pos)} onClick={() => ads.click(pos)} /> : null;
        }
        const s = e.item;
        return <Rail key={s.id} section={s} owned={(x) => inLibrary(lib, x)} />;
      })}
    </div>
  );
}
