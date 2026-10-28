import { useEffect, useRef, useState } from 'preact/hooks';
import { Sheet } from './Sheet';
import { showToast } from './toast';
import { PosterSheet } from '../screens/catalog/PosterSheet';
import { t } from '../../../src/i18n';
import { client } from '../../../src/store/servers';
import { patchPosters, refreshTorrents } from '../../../src/store/library';
import { errorMessage } from '../../../src/api/http';
import { catalogErrorCode, catalogErrorKey } from '../../../src/catalog/client';
import type { CatalogTitle } from '../../../src/catalog/tmdb';
import type { Torrent } from '../../../src/api/types';
import {
  checkPosterUrl,
  posterSearchText,
  resetPoster,
  savePoster,
  savedText,
  searchCandidates,
  storedPosterUrl,
  titleVariants,
  POSTER_URL_MAX,
} from '../../../src/lib/posterPick';

/**
 * «Сменить постер» on the phone: a search field with the title proper, TMDB results of the torrent's kind (its year
 * first); a result opens its poster variants (PosterSheet). «Вставить ссылку» takes an image link, «Сбросить» clears
 * the poster and looks one up again. The choice goes to TorrServer on every release in `targets` (the film's card).
 */
export function PosterPickSheet({
  tor,
  targets,
  onSaved,
  onClose,
}: {
  tor: Torrent;
  targets: Torrent[];
  /** After a write: the poster now on `tor` ('' when reset found none). */
  onSaved?: (poster: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(() => posterSearchText(tor));
  const [items, setItems] = useState<CatalogTitle[] | null>(null);
  const [error, setError] = useState('');
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [chosen, setChosen] = useState<CatalogTitle | null>(null);
  const [variants, setVariants] = useState<string[]>([]);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState('');
  const [linkError, setLinkError] = useState('');
  const alive = useRef(true);
  const gen = useRef(0);
  useEffect(() => {
    search(query);
    return () => {
      alive.current = false;
    };
  }, []);

  function search(q: string) {
    const my = ++gen.current;
    setSearching(true);
    setError('');
    searchCandidates(q, tor).then(
      (list) => {
        if (!alive.current || my !== gen.current) return;
        setSearching(false);
        setItems(list);
      },
      (e) => {
        if (!alive.current || my !== gen.current) return;
        setSearching(false);
        setItems([]);
        const code = catalogErrorCode(e);
        setError(code === 'nokey' ? t('torrent.poster.needKey') : t(catalogErrorKey(code, 'phone')));
      },
    );
  }

  const openTitle = (item: CatalogTitle) => {
    setChosen(item);
    setVariants(item.poster ? [item.poster] : []);
    titleVariants(item).then((urls) => {
      if (alive.current) setVariants(urls);
    });
  };

  const save = (url: string) => {
    const c = client.value;
    if (!c || busy) return Promise.resolve();
    setBusy(true);
    const poster = storedPosterUrl(url);
    return savePoster(c, targets, poster).then(
      (r) => {
        patchPosters(r.saved, poster);
        if (onSaved && r.saved.indexOf(tor.hash) >= 0) onSaved(poster);
        showToast(savedText(r, targets.length));
        if (alive.current) onClose();
      },
      (e) => {
        if (alive.current) setBusy(false);
        showToast(errorMessage(e) || t('torrent.poster.saveFailed'));
      },
    );
  };

  const saveLink = () => {
    const v = checkPosterUrl(link);
    if (!v.ok) {
      setLinkError(t(v.error));
      return;
    }
    setLinkError('');
    void save(v.url);
  };

  const reset = () => {
    const c = client.value;
    if (!c || busy) return;
    setBusy(true);
    resetPoster(c, targets).then(
      (found) => {
        patchPosters(targets.map((x) => x.hash), found);
        if (onSaved) onSaved(found);
        showToast(found ? t('torrent.poster.resetFound') : t('torrent.poster.resetNone'));
        void refreshTorrents(c).catch(() => {});
        if (alive.current) onClose();
      },
      (e) => {
        if (alive.current) setBusy(false);
        showToast(errorMessage(e) || t('torrent.poster.saveFailed'));
      },
    );
  };

  if (chosen) {
    return <PosterSheet urls={variants} current={tor.poster || ''} onPick={(u) => void save(u)} onClose={() => setChosen(null)} />;
  }

  return (
    <Sheet label={t('torrent.poster.title')} testId="PD56" onClose={onClose}>
      <div class="m-sheet-title">{t('torrent.poster.title')}</div>
      {targets.length > 1 && <p class="m-small m-muted m-pp-sub">{t('torrent.poster.allReleases', { n: targets.length })}</p>}
      <form
        class="m-pp-search"
        onSubmit={(e) => {
          e.preventDefault();
          search(query);
        }}
      >
        <input
          class="m-input"
          type="search"
          aria-label={t('torrent.poster.searchLabel')}
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        />
        <button type="submit" class="m-btn m-btn-secondary" disabled={searching}>
          {t('torrent.poster.search')}
        </button>
      </form>
      {searching && <p class="m-small m-muted">{t('torrent.poster.searching')}</p>}
      {!searching && error && (
        <p class="m-small m-muted" role="alert">
          {error}
        </p>
      )}
      {!searching && !error && items && !items.length && <p class="m-small m-muted">{t('torrent.poster.none')}</p>}
      {!searching && items && items.length > 0 && (
        <div class="m-art-grid m-pp-grid">
          {items.map((x) => (
            <button key={x.kind + x.id} type="button" class="m-art-pick m-pp-item" disabled={busy} onClick={() => openTitle(x)}>
              <img src={x.poster} alt="" />
              <span class="m-small m-pp-cap">{x.year ? x.title + ' · ' + x.year : x.title}</span>
            </button>
          ))}
        </div>
      )}
      {linkOpen ? (
        <div class="m-field m-pp-link">
          <label for="poster-link">{t('torrent.poster.urlTitle')}</label>
          <input
            id="poster-link"
            class="m-input"
            type="url"
            inputMode="url"
            autoFocus
            maxLength={POSTER_URL_MAX}
            placeholder="https://"
            value={link}
            onInput={(e) => setLink((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === 'Enter' && !busy && saveLink()}
          />
          {linkError && (
            <div class="m-error" role="alert">
              {linkError}
            </div>
          )}
          <button type="button" class="m-btn m-btn-primary" disabled={busy} onClick={saveLink}>
            {t('torrent.poster.urlSave')}
          </button>
        </div>
      ) : null}
      <div class="m-sheet-row m-pp-actions">
        {!linkOpen && (
          <button type="button" class="m-btn m-btn-secondary" disabled={busy} onClick={() => setLinkOpen(true)}>
            {t('torrent.poster.url')}
          </button>
        )}
        <button type="button" class="m-btn m-btn-secondary" disabled={busy} onClick={reset}>
          {t('torrent.poster.reset')}
        </button>
      </div>
    </Sheet>
  );
}
