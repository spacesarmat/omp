// Search rows of one show and season share a heading, whichever language the tracker wrote.
// A known TMDB id groups them. Until the id arrives, the short title keeps its own heading.
import { parseEpisodeRange } from '../monitor/episodes';
import { releaseTitle } from './releaseRow';
import type { SourceResult } from './types';

export interface KnownShow {
  id: number;
  title: string;
  poster: string;
}

export interface TitleGroup {
  key: string;
  label: string;
  poster: string;
  rows: SourceResult[];
}

function httpPoster(show: KnownShow | undefined): string {
  return show && /^https?:\/\//i.test(show.poster || '') ? show.poster : '';
}

function groupOf(title: string, show: KnownShow | undefined): { key: string; label: string } {
  const s = releaseTitle(title);
  const localKey = (s.title + '|' + s.meta).toLowerCase();
  const localLabel = s.meta ? s.title + ' · ' + s.meta : s.title;
  if (!show || !show.id) return { key: localKey, label: localLabel };
  const range = parseEpisodeRange(title);
  if (range.season === undefined) return { key: localKey, label: localLabel };
  const span = range.seasonTo !== undefined ? range.season + '-' + range.seasonTo : String(range.season);
  const name = show.title || s.title;
  const head = s.meta ? s.meta.split(' · ')[0] : '';
  return { key: 'tv:' + show.id + ':' + span, label: head ? name + ' · ' + head : name };
}

/** Same short title, or the same TMDB show and season, becomes one heading. */
export function groupSameTitles(rows: SourceResult[], known?: { [title: string]: KnownShow | undefined }): TitleGroup[] {
  const out: TitleGroup[] = [];
  const at: { [k: string]: number } = {};
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const title = r.Title || '';
    const show = known ? known[title] : undefined;
    const g = groupOf(title, show);
    const found = at[g.key];
    if (found === undefined) {
      at[g.key] = out.length;
      out.push({ key: g.key, label: g.label, poster: httpPoster(show), rows: [r] });
    } else {
      out[found].rows.push(r);
      if (!out[found].poster) out[found].poster = httpPoster(show);
    }
  }
  return out;
}
