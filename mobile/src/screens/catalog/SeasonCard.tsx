// A season of a catalog series: its poster, «Смотреть на ТВ», and the episode list.
import { useEffect, useState } from 'preact/hooks';
import { t, tp, fmtDuration } from '../../../../src/i18n';
import { formatBytes } from '../../../../src/lib/format';
import { baseName, parseEpisode, stripExt } from '../../../../src/lib/episodes';
import { airDateText, isoDay } from '../../../../src/lib/seriesStatus';
import { getLocalProgress } from '../../../../src/store/progress';
import { torrents } from '../../../../src/store/library';
import { torrentQuery, type CatalogCard, type Season, type SeasonDetails } from '../../../../src/catalog/tmdb';
import { catalogErrorCode, type CatalogErrorCode } from '../../../../src/catalog/client';
import { phoneCatalog } from '../../catalog/phoneCatalog';
import { artKey, artVersion, pickedArt, saveArt } from '../../catalog/artPick';
import { goBack, navigate } from '../../nav';
import { Icon } from '../../ui/Icon';
import { activeTv } from '../../tv/tvStore';
import { episodeLabel } from '../../lib/torrentActions';
import { useTvLaunch } from '../../watch';
import { LaunchError } from '../../ui/LaunchError';
import { CatalogError } from './CatalogError';
import { PosterSheet } from './PosterSheet';
import { episodeSizes, seriesLibraryHash, seriesWatchSpot } from './seriesWatch';

const BACK = 'M15 5l-7 7l7 7';

/** «3 · Название — 52 мин». */
export function episodeHead(n: number, title: string, runtime: number): string {
  const name = title || t('library.episode', { n });
  const dur = runtime > 0 ? fmtDuration(runtime) : '';
  return n + ' · ' + name + (dur ? ' — ' + dur : '');
}

function barOf(card: CatalogCard, season: number, episode: number): number {
  const spot = seriesWatchSpot(torrents.value, card, season);
  if (!spot || spot.at <= 0) return 0;
  const parsed = parseEpisode(spot.file.path);
  if (parsed.episode !== episode) return 0;
  const dur = getLocalProgress(spot.hash, spot.file.id)?.duration || 0;
  return dur > 0 ? Math.min(1, spot.at / dur) : 0;
}

function Episodes({ card, season, details }: { card: CatalogCard; season: Season; details: SeasonDetails }) {
  const sizes = episodeSizes(torrents.value, card, season.number);
  const today = isoDay(Date.now());
  return (
    <section class="m-tc-section">
      <h2>{t('titleCard.episodes')}</h2>
      {!details.episodes.length ? (
        <p class="m-small m-muted m-tc-ep-empty">{t('titleCard.noEpisodes')}</p>
      ) : (
        <div class="m-tc-episodes">
          {details.episodes.map((e) => {
            const size = sizes[e.n] || 0;
            const future = !size && ((e.airDate && e.airDate > today) || e.n > season.aired);
            const line2 = size
              ? formatBytes(size)
              : future && e.airDate
                ? airDateText(e.airDate)
                : future
                  ? t('titleCard.notOut')
                  : t('titleCard.notInLibrary');
            const progress = size ? barOf(card, season.number, e.n) : 0;
            return (
              <div key={e.n} class={'m-tc-ep' + (future ? ' future' : '')}>
                <div class="m-tc-ep-info">
                  <span class="m-tc-ep-title">{episodeHead(e.n, e.title, e.runtime || card.runtime)}</span>
                  <span class="m-small m-muted m-tc-ep-sub">{line2}</span>
                </div>
                {progress > 0 && (
                  <span class="m-bar-track thin">
                    <span class="m-bar-fill" style={{ width: progress * 100 + '%' }} />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function SeasonCard({ id, season }: { id: number; season: number }) {
  const [card, setCard] = useState<CatalogCard | null>(null);
  const [details, setDetails] = useState<SeasonDetails | null>(null);
  const [error, setError] = useState<CatalogErrorCode | null>(null);
  const [reload, setReload] = useState(0);
  const [artOpen, setArtOpen] = useState(false);
  const [variants, setVariants] = useState<string[]>([]);
  const [launchError, setLaunchError] = useState('');
  const launch = useTvLaunch();
  void artVersion.value;
  const art = pickedArt(artKey(id, season));

  useEffect(() => {
    let alive = true;
    setError(null);
    setDetails(null);
    phoneCatalog()
      .then((c) => Promise.all([c.card('tv', id), c.season(id, season, { full: true })]))
      .then(
        ([c, s]) => {
          if (!alive) return;
          setCard(c);
          setDetails(s);
        },
        (e) => {
          if (alive) setError(catalogErrorCode(e));
        },
      );
    return () => {
      alive = false;
    };
  }, [id, season, reload]);

  const meta = card ? card.seasons.filter((s) => s.number === season)[0] : undefined;
  const poster = art || (meta && meta.poster) || (card && card.poster) || '';
  const hash = card ? seriesLibraryHash(torrents.value, card, season) : '';
  const spot = card ? seriesWatchSpot(torrents.value, card, season) : null;
  const unreleased = !!meta && meta.aired === 0;

  const openArt = () => {
    setArtOpen(true);
    phoneCatalog()
      .then((c) => c.posters('tv', id, season))
      .then(
        (urls) => setVariants(poster && urls.indexOf(poster) < 0 ? [poster].concat(urls) : urls),
        () => setVariants(poster ? [poster] : []),
      );
  };

  const watch = () => {
    if (!spot) {
      if (hash) navigate({ name: 'torrent', hash });
      return;
    }
    if (!activeTv.value) {
      navigate({ name: 'tv' });
      return;
    }
    setLaunchError('');
    void launch.start({
      hash: spot.hash,
      file: spot.file.id,
      at: spot.at,
      duration: getLocalProgress(spot.hash, spot.file.id)?.duration || undefined,
      label: [episodeLabel(spot.file.path), stripExt(baseName(spot.file.path))].filter(Boolean).join(' · '),
      onError: setLaunchError,
    });
  };

  const sub = meta
    ? [meta.year ? String(meta.year) : '', meta.episodes ? tp('library.episodes', meta.episodes) : ''].filter(Boolean).join(' · ')
    : '';

  return (
    <div class="m-screen m-tc" data-route="season">
      <div class="m-bar">
        <button type="button" class="m-icon-btn" aria-label={t('common.back')} onClick={() => goBack()}>
          <Icon d={BACK} />
        </button>
        <h1 class="m-bar-title">{card ? card.title : t('titleCard.seasonTitle', { n: season })}</h1>
      </div>
      {error ? (
        <CatalogError code={error} onRetry={() => setReload((n) => n + 1)} />
      ) : !card || !details || !meta ? (
        <div class="m-tc-head m-tc-skel" aria-busy="true">
          <span class="m-tc-poster" />
        </div>
      ) : (
        <>
          <div class="m-tc-head">
            <button type="button" class="m-art-btn" aria-label={t('titleCard.pickPoster')} onClick={openArt}>
              {poster ? <img class="m-tc-poster" src={poster} alt="" width={110} height={165} /> : <span class="m-tc-poster m-disc-ph" />}
            </button>
            <div class="m-tc-info">
              <h2 class="m-tc-title">{t('library.season', { n: season })}</h2>
              {sub && <span class="m-muted m-small">{sub}</span>}
              {unreleased && meta.airDate && <span class="m-small m-accent">{airDateText(meta.airDate)}</span>}
            </div>
          </div>
          <div class="m-tc-actions m-tc-actions-row">
            {spot || hash ? (
              <button type="button" class="m-btn m-btn-primary" onClick={watch}>
                {t('news.watchOnTv')}
              </button>
            ) : (
              !unreleased && (
                <button type="button" class="m-btn m-btn-primary" onClick={() => navigate({ name: 'add', query: torrentQuery(card, season), run: true })}>
                  {t('titleCard.findSeason')}
                </button>
              )
            )}
          </div>
          {launchError && <LaunchError message={launchError} class="m-hint-warn" />}
          <Episodes card={card} season={meta} details={details} />
          {artOpen && (
            <PosterSheet
              urls={variants}
              current={poster}
              onClose={() => setArtOpen(false)}
              onPick={(url) => {
                saveArt(artKey(id, season), url);
                setArtOpen(false);
              }}
            />
          )}
          {launch.sheet}
        </>
      )}
    </div>
  );
}
