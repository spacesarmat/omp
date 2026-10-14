import { t } from '../../../../src/i18n';
import { Sheet } from '../../ui/Sheet';

/** A sheet of poster variants. The chosen one is marked. */
export function PosterSheet({
  urls,
  current,
  onPick,
  onClose,
}: {
  urls: string[];
  current: string;
  onPick: (url: string) => void;
  onClose: () => void;
}) {
  return (
    <Sheet onClose={onClose} label={t('titleCard.pickPoster')}>
      <h2>{t('titleCard.pickPoster')}</h2>
      {urls.length ? (
        <div class="m-art-grid">
          {urls.map((u) => (
            <button key={u} type="button" class={'m-art-pick' + (u === current ? ' on' : '')} onClick={() => onPick(u)}>
              <img src={u} alt="" />
            </button>
          ))}
        </div>
      ) : (
        <p class="m-small m-muted">{t('titleCard.noPosters')}</p>
      )}
    </Sheet>
  );
}
