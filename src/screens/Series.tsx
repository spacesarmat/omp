// «Мои» → a series on the TV: the TMDB hero (backdrop, poster, status pill, year · rating · genres, overview),
// «Смотреть SxxEyy» / «Раздачи · N» / «Следить за сериями», a row of season chips (focusing one shows it; seasons
// still to come are dashed) and the chosen season's episodes with their TMDB names. Without TMDB (no key, offline,
// no match) the library's poster and title stay and the episodes keep their file names.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { getCurrentFocusKey } from '@noriginmedia/norigin-spatial-navigation';
import { client } from '../store/servers';
import { torrents } from '../store/library';
import {
  continueWatching,
  getLocalProgress,
  isWatched,
  markWatched,
  progressRatio,
  progressVersion,
  refreshViewed,
  resumePosition,
  serverViewed,
} from '../store/progress';
import type { Torrent } from '../api/types';
import type { CatalogCard, Episode } from '../catalog/tmdb';
import { lang, t, fmtNumber } from '../i18n';
import { findGroup, groupLabel, NO_SEASON, seasonMembers, seasonsOf, type SeriesGroup } from '../lib/seriesGroups';
import { cachedSeriesMatch, matchSeries } from '../lib/seriesMatch';
import { airDateText, isoDay, seriesPill, upcomingSeasons } from '../lib/seriesStatus';
import { cleanFileName, seasonEpisodes, showOf, type ShowInfo } from '../lib/episodeNames';
import { baseName, naturalCompare, parseEpisode, playableFiles, stripExt, type TorrentFile } from '../lib/episodes';
import { formatBytes } from '../lib/format';
import { libraryTitle } from '../lib/libraryView';
import { buildTorrentQueue } from '../player/queue';
import { currentRoute, goBack, navigate, type Route } from '../ui/nav';
import { FocusGroup, Focusable, Button, ProgressBar } from '../ui/components';
import { Icon, KeyDot } from '../ui/icons';
import { restoreFocus } from '../ui/focus';
import { choose } from '../ui/dialog';
import { toast } from '../ui/toast';
import { useKeys } from '../ui/keys';
import { Poster } from './library/Poster';
import { SeriesPill } from './library/SeriesTile';

// the chosen season of each open series screen (its route entry): kept while the player or a torrent is on top
const chosenSeason = new WeakMap<Route, number>();

interface FileRow {
  tor: Torrent;
  file: TorrentFile;
  episode: number | null;
  code: string;
}

const pad = (n: number) => (n < 10 ? '0' : '') + n;

/** «S03E04» (or «E04» without a season); '' when the file has no episode number. */
function episodeCode(season: number | null, episode: number | null): string {
  if (episode === null) return '';
  return (season !== null && season !== NO_SEASON ? 'S' + pad(season) : '') + 'E' + pad(episode);
}

/** The playable files of one season across its torrents, by episode. */
function seasonRows(g: SeriesGroup, season: number): FileRow[] {
  const c = client.value!;
  const out: FileRow[] = [];
  seasonMembers(g, season).forEach((m) => {
    const pack = seasonsOf(m).length > 1;
    playableFiles(c.files(m)).forEach((f) => {
      const e = parseEpisode(f.path);
      if (season !== NO_SEASON) {
        // a file of another season of a pack; a pack's file with no season cannot be placed
        if (e.season !== null ? e.season !== season : pack) return;
      }
      const s = season !== NO_SEASON ? season : e.season;
      out.push({ tor: m, file: f, episode: e.episode, code: episodeCode(s, e.episode) });
    });
  });
  return dedupe(out).sort((a, b) => {
    if (a.episode !== b.episode) {
      if (a.episode === null) return 1;
      if (b.episode === null) return -1;
      return a.episode - b.episode;
    }
    return naturalCompare(a.file.path, b.file.path);
  });
}

const hasProgress = (r: FileRow) => isWatched(r.tor.hash, r.file.id) || resumePosition(r.tor.hash, r.file.id) > 0;

/**
 * One row per episode when several torrents hold the same season: the copy with progress (watched or started) wins,
 * else the newest torrent's. Files without an episode number all stay.
 */
function dedupe(rows: FileRow[]): FileRow[] {
  const best: { [n: number]: FileRow } = {};
  const out: FileRow[] = [];
  rows.forEach((r) => {
    if (r.episode === null) {
      out.push(r);
      return;
    }
    const cur = best[r.episode];
    if (!cur) {
      best[r.episode] = r;
      return;
    }
    const a = hasProgress(r);
    const b = hasProgress(cur);
    if ((a && !b) || (a === b && (r.tor.timestamp || 0) > (cur.tor.timestamp || 0))) best[r.episode] = r;
  });
  Object.keys(best).forEach((k) => out.push(best[+k]));
  return out;
}

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

/** The episode «Смотреть» starts: one in progress, else the first not watched, else the first. */
function nextRow(rows: FileRow[]): FileRow | null {
  const started = rows.filter((r) => resumePosition(r.tor.hash, r.file.id) > 0)[0];
  if (started) return started;
  return rows.filter((r) => !isWatched(r.tor.hash, r.file.id))[0] || rows[0] || null;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** «2024–2026 · ★ 7,6 · Фантастика, Драма». */
function heroMeta(card: CatalogCard): string {
  const end = card.seasons.reduce((m, s) => Math.max(m, s.year || 0), 0);
  const now = new Date().getFullYear();
  const last = end > now ? now : end;
  const years = !card.year ? '' : last > card.year ? card.year + '–' + last : String(card.year);
  return [years, card.rating > 0 ? '★ ' + fmtNumber(card.rating, 1) : '', card.genres.slice(0, 2).map(capital).join(', ')]
    .filter(Boolean)
    .join(' · ');
}

/** The TMDB card of the series: at once from memory on a revisit, else once the lookup ends; null without one. */
function useSeriesCard(group: SeriesGroup): CatalogCard | null {
  const l = lang.value;
  const [card, setCard] = useState<CatalogCard | null>(() => cachedSeriesMatch(group.key) || null);
  const groupRef = useRef(group);
  groupRef.current = group;
  useEffect(() => {
    const hit = cachedSeriesMatch(group.key);
    if (hit !== undefined) {
      setCard(hit);
      return;
    }
    let live = true;
    matchSeries(groupRef.current).then(
      (c) => {
        if (live) setCard(c);
      },
      () => undefined, // no TMDB: the library's poster and title stay
    );
    return () => {
      live = false;
    };
  }, [group.key, l]);
  return card;
}

/** The TMDB episodes of a season by number; {} until they arrive or without TMDB. */
function useEpisodes(group: SeriesGroup, season: number): { [n: number]: Episode } {
  const [show, setShow] = useState<ShowInfo | null>(null);
  const [eps, setEps] = useState<{ [n: number]: Episode }>({});
  const l = lang.value;
  useEffect(() => {
    let live = true;
    showOf(group.named).then((s) => {
      if (live) setShow(s);
    });
    return () => {
      live = false;
    };
  }, [group.named.hash, l]);
  useEffect(() => {
    setEps({});
    if (!show || season === NO_SEASON) return;
    let live = true;
    seasonEpisodes(show, season).then((e) => {
      if (live) setEps(e);
    });
    return () => {
      live = false;
    };
  }, [show ? show.id : 0, season, l]);
  return eps;
}

function Body({ group, asked }: { group: SeriesGroup; asked?: number }) {
  const c = client.value!;
  const route = useMemo(() => currentRoute.peek(), []);
  const card = useSeriesCard(group);
  const now = Date.now();

  const future = card ? upcomingSeasons(card, now).filter((u) => group.seasons.indexOf(u.number) < 0) : [];
  const chips = group.seasons.concat(future.map((u) => u.number)).sort((a, b) => a - b);
  const remembered = chosenSeason.get(route);
  const [chosen, setChosen] = useState(() =>
    remembered !== undefined ? remembered : asked !== undefined && group.seasons.indexOf(asked) >= 0 ? asked : firstSeason(group),
  );
  const season = chips.indexOf(chosen) >= 0 ? chosen : firstSeason(group);
  const pick = (n: number) => {
    if (n === season) return;
    setChosen(n);
    chosenSeason.set(route, n);
  };
  const eps = useEpisodes(group, season);

  const rows = seasonRows(group, season); // progress decides which copy of an episode is shown
  const target = nextRow(rows);
  const members = seasonMembers(group, season);
  const releases = members.length ? members : group.members;

  useEffect(() => {
    refreshViewed(c);
    restoreFocus('SERIES-ACTIONS');
  }, []);

  const play = (r: FileRow) => {
    const queue = buildTorrentQueue(c, r.tor, c.files(r.tor));
    const index = queue.findIndex((q) => q.fileIndex === r.file.id);
    if (index >= 0) navigate({ name: 'player', queue, index });
  };

  const openReleases = () => {
    if (releases.length === 1) {
      navigate({ name: 'torrent', hash: releases[0].hash });
      return;
    }
    const options = releases.map((m) => ({ label: libraryTitle(m).title + ' · ' + formatBytes(m.torrent_size || 0), value: m.hash }));
    choose(t('series.releasesTitle'), options).then((hash) => {
      if (hash) navigate({ name: 'torrent', hash });
    });
  };

  // red on an episode row: mark it watched
  const rowByKey = useRef<{ [k: string]: FileRow }>({});
  rowByKey.current = {};
  rows.forEach((r) => {
    rowByKey.current[rowKey(r)] = r;
  });
  useKeys((a) => {
    if (a !== 'red') return false;
    let k = '';
    try {
      k = getCurrentFocusKey() || '';
    } catch (e) {
      k = '';
    }
    const r = rowByKey.current[k];
    if (!r) return false;
    markWatched(r.tor.hash, r.file.id);
    toast(t('series.markedWatched'));
    return true;
  });

  const pill = card ? seriesPill(card, now) : null;
  const meta = card ? heroMeta(card) : groupLabel(group);
  const title = card && card.title ? card.title : libraryTitle(group.named).title;

  // TMDB episodes of the season still to come that no file has
  const have: { [n: number]: boolean } = {};
  rows.forEach((r) => {
    if (r.episode !== null) have[r.episode] = true;
  });
  const today = isoDay(now);
  const coming = Object.keys(eps)
    .map((k) => eps[+k])
    .filter((e) => !have[e.n] && !!e.airDate && e.airDate > today)
    .sort((a, b) => a.n - b.n);
  const futureSeason = future.filter((u) => u.number === season)[0];

  return (
    <>
      <div class={'series-hero' + (card && card.backdrop ? ' with-backdrop' : '')}>
        {card && card.backdrop ? (
          <div class="series-backdrop">
            <img src={card.backdrop} alt="" />
            <div class="series-shade" />
          </div>
        ) : null}
        <div class="series-poster">{card && card.poster ? <img src={card.poster} alt="" /> : <Poster t={group.lead} showTitle />}</div>
        <div class="series-info">
          <h1>{title}</h1>
          {pill && (
            <div class="series-status">
              <SeriesPill pill={pill} inline />
            </div>
          )}
          {meta && <div class="muted series-meta">{meta}</div>}
          {card && card.overview ? <p class="series-overview">{card.overview}</p> : null}
          <FocusGroup focusKey="SERIES-ACTIONS" className="row series-actions" preferredChildFocusKey="series-watch">
            {target && (
              <Button
                focusKey="series-watch"
                label={target.code ? t('series.watchEp', { code: target.code }) : t('torrent.watch')}
                onPress={() => play(target)}
              />
            )}
            <Button focusKey="series-releases" label={t('series.releasesBtn', { n: releases.length })} onPress={openReleases} />
            <Button focusKey="series-follow" label={t('series.follow')} onPress={() => toast(t('series.watchOnPhone'))} />
          </FocusGroup>
        </div>
      </div>
      {chips.length > 0 && (
        <FocusGroup focusKey="SERIES-SEASONS" className="series-seasons" preferredChildFocusKey={'season-' + season}>
          {chips.map((n) => {
            const soon = future.filter((u) => u.number === n)[0];
            let sub: string;
            if (soon) sub = t('series.seasonComes', { date: airDateText(soon.airDate, now) });
            else {
              const list = n === season ? rows : seasonRows(group, n);
              const done = list.filter((r) => isWatched(r.tor.hash, r.file.id)).length;
              sub = list.length && done === list.length ? t('series.watchedAll') : t('series.progressOf', { done, total: list.length });
            }
            return (
              <Focusable
                key={n}
                focusKey={'season-' + n}
                className={'season-chip' + (soon ? ' chip-future' : '') + (n === season ? ' on' : '')}
                role="button"
                onFocused={() => pick(n)}
                onPress={() => pick(n)}
              >
                <div class="chip-name">{n === NO_SEASON ? t('series.noSeason') : t('library.season', { n })}</div>
                <div class="chip-sub">{sub}</div>
              </Focusable>
            );
          })}
        </FocusGroup>
      )}
      <FocusGroup focusKey="SERIES-EPISODES" className="series-episodes">
        {rows.map((r) => {
          const hash = r.tor.hash;
          const watched = isWatched(hash, r.file.id);
          const ratio = progressRatio(hash, r.file.id);
          const at = resumePosition(hash, r.file.id);
          const p = getLocalProgress(hash, r.file.id);
          const left = !watched && at > 0 && p && p.duration > 0 ? Math.max(1, Math.round((p.duration - at) / 60)) : 0;
          const ep = r.episode !== null ? eps[r.episode] : undefined;
          const name = ep && ep.title ? ep.title : cleanFileName(stripExt(baseName(r.file.path)));
          return (
            <Focusable key={rowKey(r)} focusKey={rowKey(r)} className="list-item file-row ep-row" onPress={() => play(r)}>
              <span class="ep">{r.code}</span>
              <span class="name">{name}</span>
              {!watched && ratio > 0 && (
                <span class="bar">
                  <ProgressBar ratio={ratio} />
                </span>
              )}
              <span class="size">{left ? t('series.left', { n: left }) : formatBytes(r.file.length)}</span>
              <span class="check">{watched ? <Icon name="check" size={28} /> : null}</span>
            </Focusable>
          );
        })}
        {coming.map((e) => (
          <Focusable key={'future-' + e.n} focusKey={'ep-future-' + season + '-' + e.n} className="list-item file-row ep-row ep-future">
            <span class="ep">{episodeCode(season, e.n)}</span>
            <span class="name">{e.title}</span>
            <span class="size">{airDateText(e.airDate, now)}</span>
            <span class="check" />
          </Focusable>
        ))}
      </FocusGroup>
      {!rows.length && !coming.length && futureSeason && (
        <div class="empty">{t('series.seasonComes', { date: airDateText(futureSeason.airDate, now) })}</div>
      )}
      <div class="hints">
        {t('series.hintOk')} · {t('series.hintSeasons')} · <KeyDot color="red" /> {t('series.hintWatched')} · {t('series.hintBack')}
      </div>
    </>
  );
}

function rowKey(r: FileRow): string {
  return 'ep-' + r.tor.hash + '-' + r.file.id;
}

export function SeriesScreen({ seriesKey, season }: { seriesKey: string; season?: number }) {
  progressVersion.value; // re-render when the progress changes
  serverViewed.value;
  const list = torrents.value;
  const group = useMemo(() => findGroup(list, seriesKey), [list, seriesKey]);
  useEffect(() => {
    if (group) return;
    toast(t('series.goneTv'));
    goBack();
  }, [!!group]);
  return (
    <FocusGroup focusKey="SERIES" className="screen series">
      {group ? <Body group={group} asked={season} /> : null}
    </FocusGroup>
  );
}
