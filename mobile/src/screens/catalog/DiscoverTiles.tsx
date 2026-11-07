// Shared Discover tile pieces (grid + homepage rails).
import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../../../../src/i18n';
import { LazyImg } from '../../ui/LazyImg';
import { ratingText } from './CatalogSearch';
import { cachedTileCard, leaveTileCard, requestTileCard, tileCardVersion } from '../../catalog/tileCards';
import { digitalSoonLabel, tileLabel, tileYear } from '../../lib/releaseDates';
import { readableTitle, type CatalogTitle, type Kind } from '../../../../src/catalog/tmdb';

/**
 * The tile card is asked for once this row is on screen. The date line is not the only reader: a plain list
 * still needs the English title and, for «Скоро в цифре», the year.
 */
function useTileCard(kind: Kind, id: number, ref: { current: HTMLElement | null }) {
  const unknown = cachedTileCard(kind, id) === undefined;
  useEffect(() => {
    const node = ref.current;
    if (!unknown || !node || typeof IntersectionObserver === 'undefined') return;
    const target = node.parentElement || node;
    let held = false;
    const hold = () => {
      if (held) return;
      held = true;
      requestTileCard(kind, id);
    };
    const drop = () => {
      if (!held) return;
      held = false;
      leaveTileCard(kind, id);
    };
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) hold();
      else drop();
    });
    io.observe(target);
    return () => {
      io.disconnect();
      drop();
    };
  }, [kind, id, unknown]);
}

/**
 * The date label of a tile («в цифре 12 нояб.», «новая серия 8 окт.»): nothing until the card is known.
 * A «Скоро в цифре» item brings its `digital` date: shown at once (the card is still asked for).
 */
export function TileWhen({ kind, id, digital }: { kind: Kind; id: number; digital?: string }) {
  void tileCardVersion.value;
  const ref = useRef<HTMLSpanElement>(null);
  useTileCard(kind, id, ref);
  const card = cachedTileCard(kind, id);
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
    <span class={'m-disc-poster' + (x.poster && !ready ? ' m-disc-loading' : '')} data-poster={x.kind + ':' + x.id}>
      {x.poster ? (
        <>
          {!ready && <span class="m-disc-poster-skel" aria-hidden="true" />}
          <LazyImg src={x.poster} onLoad={() => setReady(true)} onError={() => setReady(true)} />
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
  const ref = useRef<HTMLSpanElement>(null);
  useTileCard(x.kind, x.id, ref);
  const card = cachedTileCard(x.kind, x.id);
  const title = readableTitle(x.title) ? x.title : card && readableTitle(card.title) ? card.title : x.title;
  return (
    <>
      <span ref={ref} hidden aria-hidden="true" />
      {title}
    </>
  );
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
