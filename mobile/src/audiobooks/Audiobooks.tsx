// «Аудиокниги»: search and the books already added. The rows match the simplified Settings screen.
import { t } from '../../../src/i18n';
import { navigate } from '../nav';
import { Icon } from '../ui/Icon';
import { AudiobookBar } from './bar';
import { useHint } from '../ui/Hint';

const CHEVRON = 'M9 6l6 6l-6 6';

export function Audiobooks() {
  useHint('audiobooks');
  return (
    <div class="m-screen" data-route="audiobooks">
      <AudiobookBar title={t('audiobooks.title')} code="P28.1" />
      <section class="m-set-group" data-hint-anchor="audiobooks">
        <button type="button" class="m-set-row m-set-pick tm" data-code="P28.2" data-row="audiobook-search" onClick={() => navigate({ name: 'audiobookSearch' })}>
          <span class="m-set-text">
            <span>{t('audiobooks.find')}</span>
            <span class="m-muted m-small">{t('audiobooks.findHint')}</span>
          </span>
          <Icon d={CHEVRON} size={20} />
        </button>
        <button type="button" class="m-set-row m-set-pick tm" data-code="P28.3" data-row="audiobook-mine" onClick={() => navigate({ name: 'audiobookMine' })}>
          <span class="m-set-text">
            <span>{t('audiobooks.mine')}</span>
            <span class="m-muted m-small">{t('audiobooks.mineHint')}</span>
          </span>
          <Icon d={CHEVRON} size={20} />
        </button>
      </section>
    </div>
  );
}
