// «Обзор» → search: TMDB titles as you type, and a way on to the trackers with the same query.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { t, lang } from '../../../../src/i18n';
import { navigate } from '../../nav';
import { useBackHandler } from '../../ui/backStack';
import { Icon } from '../../ui/Icon';
import { torrents } from '../../../../src/store/library';
import { catalogErrorCode, type CatalogErrorCode } from '../../../../src/catalog/client';
import { libraryIndex, inLibrary } from '../../../../src/catalog/library';
import type { CatalogTitle } from '../../../../src/catalog/tmdb';
import { phoneCatalog, OFFLINE_TITLE, OFFLINE_TEXT, NOKEY_TEXT } from '../../catalog/phoneCatalog';

const DEBOUNCE_MS = 400;
const MIN_CHARS = 2;
const BACK = 'M15 5l-7 7l7 7';

export function ratingText(r: number): string {
  const s = r.toFixed(1);
  return '★ ' + (lang.peek() === 'en' ? s : s.replace('.', ','));
}

export function CatalogSearch({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const [items, setItems] = useState<CatalogTitle[] | null>(null);
  const [error, setError] = useState<CatalogErrorCode | null>(null);
  const [reload, setReload] = useState(0);
  const gen = useRef(0);
  // the first search of a visit and «Повторить» read the server's TMDB settings again
  const fresh = useRef(true);
  const list = torrents.value;
  const index = useMemo(() => libraryIndex(list), [list]);
  const q = text.trim();
  useBackHandler(onClose);

  useEffect(() => {
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
            if (gen.current === my) setItems(r.items);
          },
          (e) => {
            if (gen.current === my) setError(catalogErrorCode(e));
          },
        );
    }, reload ? 0 : DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q, reload]);

  return (
    <div class="m-discover m-srch">
      <div class="m-srch-bar">
        <button type="button" class="m-btn m-btn-secondary m-btn-sm" aria-label={t('common.back')} onClick={onClose}>
          <Icon d={BACK} size={18} />
        </button>
        <input
          class="m-input m-lib-search"
          type="search"
          autoFocus
          aria-label={t('discover.searchLabel')}
          placeholder={t('discover.searchLabel')}
          value={text}
          onInput={(e) => setText((e.target as HTMLInputElement).value)}
        />
      </div>
      {error ? (
        <div class="m-disc-error" role="alert">
          <p class="m-disc-error-title">{t(OFFLINE_TITLE)}</p>
          <p class="m-muted">{t(error === 'nokey' ? NOKEY_TEXT : OFFLINE_TEXT)}</p>
          <div class="m-disc-error-actions">
            <button
              type="button"
              class="m-btn m-btn-primary"
              onClick={() => {
                fresh.current = true;
                setReload((n) => n + 1);
              }}
            >
              {t('common.retry')}
            </button>
            {error === 'nokey' && (
              <button type="button" class="m-btn m-btn-secondary" onClick={() => navigate({ name: 'faq', q: 'tmdb-key' })}>
                {t('discover.howToKey')}
              </button>
            )}
          </div>
        </div>
      ) : items && items.length === 0 ? (
        <p class="m-muted">{t('discover.nothingFound')}</p>
      ) : (
        items && (
          <div class="m-srch-list">
            {items.map((x) => (
              <button
                key={x.kind + ':' + x.id}
                type="button"
                class="m-srch-row"
                onClick={() => navigate({ name: 'title', kind: x.kind, id: x.id })}
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
              </button>
            ))}
          </div>
        )
      )}
      {q.length >= MIN_CHARS && !error && items && (
        <div class="m-srch-trackers">
          <span class="m-muted">{t('discover.trackerAsk')}</span>
          <button type="button" class="m-btn m-btn-secondary" onClick={() => navigate({ name: 'add', query: q, run: true })}>
            {t('discover.trackerSearch', { q })}
          </button>
        </div>
      )}
    </div>
  );
}
