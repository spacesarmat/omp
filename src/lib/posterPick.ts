// «Сменить постер» on the phone and the TV: TMDB candidates for a torrent, a typed link, and the write to TorrServer.
// The poster lives in the torrent's `poster` field on TorrServer, so every OMP (phone, TV, webOS), the TorrServer page
// and Lampa see the same one. A film with several releases in «Мои» gets it on every release.
import type { Torrent } from '../api/types';
import type { CatalogTitle, Kind } from '../catalog/tmdb';
import { sharpPosterUrl } from '../catalog/tmdb';
import { yearOf } from '../catalog/library';
import { hostOf, isLanOrLocal } from '../../mobile/src/cleartextHosts';
import { titleCore } from './posterSearch';
import { displayTitle } from './torrentName';
import { attachPoster, posterKind, type PosterClient, type PosterDeps } from './autoPoster';
import { activeCatalog } from '../catalog/activeCatalog';
import { filmReleases } from '../../mobile/src/lib/filmGroups';
import { t, type Key } from '../i18n';

export const POSTER_URL_MAX = 2000;
/** How many search results the picker shows. */
export const CANDIDATES_MAX = 20;

export type PosterUrlCheck = { ok: true; url: string } | { ok: false; error: Key };

/**
 * A poster link typed or pasted by the user. https:// anywhere; http:// only on the home network (loopback, private,
 * .local), because the Android app refuses plain HTTP to other hosts and the poster would stay blank there.
 */
export function checkPosterUrl(raw: string): PosterUrlCheck {
  const s = (raw || '').trim();
  if (!s || /\s/.test(s) || /["'<>\\]/.test(s)) return { ok: false, error: 'torrent.poster.badUrl' };
  if (s.length > POSTER_URL_MAX) return { ok: false, error: 'torrent.poster.urlTooLong' };
  const m = /^(https?):\/\//i.exec(s);
  if (!m) return { ok: false, error: 'torrent.poster.badUrl' };
  let parsed: URL;
  try {
    parsed = new URL(s);
  } catch (e) {
    return { ok: false, error: 'torrent.poster.badUrl' };
  }
  const host = hostOf(s);
  if (!host || !parsed.hostname) return { ok: false, error: 'torrent.poster.badUrl' };
  if (m[1].toLowerCase() === 'http' && !isLanOrLocal(host)) return { ok: false, error: 'torrent.poster.httpPublic' };
  return { ok: true, url: s };
}

/** The search text the picker starts with: the title proper of the torrent's name. */
export function posterSearchText(tor: Torrent): string {
  const name = displayTitle(tor);
  return titleCore(name) || name.trim();
}

/** The year in the torrent's name (0 when none): its candidates of that year come first. */
export function posterYear(tor: Torrent): number {
  return yearOf(displayTitle(tor));
}

/**
 * Search results worth showing: with a poster, of the torrent's kind (a film among films, a series among series; all
 * of them when none matches the kind), the same year first, then a year off, then the rest in TMDB's order.
 */
export function posterCandidates(items: CatalogTitle[], kind: Kind | null, year: number): CatalogTitle[] {
  const withPoster = items.filter((x) => !!x.poster && (x.kind === 'movie' || x.kind === 'tv'));
  const ofKind = kind ? withPoster.filter((x) => x.kind === kind) : withPoster;
  const list = ofKind.length ? ofKind : withPoster;
  const rank = (x: CatalogTitle) => (!year || !x.year ? 2 : x.year === year ? 0 : Math.abs(x.year - year) === 1 ? 1 : 2);
  return list
    .map((x, i) => ({ x: x, i: i, r: rank(x) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((o) => o.x)
    .slice(0, CANDIDATES_MAX);
}

/** The kind to search for: what the background lookup would use. */
export function pickerKind(tor: Torrent): Kind | null {
  return posterKind(tor);
}

/** A TMDB poster is stored at the sharp size the cards draw; any other link as typed. */
export function storedPosterUrl(url: string): string {
  return sharpPosterUrl(url, 1);
}

export interface PosterWriter {
  get(hash: string): Promise<Torrent>;
  setPoster(t: Pick<Torrent, 'hash' | 'title' | 'category'> & { name?: string }, poster: string): Promise<void>;
}

export interface SaveResult {
  /** The hashes written. */
  saved: string[];
  /** How many writes failed. */
  failed: number;
}

/**
 * Writes `poster` ('' clears it) to every torrent of `list`, one after another. Each torrent is read again right
 * before its write, because TorrServer's `set` replaces the title and category too: the current ones go back (the
 * listed ones when the read fails). Rejects with the first error when no write succeeded.
 */
export function savePoster(c: PosterWriter, list: Torrent[], poster: string): Promise<SaveResult> {
  const saved: string[] = [];
  let failed = 0;
  let firstError: unknown = null;
  const step = (i: number): Promise<SaveResult> => {
    if (i >= list.length) {
      if (!saved.length && failed) return Promise.reject(firstError);
      return Promise.resolve({ saved: saved, failed: failed });
    }
    const tor = list[i];
    return c
      .get(tor.hash)
      .then(
        (cur) => (cur && cur.hash ? cur : tor),
        () => tor,
      )
      .then((cur) => c.setPoster({ hash: tor.hash, title: cur.title || tor.title, name: cur.name || tor.name, category: cur.category || tor.category }, poster))
      .then(
        () => {
          saved.push(tor.hash);
        },
        (e) => {
          failed++;
          if (firstError === null) firstError = e;
        },
      )
      .then(() => step(i + 1));
  };
  return step(0);
}

/**
 * «Сбросить (найти автоматически)»: clears the poster of every release, then looks one up for the first release
 * (as for a new torrent: a film by its year, a series among series) and gives the others the same one.
 * Resolves with the poster found, '' when none.
 */
export function resetPoster(c: PosterClient & PosterWriter, list: Torrent[], deps: PosterDeps = {}): Promise<string> {
  if (!list.length) return Promise.resolve('');
  const lead = list[0];
  return savePoster(c, list, '').then(() =>
    attachPoster(c, lead.hash, displayTitle(lead), { ...deps, tries: 1 }).then((found) => {
      if (!found || list.length < 2) return found;
      return savePoster(c, list.slice(1), found).then(
        () => found,
        () => found,
      );
    }),
  );
}

/** The toast after a save: all written, or «у 2 из 3 раздач». */
export function savedText(r: SaveResult, total: number): string {
  return r.failed ? t('torrent.poster.savedSome', { ok: r.saved.length, n: total }) : t('torrent.poster.saved');
}

/**
 * The torrents a poster choice is written to: `tor` first, then the other releases of the same film (one card in the
 * phone's «Мои», #210 groups); just `tor` for a series, music or a film with one release.
 */
export function posterTargets(list: Torrent[], tor: Torrent): Torrent[] {
  const all = filmReleases(list, tor);
  if (all.length < 2) return [tor];
  return [tor].concat(all.filter((x) => x.hash !== tor.hash));
}

/** TMDB titles for the picker: the catalog's search, filtered and ordered for `tor` (posterCandidates). */
export function searchCandidates(query: string, tor: Torrent): Promise<CatalogTitle[]> {
  const q = query.trim();
  if (!q) return Promise.resolve([]);
  return activeCatalog()
    .then((cat) => cat.search(q, 1))
    .then((r) => posterCandidates(r.items, pickerKind(tor), posterYear(tor)));
}

/** The part of a TMDB image URL after the size («/abc.jpg»), so the same poster at two sizes is one variant. */
function imagePath(url: string): string {
  const m = /\/t\/p\/[^/]+(\/.+)$/.exec(url);
  return m ? m[1] : url;
}

/** Poster variants of one title: its search poster first, then TMDB's images of it (the same picture once). */
export function titleVariants(item: CatalogTitle): Promise<string[]> {
  const first = item.poster ? [item.poster] : [];
  return activeCatalog()
    .then((cat) => cat.posters(item.kind, item.id))
    .then(
      (urls) => {
        const seen: { [p: string]: boolean } = {};
        const out: string[] = [];
        first.concat(urls).forEach((u) => {
          const k = imagePath(u);
          if (!u || seen[k]) return;
          seen[k] = true;
          out.push(u);
        });
        return out;
      },
      () => first,
    );
}
