// TV «Человек» (route 'person', from the cast row of a title card): the photo, the name, the job and the years, and the
// filmography as a poster grid like «Обзор». What the library has comes first, marked; OK opens it in «Мои» (else the
// title card), the yellow key puts a title on «Хочу посмотреть». The job (acting / directing), «В медиатеке» and the
// sort are chips above the grid.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { setFocus, doesFocusableExist } from '@noriginmedia/norigin-spatial-navigation';
import { t } from '../i18n';
import { activeCatalog } from '../catalog/activeCatalog';
import { catalogErrorCode, type CatalogErrorCode } from '../catalog/client';
import { filmography, personJobs, type FilmSort } from '../catalog/filmography';
import { libraryTargetOf, ownedChecker } from '../catalog/libraryTarget';
import type { Credit, PersonCard } from '../catalog/tmdb';
import { torrents } from '../store/library';
import { isWanted, wantAction } from '../store/wantList';
import { FocusGroup, Focusable, Button, Spinner } from '../ui/components';
import { useKeys } from '../ui/keys';
import { navigate } from '../ui/nav';
import { choose } from '../ui/dialog';
import { tvGlyphs } from '../ui/tvText';
import { focusedRow, keepRows, keepsImage, rowOf } from '../lib/gridWindow';
import { DISCOVER_COLS, ratingText } from './library/DiscoverGrid';
import { initials, routeOf } from './TitleCard';

/** The height of a row of posters with the title and the gap under it, px (as in «Обзор»). */
const ROW_PX = 380;
/** A biography longer than this gets «Ещё» even if the clamp does not cut it. */
const BIO_LONG = 300;

type Job = 'acting' | 'directing';

const tileKey = (c: Credit) => 'person-tile-' + c.kind + '-' + c.id;

/** «1970–2010» / «род. 1970» / ''. */
function yearsText(p: PersonCard): string {
  const from = p.birth.slice(0, 4);
  const to = p.death.slice(0, 4);
  if (from && to) return t('person.years', { from: from, to: to });
  if (from) return t('person.born', { date: from });
  return '';
}

/** «Актёр» / «Режиссёр» / «Создатель» (a director whose credits are all series). */
function jobText(p: PersonCard, job: Job): string {
  if (job === 'acting') return t('person.actor');
  return p.directing.length > 0 && p.directing.every((c) => c.kind === 'tv') ? t('person.creator') : t('person.director');
}

function Body({ card }: { card: PersonCard }) {
  const jobs = personJobs(card);
  const [job, setJob] = useState<Job>(jobs[0] || 'acting');
  const [sort, setSort] = useState<FilmSort>('popular');
  const [onlyOwned, setOnlyOwned] = useState(false);
  const [, setTick] = useState(0);
  const list = torrents.value;
  const owned = useMemo(() => ownedChecker(list), [list]);
  const items = useMemo(() => filmography(card, job, sort, owned, onlyOwned), [card, job, sort, owned, onlyOwned]);
  const focused = useRef<Credit | null>(null);
  const [focusRow, setFocusRow] = useState(0);
  const keep = keepRows(ROW_PX);
  const bioRef = useRef<HTMLDivElement>(null);
  const [bioCut, setBioCut] = useState(false);
  useEffect(() => {
    const el = bioRef.current;
    setBioCut(!!el && el.scrollHeight > el.clientHeight + 1);
  }, [card.bio]);
  const bioMore = !!card.bio && (bioCut || card.bio.length > BIO_LONG);

  useEffect(() => {
    // the first tile; «Все» when there is nothing to open
    const first = items[0];
    if (first && doesFocusableExist(tileKey(first.credit))) setFocus(tileKey(first.credit));
    else if (doesFocusableExist('person-filter-all')) setFocus('person-filter-all');
  }, []);

  useKeys((a) => {
    if (a !== 'yellow') return false;
    const c = focused.current;
    if (c) {
      wantAction(c);
      setTick((n) => n + 1);
    }
    return true;
  });

  const open = (c: Credit) => {
    const target = libraryTargetOf(list, c);
    navigate(target ? routeOf(target) : { name: 'title', kind: c.kind, id: c.id });
  };
  const leaveTile = () => {
    focused.current = null;
    setFocusRow(0);
  };
  const chip = (key: string, label: string, active: boolean, press: () => void) => (
    <Focusable focusKey={key} className={'disc-kind' + (active ? ' active' : '')} onPress={press} onFocused={leaveTile}>
      {tvGlyphs(label)}
    </Focusable>
  );

  const years = yearsText(card);
  return (
    <>
      <div class="person-head">
        <div class="person-photo">{card.photo ? <img src={card.photo} alt="" /> : <span class="tc-initials">{tvGlyphs(initials(card.name))}</span>}</div>
        <div class="person-info">
          <div class="person-crumb">{tvGlyphs(t('person.crumb'))}</div>
          <h1 class="person-name">{tvGlyphs(card.name)}</h1>
          <div class="person-job">{tvGlyphs(jobText(card, job))}</div>
          {years ? <div class="person-years">{tvGlyphs(years)}</div> : null}
          {card.bio ? (
            <div class="person-bio" ref={bioRef}>
              {tvGlyphs(card.bio)}
            </div>
          ) : null}
          {bioMore && (
            <Focusable focusKey="person-bio-more" className="person-more" role="button" onPress={() => choose(tvGlyphs(card.bio), [{ label: t('common.close'), value: true }])} onFocused={leaveTile}>
              {t('person.more')}
            </Focusable>
          )}
        </div>
      </div>
      <FocusGroup focusKey="PERSON-BAR" className="person-bar">
        {jobs.length > 1 && (
          <div class="disc-kinds">
            {chip('person-job-acting', t('person.acting'), job === 'acting', () => setJob('acting'))}
            {chip('person-job-directing', t('person.directing'), job === 'directing', () => setJob('directing'))}
          </div>
        )}
        <div class="disc-kinds">
          {chip('person-filter-all', t('person.all'), !onlyOwned, () => setOnlyOwned(false))}
          {chip('person-filter-owned', t('person.owned'), onlyOwned, () => setOnlyOwned(true))}
        </div>
        <Focusable
          focusKey="person-sort"
          className="disc-kind person-sort"
          role="button"
          onPress={() => setSort(sort === 'popular' ? 'year' : 'popular')}
          onFocused={leaveTile}
        >
          {tvGlyphs(t(sort === 'popular' ? 'person.sortPopular' : 'person.sortYear')) + ' ↕'}
        </Focusable>
      </FocusGroup>
      {items.length === 0 ? (
        <div class="empty">{onlyOwned ? tvGlyphs(t('person.ownedEmpty', { name: card.name })) : tvGlyphs(t('discover.nothingFound'))}</div>
      ) : (
        <FocusGroup focusKey="PERSON-GRID" className="disc-grid">
          {items.map((x, i) => {
            const c = x.credit;
            const meta = [c.year ? String(c.year) : '', c.roles.join(', ')].filter(Boolean).join(' · ');
            return (
              <Focusable
                key={c.kind + ':' + c.id}
                focusKey={tileKey(c)}
                className={'disc-tile' + (x.owned ? ' person-owned' : '')}
                ariaLabel={c.year ? c.title + ' ' + c.year : c.title}
                onPress={() => open(c)}
                onFocused={() => {
                  focused.current = c;
                  setFocusRow(rowOf(i, DISCOVER_COLS));
                }}
              >
                <div class="disc-poster">
                  {c.poster ? (keepsImage(i, focusRow, DISCOVER_COLS, keep) ? <img src={c.poster} alt="" /> : null) : <div class={'disc-ph disc-ph-' + (c.id % 4)}>{tvGlyphs(c.title)}</div>}
                  {c.rating > 0 && <span class="disc-rating">{ratingText(c.rating)}</span>}
                  {isWanted(c.kind, c.id) ? (
                    <span class="disc-mark disc-mark-want">{tvGlyphs(t('tv.discover.wantMark'))}</span>
                  ) : x.owned ? (
                    <span class="disc-mark">{tvGlyphs(t('discover.inLibrary'))}</span>
                  ) : null}
                </div>
                <div class="disc-title">{tvGlyphs(c.title)}</div>
                <div class="disc-meta">{tvGlyphs(meta)}</div>
              </Focusable>
            );
          })}
        </FocusGroup>
      )}
    </>
  );
}

export function PersonScreen(p: { id: number; name?: string }) {
  const [card, setCard] = useState<PersonCard | null>(null);
  const [error, setError] = useState<CatalogErrorCode | null>(null);
  const [reload, setReload] = useState(0);
  // answers of an older request (a retry) are dropped
  const gen = useRef(0);

  useEffect(() => {
    const my = ++gen.current;
    setCard(null);
    setError(null);
    activeCatalog()
      .then((c) => c.person(p.id))
      .then(
        (c) => {
          if (gen.current === my) setCard(c);
        },
        (e) => {
          if (gen.current === my) setError(catalogErrorCode(e));
        },
      );
  }, [p.id, reload]);

  useEffect(() => {
    if (error && doesFocusableExist('person-retry')) setFocus('person-retry');
  }, [error]);

  return (
    <FocusGroup focusKey="PERSON" className="screen person">
      {error ? (
        <div class="disc-error">
          <div class="catalog-off-title">{t('discover.offlineTitle')}</div>
          <div class="disc-error-text">{t(error === 'nokey' ? 'tv.discover.nokeyText' : 'tv.discover.offlineText')}</div>
          <FocusGroup focusKey="PERSON-ERROR" className="actions">
            <Button focusKey="person-retry" label={t('common.retry')} onPress={() => setReload((n) => n + 1)} />
          </FocusGroup>
        </div>
      ) : !card ? (
        <Spinner text={t('catalog.loading')} />
      ) : (
        <Body card={card} />
      )}
      <div class="hints">{tvGlyphs(t('person.hints'))}</div>
    </FocusGroup>
  );
}
