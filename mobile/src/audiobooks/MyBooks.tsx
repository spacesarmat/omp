// «Мои книги»: torrents added with the audiobook category.
import { categoryOf } from '../../../src/lib/category';
import { libraryTitle } from '../../../src/lib/libraryView';
import { t } from '../../../src/i18n';
import { torrents } from '../../../src/store/library';
import { navigate } from '../nav';
import { Icon } from '../ui/Icon';
import { AudiobookBar } from './bar';

const CHEVRON = 'M9 6l6 6l-6 6';

export function MyBooks() {
  const books = torrents.value
    .filter((tor) => categoryOf(tor.category) === 'audiobook')
    .slice()
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  return (
    <div class="m-screen" data-route="audiobook-mine">
      <AudiobookBar title={t('audiobooks.mine')} code="P30.1" />
      {books.length === 0 ? (
        <section class="m-set-group">
          <p class="m-muted m-note" data-empty="mine">
            {t('audiobooks.emptyMine')}
          </p>
          <p class="m-muted m-small">{t('audiobooks.emptyMineHint')}</p>
          <button type="button" class="m-btn m-btn-primary" onClick={() => navigate({ name: 'audiobookSearch' })}>
            {t('audiobooks.find')}
          </button>
        </section>
      ) : (
        <section class="m-set-group" data-books="">
          {books.map((tor) => {
            const name = libraryTitle(tor);
            return (
              <button
                key={tor.hash}
                type="button"
                class="m-set-row m-set-pick"
                data-book={tor.hash}
                onClick={() => navigate({ name: 'audiobook', hash: tor.hash })}
              >
                <span class="m-set-text">
                  <span>{name.title}</span>
                  {name.meta && <span class="m-muted m-small">{name.meta}</span>}
                </span>
                <Icon d={CHEVRON} size={20} />
              </button>
            );
          })}
        </section>
      )}
    </div>
  );
}
