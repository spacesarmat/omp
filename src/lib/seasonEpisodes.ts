// Episode rows of one season: a combined file is one row, a TMDB episode with no file is shown as missing.
import { t } from '../i18n';
import { fileEpisodes } from './categoryCheck';

export interface SeasonEpFile {
  id: number;
  path: string;
  length: number;
}

export interface SeasonEpTitle {
  episode: number;
  title: string;
  runtime: number;
}

export interface SeasonEpModel {
  key: string;
  fileId: number | null;
  numbers: number[];
  season: number | null;
  title: string;
  missing: boolean;
  runtimeMin: number;
}

function titleOf(n: number, tmdb: SeasonEpTitle[]): string {
  const row = tmdb.filter((e) => e.episode === n)[0];
  return row && row.title ? row.title : '';
}

function runtimeOf(numbers: number[], tmdb: SeasonEpTitle[]): number {
  let sum = 0;
  numbers.forEach((n) => {
    const row = tmdb.filter((e) => e.episode === n)[0];
    if (row && row.runtime > 0) sum += row.runtime;
  });
  return sum;
}

/** Rows in episode order. `season` 0 keeps files that name no season. */
export function seasonEpisodeModels(files: SeasonEpFile[], season: number, tmdb: SeasonEpTitle[]): SeasonEpModel[] {
  const covered: number[] = [];
  const rows: SeasonEpModel[] = [];
  files.forEach((f) => {
    const parsed = fileEpisodes(f.path);
    if (!parsed || !parsed.episodes.length) return;
    const fileSeason = parsed.season;
    if (season > 0 && parsed.season !== null && parsed.season !== season) return;
    if (season > 0 && parsed.season === null) return;
    parsed.episodes.forEach((n) => {
      if (covered.indexOf(n) < 0) covered.push(n);
    });
    const a = parsed.episodes[0];
    const b = parsed.episodes[parsed.episodes.length - 1];
    const name = titleOf(a, tmdb);
    const label = (a === b ? String(a) : a + '-' + b) + '. ' + (name || '');
    rows.push({
      key: 'f' + f.id,
      fileId: f.id,
      numbers: parsed.episodes.slice(),
      season: fileSeason,
      title: label.trim(),
      missing: false,
      runtimeMin: runtimeOf(parsed.episodes, tmdb),
    });
  });
  tmdb.forEach((ep) => {
    if (covered.indexOf(ep.episode) >= 0) return;
    rows.push({
      key: 'm' + ep.episode,
      fileId: null,
      numbers: [ep.episode],
      season: null,
      title: ep.episode + '. ' + (ep.title || '') + ' - ' + t('series.notInRelease'),
      missing: true,
      runtimeMin: ep.runtime > 0 ? ep.runtime : 0,
    });
  });
  rows.sort((a, b) => a.numbers[0] - b.numbers[0]);
  return rows;
}

/** Watched episodes (a finished combined file counts each episode it holds) and the season total. */
export function watchedCount(rows: SeasonEpModel[], ratio: (fileId: number) => number): { have: number; total: number } {
  let have = 0;
  let numbered = 0;
  rows.forEach((r) => {
    if (r.missing) return;
    numbered += r.numbers.length;
    if (r.fileId !== null && ratio(r.fileId) >= 0.9) have += r.numbers.length;
  });
  const announced = rows.reduce((n, r) => n + (r.missing ? 1 : 0), 0) + numbered;
  return { have, total: announced };
}
