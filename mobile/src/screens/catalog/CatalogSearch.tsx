// «Поиск» → «Каталог»: TMDB titles as you type (the field is the search screen's), and a way on to the trackers with
// the same query.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { t, lang } from '../../../../src/i18n';
import { navigate } from '../../nav';
import { torrents } from '../../../../src/store/library';
import { catalogErrorCode, type CatalogErrorCode } from '../../../../src/catalog/client';
import { libraryIndex, inLibrary } from '../../../../src/catalog/library';
import type { CatalogTitle } from '../../../../src/catalog/tmdb';
import { phoneCatalog } from '../../catalog/phoneCatalog';
import { CatalogError } from './CatalogError';
import { PosterButton } from '../../share/PosterButton';

const DEBOUNCE_MS = 400;
const MIN_CHARS = 2;

export function ratingText(r: number): string {
  const s = r.toFixed(1);
  return '★ ' + (lang.peek() === 'en' ? s : s.replace('.', ','));
}

// the last results: back from a title card opened from them they come back at once, without a new request
let kept: { q: string; items: CatalogTitle[] } | null = null;

/** Tests: forget the kept results. */
export function resetCatalogResults(): void {
  kept = null;
}

export function CatalogResults({ text, onTrackers }: { text: string; onTrackers: (q: string) => void }) {
  const q = text.trim();
  const [items, setItems] = useState<CatalogTitle[] | null>(() => (kept && kept.q === q ? kept.items : null));
  // kept results are shown as is: the first run of the search effect skips the request
  const restored = useRef(!!(kept && kept.q === q));
  const [error, setError] = useState<CatalogErrorCode | null>(null);
  const [reload, setReload] = useState(0);
  const gen = useRef(0);
  // only the search started by «Повторить» skips the debounce; typing debounces again
  const instant = useRef(false);
  // the first search of a visit and «Повторить» read the server's TMDB settings again
  const fresh = useRef(true);
  const list = torrents.value;
  const index = useMemo(() => libraryIndex(list), [list]);

  useEffect(() => {
    if (restored.current) {
      restored.current = false;
      return;
    }
    const my = ++gen.current;
    setError(null);
    if (q.length < MIN_CHARS) {
      setItems(null);
      return;
    }
    const timer = setTimeout(() => {
      const reread = fresh.current;
      fresh.current = false;
      phoneCatalog(reread)
        .then((c) => c.search(q, 1))
        .then(
          (r) => {
            if (gen.current !== my) return;
            kept = { q, items: r.items };
            setItems(r.items);
          },
          (e) => {
            if (gen.current === my) setError(catalogErrorCode(e));
          },
        );
    }, instant.current ? 0 : DEBOUNCE_MS);
    instant.current = false;
    return () => clearTimeout(timer);
  }, [q, reload]);

  return (
    <div class="m-discover m-srch">
      {q.length < MIN_CHARS && <p class="m-muted m-small">{t('nav.searchTypeMore')}</p>}
      {error ? (
        <CatalogError
          code={error}
          onRetry={() => {
            fresh.current = true;
            instant.current = true;
            setReload((n) => n + 1);
          }}
        />
      ) : items && items.length === 0 ? (
        <p class="m-muted">{t('discover.nothingFound')}</p>
      ) : (
        items && (
          <div class="m-srch-list">
            {items.map((x) => (
              <PosterButton
                key={x.kind + ':' + x.id}
                item={x}
                className="m-srch-row"
                label={x.year ? x.title + ' ' + x.year : x.title}
                onOpen={() => navigate({ name: 'title', kind: x.kind, id: x.id })}
              >
                {x.poster ? (
                  <img class="m-srch-poster" src={x.poster} alt="" width={64} height={92} loading="lazy" />
                ) : (
                  <span class="m-srch-poster m-srch-ph" />
                )}
                <span class="m-srch-info">
                  <span class="m-card-title">{x.title}</span>
                  <span class="m-muted m-small">
                    {(x.year ? x.year + ' · ' : '') + (x.kind === 'tv' ? t('discover.series') : t('library.movie'))}
                  </span>
                  {x.rating > 0 && <span class="m-small m-srch-rating">{ratingText(x.rating)}</span>}
                  {inLibrary(index, x) && <span class="m-small m-srch-lib">{t('discover.inLibrary')}</span>}
                </span>
              </PosterButton>
            ))}
          </div>
        )
      )}
      {q.length >= MIN_CHARS && !error && items && (
        <div class="m-srch-trackers">
          <span class="m-muted">{t('discover.trackerAsk')}</span>
          <button type="button" class="m-btn m-btn-secondary" onClick={() => onTrackers(q)}>
            {t('discover.trackerSearch', { q })}
          </button>
        </div>
      )}
    </div>
  );
}
