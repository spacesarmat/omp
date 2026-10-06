import { useState } from 'preact/hooks';
import { t, tp } from '../../../src/i18n';
import { Sheet } from './Sheet';
import { Icon } from './Icon';
import { navigate } from '../nav';
import { deleteTorrents, reportDeleted } from '../lib/torrentActions';
import { client } from '../../../src/store/servers';
import { libraryTitle } from '../../../src/lib/libraryView';
import type { SeriesGroup } from '../lib/seriesGroups';

const OPEN = 'M9 6l6 6-6 6';
const CHECK = 'M5 12.5l4.5 4.5L19 7';
const TRASH = 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3';

/** What a long press on a series card in «Мои» opens: open, select (all its torrents), delete the whole series. */
export function SeriesMenu({ group, onClose, onSelect }: { group: SeriesGroup; onClose: () => void; onSelect?: (hashes: string[]) => void }) {
  const [busy, setBusy] = useState(false);
  const title = libraryTitle(group.named).title;
  const n = group.members.length;
  const hashes = group.members.map((m) => m.hash);

  const remove = async () => {
    const c = client.value;
    if (!c || busy) return;
    if (!window.confirm(tp('library.deleteAsk', n))) return;
    setBusy(true);
    reportDeleted(await deleteTorrents(c, hashes));
    onClose();
  };

  return (
    <Sheet label={title} onClose={onClose}>
      <div class="m-sheet-title">{title}</div>
      <button
        type="button"
        class="m-opt"
        disabled={busy}
        onClick={() => {
          onClose();
          navigate({ name: 'series', key: group.key });
        }}
      >
        <Icon d={OPEN} size={22} />
        <span class="m-opt-name">{t('common.open')}</span>
      </button>
      {onSelect && (
        <button
          type="button"
          class="m-opt"
          disabled={busy}
          onClick={() => {
            onClose();
            onSelect(hashes);
          }}
        >
          <Icon d={CHECK} size={22} />
          <span class="m-opt-name">{t('library.select')}</span>
        </button>
      )}
      <button type="button" class="m-opt m-danger" disabled={busy} onClick={() => void remove()}>
        <Icon d={TRASH} size={22} />
        <span class="m-opt-name">{tp('series.deleteSeries', n)}</span>
      </button>
    </Sheet>
  );
}
