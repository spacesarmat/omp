import { it, expect } from 'vitest';
import { filmography, personJobs } from '../../src/catalog/filmography';
const credit = (id: number, over = {}) => ({ kind: 'movie', id, title: 'T' + id, original: 'T' + id, year: 2000 + id, poster: 'p', rating: 7, popularity: id, roles: ['R'], genreIds: [18], date: (2000 + id) + '-01-01', ...over });
const P = { id: 1, name: 'N', photo: '', birth: '', death: '', bio: '', known: 'acting', acting: [credit(1), credit(2), credit(3, { genreIds: [10767] }), credit(4, { poster: '' })], directing: [] };
it('drops talk/news/reality, owned first, then by popularity; no poster last', () => {
  const r = filmography(P as never, 'acting', 'popular', (c) => c.id === 1, false);
  expect(r.map((x) => [x.credit.id, x.owned])).toEqual([[1, true], [2, false], [4, false]]);
});
it('by year: newest first after owned; onlyOwned keeps owned', () => {
  expect(filmography(P as never, 'acting', 'year', () => false, false).map((x) => x.credit.id)).toEqual([2, 1, 4]);
  expect(filmography(P as never, 'acting', 'year', (c) => c.id === 2, true).map((x) => x.credit.id)).toEqual([2]);
});
it('personJobs: the known department first, empty lists dropped', () => {
  expect(personJobs({ ...P, directing: [credit(9)], known: 'directing' } as never)).toEqual(['directing', 'acting']);
  expect(personJobs(P as never)).toEqual(['acting']);
});
