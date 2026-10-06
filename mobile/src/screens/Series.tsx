// «Мои» → a series card: season chips (like the «Обзор» title card) and the torrents of the chosen season as rows,
// each opening the torrent screen; «Смотреть на ТВ» / «Продолжить на ТВ» for the chosen season.
// With the TMDB show found: a hero (backdrop, poster, years · rating · genres, overview), every season TMDB knows (the
// ones missing from «Мои» dimmed, with «Найти раздачи»), and the chosen season's TMDB name and overview. Without TMDB
// (no key, offline, no match) the simple layout stays, with no error shown. The hero has the series' status pill; a
// season still to come is a chip «Сезон 5 · с 3 мая» with «Напомнить» (a monitoring subscription for that season).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { lang, t, tp } from '../../../src/i18n';
import { Icon, ICONS } from '../ui/Icon';
import { SeriesPill } from '../ui/SeriesPill';
import { showToast } from '../ui/toast';
import { askNotifyOnce, monitorVersion, reloadMonitor } from '../monitor/ui';
import { addSubscription, loadSubs, sameQuery } from '../../../src/monitor/subs';
import { airDateText, upcomingSeasons, type Upcoming } from '../lib/seriesStatus';
import { Poster, qualityBadge } from '../ui/Poster';
import { LaunchError } from '../ui/LaunchError';
import { currentRoute, goBack, navigate, switchTab, type MRoute } from '../nav';
import { filesOf, useTvLaunch } from '../watch';
import { deleteTorrents, reportDeleted, watchTarget } from '../lib/torrentActions';
import { TorrentMenu, type TorrentMenuItem } from '../ui/TorrentMenu';
import { client } from '../../../src/store/servers';
import { sharedProgress, sharedResume } from '../lib/sharedProgress';
import { activeTv } from '../tv/tvStore';
import { torrents } from '../../../src/store/library';
import { continueWatching, getLocalProgress, progressVersion, serverViewed } from '../../../src/store/progress';
import { libraryTitle, positionLabel } from '../../../src/lib/libraryView';
import { formatBytes } from '../../../src/lib/format';
import { baseName, episodeLabel, playableFiles, stripExt } from '../../../src/lib/episodes';
import { displayTitle } from '../../../src/lib/torrentName';
import type { Torrent } from '../../../src/api/types';
import { findGroup, groupLabel, NO_SEASON, otherSeasonReleases, seasonMembers, type SeriesGroup } from '../lib/seriesGroups';
import { cachedSeriesMatch, matchSeries } from '../lib/seriesMatch';
import { dropLine, dropWorse, worseInSeason } from '../lib/duplicates';
import { phoneCatalog } from '../catalog/phoneCatalog';
import { torrentQuery, type CatalogCard, type Season, type SeasonDetails } from '../../../src/catalog/tmdb';
import { ratingText } from './catalog/CatalogSearch';

const BACK = 'M15 5l-7 7l7 7';
const KEEP = 'M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.5 6.6 19.5l1.2-6-4.5-4.2 6.1-.7z';
const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP = 10;

/** A long press (500 ms without moving more than 10 px) or contextmenu runs `onLong`; the tap after it is swallowed. */
function useLongPress(onLong: () => void, onTap: () => void) {
  const p = useRef<{ timer: ReturnType<typeof setTimeout> | undefined; x: number; y: number; fired: boolean }>({
    timer: undefined,
    x: 0,
    y: 0,
    fired: false,
  }).current;
  const stop = () => {
    clearTimeout(p.timer);
    p.timer = undefined;
  };
  return {
    onPointerDown: (e: PointerEvent) => {
      stop();
      p.fired = false;
      p.x = e.clientX;
      p.y = e.clientY;
      p.timer = setTimeout(() => {
        p.timer = undefined;
        p.fired = true;
        onLong();
      }, LONG_PRESS_MS);
    },
    onPointerMove: (e: PointerEvent) => {
      if (p.timer && Math.hypot(e.clientX - p.x, e.clientY - p.y) > LONG_PRESS_SLOP) stop();
    },
    onPointerUp: stop,
    onPointerCancel: stop,
    onContextMenu: (e: Event) => {
      e.preventDefault();
      stop();
      p.fired = true;
      onLong();
    },
    onClick: () => {
      if (p.fired) {
        p.fired = false;
        return;
      }
      onTap();
    },
  };
}

// the chosen season of each open series screen (its route entry): kept through «Назад» from the torrent screen
const chosenSeason = new WeakMap<MRoute, number>();

/** The season shown first: the one watched last, else the newest. */
function firstSeason(g: SeriesGroup): number {
  const recent = continueWatching(g.members, 1000)[0];
  if (recent) {
    const s = g.seasons.filter((x) => seasonMembers(g, x).indexOf(recent.torrent) >= 0);
    if (s.length) return s[s.length - 1];
  }
  const known = g.seasons.filter((x) => x !== NO_SEASON);
  return known.length ? known[known.length - 1] : g.seasons[0];
}

/** The torrent of the season «Смотреть на ТВ» starts: the one watched last, else the newest. */
function seasonTarget(list: Torrent[]): Torrent {
  const recent = continueWatching(list, 1000)[0];
  if (recent) return recent.torrent;
  return list.slice().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))[0];
}

function seasonName(n: number): string {
  return n === NO_SEASON ? t('series.noSeason') : t('library.season', { n });
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** «2022–2026 · ★ 7,6 · Фантастика, Приключения»: the years of its seasons, the TMDB rating, up to 2 genres. */
export function heroMeta(card: CatalogCard): string {
  const end = card.seasons.reduce((m, s) => Math.max(m, s.year), 0);
  const years = !card.year ? '' : end > card.year ? card.year + '–' + end : String(card.year);
  return [years, card.rating > 0 ? ratingText(card.rating) : '', card.genres.slice(0, 2).map(capital).join(', ')]
    .filter(Boolean)
    .join(' · ');
}

/** «10 серий · 2023» of a TMDB season. */
function seasonCaption(s: Season): string {
  return [s.episodes ? tp('library.episodes', s.episodes) : '', s.year ? String(s.year) : ''].filter(Boolean).join(' · ');
}

/** The TMDB card of the series: at once from memory on a revisit, else once the lookup ends; null without one. */
function useSeriesCard(group: SeriesGroup | null): CatalogCard | null {
  const l = lang.value;
  const key = group ? group.key : '';
  const [card, setCard] = useState<CatalogCard | null>(() => (key ? cachedSeriesMatch(key) || null : null));
  const groupRef = useRef(group);
  groupRef.current = group;
  useEffect(() => {
    const g = groupRef.current;
    if (!g) {
      setCard(null);
      return;
    }
    const hit = cachedSeriesMatch(g.key);
    if (hit !== undefined) {
      setCard(hit);
      return;
    }
    setCard(null);
    let live = true;
    matchSeries(g).then(
      (c) => {
        if (live) setCard(c);
      },
      () => undefined, // no TMDB: the simple layout stays
    );
    return () => {
      live = false;
    };
  }, [key, l]);
  return card;
}

/** The overview: 3 lines, «Ещё» when it does not fit. */
function HeroOverview({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [clamped, setClamped] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (node && !open) setClamped(node.scrollHeight > node.clientHeight + 1);
  }, [text, open]);
  return (
    <div class="m-tc-about">
      <p ref={ref} class={'m-tc-overview m-sh-overview' + (open ? ' open' : '')}>
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

function Hero({ card, group }: { card: CatalogCard; group: SeriesGroup }) {
  const meta = heroMeta(card);
  return (
    <>
      <div class="m-tc-backdrop m-sh-backdrop">
        {card.backdrop && <img src={card.backdrop} alt="" />}
        <button type="button" class="m-icon-btn m-tc-back" aria-label={t('common.back')} onClick={() => goBack()}>
          <Icon d={BACK} />
        </button>
      </div>
      <div class="m-tc-head m-sh-head">
        {card.poster ? (
          <img class="m-tc-poster m-sh-poster" src={card.poster} alt="" width={96} height={144} />
        ) : (
          <Poster torrent={group.lead} class="m-tc-poster m-sh-poster" />
        )}
        <div class="m-tc-info">
          <h1 class="m-tc-title m-series-title">{card.title || libraryTitle(group.named).title}</h1>
          {meta && <span class="m-muted m-small m-sh-meta">{meta}</span>}
          <SeriesPill card={card} />
          <span class="m-muted m-small">{groupLabel(group)}</span>
        </div>
      </div>
      {card.overview && <HeroOverview text={card.overview} />}
    </>
  );
}

/** The TMDB name and overview of a season in «Мои»; nothing while loading or when TMDB fails. */
function SeasonAbout({ id, number }: { id: number; number: number }) {
  const [data, setData] = useState<SeasonDetails | null>(null);
  useEffect(() => {
    let live = true;
    setData(null);
    phoneCatalog()
      .then((c) => c.season(id, number))
      .then(
        (d) => {
          if (live) setData(d);
        },
        () => undefined,
      );
    return () => {
      live = false;
    };
  }, [id, number]);
  if (!data) return null;
  const plain = t('library.season', { n: number }).toLowerCase();
  const name = data.name && data.name.toLowerCase() !== plain ? data.name : '';
  if (!name && !data.overview) return null;
  return (
    <div class="m-sh-season-about">
      {name && <span class="m-small m-sh-season-name">{name}</span>}
      {data.overview && <span class="m-small m-muted m-sh-season-overview">{data.overview}</span>}
    </div>
  );
}

/** A season still to come: its day, and «Напомнить» (a subscription for it), or «Напоминание включено» when one exists. */
function FutureSeason({ card, season }: { card: CatalogCard; season: Upcoming }) {
  void monitorVersion.value; // re-read after a subscription is added
  const query = torrentQuery(card, season.number);
  const on = loadSubs().some((s) => sameQuery(s.query, query));
  const remind = () => {
    const first = loadSubs().length === 0;
    const saved = addSubscription({ query: query, quality: '', sources: null, notify: true });
    if (!saved) return;
    if (first) void askNotifyOnce().catch(() => {});
    reloadMonitor();
    showToast(t('titleCard.wantDone'));
  };
  return (
    <div class="m-sh-missing m-sh-future">
      <p class="m-small">{t('series.seasonComes', { date: airDateText(season.airDate) })}</p>
      {on ? (
        <button type="button" class="m-btn m-btn-secondary" onClick={() => navigate({ name: 'news', seg: 'subs' })}>
          {t('series.reminderOn')}
        </button>
      ) : (
        <button type="button" class="m-btn m-btn-primary" onClick={remind}>
          {t('series.remind')}
        </button>
      )}
    </div>
  );
}

function Row({ tor, onWatch, onMenu }: { tor: Torrent; onWatch: (tor: Torrent) => void; onMenu: (tor: Torrent) => void }) {
  const press = useLongPress(
    () => onMenu(tor),
    () => navigate({ name: 'torrent', hash: tor.hash }),
  );
  const s = libraryTitle(tor);
  const files = playableFiles(filesOf(tor));
  const target = watchTarget(tor.hash, files);
  // the episode's progress, also from the same episode in another release of the series
  const shared = target ? sharedProgress(tor.hash, target.id) : null;
  const at = shared ? shared.position : 0;
  const duration = target && shared ? getLocalProgress(tor.hash, target.id)?.duration || shared.duration : 0;
  const q = qualityBadge(displayTitle(tor));
  return (
    <div class="m-hrow m-series-row" data-hash={tor.hash}>
      <button type="button" class="m-hrow-main" {...press}>
        <Poster torrent={tor} class="m-poster-mini" />
        <span class="m-hrow-text">
          <span class="m-hrow-title">
            {s.title}
            {s.meta && <span class="m-title-meta">{' · ' + s.meta}</span>}
          </span>
          <span class="m-muted m-small m-vrow-meta">
            <span>{formatBytes(tor.torrent_size || 0)}</span>
            {q && <span class="m-badge-inline">{q}</span>}
            {files.length > 1 && <span>{tp('library.episodes', files.length)}</span>}
          </span>
          {at > 0 && (
            <>
              <span class="m-hrow-pos">
                <span>{[target ? episodeLabel(target.path) : '', positionLabel(at, duration)].filter(Boolean).join(' · ')}</span>
                <span class="m-muted">{t('series.continue')}</span>
              </span>
              {duration > 0 && (
                <span class="m-bar-track thin">
                  <span class="m-bar-fill" style={{ width: Math.min(100, (at / duration) * 100) + '%' }} />
                </span>
              )}
            </>
          )}
        </span>
      </button>
      {target && (
        <button
          type="button"
          class="m-play"
          aria-label={at > 0 ? t('library.continueOnTv') : t('news.watchOnTv')}
          onClick={() => onWatch(tor)}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M8 5l11 7-11 7z" />
          </svg>
        </button>
      )}
    </div>
  );
}

function Body({ group, card }: { group: SeriesGroup; card: CatalogCard | null }) {
  const route = useMemo(() => currentRoute.peek(), []);
  const remembered = chosenSeason.get(route);
  // a season chip on the torrent screen opens this screen on that season (route.season)
  const asked = route.name === 'series' && typeof route.season === 'number' ? route.season : undefined;
  const [chosen, setChosen] = useState(() => (remembered !== undefined ? remembered : asked !== undefined ? asked : firstSeason(group)));
  const [error, setError] = useState('');
  const [menuFor, setMenuFor] = useState<Torrent | null>(null);
  const launch = useTvLaunch();
  const chipsRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const row = chipsRef.current;
    const on = row ? (row.querySelector('.m-chip.on') as HTMLElement | null) : null;
    if (row && on) row.scrollLeft = Math.max(0, on.offsetLeft - (row.clientWidth - on.offsetWidth) / 2);
  }, [!!card]);
  // TMDB's seasons (specials are not listed) and the ones of «Мои»; those TMDB has and «Мои» lacks are missing
  // seasons still to come (dated later, or the next episode's season not started yet) that «Мои» lacks
  const tmdbSeasons = card ? card.seasons : [];
  const tmdbOf = (n: number): Season | undefined => tmdbSeasons.filter((x) => x.number === n)[0];
  const future = card ? upcomingSeasons(card).filter((u) => group.seasons.indexOf(u.number) < 0) : [];
  const futureOf = (n: number): Upcoming | undefined => future.filter((u) => u.number === n)[0];
  const missing = tmdbSeasons.map((x) => x.number).filter((n) => group.seasons.indexOf(n) < 0 && !futureOf(n));
  const chips = group.seasons.concat(missing, future.map((u) => u.number)).sort((a, b) => a - b);
  // a season whose torrents were deleted (or a TMDB season not offered any more): the newest one left
  const season = chips.indexOf(chosen) >= 0 ? chosen : firstSeason(group);
  const isMissing = !!card && missing.indexOf(season) >= 0;
  const coming = card ? futureOf(season) : undefined;
  const pick = (n: number) => {
    setChosen(n);
    chosenSeason.set(route, n);
  };
  const rows = isMissing || coming ? [] : seasonMembers(group, season);
  const lead = libraryTitle(group.named);
  const info = season !== NO_SEASON ? tmdbOf(season) : undefined;
  const caption = info ? seasonCaption(info) : '';

  const watch = (tor: Torrent) => {
    const target = watchTarget(tor.hash, playableFiles(filesOf(tor)));
    if (!target) return;
    if (!activeTv.value) {
      navigate({ name: 'tv' });
      return;
    }
    setError('');
    void launch.start({
      hash: tor.hash,
      file: target.id,
      at: sharedResume(tor.hash, target.id),
      duration: getLocalProgress(tor.hash, target.id)?.duration || undefined,
      label: [episodeLabel(target.path), stripExt(baseName(target.path))].filter(Boolean).join(' · '),
      onError: setError,
    });
  };

  // «Оставить только эту»: the other releases of the shown season go (a pack holding another season stays)
  const keepOnly = (tor: Torrent): TorrentMenuItem[] => {
    const others = otherSeasonReleases(group, season, tor);
    if (rows.length < 2 || !others.length) return [];
    return [
      {
        label: t('series.keepOnly'),
        icon: KEEP,
        danger: true,
        run: async () => {
          const c = client.value;
          if (!c) return false;
          const ask =
            season === NO_SEASON
              ? tp('series.keepOnlyAskNoSeason', others.length)
              : tp('series.keepOnlyAsk', others.length, { season: String(season) });
          if (!window.confirm(ask)) return false;
          reportDeleted(await deleteTorrents(c, others.map((m) => m.hash)));
          return true;
        },
      },
    ];
  };

  // «Есть дубль в худшем качестве»: each release a better one of the season fully covers may go (history moves over)
  const worse = rows.length > 1 ? worseInSeason(group, season) : [];
  const [dropping, setDropping] = useState(false);
  const keepBetter = async () => {
    const c = client.value;
    if (!c || dropping || !worse.length) return;
    const lines = worse.map((w) => dropLine(w.worse, w.better));
    if (!window.confirm(tp('series.dupHintAsk', worse.length) + '\n' + lines.join('\n'))) return;
    setDropping(true);
    let failed = '';
    for (const w of worse) {
      const r = await dropWorse(c, w.worse, w.better);
      if (!r.ok && !failed) failed = r.error;
    }
    setDropping(false);
    showToast(failed || t('library.deletedN', { n: worse.length }));
  };

  const main = rows.length ? seasonTarget(rows) : null;
  const mainFile = main ? watchTarget(main.hash, playableFiles(filesOf(main))) : undefined;
  const mainAt = main && mainFile ? sharedResume(main.hash, mainFile.id) : 0;

  return (
    <>
      {card ? (
        <Hero card={card} group={group} />
      ) : (
        <div class="m-series-head">
          <Poster torrent={group.lead} class="m-poster-mini" />
          <div class="m-series-info">
            <h1 class="m-bar-title m-series-title">{lead.title}</h1>
            <span class="m-muted m-small">{groupLabel(group)}</span>
          </div>
        </div>
      )}
      {chips.length > 1 && (
        <div class="m-chips m-tc-chips" ref={chipsRef}>
          {chips.map((n) => {
            const gap = missing.indexOf(n) >= 0;
            const soon = futureOf(n);
            if (soon) {
              return (
                <button
                  key={n}
                  type="button"
                  class={'m-chip m-chip-future' + (n === season ? ' on' : '')}
                  aria-pressed={n === season}
                  onClick={() => pick(n)}
                >
                  <Icon d={ICONS.clock} size={14} />
                  {t('series.futureSeason', { n, date: airDateText(soon.airDate) })}
                </button>
              );
            }
            return (
              <button
                key={n}
                type="button"
                class={'m-chip' + (gap ? ' m-chip-missing' : '') + (n === season ? ' on' : '')}
                aria-pressed={n === season}
                aria-label={gap ? t('series.missingSeason', { n }) : undefined}
                onClick={() => pick(n)}
              >
                {gap && (
                  <span class="m-chip-plus" aria-hidden="true">
                    +
                  </span>
                )}
                {seasonName(n)}
              </button>
            );
          })}
        </div>
      )}
      {caption && <span class="m-small m-muted m-sh-caption">{caption}</span>}
      {coming && card ? (
        <FutureSeason card={card} season={coming} />
      ) : isMissing && card ? (
        <div class="m-sh-missing">
          <p class="m-muted m-small">{t('series.notInLibrary')}</p>
          <button
            type="button"
            class="m-btn m-btn-primary"
            onClick={() => navigate({ name: 'add', query: torrentQuery(card, season), run: true })}
          >
            {t('titleCard.findTorrents')}
          </button>
        </div>
      ) : (
        <>
          {card && season !== NO_SEASON && <SeasonAbout key={season} id={card.id} number={season} />}
          {main && mainFile && (
            <div class="m-tc-season-actions">
              <button type="button" class="m-btn m-btn-primary" onClick={() => watch(main)}>
                {mainAt > 0 ? t('library.continueOnTv') : t('news.watchOnTv')}
              </button>
            </div>
          )}
          {error && <LaunchError message={error} class="m-hint-warn" />}
          {worse.length > 0 && (
            <div class="m-dup-hint m-small" data-dup-hint>
              <span>
                {t('series.dupHint')}
                {worse.map((w) => (
                  <span key={w.worse.hash} class="m-muted m-dup-line" data-dup-line>
                    {dropLine(w.worse, w.better)}
                  </span>
                ))}
              </span>
              <button type="button" class="m-btn m-btn-secondary m-btn-sm" disabled={dropping} onClick={() => void keepBetter()}>
                {t('series.dupHintButton')}
              </button>
            </div>
          )}
          <div class="m-list m-series-rows">
            {rows.map((tor) => (
              <Row key={tor.hash} tor={tor} onWatch={watch} onMenu={setMenuFor} />
            ))}
          </div>
        </>
      )}
      {menuFor && (
        <TorrentMenu tor={menuFor} onClose={() => setMenuFor(null)} onWatchTv={watch} extra={keepOnly(menuFor)} />
      )}
      {launch.sheet}
    </>
  );
}

export function Series({ seriesKey }: { seriesKey: string }) {
  const list = torrents.value;
  progressVersion.value; // re-render when local progress changes
  serverViewed.value;
  const group = useMemo(() => findGroup(list, seriesKey), [list, seriesKey]);
  const card = useSeriesCard(group);
  const hero = !!(group && card);
  // the last release of the series deleted here: back to the library (a series already gone on arrival says so)
  const had = useRef(!!group);
  useEffect(() => {
    if (group) had.current = true;
    else if (had.current && currentRoute.peek().name === 'series') switchTab({ name: 'library' });
  }, [!!group]);
  return (
    <div class={'m-screen m-series' + (hero ? ' m-series-hero' : '')} data-route="series">
      {!hero && (
        <div class="m-bar">
          <button type="button" class="m-icon-btn" aria-label={t('common.back')} onClick={() => goBack()}>
            <Icon d={BACK} />
          </button>
        </div>
      )}
      {group ? <Body group={group} card={card} /> : <p class="m-muted m-note">{t('series.gone')}</p>}
    </div>
  );
}
