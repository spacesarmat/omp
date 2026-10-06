// «Обзор» → the TV card of a film or a series (route 'title'): the TMDB hero (backdrop, poster, title, original title,
// status pill, year · rating · seasons or runtime · genres, overview), «Найти раздачи», «Хочу посмотреть» (the TV list
// fills it in) and «Открыть в медиатеке» when the library has the title. A series has a row of season chips: released
// ones search for that season, the library's open the series screen on it, seasons to come are dashed with their date.
// Below: the cast. Back returns to «Обзор» on the same poster (the library screen restores the focus).
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { setFocus, doesFocusableExist } from '@noriginmedia/norigin-spatial-navigation';
import { t, tp, fmtDuration } from '../i18n';
import { activeCatalog } from '../catalog/activeCatalog';
import { catalogErrorCode, type CatalogErrorCode } from '../catalog/client';
import { libraryIndex, inLibrary, seasonIndex, librarySeasonHash } from '../catalog/library';
import { torrentQuery, type CatalogCard, type Kind, type Person } from '../catalog/tmdb';
import type { Torrent } from '../api/types';
import { torrents } from '../store/library';
import { isWanted, wantAction } from '../store/wantList';
import { findGroup, seriesKey } from '../lib/seriesGroups';
import { airDateText, seriesPill } from '../lib/seriesStatus';
import { FocusGroup, Focusable, Button, Spinner } from '../ui/components';
import { restoreFocus, scrollToShow } from '../ui/focus';
import { navigate, type Route } from '../ui/nav';
import { tvGlyphs } from '../ui/tvText';
import { seasonPlan } from './Series';
import { SeriesPill } from './library/SeriesTile';
import { ratingText } from './library/DiscoverGrid';

/** People shown in the cast row. */
export const CAST_MAX = 8;

/** Inner margin of the rows that scroll sideways: a focused item keeps this much room to the row's edge. */
const ROW_PAD = 24;

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** «2025 · 2 сезона · Ужасы, Фантастика» / «2025 · 1 ч 58 мин · Драма» (the rating is shown apart). */
export function titleMeta(card: CatalogCard): string[] {
  const seasons = card.seasons.filter((s) => s.number > 0).length;
  const genres = card.genres.slice(0, 2).map(capital).join(', ');
  return [
    card.year ? String(card.year) : '',
    card.kind === 'tv' ? (seasons ? tp('series.seasons', seasons) : '') : card.runtime > 0 ? fmtDuration(card.runtime) : '',
    genres,
  ].filter(Boolean);
}

/** «СЧ» for «Сидни Чандлер»: the first letters of the first two words. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
}

/** The library screen of a torrent: its series screen (on `season` when given) for a series, else the torrent. */
function openTarget(list: Torrent[], tor: Torrent, season?: number): Route {
  const key = seriesKey(tor);
  const g = key ? findGroup(list, key) : null;
  if (g) return season ? { name: 'series', key: g.key, season: season } : { name: 'series', key: g.key };
  return { name: 'torrent', hash: tor.hash };
}

/** Where «Открыть в медиатеке» goes; null when the library has nothing of the title. */
export function libraryTarget(list: Torrent[], card: CatalogCard): Route | null {
  if (card.kind === 'tv') {
    const idx = seasonIndex(list);
    const numbers = card.seasons.map((s) => s.number).sort((a, b) => b - a);
    for (let i = 0; i < numbers.length; i++) {
      const hash = librarySeasonHash(idx, card, numbers[i]);
      const tor = hash ? list.filter((x) => x.hash === hash)[0] : undefined;
      if (tor) return openTarget(list, tor);
    }
  }
  const hit = list.filter((x) => inLibrary(libraryIndex([x]), card))[0];
  return hit ? openTarget(list, hit) : null;
}

interface Chip {
  n: number;
  name: string;
  sub: string;
  state: 'library' | 'missing' | 'future';
  hash: string;
}

/** The season chips of a series: the library's, the released ones it lacks and the ones still to come. */
export function seasonChips(card: CatalogCard, list: Torrent[], now: number): Chip[] {
  const idx = seasonIndex(list);
  const have: { [n: number]: string } = {};
  const library: number[] = [];
  card.seasons.forEach((s) => {
    const hash = s.number > 0 ? librarySeasonHash(idx, card, s.number) : '';
    if (hash) {
      have[s.number] = hash;
      library.push(s.number);
    }
  });
  const plan = seasonPlan(card, library, now);
  const numbers = library.concat(plan.missing, plan.future.map((u) => u.number)).sort((a, b) => a - b);
  // the season on air: the newest one with episodes out (a season announced after it does not count)
  const latest = card.seasons.reduce((m, s) => (s.aired > 0 ? Math.max(m, s.number) : m), 0);
  return numbers.map((n) => {
    const s = card.seasons.filter((x) => x.number === n)[0];
    const name = s && s.year ? t('tv.title.seasonYear', { n: n, year: s.year }) : t('library.season', { n: n });
    const soon = plan.future.filter((u) => u.number === n)[0];
    if (soon) {
      return { n: n, name: name, sub: soon.airDate ? t('tv.title.comes', { date: airDateText(soon.airDate, now) }) : t('tv.title.announced'), state: 'future', hash: '' };
    }
    const airing = !!s && card.airing && n === latest && s.aired < s.episodes;
    const count = airing ? t('titleCard.airing', { a: s.aired, b: s.episodes }) : s && s.episodes ? tp('library.episodes', s.episodes) : '';
    if (have[n]) return { n: n, name: name, sub: [count, t('tv.title.inLibrary')].filter(Boolean).join(' · '), state: 'library', hash: have[n] };
    return { n: n, name: name, sub: [count, t('tv.title.findShort')].filter(Boolean).join(' · '), state: 'missing', hash: '' };
  });
}

/** A row that does not wrap: it scrolls sideways so the focused item is whole. */
function showInRow(row: HTMLElement | null, key: string): void {
  const el = row ? (row.querySelector('[data-fk="' + key + '"]') as HTMLElement | null) : null;
  if (!row || !el) return;
  row.scrollLeft = scrollToShow(row.scrollLeft, row.clientWidth, el.offsetLeft, el.offsetWidth, ROW_PAD);
}

function CastRow({ cast }: { cast: Person[] }) {
  const rowRef = useRef<HTMLDivElement>(null);
  return (
    <section class="tc-section">
      <h2 class="tc-h2">{t('titleCard.cast')}</h2>
      <div class="tc-scroll" ref={rowRef}>
        <FocusGroup focusKey="TITLE-CAST" className="tc-cast-row">
          {cast.slice(0, CAST_MAX).map((p, i) => (
            <Focusable key={i} focusKey={'title-cast-' + i} className="tc-person" onFocused={() => showInRow(rowRef.current, 'title-cast-' + i)}>
              <div class="tc-photo">{p.photo ? <img src={p.photo} alt="" /> : <span class="tc-initials">{tvGlyphs(initials(p.name))}</span>}</div>
              <div class="tc-person-name">{tvGlyphs(p.name)}</div>
              {p.role ? <div class="tc-person-role">{tvGlyphs(p.role)}</div> : null}
            </Focusable>
          ))}
        </FocusGroup>
      </div>
    </section>
  );
}

export interface TitleWantProps {
  /** The title is on the TV «Хочу посмотреть» list (the TV list by default). */
  wanted?: (kind: Kind, id: number) => boolean;
  /** «Хочу посмотреть» / «В списке» pressed (toggles the TV list by default). */
  onWant?: (card: CatalogCard) => void;
}

function Body({ card, want }: { card: CatalogCard; want: TitleWantProps }) {
  const list = torrents.value;
  const now = Date.now();
  const target = useMemo(() => libraryTarget(list, card), [list, card]);
  const chips = useMemo(() => (card.kind === 'tv' ? seasonChips(card, list, now) : []), [list, card]);
  const seasonsRef = useRef<HTMLDivElement>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    restoreFocus('title-find');
  }, []);

  const find = (season?: number) => navigate({ name: 'add', query: torrentQuery(card, season), run: true });
  const pressChip = (c: Chip) => {
    if (c.state === 'missing') find(c.n);
    else if (c.state === 'library') {
      const tor = list.filter((x) => x.hash === c.hash)[0];
      if (tor) navigate(openTarget(list, tor, c.n));
    }
  };
  const wanted = (want.wanted || isWanted)(card.kind, card.id);
  const pressWant = () => {
    (want.onWant || wantAction)(card);
    setTick((n) => n + 1); // the list may have changed: the label follows
  };

  const pill = seriesPill(card, now);
  const meta = titleMeta(card);
  const original = card.original && card.original !== card.title ? card.original : '';

  return (
    <>
      <div class={'series-hero tc-hero' + (card.backdrop ? ' with-backdrop' : '')}>
        {card.backdrop ? (
          <div class="series-backdrop">
            <img src={card.backdrop} alt="" />
            <div class="series-shade" />
          </div>
        ) : null}
        <div class="series-poster">
          {card.poster ? <img src={card.poster} alt="" /> : <div class={'disc-ph disc-ph-' + (card.id % 4)}>{tvGlyphs(card.title)}</div>}
        </div>
        <div class="series-info">
          <h1>{tvGlyphs(card.title)}</h1>
          {original ? <div class="tc-original">{tvGlyphs(original)}</div> : null}
          <div class="tc-meta">
            {pill ? <SeriesPill pill={pill} inline /> : null}
            {meta.length ? <span>{meta[0]}</span> : null}
            {card.rating > 0 ? <span class="tc-rating">{ratingText(card.rating)}</span> : null}
            {meta.slice(1).map((m, i) => (
              <span key={i}>{tvGlyphs(m)}</span>
            ))}
          </div>
          {card.overview ? <p class="series-overview">{tvGlyphs(card.overview)}</p> : null}
          <FocusGroup focusKey="TITLE-ACTIONS" className="row series-actions" preferredChildFocusKey="title-find">
            <Button focusKey="title-find" label={t('titleCard.findTorrents')} onPress={() => find()} />
            <Button focusKey="title-want" label={wanted ? t('tv.title.inList') : '★ ' + t('titleCard.want')} onPress={pressWant} />
            {target ? <Button focusKey="title-open" label={t('titleCard.openInLibrary')} onPress={() => navigate(target)} /> : null}
          </FocusGroup>
        </div>
      </div>
      {chips.length > 0 && (
        <section class="tc-section">
          <h2 class="tc-h2">{t('titleCard.seasons')}</h2>
          <div class="series-seasons" ref={seasonsRef}>
            <FocusGroup focusKey="TITLE-SEASONS" className="series-seasons-row">
              {chips.map((c) => (
                <Focusable
                  key={c.n}
                  focusKey={'title-season-' + c.n}
                  className={'season-chip tc-chip tc-chip-' + c.state + (c.state === 'future' ? ' chip-future' : '')}
                  role="button"
                  onPress={() => pressChip(c)}
                  onFocused={() => showInRow(seasonsRef.current, 'title-season-' + c.n)}
                >
                  <div class="chip-name">{c.name}</div>
                  <div class="chip-sub">{c.sub}</div>
                </Focusable>
              ))}
            </FocusGroup>
          </div>
        </section>
      )}
      {card.cast.length > 0 && <CastRow cast={card.cast} />}
    </>
  );
}

export function TitleCardScreen(p: { kind: Kind; id: number } & TitleWantProps) {
  const [card, setCard] = useState<CatalogCard | null>(null);
  const [error, setError] = useState<CatalogErrorCode | null>(null);
  const [reload, setReload] = useState(0);
  // answers of an older request (a retry) are dropped
  const gen = useRef(0);

  useEffect(() => {
    const my = ++gen.current;
    setCard(null);
    setError(null);
    activeCatalog()
      .then((c) => c.card(p.kind, p.id))
      .then(
        (c) => {
          if (gen.current === my) setCard(c);
        },
        (e) => {
          if (gen.current === my) setError(catalogErrorCode(e));
        },
      );
  }, [p.kind, p.id, reload]);

  useEffect(() => {
    if (error && doesFocusableExist('title-retry')) setFocus('title-retry');
  }, [error]);

  return (
    <FocusGroup focusKey="TITLE" className="screen title-card">
      {error ? (
        <div class="disc-error">
          <div class="catalog-off-title">{t('discover.offlineTitle')}</div>
          <div class="disc-error-text">{t(error === 'nokey' ? 'tv.discover.nokeyText' : 'tv.discover.offlineText')}</div>
          <FocusGroup focusKey="TITLE-ERROR" className="actions">
            <Button focusKey="title-retry" label={t('common.retry')} onPress={() => setReload((n) => n + 1)} />
          </FocusGroup>
        </div>
      ) : !card ? (
        <Spinner text={t('catalog.loading')} />
      ) : (
        <Body card={card} want={{ wanted: p.wanted, onWant: p.onWant }} />
      )}
      <div class="hints">
        {t('tv.title.hintOk')} · {t('tv.title.hintDown')} · {t('tv.title.hintBack')}
      </div>
    </FocusGroup>
  );
}
