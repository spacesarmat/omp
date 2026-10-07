// «Человек» (from the cast of a title card): the photo, the name, the job and the years, and the filmography as a poster
// grid like «Обзор». What the library has comes first, marked; a tap opens it in «Мои» (else the title card).
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { t } from '../../../../src/i18n';
import { catalogErrorCode, type CatalogErrorCode } from '../../../../src/catalog/client';
import { filmography, personJobs, type FilmSort } from '../../../../src/catalog/filmography';
import { libraryTargetOf, ownedChecker } from '../../../../src/catalog/libraryTarget';
import type { Credit, PersonCard } from '../../../../src/catalog/tmdb';
import { torrents } from '../../../../src/store/library';
import { phoneCatalog, setCatalogMode, type CatalogMode } from '../../catalog/phoneCatalog';
import { goBack, navigate, switchTab, type MRoute } from '../../nav';
import { Icon, ICONS } from '../../ui/Icon';
import { CatalogError } from './CatalogError';
import { ratingText } from './CatalogSearch';
import { TileTitle, TileWhen } from './Discover';
import { Overview } from './TitleCard';
import { readDiscoverCols } from './discoverCols';

const BACK = 'M15 5l-7 7l7 7';

type Job = 'acting' | 'directing';

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

function routeOf(list: Parameters<typeof libraryTargetOf>[0], c: Credit): MRoute {
  const target = libraryTargetOf(list, c);
  if (!target) return { name: 'title', kind: c.kind, id: c.id };
  if (target.kind === 'torrent') return { name: 'torrent', hash: target.hash };
  return target.season ? { name: 'series', key: target.key, season: target.season } : { name: 'series', key: target.key };
}

function Segment({ items, value }: { items: { id: string; label: string; press: () => void }[]; value: string }) {
  return (
    <div class="m-disc-chips" role="group">
      {items.map((x) => (
        <button key={x.id} type="button" class={'m-hfilter' + (value === x.id ? ' on' : '')} aria-pressed={value === x.id} onClick={x.press}>
          {x.label}
        </button>
      ))}
    </div>
  );
}

/** The «Мои / Обзор» switch of «Каталог» with «Обзор» on: a tap opens that mode's root. */
function ModeSwitch() {
  const go = (m: CatalogMode) => {
    setCatalogMode(m);
    switchTab({ name: 'library' });
  };
  return (
    <div class="m-lib-head m-person-switch">
      <div class="m-seg" role="tablist" aria-label={t('nav.library')}>
        {(['mine', 'discover'] as const).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={m === 'discover'} class={'m-seg-btn' + (m === 'discover' ? ' on' : '')} onClick={() => go(m)}>
            {m === 'mine' ? t('discover.mine') : t('discover.browse')}
          </button>
        ))}
      </div>
    </div>
  );
}

function Body({ card }: { card: PersonCard }) {
  const jobs = personJobs(card);
  const [job, setJob] = useState<Job>(jobs[0] || 'acting');
  const [sort, setSort] = useState<FilmSort>('popular');
  const [onlyOwned, setOnlyOwned] = useState(false);
  const list = torrents.value;
  const owned = useMemo(() => ownedChecker(list), [list]);
  const items = useMemo(() => filmography(card, job, sort, owned, onlyOwned), [card, job, sort, owned, onlyOwned]);
  const cols = readDiscoverCols();
  const gridClass = 'm-disc-grid' + (cols === 3 ? ' m-cols-3' : cols === 4 ? ' m-cols-3 m-cols-4' : '');
  const years = yearsText(card);
  return (
    <>
      <div class="m-person-head">
        {card.photo ? (
          <img class="m-person-photo" src={card.photo} alt="" width={96} height={96} />
        ) : (
          <span class="m-person-photo m-tc-initial" aria-hidden="true">
            {card.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join('')}
          </span>
        )}
        <div class="m-person-info">
          <h2 class="m-person-name">{card.name}</h2>
          <span class="m-small m-muted m-person-job">{[jobText(card, jobs[0] || 'acting'), years].filter(Boolean).join(' · ')}</span>
        </div>
      </div>
      {card.bio && <Overview text={card.bio} />}
      {jobs.length > 1 && (
        <Segment
          value={job}
          items={[
            { id: 'acting', label: t('person.acting'), press: () => setJob('acting') },
            { id: 'directing', label: t('person.directing'), press: () => setJob('directing') },
          ]}
        />
      )}
      <div class="m-person-filters">
        <Segment
          value={onlyOwned ? 'owned' : 'all'}
          items={[
            { id: 'all', label: t('person.all'), press: () => setOnlyOwned(false) },
            { id: 'owned', label: t('person.owned'), press: () => setOnlyOwned(true) },
          ]}
        />
        <button
          type="button"
          class="m-icon-btn m-sort"
          aria-label={t('discover.sortAria', { name: sort === 'year' ? t('person.sortYear') : t('person.sortPopular') })}
          onClick={() => setSort(sort === 'year' ? 'popular' : 'year')}
        >
          <Icon d={ICONS.sort} size={20} />
        </button>
      </div>
      {items.length === 0 ? (
        <p class="m-muted m-disc-empty">{onlyOwned ? t('person.ownedEmpty', { name: card.name }) : t('discover.nothingFound')}</p>
      ) : (
        <div class={gridClass}>
          {items.map((x) => {
            const c = x.credit;
            return (
              <button
                key={c.kind + ':' + c.id}
                data-anchor={c.kind + ':' + c.id}
                type="button"
                class={'m-disc-tile' + (x.owned ? ' m-person-owned' : '')}
                aria-label={c.year ? c.title + ' ' + c.year : c.title}
                onClick={() => navigate(routeOf(list, c))}
              >
                <span class="m-disc-poster">
                  {c.poster ? <img src={c.poster} alt="" loading="lazy" /> : <span class={'m-disc-ph m-disc-ph-' + (c.id % 4)}>{c.title}</span>}
                  {c.rating > 0 && <span class="m-disc-rating">{ratingText(c.rating)}</span>}
                  {x.owned && <span class="m-disc-badge">{t('person.owned')}</span>}
                </span>
                <span class="m-card-title m-disc-title">
                  <TileTitle x={c} />
                </span>
                <span class="m-muted m-small m-disc-meta m-person-roles">{c.roles.join(', ')}</span>
                <TileWhen kind={c.kind} id={c.id} />
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

export function Person({ id, label }: { id: number; label?: string }) {
  const [card, setCard] = useState<PersonCard | null>(null);
  const [error, setError] = useState<CatalogErrorCode | null>(null);
  const [reload, setReload] = useState(0);
  // «Повторить» reads the server's TMDB settings again; answers of an older request are dropped
  const fresh = useRef(false);
  const gen = useRef(0);

  useEffect(() => {
    const my = ++gen.current;
    setCard(null);
    setError(null);
    const reread = fresh.current;
    fresh.current = false;
    phoneCatalog(reread)
      .then((c) => c.person(id))
      .then(
        (c) => {
          if (gen.current === my) setCard(c);
        },
        (e) => {
          if (gen.current === my) setError(catalogErrorCode(e));
        },
      );
  }, [id, reload]);

  return (
    <div class="m-screen m-person m-library" data-route="person">
      <div class="m-bar">
        <button type="button" class="m-icon-btn" aria-label={t('common.back')} onClick={() => goBack()}>
          <Icon d={BACK} />
        </button>
      </div>
      <ModeSwitch />
      {error ? (
        <CatalogError
          code={error}
          onRetry={() => {
            fresh.current = true;
            setReload((n) => n + 1);
          }}
        />
      ) : !card ? (
        <div class="m-disc-grid" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} class="m-disc-tile m-disc-skel" aria-hidden="true">
              <span class="m-disc-poster" />
              <span class="m-disc-skel-line" />
            </div>
          ))}
        </div>
      ) : (
        <Body card={card} />
      )}
    </div>
  );
}
