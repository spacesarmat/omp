// The TV's announced episodes after the last one here (the series and the torrent screens): dashed muted rows
// «S02E08 Пирамида · выйдет 8 окт.» shaped like the file rows, plain divs the focus never reaches, no OK.
import { comingEpisodeDate, comingEpisodeTitle, type ComingEpisode } from '../lib/episodeNames';
import { tvGlyphs } from './tvText';

const pad = (n: number) => (n < 10 ? '0' : '') + n;

export function ComingRows({ list, now }: { list: ComingEpisode[]; now: number }) {
  return (
    <>
      {list.map((e) => (
        <div key={'coming-' + e.season + '-' + e.episode} class="list-item file-row ep-row ep-coming" data-coming={e.season + ':' + e.episode} aria-disabled="true">
          <span class="ep">{'S' + pad(e.season) + 'E' + pad(e.episode)}</span>
          <span class="name">{tvGlyphs(comingEpisodeTitle(e))}</span>
          <span class="size">{tvGlyphs(comingEpisodeDate(e, now))}</span>
          <span class="check" />
        </div>
      ))}
    </>
  );
}
