// The season's episode list on the phone: a number on the left, no fold button, missing episodes stay visible.
import { useEffect, useState } from 'preact/hooks';
import { fmtDuration, fmtSize, t } from '../../../../src/i18n';
import { formatDuration } from '../../../../src/lib/format';
import { markWatched, saveProgress } from '../../../../src/store/progress';
import { sharedProgress } from '../../lib/sharedProgress';
import { episodePageLabel, seasonEpisodeModels, watchedCount, type SeasonEpTitle } from '../../../../src/lib/seasonEpisodes';
import { commonReleaseTail } from '../../../../src/lib/releaseFileName';
import { parseReleaseInfo } from '../../../../src/lib/releaseInfo';
import type { TorrentFile } from '../../../../src/lib/episodes';
import { Sheet } from '../../ui/Sheet';

const CHECK = 'M5 12.5l4.5 4.5L19 7';
const tight = (s: string) => s.replace(/ /g, '\u00A0');

export function SeasonEpisodes({
  hash,
  files,
  season,
  titles,
  nextAir,
  onPick,
  listRef,
  showSeason,
}: {
  hash: string;
  files: TorrentFile[];
  season: number;
  titles: SeasonEpTitle[];
  nextAir: string;
  showSeason?: boolean;
  onPick: (f: TorrentFile) => void;
  listRef?: { current: HTMLDivElement | null };
}) {
  const rows = seasonEpisodeModels(files, season, titles);
  const ratioOf = (id: number) => {
    const p = sharedProgress(hash, id);
    return p.watched ? 1 : p.ratio;
  };
  const count = watchedCount(rows, ratioOf);
  const [menu, setMenu] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(rows.length <= 50);
  const [jump, setJump] = useState('');
  const [rangeAt, setRangeAt] = useState(0);
  const listKey = hash + ':' + season + ':' + files.length + ':' + (files[0] ? files[0].id : 0);
  useEffect(() => {
    setRangeAt(0);
    setShowAll(files.length <= 50);
    setJump('');
  }, [listKey]);
  let highlight = -1;
  rows.forEach((r, i) => {
    if (highlight >= 0 || r.missing || r.fileId === null) return;
    if (ratioOf(r.fileId) < 0.9) highlight = i;
  });
  const fileOf = (id: number) => files.filter((f) => f.id === id)[0];
  const tail = commonReleaseTail(files.map((f) => f.path));
  const seasons = rows.map((r) => r.season).filter((n, i, a): n is number => n !== null && n > 0 && a.indexOf(n) === i);
  const continueRow = highlight >= 0 ? rows[highlight] : null;
  const continueFile = continueRow && continueRow.fileId !== null ? fileOf(continueRow.fileId) : null;
  const continueProgress = continueRow && continueRow.fileId !== null ? sharedProgress(hash, continueRow.fileId) : null;
  const continueN = continueRow && continueRow.numbers.length ? continueRow.numbers[0] : 0;
  const ranges: number[] = [];
  if (seasons.length < 2 && rows.length > 50) {
    for (let n = 0; n < rows.length; n += 50) ranges.push(n);
  }
  const visible = rows.filter((r, i) => {
    if (showAll || rows.length <= 50) return true;
    if (seasons.length > 1) return true;
    return i >= rangeAt && i < rangeAt + 50;
  });
  const rowName = (title: string, numbers: number[]) => {
    const stripped = title.replace(/^\d+(?:-\d+)?\.\s*/, '');
    if (stripped) return stripped;
    if (numbers.length === 1) return t('library.episode', { n: numbers[0] });
    if (numbers.length > 1) return t('library.episode', { n: numbers[0] + '-' + numbers[numbers.length - 1] });
    return title;
  };
  return (
    <div class="m-eps-block" ref={listRef} data-episodes>
      <div class="m-eps-head">
        <span class="m-section">{t('torrent.screen.episodesHead')}</span>
        {rows.length > 50 && (
          <button type="button" class="m-btn-text" onClick={() => setShowAll(!showAll)}>
            {showAll ? t('torrent.screen.episodesFold') : t('torrent.screen.episodesAll', { n: rows.length })}
          </button>
        )}
      </div>
      {tail ? <p class="m-small m-muted m-eps-tail">{tail}</p> : null}
      {continueFile && continueProgress && continueN > 0 && continueProgress.position >= 5 && continueProgress.ratio < 0.9 && (
        <button type="button" class="m-btn m-btn-primary m-eps-continue" onClick={() => onPick(continueFile)}>
          {t('series.resumeAt', { n: continueN, time: formatDuration(Math.floor(continueProgress.position)) })}
        </button>
      )}
      {seasons.length > 1 && (
        <div class="m-chips m-eps-jump" role="group">
          {seasons.map((n) => (
            <button key={n} type="button" class="m-chip" onClick={() => {
              const node = listRef && listRef.current ? listRef.current.querySelector('[data-season="' + n + '"]') : null;
              if (node && (node as HTMLElement).scrollIntoView) (node as HTMLElement).scrollIntoView({ block: 'start' });
            }}>
              {t('library.seasonNamed', { n })}
            </button>
          ))}
        </div>
      )}
      {ranges.length > 1 && !showAll && (
        <div class="m-eps-jump">
          <div class="m-chips" role="group">
            {ranges.map((n) => (
              <button key={n} type="button" class={'m-chip' + (rangeAt === n ? ' on' : '')} aria-pressed={rangeAt === n} onClick={() => setRangeAt(n)}>
                {episodePageLabel(rows, n)}
              </button>
            ))}
          </div>
          <form class="m-eps-jump-form" onSubmit={(e) => {
            e.preventDefault();
            const n = parseInt(jump, 10);
            if (!n) return;
            const idx = rows.findIndex((r) => r.numbers.indexOf(n) >= 0);
            if (idx < 0) return;
            setRangeAt(Math.floor(idx / 50) * 50);
            setShowAll(false);
          }}>
            <input class="m-input" inputMode="numeric" aria-label={t('series.jumpEpisode')} placeholder={t('series.jumpEpisode')} value={jump} onInput={(e) => setJump((e.currentTarget as HTMLInputElement).value)} />
          </form>
        </div>
      )}
      <div class="m-eps-tools">
        <span class="m-small">{t('series.watchedOf', { have: count.have, n: count.total })}</span>
        <button
          type="button"
          class="m-btn-text"
          onClick={() => {
            rows.forEach((r) => {
              if (r.fileId !== null) markWatched(hash, r.fileId);
            });
          }}
        >
          {t('series.markSeason')}
        </button>
      </div>
      <div class="m-list m-eps m-eps-short">
        {visible.map((r) => {
          const i = rows.indexOf(r);
          const progress = r.fileId === null ? null : sharedProgress(hash, r.fileId);
          const ratio = progress ? (progress.watched ? 1 : progress.ratio) : 0;
          const watched = ratio >= 0.9;
          const started = !watched && ratio >= 0.02;
          const leftMin = progress && progress.duration > 0 ? Math.max(1, Math.round((progress.duration - progress.position) / 60)) : 0;
          const file = r.fileId === null ? null : fileOf(r.fileId);
          return (
            <button
              type="button"
              key={r.key}
              data-season={r.season || undefined}
              class={'m-ep m-ep-row' + (watched ? ' is-watched' : '') + (r.missing ? ' is-missing' : '')}
              data-current={i === highlight ? '1' : undefined}
              disabled={r.missing || !file}
              onClick={() => {
                if (file) onPick(file);
              }}
              onContextMenu={(e) => {
                if (r.fileId === null) return;
                e.preventDefault();
                setMenu(r.fileId);
              }}
            >
              <span class="m-ep-num">{r.numbers.length > 1 ? r.numbers[0] + '-' + r.numbers[r.numbers.length - 1] : r.numbers[0] || ''}</span>
              <span class="m-ep-text">
                <span class="m-ep-line">
                  <span class="m-ep-name">{rowName(r.title, r.numbers)}{showSeason && r.season ? ' · ' + t('library.seasonNamed', { n: r.season }) : ''}</span>
                  {file && <span class="m-muted m-small m-ep-size">{tight(fmtSize(file.length))}{parseReleaseInfo(file.path).resolution ? ' · ' + parseReleaseInfo(file.path).resolution : ''}</span>}
                </span>
                {(r.runtimeMin > 0 || (started && leftMin > 0)) && (
                  <span class="m-ep-meta">
                    <span class="m-ep-dur">{r.runtimeMin > 0 ? tight(fmtDuration(r.runtimeMin)) : tight(t('library.left', { time: fmtDuration(leftMin) }))}</span>
                  </span>
                )}
                {file && (
                  <span class="m-bar-track thin">
                    <span class="m-bar-fill" style={{ width: Math.round(ratio * 100) + '%' }} />
                  </span>
                )}
              </span>
              {watched && (
                <svg class="m-ep-check" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                  <path d={CHECK} fill="none" stroke="currentColor" stroke-width="2.4" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
      {nextAir ? <p class="m-small m-muted m-eps-next">{nextAir}</p> : null}
      {menu !== null && (
        <Sheet label={t('library.actions')} onClose={() => setMenu(null)}>
          <button
            type="button"
            class="m-opt"
            onClick={() => {
              markWatched(hash, menu);
              setMenu(null);
            }}
          >
            {t('history.markWatched')}
          </button>
          <button
            type="button"
            class="m-opt"
            onClick={() => {
              saveProgress(hash, menu, 0, 1);
              setMenu(null);
            }}
          >
            {t('history.restart')}
          </button>
        </Sheet>
      )}
    </div>
  );
}
