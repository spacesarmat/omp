// «Мои» → a series card: season chips (like the «Обзор» title card) and the torrents of the chosen season as rows,
// each opening the torrent screen; «Смотреть на ТВ» / «Продолжить на ТВ» for the chosen season.
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { t, tp } from '../../../src/i18n';
import { Icon } from '../ui/Icon';
import { Poster, qualityBadge } from '../ui/Poster';
import { LaunchError } from '../ui/LaunchError';
import { currentRoute, goBack, navigate, type MRoute } from '../nav';
import { filesOf, useTvLaunch } from '../watch';
import { watchTarget } from '../lib/torrentActions';
import { activeTv } from '../tv/tvStore';
import { torrents } from '../../../src/store/library';
import { continueWatching, getLocalProgress, progressVersion, resumePosition, serverViewed } from '../../../src/store/progress';
import { libraryTitle, positionLabel } from '../../../src/lib/libraryView';
import { formatBytes } from '../../../src/lib/format';
import { baseName, episodeLabel, playableFiles, stripExt } from '../../../src/lib/episodes';
import { displayTitle } from '../../../src/lib/torrentName';
import type { Torrent } from '../../../src/api/types';
import { findGroup, groupLabel, NO_SEASON, seasonMembers, type SeriesGroup } from '../lib/seriesGroups';

const BACK = 'M15 5l-7 7l7 7';

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

function Row({ tor, onWatch }: { tor: Torrent; onWatch: (tor: Torrent) => void }) {
  const s = libraryTitle(tor);
  const files = playableFiles(filesOf(tor));
  const target = watchTarget(tor.hash, files);
  const at = target ? resumePosition(tor.hash, target.id) : 0;
  const duration = target ? getLocalProgress(tor.hash, target.id)?.duration || 0 : 0;
  const q = qualityBadge(displayTitle(tor));
  return (
    <div class="m-hrow m-series-row" data-hash={tor.hash}>
      <button type="button" class="m-hrow-main" onClick={() => navigate({ name: 'torrent', hash: tor.hash })}>
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

function Body({ group }: { group: SeriesGroup }) {
  const route = useMemo(() => currentRoute.peek(), []);
  const remembered = chosenSeason.get(route);
  const [chosen, setChosen] = useState(() =>
    remembered !== undefined && group.seasons.indexOf(remembered) >= 0 ? remembered : firstSeason(group),
  );
  const [error, setError] = useState('');
  const launch = useTvLaunch();
  const chipsRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const row = chipsRef.current;
    const on = row ? (row.querySelector('.m-chip.on') as HTMLElement | null) : null;
    if (row && on) row.scrollLeft = Math.max(0, on.offsetLeft - (row.clientWidth - on.offsetWidth) / 2);
  }, []);
  // a season whose torrents were deleted: the newest one left
  const season = group.seasons.indexOf(chosen) >= 0 ? chosen : firstSeason(group);
  const pick = (n: number) => {
    setChosen(n);
    chosenSeason.set(route, n);
  };
  const rows = seasonMembers(group, season);
  const lead = libraryTitle(group.lead);

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
      at: resumePosition(tor.hash, target.id),
      duration: getLocalProgress(tor.hash, target.id)?.duration || undefined,
      label: [episodeLabel(target.path), stripExt(baseName(target.path))].filter(Boolean).join(' · '),
      onError: setError,
    });
  };

  const main = rows.length ? seasonTarget(rows) : null;
  const mainFile = main ? watchTarget(main.hash, playableFiles(filesOf(main))) : undefined;
  const mainAt = main && mainFile ? resumePosition(main.hash, mainFile.id) : 0;

  return (
    <>
      <div class="m-series-head">
        <Poster torrent={group.lead} class="m-poster-mini" />
        <div class="m-series-info">
          <h1 class="m-bar-title m-series-title">{lead.title}</h1>
          <span class="m-muted m-small">{groupLabel(group)}</span>
        </div>
      </div>
      {group.seasons.length > 1 && (
        <div class="m-chips m-tc-chips" ref={chipsRef}>
          {group.seasons.map((n) => (
            <button
              key={n}
              type="button"
              class={'m-chip' + (n === season ? ' on' : '')}
              aria-pressed={n === season}
              onClick={() => pick(n)}
            >
              {seasonName(n)}
            </button>
          ))}
        </div>
      )}
      {main && mainFile && (
        <div class="m-tc-season-actions">
          <button type="button" class="m-btn m-btn-primary" onClick={() => watch(main)}>
            {mainAt > 0 ? t('library.continueOnTv') : t('news.watchOnTv')}
          </button>
        </div>
      )}
      {error && <LaunchError message={error} class="m-hint-warn" />}
      <div class="m-list m-series-rows">
        {rows.map((tor) => (
          <Row key={tor.hash} tor={tor} onWatch={watch} />
        ))}
      </div>
      {launch.sheet}
    </>
  );
}

export function Series({ seriesKey }: { seriesKey: string }) {
  const list = torrents.value;
  progressVersion.value; // re-render when local progress changes
  serverViewed.value;
  const group = useMemo(() => findGroup(list, seriesKey), [list, seriesKey]);
  return (
    <div class="m-screen m-series" data-route="series">
      <div class="m-bar">
        <button type="button" class="m-icon-btn" aria-label={t('common.back')} onClick={() => goBack()}>
          <Icon d={BACK} />
        </button>
      </div>
      {group ? <Body group={group} /> : <p class="m-muted m-note">{t('series.gone')}</p>}
    </div>
  );
}
