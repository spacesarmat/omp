// Shared Discover tile pieces (grid + homepage rails).
import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../../../../src/i18n';
import { ratingText } from './CatalogSearch';
import { cachedTileCard, leaveTileCard, requestTileCard, tileCardVersion } from '../../catalog/tileCards';
import { digitalSoonLabel, tileLabel, tileYear } from '../../lib/releaseDates';
import { readableTitle, type CatalogTitle, type Kind } from '../../../../src/catalog/tmdb';

/**
 * The date label of a tile («в цифре 12 нояб.», «новая серия 8 окт.»): the tile's card is asked for once the tile
 * comes into view; nothing until it is known. A «Скоро в цифре» item brings its `digital` date: shown at once (the
 * card is still asked for: the tile's year comes from it).
 */
export function TileWhen({ kind, id, digital }: { kind: Kind; id: number; digital?: string }) {
  void tileCardVersion.value;
  const ref = useRef<HTMLSpanElement>(null);
  const card = cachedTileCard(kind, id);
  const unknown = card === undefined;
  useEffect(() => {
    const node = ref.current;
    if (!unknown || !node || typeof IntersectionObserver === 'undefined') return;
    const target = node.parentElement || node;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) requestTileCard(kind, id);
      else leaveTileCard(kind, id);
    });
    io.observe(target);
    return () => {
      io.disconnect();
      leaveTileCard(kind, id);
    };
  }, [kind, id, unknown]);
  const text = digital ? digitalSoonLabel(digital) : card && card.kind !== 'tv' ? tileLabel(card) : '';
  return (
    <span ref={ref} class={'m-small m-accent m-disc-when' + (text ? '' : ' m-disc-when-none')} data-when={text ? '' : undefined}>
      {text}
    </span>
  );
}

/** Poster with a skeleton until the image paints (empty dark tiles read as a broken catalog). */
export function DiscPoster({ x, owned }: { x: CatalogTitle; owned: boolean }) {
  const [ready, setReady] = useState(!x.poster);
  useEffect(() => {
    setReady(!x.poster);
  }, [x.poster]);
  return (
    <span class={'m-disc-poster' + (x.poster && !ready ? ' m-disc-loading' : '')}>
      {x.poster ? (
        <>
          {!ready && <span class="m-disc-poster-skel" aria-hidden="true" />}
          <img
            src={x.poster}
            alt=""
            loading="lazy"
            onLoad={() => setReady(true)}
            onError={() => setReady(true)}
            style={ready ? undefined : { opacity: 0 }}
          />
        </>
      ) : (
        <span class={'m-disc-ph m-disc-ph-' + (x.id % 4)}>{x.title}</span>
      )}
      {x.rating > 0 && <span class="m-disc-rating">{ratingText(x.rating)}</span>}
      {owned && <span class="m-disc-badge">{t('discover.inLibrary')}</span>}
    </span>
  );
}

/**
 * The tile title: the list's one, or — when that is in a script a Russian or English user cannot read —
 * the card's English translation once known.
 */
export function TileTitle({ x }: { x: CatalogTitle }) {
  void tileCardVersion.value;
  if (readableTitle(x.title)) return <>{x.title}</>;
  const card = cachedTileCard(x.kind, x.id);
  return <>{card && readableTitle(card.title) ? card.title : x.title}</>;
}

/** «Фильм · 2006»: a «Скоро в цифре» item takes its year from the card (none until known). */
export function TileMeta({ x }: { x: CatalogTitle }) {
  void tileCardVersion.value;
  const year = tileYear(x, x.digital === undefined ? undefined : cachedTileCard(x.kind, x.id));
  return (
    <span class="m-muted m-small m-disc-meta">
      {(x.kind === 'tv' ? t('discover.series') : t('library.movie')) + (year ? ' · ' + year : '')}
    </span>
  );
}
