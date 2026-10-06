// TV «Обзор»: the TMDB feed (films and series) with the kind switch, the sort and the filters (one choose() each),
// a title search, and the posters marked when already in the library. OK opens the title card.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { setFocus, doesFocusableExist, getCurrentFocusKey } from '@noriginmedia/norigin-spatial-navigation';
import { t, lang, type Key } from '../../i18n';
import { activeCatalog } from '../../catalog/activeCatalog';
import { catalogErrorCode, type CatalogErrorCode } from '../../catalog/client';
import { libraryIndex, inLibrary } from '../../catalog/library';
import type { CatalogTitle } from '../../catalog/tmdb';
import {
  DISCOVER_SORTS, DISCOVER_RATINGS, DISCOVER_COUNTRIES, genresFor, sanitizeDiscoverQuery, discoverQueryKey,
  type DiscoverQuery, type DiscoverSort, type DiscoverYear,
} from '../../catalog/discoverQuery';
import {
  loadTvDiscoverQuery, saveTvDiscoverQuery, readDiscoverState, saveDiscoverState,
  type DiscoverKind, type DiscoverFeed, type DiscoverSearch,
} from '../../store/discover';
import { torrents } from '../../store/library';
import { isWanted, wantAction, wantTitles } from '../../store/wantList';
import { FocusGroup, Focusable, Button, Spinner } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { choose } from '../../ui/dialog';
import { askText } from '../../ui/TextDialog';
import { useKeys } from '../../ui/keys';
import { navigate } from '../../ui/nav';
import { tvGlyphs } from '../../ui/tvText';
import { scrollToShow } from '../../ui/focus';
import { focusedRow, keepRows, keepsImage, rowOf } from '../../lib/gridWindow';

/** Posters per row (the CSS widths match). */
export const DISCOVER_COLS = 8;
/** The height of a row of posters with the title and the gap under it, px. */
const DISCOVER_ROW_PX = 380;
/** Inner margin of the chip bar: a focused chip keeps this much room to the bar's edge. */
const BAR_PAD = 24;

// every sort needs a label: a new DiscoverSort fails tsc here instead of t(undefined) on the TV
const SORT_KEYS: { [s in DiscoverSort]: Key } = {
  popular: 'discover.sortPopular',
  rating: 'discover.sortRating',
  date: 'discover.sortDate',
  upcoming: 'discover.sortUpcoming',
  digitalSoon: 'discover.sortDigitalSoon',
};

export function sortName(s: DiscoverSort): string {
  return t(SORT_KEYS[s]);
}

function genreName(id: string): string {
  return t(('discover.genres.' + id) as Key);
}

function countryName(code: string): string {
  return t(('discover.countries.' + code) as Key);
}

/** «★ 7,8» (a dot in English). */
export function ratingText(r: number): string {
  const s = r.toFixed(1);
  return '★ ' + (lang.peek() === 'en' ? s : s.replace('.', ','));
}

// the feed kinds select on focus; «Хочу» is a separate chip at the right end of the bar and selects on OK only,
// so the remote can always pass along the bar
function kinds(): { id: DiscoverKind; label: string }[] {
  return [
    { id: 'all', label: t('common.all') },
    { id: 'movie', label: t('category.movie') },
    { id: 'tv', label: t('category.tv') },
  ];
}

function yearName(q: DiscoverQuery): string {
  if (q.year === 'this') return t('discover.yearThis');
  if (q.year === 'last') return t('discover.yearLast');
  if (q.year === 'range') return (q.from ? String(q.from) : '') + '-' + (q.to ? String(q.to) : '');
  return t('tv.discover.any');
}

function genreLabel(q: DiscoverQuery): string {
  if (!q.genres.length) return t('tv.discover.any');
  return genreName(q.genres[0]) + (q.genres.length > 1 ? ' +' + (q.genres.length - 1) : '');
}

function ratingName(n: number): string {
  return n ? t('tv.discover.ratingFrom', { n: n }) : t('tv.discover.any');
}

/** The tiles of the last row start here. */
export function lastRowStart(n: number, cols: number = DISCOVER_COLS): number {
  return Math.max(0, n - (n % cols || cols));
}

export interface DiscoverGridProps {
  /** «Хочу посмотреть» mark of a title (the TV list by default). */
  wanted?: (kind: string, id: number) => boolean;
  /** Yellow key on a tile (adds to / removes from the TV list by default). */
  onWant?: (x: CatalogTitle) => void;
  /** Focus moved to an element of the tab. */
  onFocused?: () => void;
  /** Back: leave «Обзор» for the library. */
  onBack: () => void;
}

export function DiscoverGrid(p: DiscoverGridProps) {
  const [query, setQuery] = useState<DiscoverQuery>(loadTvDiscoverQuery);
  const qkey = discoverQueryKey(query);
  // back from a title card: the kind, the loaded pages and the open search come back as they were
  const kept = useMemo(() => {
    const k = readDiscoverState();
    return k && k.qkey === qkey ? k : null;
  }, []);
  // the kind of the TMDB feed; it stays while the «Хочу» list is shown
  const [kind, setKind] = useState<DiscoverKind>(kept ? kept.kind : 'all');
  const [isWant, setWant] = useState<boolean>(kept ? kept.want : false);
  const feedKind: DiscoverKind = kind;
  const wantedFn = p.wanted || isWanted;
  const [feed, setFeed] = useState<DiscoverFeed | null>(kept ? kept.feed : null);
  const [error, setError] = useState<CatalogErrorCode | null>(null);
  const [moreFailed, setMoreFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState<DiscoverSearch | null>(kept ? kept.search : null);
  const [searchError, setSearchError] = useState<CatalogErrorCode | null>(null);
  const restored = useRef(!!(kept && kept.feed));
  // the current request: answers of an older one (another kind, a retry) are dropped
  const gen = useRef(0);
  const searchGen = useRef(0);
  const moreBusy = useRef(false);
  const focusResults = useRef(false);
  const focused = useRef<CatalogTitle | null>(null);
  const list = torrents.value;
  const index = useMemo(() => libraryIndex(list), [list]);
  // the bar does not wrap: it scrolls sideways so the focused chip is whole, with a margin
  const barRef = useRef<HTMLDivElement>(null);
  const showChip = (key: string) => {
    const box = barRef.current;
    const el = box ? (box.querySelector('[data-fk="' + key + '"]') as HTMLElement | null) : null;
    if (!box || !el) return;
    box.scrollLeft = scrollToShow(box.scrollLeft, box.clientWidth, el.offsetLeft, el.offsetWidth, BAR_PAD);
  };
  // posters further than about 3 screens from the focused row are let go (webOS 4 memory)
  const [focusRow, setFocusRow] = useState(0);
  const rowRef = useRef(0);
  const setRow = (r: number) => {
    if (r === rowRef.current) return;
    rowRef.current = r;
    setFocusRow(r);
  };

  useEffect(() => {
    if (restored.current) {
      restored.current = false;
      return;
    }
    const my = ++gen.current;
    setFeed(null);
    setError(null);
    setMoreFailed(false);
    moreBusy.current = false;
    activeCatalog()
      .then((c) => c.discover(feedKind, query, 1))
      .then(
        (r) => {
          if (gen.current === my) setFeed({ items: r.items, page: 1, pages: r.pages });
        },
        (e) => {
          if (gen.current === my) setError(catalogErrorCode(e));
        },
      );
  }, [kind, qkey, reload]);

  useEffect(() => saveDiscoverState({ kind: kind, want: isWant, qkey: qkey, feed: feed, search: search }), [kind, isWant, qkey, feed, search]);

  useEffect(() => {
    if (!focusResults.current || !search || !search.items) return;
    focusResults.current = false;
    const first = search.items[0];
    if (first && doesFocusableExist(tileKey(first))) setFocus(tileKey(first));
  }, [search]);

  const loadMore = () => {
    if (!feed || moreBusy.current || feed.page >= feed.pages) return;
    const my = gen.current;
    const next = feed.page + 1;
    moreBusy.current = true;
    setMoreFailed(false);
    activeCatalog()
      .then((c) => c.discover(feedKind, query, next))
      .then(
        (r) => {
          if (gen.current !== my) return;
          moreBusy.current = false;
          setFeed((f) => {
            if (!f || f.page !== next - 1) return f;
            // a title already shown (the feed shifts between pages) is not repeated
            const seen: { [k: string]: boolean } = {};
            f.items.forEach((x) => { seen[x.kind + ':' + x.id] = true; });
            return { items: f.items.concat(r.items.filter((x) => !seen[x.kind + ':' + x.id])), page: next, pages: r.pages };
          });
        },
        () => {
          if (gen.current !== my) return;
          moreBusy.current = false;
          setMoreFailed(true);
        },
      );
  };

  /** New sort or filters: kept for the next launch, page 1 fetched again. */
  const applyQuery = (next: DiscoverQuery) => {
    const q = sanitizeDiscoverQuery(next);
    if (discoverQueryKey(q) === qkey) return;
    saveTvDiscoverQuery(q);
    setQuery(q);
  };

  const runSearch = (q: string) => {
    const my = ++searchGen.current;
    setSearchError(null);
    setSearch({ q: q, items: null });
    activeCatalog()
      .then((c) => c.search(q, 1))
      .then(
        (r) => {
          if (searchGen.current !== my) return;
          focusResults.current = true;
          setSearch({ q: q, items: r.items });
        },
        (e) => {
          if (searchGen.current === my) setSearchError(catalogErrorCode(e));
        },
      );
  };

  // a search left before its results came (Back to the header, a title card) is asked again, not shown spinning
  useEffect(() => {
    if (kept && kept.search && !kept.search.items) runSearch(kept.search.q);
  }, []);

  const askSearch = () => {
    askText(t('discover.searchLabel'), search ? search.q : '', t('add.search')).then((v) => {
      const q = (v || '').trim();
      if (q) runSearch(q);
    });
  };

  const resetSearch = () => {
    searchGen.current++;
    setSearch(null);
    setSearchError(null);
    if (doesFocusableExist('disc-find')) setFocus('disc-find');
  };

  const pickSort = (fromKey?: boolean) => {
    choose(t('discover.sort'), DISCOVER_SORTS.map((s) => ({ label: sortName(s), value: s })), query.sort).then((s) => {
      if (!s) return;
      applyQuery({ ...query, sort: s });
      // the blue key may have been pressed on a poster that the new feed replaces
      if (fromKey && doesFocusableExist('disc-sort')) setFocus('disc-sort');
    });
  };

  const pickGenre = () => {
    const ids = genresFor(feedKind);
    // a genre chosen under another kind stays in the list, so it can be turned off
    query.genres.forEach((g) => { if (ids.indexOf(g) < 0) ids.push(g); });
    const options = [{ label: t('discover.yearAny'), value: '' }].concat(ids.map((g) => ({ label: genreName(g), value: g })));
    choose(t('discover.genre'), options, query.genres.length ? query.genres[0] : '').then((g) => {
      if (g !== null) applyQuery({ ...query, genres: g ? [g] : [] });
    });
  };

  const pickYear = () => {
    const years: DiscoverYear[] = ['any', 'this', 'last'];
    const names = [t('discover.yearAny'), t('discover.yearThis'), t('discover.yearLast')];
    choose(t('discover.year'), years.map((y, i) => ({ label: names[i], value: y })), query.year).then((y) => {
      if (y) applyQuery({ ...query, year: y, from: 0, to: 0 });
    });
  };

  const pickCountry = () => {
    const options = [{ label: t('discover.countryAny'), value: '' }].concat(DISCOVER_COUNTRIES.map((c) => ({ label: countryName(c), value: c })));
    choose(t('discover.country'), options, query.country).then((c) => {
      if (c !== null) applyQuery({ ...query, country: c });
    });
  };

  const pickRating = () => {
    const options = DISCOVER_RATINGS.map((n) => ({ label: n ? t('tv.discover.ratingFrom', { n: n }) : t('discover.ratingAny'), value: n }));
    choose(t('discover.minRating'), options, query.rating).then((n) => {
      if (n !== null) applyQuery({ ...query, rating: n });
    });
  };

  useKeys((a) => {
    if (a === 'yellow') {
      const x = focused.current;
      if (x) {
        // a tile of the «Хочу» list leaves with the key: the focus goes to its neighbour
        const at = isWant ? wantTitles().findIndex((y) => y.kind === x.kind && y.id === x.id) : -1;
        if (p.onWant) p.onWant(x);
        else wantAction(x);
        if (isWant) {
          focused.current = null;
          setTimeout(() => {
            const cur = wantTitles();
            const k = cur.length ? tileKey(cur[Math.min(Math.max(0, at), cur.length - 1)]) : 'disc-kind-want';
            if (doesFocusableExist(k)) setFocus(k);
          }, 0);
        }
      }
      return true;
    }
    if (a === 'blue') {
      if (!isWant) pickSort(true);
      return true;
    }
    if (a === 'back') {
      if (search && !isWant) resetSearch();
      else p.onBack();
      return true;
    }
    return false;
  });

  const leaveTile = () => {
    focused.current = null;
    setRow(0);
    if (p.onFocused) p.onFocused();
  };
  /** A chip of the bar got the focus. */
  const onChip = (key: string) => () => {
    showChip(key);
    leaveTile();
  };

  /** A feed kind chip: leaves «Хочу» and shows that feed (with its open search, if any). */
  const pickKind = (k: DiscoverKind) => {
    setWant(false);
    setKind(k);
  };

  const dim = isWant ? ' dim' : '';
  /** The filters and the search do nothing under «Хочу». */
  const feedOnly = (f: () => void) => () => {
    if (!isWant) f();
  };

  const retry = () => {
    if (search) runSearch(search.q);
    else setReload((n) => n + 1);
  };

  const shown = isWant ? wantTitles() : search ? search.items : feed ? feed.items : null;
  const shownError = isWant ? null : search ? searchError : error;
  const keep = keepRows(DISCOVER_ROW_PX);
  // another list (kind, search, the want list, a new page): the window follows the focused poster where it is now
  const shownKeys = shown ? shown.map(tileKey) : [];
  const shownId = shownKeys.join('|');
  useEffect(() => {
    let cur = '';
    try {
      cur = getCurrentFocusKey() || '';
    } catch (e) {
      cur = '';
    }
    setRow(focusedRow(shownKeys, cur, DISCOVER_COLS));
  }, [shownId]);

  return (
    <div class="discover">
      <div class="disc-bar-box" ref={barRef}>
      <FocusGroup focusKey="DISC-BAR" className="disc-bar" preferredChildFocusKey={isWant ? 'disc-kind-want' : 'disc-kind-' + kind}>
        <div class="disc-kinds">
          {kinds().map((k) => (
            <Focusable
              key={k.id}
              focusKey={'disc-kind-' + k.id}
              className={'disc-kind' + (!isWant && kind === k.id ? ' active' : '')}
              onPress={() => pickKind(k.id)}
              onFocused={() => { pickKind(k.id); onChip('disc-kind-' + k.id)(); }}
            >
              {k.label}
            </Focusable>
          ))}
        </div>
        {/* under «Хочу» the filters stay in place, dimmed and inert, so the focus still passes along the bar */}
        <Focusable focusKey="disc-sort" className={'disc-btn disc-btn-sort' + dim} onPress={feedOnly(() => pickSort())} onFocused={onChip('disc-sort')}>
          {t('discover.sortAria', { name: sortName(query.sort) })}
        </Focusable>
        <Focusable focusKey="disc-genre" className={'disc-btn' + dim} onPress={feedOnly(pickGenre)} onFocused={onChip('disc-genre')}>
          {t('tv.discover.genreValue', { name: genreLabel(query) })}
        </Focusable>
        <Focusable focusKey="disc-year" className={'disc-btn' + dim} onPress={feedOnly(pickYear)} onFocused={onChip('disc-year')}>
          {t('tv.discover.yearValue', { name: yearName(query) })}
        </Focusable>
        <Focusable focusKey="disc-country" className={'disc-btn' + dim} onPress={feedOnly(pickCountry)} onFocused={onChip('disc-country')}>
          {t('tv.discover.countryValue', { name: query.country ? countryName(query.country) : t('tv.discover.anyCountry') })}
        </Focusable>
        <Focusable focusKey="disc-rating" className={'disc-btn' + dim} onPress={feedOnly(pickRating)} onFocused={onChip('disc-rating')}>
          {t('tv.discover.ratingValue', { name: ratingName(query.rating) })}
        </Focusable>
        <div class="spacer" />
        <Focusable focusKey="disc-find" className={'disc-btn disc-find' + dim} onPress={feedOnly(askSearch)} onFocused={onChip('disc-find')}>
          <Icon name="search" size={26} class="disc-find-icon" />
          {t('tv.discover.find')}
        </Focusable>
        <Focusable
          focusKey="disc-kind-want"
          className={'disc-kind disc-kind-want' + (isWant ? ' active' : '')}
          onPress={() => setWant(!isWant)}
          onFocused={onChip('disc-kind-want')}
        >
          {t('tv.want.tab')}
        </Focusable>
      </FocusGroup>
      </div>
      {isWant ? (
        <div class="disc-sub">{t('tv.want.subtitle')}</div>
      ) : search ? (
        <FocusGroup focusKey="DISC-SEARCH" className="disc-sub disc-results">
          <span class="disc-sub-text">{tvGlyphs(t('tv.discover.results', { q: search.q }))}</span>
          <Button focusKey="disc-reset" label={t('tv.discover.resetSearch')} onPress={resetSearch} onFocused={leaveTile} />
        </FocusGroup>
      ) : (
        <div class="disc-sub">{t('tv.discover.subtitle')}</div>
      )}
      {shownError ? (
        <div class="disc-error">
          <div class="catalog-off-title">{t('discover.offlineTitle')}</div>
          <div class="disc-error-text">{t(shownError === 'nokey' ? 'tv.discover.nokeyText' : 'tv.discover.offlineText')}</div>
          <FocusGroup focusKey="DISC-ERROR" className="actions">
            <Button focusKey="disc-retry" label={t('common.retry')} onPress={retry} onFocused={leaveTile} />
          </FocusGroup>
        </div>
      ) : !shown ? (
        <Spinner text={t('catalog.loading')} />
      ) : !shown.length ? (
        <div class="empty">{isWant ? t('tv.discover.wantEmpty') : t('discover.nothingFound')}</div>
      ) : (
        <FocusGroup focusKey="DISC-GRID" className="disc-grid">
          {shown.map((x, i) => (
            <Focusable
              key={x.kind + ':' + x.id}
              focusKey={tileKey(x)}
              className="disc-tile"
              ariaLabel={x.year ? x.title + ' ' + x.year : x.title}
              onPress={() => navigate({ name: 'title', kind: x.kind, id: x.id })}
              onFocused={() => {
                if (p.onFocused) p.onFocused();
                setRow(rowOf(i, DISCOVER_COLS));
                focused.current = x;
                if (!isWant && !search && i >= lastRowStart(shown.length)) loadMore();
              }}
            >
              <div class="disc-poster">
                {x.poster ? (keepsImage(i, focusRow, DISCOVER_COLS, keep) ? <img src={x.poster} alt="" /> : null) : <div class={'disc-ph disc-ph-' + (x.id % 4)}>{tvGlyphs(x.title)}</div>}
                {x.rating > 0 && <span class="disc-rating">{ratingText(x.rating)}</span>}
                {wantedFn(x.kind, x.id) ? (
                  <span class="disc-mark disc-mark-want">{t('tv.discover.wantMark')}</span>
                ) : inLibrary(index, x) ? (
                  <span class="disc-mark">{t('discover.inLibrary')}</span>
                ) : null}
              </div>
              <div class="disc-title">{tvGlyphs(x.title)}</div>
              <div class="disc-meta">{(x.year ? x.year + ' · ' : '') + (x.kind === 'tv' ? t('discover.series') : t('library.movie'))}</div>
            </Focusable>
          ))}
        </FocusGroup>
      )}
      {!isWant && !search && moreFailed && (
        <FocusGroup focusKey="DISC-MORE" className="disc-more">
          <span>{t('discover.pageFailed')}</span>
          <Button focusKey="disc-more-retry" label={t('common.retry')} onPress={loadMore} onFocused={leaveTile} />
        </FocusGroup>
      )}
    </div>
  );
}

function tileKey(x: CatalogTitle): string {
  return 'disc-' + x.kind + '-' + x.id;
}
