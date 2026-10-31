// «Сменить постер» on LG webOS and Android TV: a grid of TMDB posters for the torrent (its kind, its year first),
// a title opens its poster variants; «Поиск» changes the query, «Вставить ссылку» takes an image link, «Сбросить»
// clears the poster and looks one up again. The choice is written to TorrServer on every release of the film.
// Fixed px tiles and margins only (Chromium 53: no flex gap, aspect-ratio, inset or :has); the 1920x1080 root makes
// 1080p and 4K the same.
import { useEffect, useRef, useState } from 'preact/hooks';
import { getCurrentFocusKey, setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { DialogBadge, visibleDialogCode } from '../testmode/badge';
import { FocusGroup, Focusable, Button, Spinner } from './components';
import { focusAfterClose } from './focus';
import { useKeys } from './keys';
import { askText } from './TextDialog';
import { toast } from './toast';
import { tvGlyphs } from './tvText';
import { t } from '../i18n';
import { errorMessage } from '../api/http';
import type { Torrent } from '../api/types';
import type { CatalogTitle } from '../catalog/tmdb';
import { catalogErrorCode, catalogErrorKey } from '../catalog/client';
import { patchPosters, refreshTorrents } from '../store/library';
import { client } from '../store/servers';
import {
  checkPosterUrl,
  posterSearchText,
  resetPoster,
  savePoster,
  savedText,
  resetText,
  searchCandidates,
  storedPosterUrl,
  titleVariants,
} from '../lib/posterPick';

/** Tiles per row of the grid (fixed px: 6 x 236 = 1416 of the 1500 px dialog). */
export const POSTER_COLUMNS = 6;

export function PosterPicker(p: {
  torrent: Torrent;
  /** Every release the poster goes to, `torrent` first. */
  targets: Torrent[];
  /** After a write: the poster now on `torrent` ('' when reset found none). */
  onSaved: (poster: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(() => posterSearchText(p.torrent));
  const [items, setItems] = useState<CatalogTitle[] | null>(null);
  const [error, setError] = useState('');
  const [searching, setSearching] = useState(false);
  const [chosen, setChosen] = useState<CatalogTitle | null>(null);
  const [variants, setVariants] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const gen = useRef(0);
  // the variants request in flight: a reply for a title the user has left is dropped
  const variantGen = useRef(0);
  const prev = useRef(getCurrentFocusKey() || 'torrent-poster');

  useEffect(() => {
    search(query);
    setFocus('poster-search');
    return () => {
      alive.current = false;
      setTimeout(() => focusAfterClose(prev.current), 0);
    };
  }, []);

  const focusSoon = (key: string) => setTimeout(() => { if (alive.current) setFocus(key); }, 0);

  function search(q: string) {
    const my = ++gen.current;
    setSearching(true);
    setError('');
    setItems(null);
    searchCandidates(q, p.torrent).then(
      (list) => {
        if (!alive.current || my !== gen.current) return;
        setSearching(false);
        setItems(list);
        focusSoon(list.length ? 'poster-tile-0' : 'poster-search');
      },
      (e) => {
        if (!alive.current || my !== gen.current) return;
        setSearching(false);
        setItems([]);
        const code = catalogErrorCode(e);
        setError(code === 'nokey' ? t('torrent.poster.needKey') : t(catalogErrorKey(code, 'tv')));
        focusSoon('poster-search');
      },
    );
  }

  const openTitle = (item: CatalogTitle) => {
    const my = ++variantGen.current;
    setChosen(item);
    setVariants(null);
    titleVariants(item).then((urls) => {
      if (!alive.current || my !== variantGen.current) return;
      setVariants(urls);
      focusSoon(urls.length ? 'poster-variant-0' : 'poster-back');
    });
  };

  const backToResults = () => {
    const at = chosen && items ? items.indexOf(chosen) : -1;
    variantGen.current++;
    setChosen(null);
    setVariants(null);
    focusSoon(at >= 0 ? 'poster-tile-' + at : 'poster-search');
  };

  const save = (url: string) => {
    const c = client.value;
    if (!c || busy) return;
    setBusy(true);
    const poster = storedPosterUrl(url);
    savePoster(c, p.targets, poster).then(
      (r) => {
        patchPosters(r.saved, poster);
        if (r.saved.indexOf(p.torrent.hash) >= 0) p.onSaved(poster);
        toast(savedText(r, p.targets.length));
        if (alive.current) p.onClose();
      },
      (e) => {
        if (alive.current) setBusy(false);
        toast(errorMessage(e) || t('torrent.poster.saveFailed'), 'error');
      },
    );
  };

  const askQuery = () => {
    if (busy) return;
    askText(t('torrent.poster.searchLabel'), query, t('torrent.poster.search'), 'poster-query').then((v) => {
      focusSoon('poster-search');
      if (v === null || !alive.current) return;
      const q = v.trim();
      if (!q) return;
      setQuery(q);
      variantGen.current++;
      setChosen(null);
      search(q);
    });
  };

  const askLink = () => {
    if (busy) return;
    askText(t('torrent.poster.urlTitle'), 'https://', t('torrent.poster.urlSave'), 'poster-url').then((v) => {
      focusSoon('poster-url');
      if (v === null || !alive.current) return;
      const check = checkPosterUrl(v);
      if (!check.ok) {
        toast(t(check.error), 'error');
        return;
      }
      save(check.url);
    });
  };

  const reset = () => {
    const c = client.value;
    if (!c || busy) return;
    setBusy(true);
    resetPoster(c, p.targets).then(
      (r) => {
        patchPosters(r.cleared, '');
        patchPosters(r.withPoster, r.poster);
        if (r.withPoster.indexOf(p.torrent.hash) >= 0) p.onSaved(r.poster);
        else if (r.cleared.indexOf(p.torrent.hash) >= 0) p.onSaved('');
        toast(resetText(r, p.targets.length), r.failed ? 'error' : 'info');
        void refreshTorrents(c).catch(() => {});
        if (alive.current) p.onClose();
      },
      (e) => {
        if (alive.current) setBusy(false);
        toast(errorMessage(e) || t('torrent.poster.saveFailed'), 'error');
      },
    );
  };

  // above the screen, below DialogHost and the text dialog: Back leaves the variants, then closes
  useKeys((a) => {
    if (a === 'back') {
      if (busy) return true;
      if (chosen) backToResults();
      else p.onClose();
      return true;
    }
    return 'spatial';
  }, 50);

  const code = visibleDialogCode('torrent-poster');
  const tiles = chosen ? variants : items;
  return (
    <div
      class="dialog-backdrop poster-backdrop"
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        e.stopPropagation();
        if (!busy) p.onClose();
      }}
    >
      <FocusGroup focusKey="POSTER-PICKER" className={'dialog poster-dialog' + (code ? ' test-anchor' : '')} boundary>
        <DialogBadge id="torrent-poster" />
        <div class="poster-title">{chosen ? t('torrent.poster.variants') : t('torrent.poster.title')}</div>
        <div class="poster-sub">
          {chosen
            ? tvGlyphs(chosen.year ? chosen.title + ' · ' + chosen.year : chosen.title)
            : p.targets.length > 1
              ? t('torrent.poster.allReleases', { n: p.targets.length })
              : tvGlyphs(posterSearchText(p.torrent))}
        </div>
        <FocusGroup focusKey="POSTER-ACTIONS" className="poster-actions">
          {chosen ? (
            <Button focusKey="poster-back" label={t('torrent.poster.back')} onPress={backToResults} disabled={busy} />
          ) : (
            [
              <Button key="s" focusKey="poster-search" className="poster-query" label={tvGlyphs(t('torrent.poster.query', { q: query }))} onPress={askQuery} disabled={busy} />,
              <Button key="u" focusKey="poster-url" label={t('torrent.poster.url')} onPress={askLink} disabled={busy} />,
              <Button key="r" focusKey="poster-reset" label={t('torrent.poster.reset')} onPress={reset} disabled={busy} />,
            ]
          )}
        </FocusGroup>
        <FocusGroup focusKey={chosen ? 'POSTER-VARIANTS' : 'POSTER-GRID'} className="poster-grid">
          {(searching || (chosen && variants === null)) && <Spinner text={t('torrent.poster.searching')} />}
          {!searching && !chosen && error && <div class="poster-empty">{error}</div>}
          {!searching && !error && tiles && tiles.length === 0 && (
            <div class="poster-empty">{chosen ? t('torrent.poster.noVariants') : t('torrent.poster.none')}</div>
          )}
          {!searching && !chosen && items
            ? items.map((x, i) => (
                <Focusable
                  key={x.kind + x.id}
                  focusKey={'poster-tile-' + i}
                  className="poster-tile"
                  ariaLabel={x.year ? x.title + ', ' + x.year : x.title}
                  role="button"
                  disabled={busy}
                  onPress={() => openTitle(x)}
                >
                  <div class="poster-img">
                    <img src={x.poster} alt="" />
                  </div>
                  <div class="poster-cap">{tvGlyphs(x.title)}</div>
                  <div class="poster-year">{x.year ? String(x.year) : ''}</div>
                </Focusable>
              ))
            : null}
          {chosen && variants
            ? variants.map((u, i) => (
                <Focusable
                  key={u}
                  focusKey={'poster-variant-' + i}
                  className={'poster-tile poster-variant' + (u === p.torrent.poster ? ' current' : '')}
                  role="button"
                  ariaLabel={t('torrent.poster.pick') + ' ' + (i + 1)}
                  disabled={busy}
                  onPress={() => save(u)}
                >
                  <div class="poster-img">
                    <img src={u} alt="" />
                  </div>
                </Focusable>
              ))
            : null}
        </FocusGroup>
      </FocusGroup>
    </div>
  );
}
