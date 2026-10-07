// A person's filmography for the person screen: talk, news and reality out, what the user has first, then by the sort.
import type { CatalogTitle, Credit, PersonCard } from './tmdb';
import { TV_EXCLUDED } from './discoverQuery';

export type FilmSort = 'popular' | 'year';

export function filmography(p: PersonCard, job: 'acting' | 'directing', sort: FilmSort, owned: (c: CatalogTitle) => boolean, onlyOwned: boolean): { credit: Credit; owned: boolean }[] {
  const list = (job === 'acting' ? p.acting : p.directing)
    .filter((c) => !c.genreIds.some((g) => TV_EXCLUDED.indexOf(g) >= 0))
    .map((c) => ({ credit: c, owned: owned(c) }))
    .filter((x) => !onlyOwned || x.owned);
  const key = (x: { credit: Credit }) => (sort === 'year' ? x.credit.date || '' : '');
  return list.sort((a, b) => {
    if (a.owned !== b.owned) return a.owned ? -1 : 1;
    if (!a.credit.poster !== !b.credit.poster) return a.credit.poster ? -1 : 1;
    if (sort === 'year' && key(a) !== key(b)) return key(a) < key(b) ? 1 : -1;
    return (b.credit.popularity || 0) - (a.credit.popularity || 0);
  });
}

/** The person's jobs that have credits, the known department first. */
export function personJobs(p: PersonCard): ('acting' | 'directing')[] {
  const order: ('acting' | 'directing')[] = p.known === 'directing' ? ['directing', 'acting'] : ['acting', 'directing'];
  return order.filter((j) => (j === 'acting' ? p.acting : p.directing).length > 0);
}
