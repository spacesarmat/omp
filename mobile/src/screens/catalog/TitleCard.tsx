// «Обзор» → a film or series card: TMDB details, «Найти раздачи» (the whole title or one season) and «Хочу посмотреть».
// A series has its status pill («Выходит · следующая серия …») and season chips; the chosen season shows its episodes and «Найти раздачи на сезон» / «Открыть в медиатеке».
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { t, tp, fmtDuration } from '../../../../src/i18n';
import { airDateText } from '../../lib/seriesStatus';
import { SeriesPill } from '../../ui/SeriesPill';
import { goBack, navigate, currentRoute, type MRoute } from '../../nav';
import { Icon } from '../../ui/Icon';
import { torrents } from '../../../../src/store/library';
import { loadSubs, sameQuery } from '../../../../src/monitor/subs';
import { monitorVersion } from '../../monitor/ui';
import { WantSheet } from './WantSheet';
import { catalogErrorCode, type CatalogErrorCode } from '../../../../src/catalog/client';
import { seasonIndex, librarySeasonHash } from '../../../../src/catalog/library';
import { torrentQuery, type CatalogCard, type Kind, type Season, type SeasonDetails } from '../../../../src/catalog/tmdb';
import { phoneCatalog } from '../../catalog/phoneCatalog';
import { CatalogError } from './CatalogError';
import { ratingText } from './CatalogSearch';

const BACK = 'M15 5l-7 7l7 7';

/** The query of «Найти раздачи» and «Хочу посмотреть» for the whole title. */
export function wantQuery(card: CatalogCard): string {
  return torrentQuery(card);
}

function yearsText(card: CatalogCard): string {
  if (!card.year) return '';
  const end = card.seasons.reduce((m, s) => Math.max(m, s.year), 0);
  return !card.airing && end > card.year ? card.year + '–' + end : String(card.year);
}

/** «2026 · драма · 1 ч 58 мин»; series: «Сериал · 2024–2026 · фантастика». */
function metaText(card: CatalogCard): string {
  const genres = card.genres.slice(0, 2).join(', ');
  const parts =
    card.kind === 'tv'
      ? [t('discover.series'), yearsText(card), genres]
      : [card.year ? String(card.year) : '', genres, card.runtime > 0 ? fmtDuration(card.runtime) : ''];
  return parts.filter(Boolean).join(' · ');
}

// The chosen season of each open card (its route entry): kept through «Назад» from the screens opened over it.
const chosenSeason = new WeakMap<MRoute, number>();

/** The season shown first: the last one with aired episodes, else the first. */
export function defaultSeason(seasons: Season[]): number {
  let best = 0;
  let first = 0;
  seasons.forEach((s) => {
    if (!first || s.number < first) first = s.number;
    if (s.aired > 0 && s.number > best) best = s.number;
  });
  return best || first || 1;
}

/** The episodes of one season: a skeleton while loading, a small error with «Повторить», one overview open at a time. */
function SeasonEpisodes({ id, number }: { id: number; number: number }) {
  const [data, setData] = useState<SeasonDetails | null>(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [open, setOpen] = useState(0);
  const gen = useRef(0);
  useEffect(() => {
    const my = ++gen.current;
    setData(null);
    setFailed(false);
    setOpen(0);
    phoneCatalog()
      .then((c) => c.season(id, number))
      .then(
        (d) => {
          if (gen.current === my) setData(d);
        },
        () => {
          if (gen.current === my) setFailed(true);
        },
      );
  }, [id, number, reload]);

  if (failed) {
    return (
      <div class="m-tc-ep-error" role="alert">
        <span class="m-small m-muted">{t('titleCard.episodesError')}</span>
        <button type="button" class="m-btn m-btn-secondary m-btn-sm" onClick={() => setReload((n) => n + 1)}>
          {t('common.retry')}
        </button>
      </div>
    );
  }
  if (!data) {
    return (
      <div class="m-tc-episodes m-tc-skel" aria-busy="true">
        <span class="m-tc-ep-skel" />
        <span class="m-tc-ep-skel" />
        <span class="m-tc-ep-skel" />
      </div>
    );
  }
  if (!data.episodes.length) return <p class="m-small m-muted m-tc-ep-empty">{t('titleCard.noEpisodes')}</p>;
  return (
    <div class="m-tc-episodes">
      {data.episodes.map((e) => {
        const expanded = open === e.n && !!e.overview;
        const sub = [airDateText(e.airDate), e.runtime > 0 ? fmtDuration(e.runtime) : ''].filter(Boolean).join(' · ');
        return (
          <div key={e.n} class={'m-tc-ep' + (expanded ? ' open' : '')}>
            <button
              type="button"
              class="m-tc-ep-row"
              aria-expanded={e.overview ? expanded : undefined}
              onClick={() => {
                if (e.overview) setOpen(expanded ? 0 : e.n);
              }}
            >
              <span class="m-tc-ep-num">{e.n}</span>
              <span class="m-tc-ep-info">
                <span class="m-tc-ep-title">{e.title || t('library.episode', { n: e.n })}</span>
                {sub && <span class="m-small m-muted m-tc-ep-sub">{sub}</span>}
              </span>
            </button>
            {expanded && <p class="m-small m-tc-ep-overview">{e.overview}</p>}
          </div>
        );
      })}
    </div>
  );
}

/** Season chips (specials are not listed: the card has no season 0) and the chosen season below them. */
function Seasons({ card, index, find }: { card: CatalogCard; index: Map<string, string>; find: (season?: number) => void }) {
  const route = useMemo(() => currentRoute.peek(), []);
  const chips = useMemo(() => card.seasons.slice().sort((a, b) => a.number - b.number), [card]);
  const remembered = chosenSeason.get(route);
  const [chosen, setChosen] = useState(
    remembered && chips.some((x) => x.number === remembered) ? remembered : defaultSeason(chips),
  );
  const chipsRef = useRef<HTMLDivElement>(null);
  // the chosen chip in view (a long series opens on its last seasons)
  useLayoutEffect(() => {
    const row = chipsRef.current;
    const on = row ? (row.querySelector('.m-chip.on') as HTMLElement | null) : null;
    if (row && on) row.scrollLeft = Math.max(0, on.offsetLeft - (row.clientWidth - on.offsetWidth) / 2);
  }, []);
  const pick = (n: number) => {
    setChosen(n);
    chosenSeason.set(route, n);
  };
  const s = chips.filter((x) => x.number === chosen)[0] || chips[chips.length - 1];
  const latest = chips[chips.length - 1].number;
  const hash = librarySeasonHash(index, card, s.number);
  const airing = card.airing && s.number === latest && s.aired < s.episodes;
  const sub = [s.year ? String(s.year) : '', s.episodes ? tp('library.episodes', s.episodes) : ''].filter(Boolean).join(' · ');
  const state = airing ? t('titleCard.airing', { a: s.aired, b: s.episodes }) : hash ? t('discover.inLibrary') : '';
  return (
    <section class="m-tc-section">
      <h2>{t('titleCard.seasons')}</h2>
      <div class="m-chips m-tc-chips" ref={chipsRef}>
        {chips.map((x) => (
          <button
            key={x.number}
            type="button"
            class={'m-chip' + (x.number === s.number ? ' on' : '')}
            aria-pressed={x.number === s.number}
            onClick={() => pick(x.number)}
          >
            {t('library.season', { n: x.number })}
          </button>
        ))}
      </div>
      <div class="m-tc-season">
        <span class="m-tc-season-name">{t('library.season', { n: s.number })}</span>
        {sub && <span class="m-small m-muted m-tc-season-sub">{sub}</span>}
        {state && <span class="m-small m-tc-season-state">{state}</span>}
      </div>
      <div class="m-tc-season-actions">
        {hash ? (
          <>
            <button type="button" class="m-btn m-btn-primary" onClick={() => navigate({ name: 'torrent', hash: hash })}>
              {t('titleCard.openInLibrary')}
            </button>
            <button type="button" class="m-btn m-btn-secondary" onClick={() => find(s.number)}>
              {t('titleCard.findTorrents')}
            </button>
          </>
        ) : (
          <button type="button" class="m-btn m-btn-primary" onClick={() => find(s.number)}>
            {t('titleCard.findSeason')}
          </button>
        )}
      </div>
      <SeasonEpisodes key={s.number} id={card.id} number={s.number} />
    </section>
  );
}

function Overview({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [clamped, setClamped] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  // «Ещё» only when the text does not fit in its 4 lines
  useLayoutEffect(() => {
    const node = ref.current;
    if (node && !open) setClamped(node.scrollHeight > node.clientHeight + 1);
  }, [text, open]);
  return (
    <div class="m-tc-about">
      <p ref={ref} class={'m-tc-overview' + (open ? ' open' : '')}>
        {text}
      </p>
      {(clamped || open) && (
        <button type="button" class="m-btn-text m-tc-more" onClick={() => setOpen(!open)}>
          {open ? t('now.collapse') : t('titleCard.more')}
        </button>
      )}
    </div>
  );
}

function Body({ card }: { card: CatalogCard }) {
  const list = torrents.value;
  const index = useMemo(() => seasonIndex(list), [list]);
  const query = wantQuery(card);
  const [wanting, setWanting] = useState(false);
  // re-read after «Хочу посмотреть» subscribes (reloadMonitor bumps the version)
  void monitorVersion.value;
  const following = loadSubs().some((s) => sameQuery(s.query, query));
  const find = (season?: number) => navigate({ name: 'add', query: torrentQuery(card, season), run: true });
  return (
    <>
      <div class="m-tc-head">
        {card.poster ? (
          <img class="m-tc-poster" src={card.poster} alt="" width={110} height={165} />
        ) : (
          <span class={'m-tc-poster m-disc-ph m-disc-ph-' + (card.id % 4)} aria-hidden="true" />
        )}
        <div class="m-tc-info">
          <h1 class="m-tc-title">{card.title}</h1>
          <span class="m-muted m-small m-tc-meta">{metaText(card)}</span>
          {card.kind === 'tv' && <SeriesPill card={card} />}
          {card.rating > 0 && <span class="m-tc-rating">{ratingText(card.rating) + ' TMDB'}</span>}
        </div>
      </div>
      <div class="m-tc-actions">
        <button type="button" class="m-btn m-btn-primary" onClick={() => find()}>
          {t('titleCard.findTorrents')}
        </button>
        {following ? (
          <button type="button" class="m-btn m-btn-secondary" onClick={() => navigate({ name: 'news', seg: 'subs' })}>
            {t(card.kind === 'tv' ? 'titleCard.followingSeries' : 'titleCard.followingMovie')}
          </button>
        ) : (
          <button type="button" class="m-btn m-btn-secondary" onClick={() => setWanting(true)}>
            {t('titleCard.want')}
          </button>
        )}
      </div>
      {wanting && <WantSheet card={card} onClose={() => setWanting(false)} />}
      {card.overview && <Overview text={card.overview} />}
      {card.cast.length > 0 && (
        <section class="m-tc-section">
          <h2>{t('titleCard.cast')}</h2>
          <div class="m-tc-cast">
            {card.cast.map((p, i) => (
              <div key={i} class="m-tc-person">
                {p.photo ? (
                  <img src={p.photo} alt="" width={64} height={64} loading="lazy" />
                ) : (
                  <span class="m-tc-initial" aria-hidden="true">
                    {p.name.charAt(0).toUpperCase()}
                  </span>
                )}
                <span class="m-small m-tc-person-name">{p.name}</span>
                {p.role && <span class="m-small m-muted m-tc-person-name">{p.role}</span>}
              </div>
            ))}
          </div>
        </section>
      )}
      {card.kind === 'tv' && card.seasons.length > 0 && <Seasons card={card} index={index} find={find} />}
    </>
  );
}

export function TitleCard({ kind, id }: { kind: Kind; id: number }) {
  const [card, setCard] = useState<CatalogCard | null>(null);
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
      .then((c) => c.card(kind, id))
      .then(
        (c) => {
          if (gen.current === my) setCard(c);
        },
        (e) => {
          if (gen.current === my) setError(catalogErrorCode(e));
        },
      );
  }, [kind, id, reload]);

  return (
    <div class="m-screen m-tc" data-route="title">
      <div class="m-tc-backdrop">
        {card && card.backdrop && <img src={card.backdrop} alt="" />}
        <button type="button" class="m-icon-btn m-tc-back" aria-label={t('common.back')} onClick={() => goBack()}>
          <Icon d={BACK} />
        </button>
      </div>
      <div class="m-tc-body">
        {error ? (
          <CatalogError
            code={error}
            onRetry={() => {
              fresh.current = true;
              setReload((n) => n + 1);
            }}
          />
        ) : !card ? (
          <div class="m-tc-head m-tc-skel" aria-busy="true">
            <span class="m-tc-poster" />
            <div class="m-tc-info">
              <span class="m-disc-skel-line" />
              <span class="m-disc-skel-line" />
            </div>
          </div>
        ) : (
          <Body card={card} />
        )}
      </div>
    </div>
  );
}
