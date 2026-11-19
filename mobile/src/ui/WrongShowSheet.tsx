// «Не тот сериал?»: search TMDB and keep the show the person picks.
import { useEffect, useState } from 'preact/hooks';
import { t } from '../../../src/i18n';
import type { CatalogTitle } from '../../../src/catalog/tmdb';
import type { SeriesGroup } from '../../../src/lib/seriesGroups';
import { libraryTitle } from '../../../src/lib/libraryView';
import { chooseSeries } from '../../../src/lib/seriesMatch';
import { phoneCatalog } from '../catalog/phoneCatalog';
import { Sheet } from './Sheet';

export function WrongShowSheet({ group, onClose }: { group: SeriesGroup; onClose: () => void }) {
  const [q, setQ] = useState(libraryTitle(group.named).title);
  const [items, setItems] = useState<CatalogTitle[]>([]);
  const run = (query: string) => {
    phoneCatalog().then((c) => c.search(query, 1)).then(
      (r) => setItems(r.items.filter((x) => x.kind === 'tv')),
      () => undefined,
    );
  };
  useEffect(() => { run(q); }, []);
  return (
    <Sheet label={t('titleCard.wrongShow')} testId="wrong-show" onClose={onClose}>
      <div class="m-sheet-title">{t('titleCard.wrongShow')}</div>
      <form onSubmit={(e) => { e.preventDefault(); run(q); }}>
        <input class="m-input" value={q} onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} />
      </form>
      {items.map((it) => (
        <button key={it.id} type="button" class="m-opt" onClick={() => { void chooseSeries(group, it.id).then(() => onClose()); }}>
          <span class="m-opt-name">{it.title + (it.year ? ' (' + it.year + ')' : '')}</span>
        </button>
      ))}
    </Sheet>
  );
}
