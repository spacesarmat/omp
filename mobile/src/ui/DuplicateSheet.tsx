// After an add: the new release duplicates one already in «Мои». The worse one may go — the old one through
// «Заменить» (its watch history moves to the new one), the new one simply removed.
import { useState } from 'preact/hooks';
import { fmtSize, t } from '../../../src/i18n';
import { client } from '../../../src/store/servers';
import { qualityLabel } from '../../../src/monitor/quality';
import { shortTitle } from '../../../src/lib/libraryView';
import { displayTitle } from '../../../src/lib/torrentName';
import { dropWorse, dupOffer } from '../lib/duplicates';
import { deleteTorrents, reportDeleted } from '../lib/torrentActions';
import { Sheet } from './Sheet';
import { showToast } from './toast';

export function DuplicateSheet() {
  const offer = dupOffer.value;
  const [busy, setBusy] = useState(false);
  if (!offer) return null;
  const close = () => {
    dupOffer.value = null;
    setBusy(false);
  };
  const oldQ = qualityLabel(displayTitle(offer.old));
  const newQ = qualityLabel(displayTitle(offer.fresh));
  const text =
    offer.drop === 'old'
      ? t('series.dupOldWorse', {
          title: shortTitle(displayTitle(offer.old)),
          quality: oldQ,
          size: fmtSize(offer.old.torrent_size || 0),
          fresh: newQ,
        }).replace(/\s+/g, ' ')
      : t('series.dupNewWorse', { quality: oldQ });
  const drop = async () => {
    const c = client.value;
    if (!c || busy) return;
    setBusy(true);
    if (offer.drop === 'old') {
      const r = await dropWorse(c, offer.old, offer.fresh);
      showToast(r.ok ? t('series.dupDone', { quality: newQ }) : r.error);
    } else {
      reportDeleted(await deleteTorrents(c, [offer.fresh.hash]));
    }
    close();
  };
  return (
    <Sheet label={t('series.dupTitle')} onClose={close}>
      <div class="m-sheet-title">{t('series.dupTitle')}</div>
      <p class="m-dup-text">{text}</p>
      <div class="m-sheet-actions">
        <button type="button" class="m-btn m-btn-primary" disabled={busy} onClick={() => void drop()}>
          {offer.drop === 'old' ? t('series.dupDropOld') : t('series.dupDropNew')}
        </button>
        <button type="button" class="m-btn m-btn-secondary" disabled={busy} onClick={close}>
          {t('series.dupKeepBoth')}
        </button>
      </div>
    </Sheet>
  );
}
