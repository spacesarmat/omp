// «Обзор» → a film or series card. A film: poster, meta, «Найти раздачи» and «Хочу посмотреть».
// A series: dates and status, «Смотреть на ТВ» when a season is in the library, two cast strips, every season as its own card, similar titles.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { t, tp, fmtDuration } from '../../../../src/i18n';
import { airDateText } from '../../../../src/lib/seriesStatus';
import { SeriesPill } from '../../ui/SeriesPill';
import { goBack, navigate } from '../../nav';
import { routeForHash } from '../../audiobooks/route';
import { Icon } from '../../ui/Icon';
import { CastStrip } from '../../ui/CastStrip';
import { torrents } from '../../../../src/store/library';
import { getLocalProgress } from '../../../../src/store/progress';
import { loadSubs, sameQuery } from '../../../../src/monitor/subs';
import { monitorVersion } from '../../monitor/ui';
import { WantSheet } from './WantSheet';
import { catalogErrorCode, type CatalogErrorCode } from '../../../../src/catalog/client';
import { torrentQuery, type CatalogCard, type CatalogTitle, type Kind, type Season } from '../../../../src/catalog/tmdb';
import { phoneCatalog } from '../../catalog/phoneCatalog';
import { artKey, artVersion, pickedArt, saveArt } from '../../catalog/artPick';
import { CatalogError } from './CatalogError';
import { PosterSheet } from './PosterSheet';
import { ratingText } from './CatalogSearch';
import { releaseParts } from '../../lib/releaseDates';
import { activeTv } from '../../tv/tvStore';
import { baseName, episodeLabel, stripExt } from '../../../../src/lib/episodes';
import { useTvLaunch } from '../../watch';
import { LaunchError } from '../../ui/LaunchError';
import { seriesLibraryHash, seriesWatchSpot } from './seriesWatch';

const BACK = 'M15 5l-7 7l7 7';

/** The query of «Найти раздачи» and «Хочу посмотреть» for the whole title. */
export function wantQuery(card: CatalogCard): string {
  return torrentQuery(card);
}

/** «2026 · драма · 1 ч 58 мин» for a film. */
function metaText(card: CatalogCard): string {
  const genres = card.genres.slice(0, 2).join(', ');
  return [card.year ? String(card.year) : '', genres, card.runtime > 0 ? fmtDuration(card.runtime) : ''].filter(Boolean).join(' · ');
}

function startYear(card: CatalogCard): number {
  return card.firstAirDate && card.firstAirDate.length >= 4 ? +card.firstAirDate.slice(0, 4) : card.year;
}

function stillAiring(card: CatalogCard): boolean {
  return card.airing || card.status === 'returning' || card.status === 'production' || card.status === 'planned';
}

/** «2019 - 2024», or «2019 - выходит» while the series is on air. */
export function seriesDates(card: CatalogCard): string {
  const start = startYear(card);
  if (stillAiring(card)) return start ? start + ' - ' + t('titleCard.stillAiring') : t('titleCard.stillAiring');
  const last = card.lastAirDate && card.lastAirDate.length >= 4 ? +card.lastAirDate.slice(0, 4) : 0;
  const end = last || card.seasons.reduce((m, s) => Math.max(m, s.year), 0);
  if (!start) return end ? String(end) : '';
  return end > start ? start + ' - ' + end : String(start);
}

/** The short status next to the dates: «Выходит», «Завершён», … */
export function seriesStatusWord(card: CatalogCard): string {
  const s = card.status || '';
  if (s === 'ended') return t('series.statusEnded');
  if (s === 'canceled') return t('series.statusCanceled');
  if (s === 'production' || s === 'planned') return t('series.statusProduction');
  if (s === 'returning' || card.airing) return t('series.statusAiring');
  return '';
}

/** The season shown first: the last one with aired episodes, else the first. */
export function defaultSeason(seasons: Season[]): number {
  let best = 0;
  let first = 0;
  seasons.forEach((s) => {
    if (!first || s.number < first) first = s.number;
    if (s.aired > 0 && s.number > best) best = s.number;
  });
  return best || first || 1;
}

/** A film's «Кино: 3 окт. · Цифра: 12 нояб. · Диск: 20 дек.»: the known dates, the ones to come accented. */
function ReleaseLine({ card }: { card: CatalogCard }) {
  const parts = releaseParts(card);
  if (!parts.length) return null;
  return (
    <p class="m-small m-tc-releases" aria-label={t('titleCard.releasesAria')}>
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && <span class="m-muted">{' · '}</span>}
          <span class={p.future ? 'm-accent' : ''} data-future={p.future ? '' : undefined}>
            {p.text}
          </span>
        </span>
      ))}
    </p>
  );
}

export function Overview({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [clamped, setClamped] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  // «Ещё» only when the text does not fit in its 4 lines
  useLayoutEffect(() => {
    const node = ref.current;
    if (node && !open) setClamped(node.scrollHeight > node.clientHeight + 1);
  }, [text, open]);
  return (
    <div class="m-tc-about">
      <p ref={ref} class={'m-tc-overview' + (open ? ' open' : '')}>
        {text}
      </p>
      {(clamped || open) && (
        <button type="button" class="m-btn-text m-tc-more" onClick={() => setOpen(!open)}>
          {open ? t('now.collapse') : t('titleCard.more')}
        </button>
      )}
    </div>
  );
}

function WantButton({ card, following, onWant }: { card: CatalogCard; following: boolean; onWant: () => void }) {
  return following ? (
    <button type="button" class="m-btn m-btn-secondary" onClick={() => navigate({ name: 'news', seg: 'subs' })}>
      {t(card.kind === 'tv' ? 'titleCard.followingSeries' : 'titleCard.followingMovie')}
    </button>
  ) : (
    <button type="button" class="m-btn m-btn-secondary" onClick={onWant}>
      {t('titleCard.want')}
    </button>
  );
}

function Poster({ card, src, onPick }: { card: CatalogCard; src: string; onPick?: () => void }) {
  const img = src ? (
    <img class="m-tc-poster" src={src} alt="" width={110} height={165} />
  ) : (
    <span class={'m-tc-poster m-disc-ph m-disc-ph-' + (card.id % 4)} aria-hidden="true" />
  );
  if (!onPick) return img;
  return (
    <button type="button" class="m-art-btn" aria-label={t('titleCard.pickPoster')} onClick={onPick}>
      {img}
    </button>
  );
}

function SeasonRows({ card }: { card: CatalogCard }) {
  const rows = card.seasons.slice().sort((a, b) => a.number - b.number);
  if (!rows.length) return null;
  return (
    <section class="m-tc-section">
      <h2>{t('titleCard.seasons')}</h2>
      <div class="m-tc-seasons">
        {rows.map((s) => (
          <SeasonRow key={s.number} card={card} season={s} />
        ))}
      </div>
    </section>
  );
}

function SeasonRow({ card, season }: { card: CatalogCard; season: Season }) {
  const unreleased = season.aired === 0;
  const sub = [season.year ? String(season.year) : '', season.episodes ? tp('library.episodes', season.episodes) : ''].filter(Boolean).join(' · ');
  return (
    <button type="button" class="m-tc-season-row" onClick={() => navigate({ name: 'seasonCard', id: card.id, season: season.number })}>
      {season.poster ? <img src={season.poster} alt="" width={46} height={69} /> : <span class="m-tc-season-ph" />}
      <span class="m-tc-season-text">
        <span>{t('library.season', { n: season.number })}</span>
        {sub && <span class="m-small m-muted">{sub}</span>}
        {unreleased && season.airDate && <span class="m-small m-accent">{airDateText(season.airDate)}</span>}
      </span>
    </button>
  );
}

function Similar({ kind, id }: { kind: Kind; id: number }) {
  const [items, setItems] = useState<CatalogTitle[]>([]);
  useEffect(() => {
    let alive = true;
    phoneCatalog()
      .then((c) => c.similar(kind, id))
      .then(
        (list) => {
          if (alive) setItems(list);
        },
        () => undefined,
      );
    return () => {
      alive = false;
    };
  }, [kind, id]);
  if (!items.length) return null;
  return (
    <section class="m-tc-section">
      <h2>{t('titleCard.similar')}</h2>
      <div class="m-tc-similar">
        {items.map((item) => (
          <button key={item.kind + item.id} type="button" class="m-tc-similar-item" onClick={() => navigate({ name: 'title', kind: item.kind, id: item.id })}>
            {item.poster ? <img src={item.poster} alt="" width={92} height={138} /> : <span class="m-tc-season-ph" />}
            <span class="m-small m-tc-similar-title">{item.title}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function Body({ card }: { card: CatalogCard }) {
  const query = wantQuery(card);
  const [wanting, setWanting] = useState(false);
  const [artOpen, setArtOpen] = useState(false);
  const [variants, setVariants] = useState<string[]>([]);
  const [launchError, setLaunchError] = useState('');
  const launch = useTvLaunch();
  void monitorVersion.value;
  void artVersion.value;
  const following = loadSubs().some((s) => sameQuery(s.query, query));
  const tv = card.kind === 'tv';
  const art = tv ? pickedArt(artKey(card.id)) : '';
  const poster = art || card.poster;
  const hash = tv ? seriesLibraryHash(torrents.value, card, null) : '';
  const spot = tv ? seriesWatchSpot(torrents.value, card, null) : null;
  const facts = tv ? [seriesDates(card), seriesStatusWord(card), card.rating > 0 ? ratingText(card.rating) : ''].filter(Boolean).join(' · ') : '';

  const openArt = () => {
    setArtOpen(true);
    phoneCatalog()
      .then((c) => c.posters('tv', card.id))
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

  return (
    <>
      <div class="m-tc-head">
        <Poster card={card} src={poster} onPick={tv ? openArt : undefined} />
        <div class="m-tc-info">
          <h1 class="m-tc-title">{card.title}</h1>
          {tv ? (
            <>
              {facts && <span class="m-muted m-small m-tc-meta">{facts}</span>}
              {card.genres.length > 0 && <span class="m-muted m-small m-tc-genres">{card.genres.join(', ')}</span>}
              <SeriesPill card={card} />
            </>
          ) : (
            <>
              <span class="m-muted m-small m-tc-meta">{metaText(card)}</span>
              {card.rating > 0 && <span class="m-tc-rating">{ratingText(card.rating) + ' TMDB'}</span>}
            </>
          )}
        </div>
      </div>
      {!tv && <ReleaseLine card={card} />}
      <div class={tv ? 'm-tc-actions m-tc-actions-row' : 'm-tc-actions'}>
        {tv && (spot || hash) ? (
          <button type="button" class="m-btn m-btn-primary" onClick={watch}>
            {t('news.watchOnTv')}
          </button>
        ) : (
          <button type="button" class="m-btn m-btn-primary" onClick={() => navigate({ name: 'add', query: torrentQuery(card), run: true })}>
            {t('titleCard.findTorrents')}
          </button>
        )}
        <WantButton card={card} following={following} onWant={() => setWanting(true)} />
      </div>
      {launchError && <LaunchError message={launchError} class="m-hint-warn" />}
      {wanting && <WantSheet card={card} onClose={() => setWanting(false)} />}
      {card.overview && <Overview text={card.overview} />}
      {tv ? (
        <>
          <CastStrip cast={card.cast} part="heads" />
          <CastStrip cast={card.cast} part="actors" />
          <SeasonRows card={card} />
          <Similar kind="tv" id={card.id} />
        </>
      ) : (
        <CastStrip cast={card.cast} />
      )}
      {artOpen && (
        <PosterSheet
          urls={variants}
          current={poster}
          onClose={() => setArtOpen(false)}
          onPick={(url) => {
            saveArt(artKey(card.id), url);
            setArtOpen(false);
          }}
        />
      )}
      {launch.sheet}
    </>
  );
}

export function TitleCard({ kind, id }: { kind: Kind; id: number }) {
  const [card, setCard] = useState<CatalogCard | null>(null);
  const [error, setError] = useState<CatalogErrorCode | null>(null);
  const [reload, setReload] = useState(0);
  // «Повторить» reads the server's TMDB settings again; answers of an older request are dropped
  const fresh = useRef(false);
  const gen = useRef(0);

  useEffect(() => {
    const my = ++gen.current;
    setCard(null);
    setError(null);
    const reread = fresh.current;
    fresh.current = false;
    phoneCatalog(reread)
      .then((c) => c.card(kind, id))
      .then(
        (c) => {
          if (gen.current === my) setCard(c);
        },
        (e) => {
          if (gen.current === my) setError(catalogErrorCode(e));
        },
      );
  }, [kind, id, reload]);

  return (
    <div class="m-screen m-tc" data-route="title">
      <div class="m-tc-backdrop">
        {card && card.backdrop && <img src={card.backdrop} alt="" />}
        <button type="button" class="m-icon-btn m-tc-back" data-code="P24.1" aria-label={t('common.back')} onClick={() => goBack()}>
          <Icon d={BACK} />
        </button>
      </div>
      <div class="m-tc-body">
        {error ? (
          <CatalogError
            code={error}
            onRetry={() => {
              fresh.current = true;
              setReload((n) => n + 1);
            }}
          />
        ) : !card ? (
          <div class="m-tc-head m-tc-skel" aria-busy="true">
            <span class="m-tc-poster" />
            <div class="m-tc-info">
              <span class="m-disc-skel-line" />
              <span class="m-disc-skel-line" />
            </div>
          </div>
        ) : (
          <Body card={card} />
        )}
      </div>
    </div>
  );
}
