// «Обзор»: the sort sheet and the filters sheet (genre, year, country, minimum rating; the look of the release filters).
import { useState } from 'preact/hooks';
import { Sheet } from '../../ui/Sheet';
import { t, type Key } from '../../../../src/i18n';
import {
  DISCOVER_SORTS, DISCOVER_RATINGS, DISCOVER_COUNTRIES, DEFAULT_DISCOVER_QUERY, genresFor, sanitizeDiscoverQuery,
  type DiscoverQuery, type DiscoverSort, type DiscoverYear,
} from '../../../../src/catalog/discoverQuery';
import type { Filter } from './discoverCache';

const SORT_KEYS: { [s: string]: Key } = {
  popular: 'discover.sortPopular',
  rating: 'discover.sortRating',
  date: 'discover.sortDate',
  upcoming: 'discover.sortUpcoming',
  digitalSoon: 'discover.sortDigitalSoon',
};

export function sortName(s: DiscoverSort): string {
  return t(SORT_KEYS[s]);
}

export function genreName(id: string): string {
  return t(('discover.genres.' + id) as Key);
}

function countryName(code: string): string {
  return t(('discover.countries.' + code) as Key);
}

function Chip({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" class={'m-chip' + (on ? ' on' : '')} aria-pressed={on} onClick={onClick}>
      {label}
    </button>
  );
}

export function DiscoverSortSheet({ value, onPick, onClose }: { value: DiscoverSort; onPick: (s: DiscoverSort) => void; onClose: () => void }) {
  return (
    <Sheet label={t('discover.sort')} onClose={onClose}>
      <div class="m-sheet-title">{t('discover.sort')}</div>
      {DISCOVER_SORTS.map((s) => (
        <button
          key={s}
          type="button"
          class={'m-opt m-disc-sort-opt' + (s === value ? ' on' : '')}
          aria-pressed={s === value}
          onClick={() => onPick(s)}
        >
          <span class="m-opt-name">{sortName(s)}</span>
        </button>
      ))}
    </Sheet>
  );
}

function yearText(n: number): string {
  return n ? String(n) : '';
}

function parseYear(s: string): number {
  return /^\d{4}$/.test(s.trim()) ? +s.trim() : 0;
}

/** The filters are edited here and applied when the sheet closes (one request, not one per tap). */
export function DiscoverFiltersSheet({
  value,
  kind,
  onClose,
}: {
  value: DiscoverQuery;
  kind: Filter;
  onClose: (q: DiscoverQuery) => void;
}) {
  const [q, setQ] = useState<DiscoverQuery>(value);
  const [from, setFrom] = useState(yearText(value.from));
  const [to, setTo] = useState(yearText(value.to));
  const set = (patch: Partial<DiscoverQuery>) => setQ({ ...q, ...patch });
  const done = () => onClose(sanitizeDiscoverQuery({ ...q, from: parseYear(from), to: parseYear(to) }));
  // the kind's genres, and any chosen one of another kind (so it can be turned off)
  const genres = genresFor(kind).concat(q.genres.filter((g) => genresFor(kind).indexOf(g) < 0));
  const toggle = (g: string) => set({ genres: q.genres.indexOf(g) >= 0 ? q.genres.filter((x) => x !== g) : q.genres.concat(g) });
  const years: [DiscoverYear, Key][] = [['any', 'discover.yearAny'], ['this', 'discover.yearThis'], ['last', 'discover.yearLast'], ['range', 'discover.yearRange']];
  return (
    <Sheet label={t('filters.title')} onClose={done}>
      <div class="m-sheet-head">
        <div class="m-sheet-title">{t('filters.title')}</div>
        <button
          type="button"
          class="m-link-btn"
          onClick={() => {
            setQ({ ...DEFAULT_DISCOVER_QUERY, sort: q.sort });
            setFrom('');
            setTo('');
          }}
        >
          {t('common.reset')}
        </button>
      </div>
      <div class="m-sheet-scroll m-filters">
        <div class="m-filter-group" data-group="genre">
          <span class="m-filter-label">{t('discover.genre')}</span>
          <div class="m-chips" style={{ flexWrap: 'wrap' }}>
            {genres.map((g) => <Chip key={g} on={q.genres.indexOf(g) >= 0} label={genreName(g)} onClick={() => toggle(g)} />)}
          </div>
        </div>
        <div class="m-filter-group" data-group="year">
          <span class="m-filter-label">{t('discover.year')}</span>
          <div class="m-chips" style={{ flexWrap: 'wrap' }}>
            {years.map(([y, k]) => <Chip key={y} on={q.year === y} label={t(k)} onClick={() => set({ year: y })} />)}
          </div>
          {q.year === 'range' && (
            <div class="m-filter-size">
              <label>
                {t('filters.from')}
                <input inputMode="numeric" maxLength={4} value={from} placeholder="1990" onInput={(e) => setFrom((e.target as HTMLInputElement).value)} />
              </label>
              <label>
                {t('filters.to')}
                <input inputMode="numeric" maxLength={4} value={to} placeholder={String(new Date().getFullYear())} onInput={(e) => setTo((e.target as HTMLInputElement).value)} />
              </label>
            </div>
          )}
        </div>
        <div class="m-filter-group" data-group="country">
          <span class="m-filter-label">{t('discover.country')}</span>
          <div class="m-chips" style={{ flexWrap: 'wrap' }}>
            <Chip on={!q.country} label={t('discover.countryAny')} onClick={() => set({ country: '' })} />
            {DISCOVER_COUNTRIES.map((c) => <Chip key={c} on={q.country === c} label={countryName(c)} onClick={() => set({ country: c })} />)}
          </div>
        </div>
        <div class="m-filter-group" data-group="rating">
          <span class="m-filter-label">{t('discover.minRating')}</span>
          <div class="m-chips" style={{ flexWrap: 'wrap' }}>
            {DISCOVER_RATINGS.map((r) => <Chip key={r} on={q.rating === r} label={r ? r + '+' : t('discover.ratingAny')} onClick={() => set({ rating: r })} />)}
          </div>
        </div>
      </div>
      <button type="button" class="m-btn m-btn-primary" onClick={done}>
        {t('discover.show')}
      </button>
    </Sheet>
  );
}
