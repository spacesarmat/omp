// «Не тот сериал?»: search TMDB and keep the show the person picks.
import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../../../src/i18n';
import { catalogErrorCode, catalogErrorKey } from '../../../src/catalog/client';
import type { CatalogTitle } from '../../../src/catalog/tmdb';
import type { SeriesGroup } from '../../../src/lib/seriesGroups';
import { libraryTitle } from '../../../src/lib/libraryView';
import { forgetEpisodeNames } from '../../../src/lib/episodeNames';
import { chooseSeries } from '../../../src/lib/seriesMatch';
import { phoneCatalog } from '../catalog/phoneCatalog';
import { Sheet } from './Sheet';

export function WrongShowSheet({ group, onClose }: { group: SeriesGroup; onClose: () => void }) {
  const [q, setQ] = useState(libraryTitle(group.named).title);
  const [items, setItems] = useState<CatalogTitle[]>([]);
  const [note, setNote] = useState(t('titleCard.wrongSearching'));
  const seq = useRef(0); // a repeated submit must not let the older answer overwrite the newer one
  const run = (query: string) => {
    const mine = ++seq.current;
    setNote(t('titleCard.wrongSearching'));
    phoneCatalog()
      .then((c) => c.search(query, 1))
      .then(
        (r) => {
          if (mine !== seq.current) return;
          const found = r.items.filter((x) => x.kind === 'tv');
          setItems(found);
          setNote(found.length ? '' : t('catalog.nothingFound'));
        },
        (e) => {
          if (mine !== seq.current) return;
          setItems([]);
          setNote(t(catalogErrorKey(catalogErrorCode(e), 'phone')));
        },
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
        <button key={it.id} type="button" class="m-opt" onClick={() => { forgetEpisodeNames(group.members.map((m) => m.hash)); void chooseSeries(group, it.id).then(() => onClose()); }}>
          <span class="m-opt-name">{it.title + (it.year ? ' (' + it.year + ')' : '')}</span>
        </button>
      ))}
      {note && <p class="m-small m-muted">{note}</p>}
    </Sheet>
  );
}
