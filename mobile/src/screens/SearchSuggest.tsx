// TMDB titles under the torrent search field. Picking one searches that title and year.
import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../../../src/i18n';
import type { CatalogTitle } from '../../../src/catalog/tmdb';
import { phoneCatalog } from '../catalog/phoneCatalog';

const DEBOUNCE_MS = 400;
const LIMIT = 6;

export function SearchSuggest({ query, onPick }: { query: string; onPick: (item: CatalogTitle) => void }) {
  const q = query.trim();
  const [items, setItems] = useState<CatalogTitle[]>([]);
  const gen = useRef(0);
  useEffect(() => {
    const my = ++gen.current;
    if (q.length < 2) {
      setItems([]);
      return;
    }
    const timer = setTimeout(() => {
      phoneCatalog(false).then(
        (c) => c.search(q, 1),
        () => null,
      ).then(
        (r) => {
          if (gen.current !== my) return;
          setItems(r && r.items ? r.items.slice(0, LIMIT) : []);
        },
        () => {
          if (gen.current === my) setItems([]);
        },
      );
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q]);
  if (!items.length) return null;
  return (
    <div class="m-srch-list" data-suggest="">
      {items.map((x) => (
        <button
          key={x.kind + ':' + x.id}
          type="button"
          class="m-srch-row"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(x)}
        >
          {x.poster ? <img class="m-srch-poster" src={x.poster} alt="" width={64} height={92} /> : <span class="m-srch-poster" />}
          <span class="m-srch-info">
            <span class="m-card-title">{x.title}</span>
            <span class="m-muted m-small">
              {(x.year ? String(x.year) + ' · ' : '') + (x.kind === 'tv' ? t('discover.series') : t('library.movie'))}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
