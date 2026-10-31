// The TV's announced episodes after the last one here (the series and the torrent screens): dashed muted rows
// the focus never reaches, no OK. The torrent screen keeps the file-row shape («S02E08 Пирамида», «выйдет 8 окт.»).
// The series screen (`lines`) matches its episode rows: a number badge, the title, then the length and the date.
import { fmtDuration } from '../i18n';
import { comingEpisodeDate, comingEpisodeTitle, type ComingEpisode } from '../lib/episodeNames';
import { joinMeta } from '../lib/torrentStatus';
import { tvGlyphs } from './tvText';
import { scrollIntoViewSafe } from './focus';

/**
 * The focus never reaches these rows, so the screen does not scroll to them by itself: when the last real row takes
 * the focus, bring the announced rows after it into view too (after the focus scroll of that row).
 */
export function revealComing(season?: number | null): void {
  setTimeout(() => {
    const rows = document.querySelectorAll(season === undefined || season === null ? '.ep-coming' : '.ep-coming[data-coming^="' + season + ':"]');
    const last = rows.length ? (rows[rows.length - 1] as HTMLElement) : null;
    // the same scroll as a focused row: clear of the hint band at the bottom
    if (last) scrollIntoViewSafe(last);
  }, 60);
}

const pad = (n: number) => (n < 10 ? '0' : '') + n;

export function ComingRows({ list, now, lines, runtime }: { list: ComingEpisode[]; now: number; lines?: boolean; runtime?: (e: ComingEpisode) => number }) {
  return (
    <>
      {list.map((e) => {
        const date = tvGlyphs(comingEpisodeDate(e, now));
        const title = tvGlyphs(comingEpisodeTitle(e));
        if (!lines) {
          return (
            <div key={'coming-' + e.season + '-' + e.episode} class="list-item file-row ep-row ep-coming" data-coming={e.season + ':' + e.episode} aria-disabled="true">
              <span class="ep">{'S' + pad(e.season) + 'E' + pad(e.episode)}</span>
              <span class="name">{title}</span>
              <span class="size">{date}</span>
              <span class="check" />
            </div>
          );
        }
        const mins = runtime ? runtime(e) : 0;
        const dur = mins > 0 ? fmtDuration(mins) : '';
        const when = joinMeta([date]);
        return (
          <div key={'coming-' + e.season + '-' + e.episode} class="list-item ep-row ep-coming" data-coming={e.season + ':' + e.episode} aria-disabled="true">
            <span class="ep ep-num">{String(e.episode)}</span>
            <span class="ep-main">
              <span class="name">{title}</span>
              <span class="ep-sub">
                {dur && when ? dur + ' · ' : ''}
                <span class="size">{when || joinMeta([dur])}</span>
              </span>
            </span>
            <span class="check" />
          </div>
        );
      })}
    </>
  );
}
