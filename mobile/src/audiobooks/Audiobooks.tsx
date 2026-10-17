// «Аудиокниги»: search and the books already added. The rows match the simplified Settings screen.
import { t } from '../../../src/i18n';
import { navigate } from '../nav';
import { Icon } from '../ui/Icon';
import { AudiobookBar } from './bar';

const CHEVRON = 'M9 6l6 6l-6 6';

export function Audiobooks() {
  return (
    <div class="m-screen" data-route="audiobooks">
      <AudiobookBar title={t('audiobooks.title')} />
      <section class="m-set-group">
        <button type="button" class="m-set-row m-set-pick" data-row="audiobook-search" onClick={() => navigate({ name: 'audiobookSearch' })}>
          <span class="m-set-text">
            <span>{t('audiobooks.find')}</span>
            <span class="m-muted m-small">{t('audiobooks.findHint')}</span>
          </span>
          <Icon d={CHEVRON} size={20} />
        </button>
        <button type="button" class="m-set-row m-set-pick" data-row="audiobook-mine" onClick={() => navigate({ name: 'audiobookMine' })}>
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
