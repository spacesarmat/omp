// A season of a catalog series: its poster, «Смотреть на ТВ», and the episode list.
import { useEffect, useState } from 'preact/hooks';
import { errorMessage } from '../../../../src/api/http';
import { playOnPhone } from '../../watchHere';
import { t, tp, fmtDuration, fmtSize } from '../../../../src/i18n';
import { baseName, episodeLabel, stripExt } from '../../../../src/lib/episodes';
import { airDateText, isoDay } from '../../../../src/lib/seriesStatus';
import { getLocalProgress } from '../../../../src/store/progress';
import { torrents } from '../../../../src/store/library';
import { torrentQuery, type CatalogCard, type Season, type SeasonDetails } from '../../../../src/catalog/tmdb';
import { catalogErrorCode, type CatalogErrorCode } from '../../../../src/catalog/client';
import { phoneCatalog } from '../../catalog/phoneCatalog';
import { artKey, artVersion, pickedArt, saveArt } from '../../catalog/artPick';
import { goBack, navigate } from '../../nav';
import { routeForHash } from '../../audiobooks/route';
import { Icon } from '../../ui/Icon';
import { activeTv } from '../../tv/tvStore';
import { useTvLaunch } from '../../watch';
import { LaunchError } from '../../ui/LaunchError';
import { CatalogError } from './CatalogError';
import { PosterSheet } from './PosterSheet';
import { episodeRatio, episodeSizes, seriesLibraryHash, seriesWatchSpot } from './seriesWatch';
import { seasonShare } from '../../share/text';
import { sendShare } from '../../share/send';

const SHARE = 'M12 3v12M8 7l4-4 4 4M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5';

const BACK = 'M15 5l-7 7l7 7';

/** Second line of an episode: «48 мин · нет в медиатеке». The title stays on its own line. */
export function episodeSub(runtime: number, status: string): string {
  const dur = runtime > 0 ? fmtDuration(runtime) : '';
  if (dur && status) return dur + ' · ' + status;
  return dur || status;
}

function barOf(card: CatalogCard, season: number, episode: number): number {
  return episodeRatio(torrents.value, card, season, episode);
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
              ? fmtSize(size)
              : future && e.airDate
                ? airDateText(e.airDate)
                : future
                  ? t('titleCard.notOut')
                  : t('titleCard.notInLibrary');
            const progress = size ? barOf(card, season.number, e.n) : 0;
            return (
              <div key={e.n} class={'m-tc-ep' + (size ? ' in' : '') + (future ? ' future' : '')}>
                <span class="m-season-ep-num">{e.n}</span>
                <div class="m-season-ep-main">
                  <span class="m-season-ep-title">{e.title || t('library.episode', { n: e.n })}</span>
                  <span class="m-small m-muted m-tc-ep-sub">{episodeSub(e.runtime || card.runtime, line2)}</span>
                  {progress > 0 && (
                    <span class="m-bar-track thin">
                      <span class="m-bar-fill" style={{ width: progress * 100 + '%' }} />
                    </span>
                  )}
                </div>
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
      if (hash) navigate(routeForHash(hash));
      return;
    }
    setLaunchError('');
    // no TV chosen: the main action plays on this phone
    if (!activeTv.value) {
      playOnPhone(spot.hash, spot.file, spot.at).catch((e) => setLaunchError(errorMessage(e)));
      return;
    }
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
  const view = !error && card && details && meta ? { card, details, meta } : null;
  const bg = (card && card.backdrop) || poster;
  const primary = !view ? null : spot || hash ? (
    <button type="button" class="m-btn m-btn-primary" onClick={watch}>
      {activeTv.value ? t('news.watchOnTv') : t('nav.watchOnPhone')}
    </button>
  ) : !unreleased ? (
    <button type="button" class="m-btn m-btn-primary" onClick={() => navigate({ name: 'add', query: torrentQuery(view.card, season), run: true })}>
      {t('titleCard.findSeason')}
    </button>
  ) : null;

  return (
    <div class="m-screen" data-route="season">
      <div class="m-season-hero">
        <div class={'m-season-backdrop' + (bg && !(card && card.backdrop) ? ' is-poster' : '')} aria-hidden="true">
          {bg ? <img src={bg} alt="" /> : null}
        </div>
        <button type="button" class="m-icon-btn m-season-back" data-code="P25.1" aria-label={t('common.back')} onClick={() => goBack()}>
          <Icon d={BACK} />
        </button>
        {view && (
          <button
            type="button"
            class="m-icon-btn m-season-share"
            aria-label={t('share.action')}
            onClick={() => void sendShare(seasonShare(view.card, season, view.meta))}
          >
            <Icon d={SHARE} />
          </button>
        )}
        {error || view ? null : (
          <div class="m-season-head m-tc-skel" aria-busy="true">
            <span class="m-season-poster" />
            <div class="m-season-info">
              <span class="m-disc-skel-line" />
              <span class="m-disc-skel-line" />
            </div>
          </div>
        )}
        {view && (
          <div class="m-season-head">
            <button type="button" class="m-art-btn" aria-label={t('titleCard.pickPoster')} onClick={openArt}>
              {poster ? <img class="m-season-poster" src={poster} alt="" width={128} height={192} /> : <span class="m-season-poster" />}
            </button>
            <div class="m-season-info">
              <h1 class="m-season-title">{view.card.title}</h1>
              <p class="m-season-kicker">{t('library.season', { n: season })}</p>
              {sub && <span class="m-muted m-small m-season-sub">{sub}</span>}
              {unreleased && view.meta.airDate && <span class="m-small m-accent">{airDateText(view.meta.airDate)}</span>}
            </div>
          </div>
        )}
      </div>
      {error ? (
        <CatalogError code={error} onRetry={() => setReload((n) => n + 1)} />
      ) : view ? (
        <>
          {primary && <div class="m-season-actions">{primary}</div>}
          {launchError && <LaunchError message={launchError} class="m-hint-warn" />}
          <Episodes card={view.card} season={view.meta} details={view.details} />
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
      ) : null}
    </div>
  );
}
