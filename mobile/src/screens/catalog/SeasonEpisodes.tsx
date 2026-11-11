// The season's episode list on the phone: a number on the left, no fold button, missing episodes stay visible.
import { useState } from 'preact/hooks';
import { fmtDuration, fmtSize, t } from '../../../../src/i18n';
import { markWatched, saveProgress } from '../../../../src/store/progress';
import { sharedProgress } from '../../lib/sharedProgress';
import { seasonEpisodeModels, watchedCount, type SeasonEpTitle } from '../../../../src/lib/seasonEpisodes';
import type { TorrentFile } from '../../../../src/lib/episodes';
import { Sheet } from '../../ui/Sheet';

const CHECK = 'M5 12.5l4.5 4.5L19 7';

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
  let highlight = -1;
  rows.forEach((r, i) => {
    if (highlight >= 0 || r.missing || r.fileId === null) return;
    if (ratioOf(r.fileId) < 0.9) highlight = i;
  });
  const fileOf = (id: number) => files.filter((f) => f.id === id)[0];
  return (
    <div class="m-eps-block" ref={listRef} data-episodes>
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
        {rows.map((r, i) => {
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
              <span class="m-ep-num">{r.numbers.length > 1 ? r.numbers[0] + '-' + r.numbers[r.numbers.length - 1] : r.numbers[0]}</span>
              <span class="m-ep-text">
                <span class="m-ep-name">{r.title.replace(/^\d+(?:-\d+)?\.\s*/, '')}{showSeason && r.season ? ' · ' + t('library.seasonNamed', { n: r.season }) : ''}</span>
                {started && leftMin > 0 && <span class="m-muted m-small">{t('library.left', { time: fmtDuration(leftMin) })}</span>}
                {started && (
                  <span class="m-bar-track thin">
                    <span class="m-bar-fill" style={{ width: Math.round(ratio * 100) + '%' }} />
                  </span>
                )}
              </span>
              {r.runtimeMin > 0 && <span class="m-ep-dur">{fmtDuration(r.runtimeMin)}</span>}
              {file && <span class="m-muted m-small m-ep-size">{fmtSize(file.length)}</span>}
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
